import type {
  CameraSpec,
  LabelMetrics,
  LabelSpec,
  LayoutSpec,
  Package,
  PackageResult,
} from './types';
import { BeltMotion } from './belt';
import { sampleTriggerLines } from './lineScan';
import { areaSampler, codeFitScale, labelDepth, lineSampler, modulePixels, renderLabelCrop, labelWorldBasis, type PackagePose } from './render';
import { checkVisibility } from './visibility';
import { cameraBeltDistance, depthOfField, liquidFocusAt, mmPerPixel } from './optics';
import { cameraBasis } from './camera';
import { encodeCode } from './barcode';
import { classifyFailure, decodeGray, measureContrast, minModulePixels } from './decoder';
import { glareCoverage } from './lighting';
import { Rng } from './rng';

/** 包裹间距（mm，含空隙），沿皮带排开 */
export const PACKAGE_GAP_MM = 200;
export const FIRST_PACKAGE_Y = 800;

export function buildPoses(packages: Package[]): PackagePose[] {
  let y = FIRST_PACKAGE_Y;
  return packages.map((pkg) => {
    const pose: PackagePose = { pkg, yCenter: y + pkg.length / 2 };
    y += pkg.length + PACKAGE_GAP_MM;
    return pose;
  });
}

export interface EngineOptions {
  layout: LayoutSpec;
  maxRenderWidth: number;
  /** 噪声种子，保证同批结果可复现 */
  noiseSeed: number;
}

export class SimEngine {
  readonly layout: LayoutSpec;
  private readonly motion: BeltMotion;
  private readonly maxWidth: number;
  private readonly rng: Rng;

  constructor(opts: EngineOptions) {
    this.layout = opts.layout;
    this.motion = new BeltMotion(opts.layout.belt.speedProfile, opts.layout.belt.speedMmPerS);
    this.maxWidth = opts.maxRenderWidth;
    this.rng = new Rng(opts.noiseSeed);
  }

  /** 单个包裹走完整套布局，返回该包裹的读码结果 */
  processPackage(pose: PackagePose): PackageResult {
    const perCamera = this.layout.cameras.map((cam) => {
      // 面阵只在包裹穿过其 y 面瞬间成像：把包裹纵向平移到该时刻位置；
      // 线阵随皮带逐行扫描，覆盖整条通过路径，用原始姿态。
      const camPose: PackagePose =
        cam.type === 'area' ? { pkg: pose.pkg, yCenter: cam.position.y } : pose;
      return this.runCamera(cam, camPose);
    });
    const readOk = perCamera.some((c) => c.decodeOk);
    // 仅当面单对所有相机都不朝向（底面/朝向死角）时记为无可见面单
    const noVisibleLabel = pose.pkg.labels.every((label) =>
      this.layout.cameras.every((cam) => !checkVisibility(cam, pose, label).visible),
    );
    return {
      packageId: pose.pkg.id,
      type: pose.pkg.type,
      readOk,
      noVisibleLabel,
      perCamera,
    };
  }

  private runCamera(cam: CameraSpec, pose: PackagePose) {
    const labels: LabelMetrics[] = [];
    let decodeOk = false;

    for (const label of pose.pkg.labels) {
      const vis = checkVisibility(cam, pose, label);
      const depth = labelDepth(cam, pose, label);
      const modulePx = modulePixels(cam, pose, label);

      const metric: LabelMetrics = {
        labelId: label.id,
        codeType: label.codeType,
        modulePx,
        contrast: 0,
        glareCoverage: 0,
        blurSigmaPx: 0,
        noiseSigma: cam.readNoise,
        visible: vis.visible,
        inFov: vis.inFov,
        decodeOk: false,
      };

      if (!vis.visible || !vis.inFov) {
        metric.failureReason = classifyFailure(metric);
        labels.push(metric);
        continue;
      }

      // 对焦距离：液态镜头带延迟，普通镜头固定
      const beltDist = cameraBeltDistance(cam);
      const focusDistance = cam.lens.liquidLens
        ? liquidFocusAt(cam, pose.pkg, beltDist, this.curtainHitT(pose), this.labelPassT(pose, cam, label))
        : cam.lens.focusDistanceMm;
      const dof = depthOfField(cam, focusDistance);
      const outsideDof = depth < dof.near || depth > dof.far;

      // 离焦 + 运动模糊
      const defocus = outsideDof ? this.defocusSigma(cam, focusDistance, depth) : 0;
      const motion = this.motionSigma(cam, depth);
      metric.blurSigmaPx = Math.hypot(defocus, motion);
      metric.glareCoverage = glareCoverage(cam, this.layout.lights, this.makeGlareSamples(pose, label));

      // 反光/模糊严重的物理上注定读不出，跳过昂贵渲染与解码
      if (metric.glareCoverage >= 0.35) {
        metric.failureReason = 'glare';
        labels.push(metric);
        continue;
      }
      if (metric.blurSigmaPx >= 1.5) {
        metric.failureReason = 'blur';
        labels.push(metric);
        continue;
      }

      const codeBitmap = encodeCode(label.payload, label.codeType);
      // 分辨率预检要基于"实际渲染"的有效模块像素：含条码缩放 fitScale
      const fit = codeFitScale(label, codeBitmap, label.moduleMm);
      const effectiveModulePx = modulePx * fit;
      if (effectiveModulePx < minModulePixels(label.codeType)) {
        metric.modulePx = effectiveModulePx;
        metric.failureReason = 'resolution';
        labels.push(metric);
        continue;
      }

      const basis = labelWorldBasis(pose, label);
      const triggers = cam.type === 'line' ? this.lineTriggers(cam, pose) : undefined;
      const sampler =
        cam.type === 'line'
          ? lineSampler(cam, pose, label, triggers!)
          : areaSampler(cam, basis.center, basis.normal);

      const crop = renderLabelCrop(
        cam,
        pose,
        label,
        sampler,
        {
          maxWidth: this.maxWidth,
          blurSigmaX: metric.blurSigmaPx,
          blurSigmaY: cam.type === 'line' ? metric.blurSigmaPx : motion,
          noiseSigma: cam.readNoise,
          codeBitmap,
          lights: this.layout.lights,
          rng: this.rng,
        },
        triggers,
      );

      if (crop) {
        // 实际输出的模块像素：理论值 × 条码缩放 × 降采样倒数，与渲染图严格一致
        metric.modulePx = (modulePx * crop.fitScale) / crop.step;
        metric.contrast = measureContrast(crop, crop.codeBounds);
        // 快速预检：物理指标已注定读不出的，不进昂贵的 zxing 解码
        const preFail = classifyFailure(metric);
        if (preFail === 'resolution' || preFail === 'glare' || preFail === 'blur') {
          metric.failureReason = preFail;
          labels.push(metric);
          continue;
        }
        const text = decodeGray(crop);
        metric.decodeOk = text === label.payload;
        if (metric.decodeOk) decodeOk = true;
      }
      if (!metric.decodeOk) metric.failureReason = classifyFailure(metric);
      labels.push(metric);
    }

    return { cameraId: cam.id, decodeOk, labels };
  }

  /** 包裹前缘到达测高光幕的相对时刻 */
  private curtainHitT(pose: PackagePose): number {
    const frontY = pose.yCenter + pose.pkg.length / 2;
    return this.motion.tAfterDistance(0, Math.max(0, frontY - this.layout.belt.lightCurtainY));
  }

  /** 面单中心经过相机所在 y 面的时刻（液态镜头对焦延迟用） */
  private labelPassT(pose: PackagePose, cam: CameraSpec, label: LabelSpec): number {
    const center = labelWorldBasis(pose, label).center;
    void cameraBasis;
    return this.motion.tAfterDistance(0, Math.max(0, center.y - cam.position.y));
  }

  private defocusSigma(cam: CameraSpec, focusDistance: number, subjectDistance: number): number {
    const f = cam.lens.focalMm;
    const N = cam.lens.fNumber;
    const vFocus = 1 / (1 / f - 1 / focusDistance);
    const vSub = 1 / (1 / f - 1 / subjectDistance);
    const bImg = Math.abs(vFocus - vSub) / N;
    return bImg / (2 * (cam.pixelUm / 1000));
  }

  private motionSigma(cam: CameraSpec, depth: number): number {
    const v = this.layout.belt.speedMmPerS;
    const mmPx = mmPerPixel(cam, depth);
    if (cam.type === 'area') {
      // 面阵：曝光窗口内皮带拖影，Gaussian 1σ 取半
      const smearMm = v * (cam.exposureUs / 1e6);
      return smearMm / mmPx / 2;
    }
    // 线阵编码器触发：每行恰好对应 mmPerLine 物理位移，纵向几何已由
    // 触发吸收，只剩单行积分时间内的亚行拖影（取行周期的一半）
    const trig = cam.trigger;
    if (trig.mode === 'encoder') {
      const linePeriod = trig.mmPerLine / Math.max(1, v);
      const smearMm = v * linePeriod * 0.5;
      return smearMm / mmPx / 2;
    }
    // freerun：行频与速度失配时，每行覆盖物理距离偏离 1 个触发单元
    const linePeriod = 1 / trig.lineRateHz;
    const smearMm = Math.abs(v * linePeriod - trig.mmPerLine);
    return smearMm / mmPx / 2;
  }

  private lineTriggers(cam: CameraSpec, pose: PackagePose) {
    const halfL = pose.pkg.length / 2 + 4;
    return sampleTriggerLines({
      trigger: cam.trigger,
      constantSpeed: this.layout.belt.speedMmPerS,
      speedProfile: this.layout.belt.speedProfile,
      yStart: pose.yCenter - halfL,
      yEnd: pose.yCenter + halfL,
    });
  }

  private makeGlareSamples(pose: PackagePose, label: LabelSpec) {
    const basis = labelWorldBasis(pose, label);
    const samples: Array<{
      point: { x: number; y: number; z: number };
      normal: { x: number; y: number; z: number };
      roughness: number;
      specularMaterial: boolean;
    }> = [];
    for (let i = 0; i < 9; i++) {
      for (let j = 0; j < 7; j++) {
        const u = (i / 8 - 0.5) * label.width;
        const v = (j / 6 - 0.5) * label.height;
        samples.push({
          point: {
            x: basis.center.x + basis.uAxis.x * u + basis.vAxis.x * v,
            y: basis.center.y + basis.uAxis.y * u + basis.vAxis.y * v,
            z: basis.center.z + basis.uAxis.z * u + basis.vAxis.z * v,
          },
          normal: basis.normal,
          roughness: pose.pkg.roughness,
          specularMaterial: label.laminate || pose.pkg.type === 'plastic',
        });
      }
    }
    return samples;
  }
}

/** 批量运行（Worker/主线程通用），每 chunkSize 件回调一次，shouldAbort 返回 true 时提前停止 */
export async function runBatch(
  packages: Package[],
  opts: EngineOptions,
  onProgress: (processed: number, chunk: PackageResult[]) => void,
  chunkSize = 50,
  shouldAbort: () => boolean = () => false,
): Promise<PackageResult[]> {
  const engine = new SimEngine(opts);
  const poses = buildPoses(packages);
  const results: PackageResult[] = [];
  for (let i = 0; i < poses.length; i++) {
    if (shouldAbort()) break;
    results.push(engine.processPackage(poses[i]));
    if (results.length % chunkSize === 0 || i === poses.length - 1) {
      onProgress(results.length, results.slice(-chunkSize));
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  return results;
}
