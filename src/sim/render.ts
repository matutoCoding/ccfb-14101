import type { CameraSpec, LabelSpec, LightSpec, Package, Vec3 } from './types';
import type { LineTrigger } from './lineScan';
import { add, dot, faceFrames, labelCornersLocal, normalize, scale, sub, topHeightAt, topNormalAt } from './geometry';
import { cameraBasis, focalPixels, lineRay, project } from './camera';
import { mmPerPixel } from './optics';
import { shade } from './lighting';
import { codePhysicalSize } from './barcode';
import { type Point2 } from './homography';
import { Rng } from './rng';

/** 包裹在皮带坐标系中的位姿：中心 (x, yCenter)，底面 z=0 */
export interface PackagePose {
  pkg: Package;
  yCenter: number;
}

function pkgCenter(pose: PackagePose): Vec3 {
  return { x: pose.pkg.x, y: pose.yCenter, z: pose.pkg.height / 2 };
}

/** 面所在平面（世界系）：point 与法线 */
function facePlane(pose: PackagePose, face: LabelSpec['face']): { point: Vec3; normal: Vec3 } {
  const frames = faceFrames(pose.pkg);
  const f = frames[face];
  return { point: add(pkgCenter(pose), f.center), normal: f.normal };
}

/** 面单中心、面内两轴（世界系，已含 tilt 旋转） */
export function labelWorldBasis(pose: PackagePose, label: LabelSpec) {
  const frames = faceFrames(pose.pkg);
  const f = frames[label.face];
  const c = Math.cos((label.tiltDeg * Math.PI) / 180);
  const s = Math.sin((label.tiltDeg * Math.PI) / 180);
  const uAxis = normalize(add(scale(f.uAxis, c), scale(f.vAxis, s)));
  const vAxis = normalize(add(scale(f.uAxis, -s), scale(f.vAxis, c)));
  const center = add(pkgCenter(pose), add(f.center, add(scale(f.uAxis, label.u), scale(f.vAxis, label.v))));
  return { center, uAxis, vAxis, normal: f.normal, frame: f };
}

function intersectPlane(origin: Vec3, dir: Vec3, planePoint: Vec3, planeNormal: Vec3): number | null {
  const denom = dot(dir, planeNormal);
  if (Math.abs(denom) < 1e-12) return null;
  const t = dot(sub(planePoint, origin), planeNormal) / denom;
  return t > 0 ? t : null;
}

/** 像素 → 世界点采样器：面阵走射线/面平面，线阵行坐标由皮带触发约束 */
export interface WorldSampler {
  width: number;
  height: number;
  /**
   * true 表示采样器网格本身就是面单的方形物理网格（线阵方形化输出），
   * 渲染时整张铺满，UV 由 labelUvAt 在 -1..1 给出；
   * false（面阵）则网格是传感器像素，需按投影包围盒裁剪。
   */
  labelSpace?: boolean;
  worldAt(col: number, row: number): Vec3 | null;
  /**
   * 像素在面单内的归一化 UV（-1..1）。
   * 线阵直接按行列解析映射，避免世界点往返产生的浮点抖动；
   * 不提供时由 worldAt + 面单基向量反算（面阵）。
   */
  labelUvAt?(col: number, row: number): { u: number; v: number } | null;
}

/** 面阵采样器：像素射线与指定面平面求交 */
export function areaSampler(cam: CameraSpec, planePoint: Vec3, planeNormal: Vec3): WorldSampler {
  const b = cameraBasis(cam);
  const { fx, fy } = focalPixels(cam);
  return {
    width: cam.sensorWidthPx,
    height: cam.sensorHeightPx,
    worldAt(col, row) {
      const dx = (col - cam.sensorWidthPx / 2) / fx;
      const dy = -(row - cam.sensorHeightPx / 2) / fy;
      const dir = normalize(add(add(b.fwd, scale(b.right, dx)), scale(b.up, dy)));
      const t = intersectPlane(cam.position, dir, planePoint, planeNormal);
      if (t === null) return null;
      return add(cam.position, scale(dir, t));
    },
  };
}

/**
 * 线阵采样器：row → beltY（编码器/自由运行触发结果），col → 线阵像元射线。
 * 顶扫：射线交顶面平面，y 强制取触发位置（线扫描的定义约束）；
 * 侧扫：列跨高度方向，射线交侧面 x 平面，y 同样取触发位置。
 */
export function lineSampler(
  cam: CameraSpec,
  pose: PackagePose,
  label: LabelSpec,
  triggers: LineTrigger[],
): WorldSampler {
  const plane = facePlane(pose, label.face);
  // 面单四角在原始线扫图上的 (列,行)，用于输出网格到传感器坐标的映射
  const localCorners = labelCornersLocal(pose.pkg, label);
  const center0 = pkgCenter(pose);
  const cornerPx: Point2[] = localCorners.map((lc) => {
    const world = add(center0, lc);
    const proj = project(cam, world);
    return { x: proj.col, y: rowForBeltY(triggers, world.y) };
  });
  // 纵向物理尺度归一化：线阵行间距 = mmPerLine（编码器），与横向光学 mm/px 不同。
  // 输出网格按"面单物理尺寸 / 横向 mm/px"定宽高，使每个输出像素对应相同的物理尺度，
  // 条码在纵横方向模块像素一致，解码库才能正常工作。
  const mmPxX = mmPerPixel(cam, labelDepth(cam, pose, label));
  const outW = Math.max(1, Math.round(label.width / mmPxX));
  const outH = Math.max(1, Math.round(label.height / mmPxX));
  // 输出像素 (u,v) → 原始传感器 (col,row)：先 homography 得 UV，再线性映回角点包围盒
  const colLo = Math.min(...cornerPx.map((q) => q.x));
  const colHi = Math.max(...cornerPx.map((q) => q.x));
  const rowLo = Math.min(...cornerPx.map((q) => q.y));
  const rowHi = Math.max(...cornerPx.map((q) => q.y));
  return {
    width: outW,
    height: outH,
    labelSpace: true,
    worldAt(col, row) {
      // 输出网格坐标 → 归一化 UV → 原始行列 → 触发 beltY
      const uv: Point2 = { x: (col / (outW - 1)) * 2 - 1, y: (row / (outH - 1)) * 2 - 1 };
      const srcCol = colLo + ((uv.x + 1) / 2) * (colHi - colLo);
      const srcRow = Math.round(rowLo + ((uv.y + 1) / 2) * (rowHi - rowLo));
      const trig = triggers[srcRow];
      if (!trig) return null;
      const y = trig.beltY;
      const ray = lineRay(cam, srcCol);
      const face = label.face;
      if (face === 'top' || face === 'bottom') {
        if (Math.abs(ray.dir.z) < 1e-12) return null;
        const t = (plane.point.z - ray.origin.z) / ray.dir.z;
        if (t <= 0) return null;
        const p = add(ray.origin, scale(ray.dir, t));
        p.y = y;
        if (face === 'top' && label.wrinkle) {
          p.z = plane.point.z + topHeightAt(label.wrinkle, p.x - pose.pkg.x, p.y - pose.yCenter);
        }
        return p;
      }
      if (face === 'left' || face === 'right') {
        if (Math.abs(ray.dir.x) < 1e-12) return null;
        const t = (plane.point.x - ray.origin.x) / ray.dir.x;
        if (t <= 0) return null;
        const p = add(ray.origin, scale(ray.dir, t));
        p.y = y;
        return p;
      }
      // front/back：y 平面即触发位置，射线给出 x、z
      const t = intersectPlane(ray.origin, ray.dir, { ...plane.point, y }, plane.normal);
      if (t === null) return null;
      const p = add(ray.origin, scale(ray.dir, t));
      p.y = y;
      return p;
    },
    labelUvAt(col, row) {
      // 输出网格本身就是面单的方形物理采样，UV 直接由归一化网格坐标给出
      const u = (col / (outW - 1)) * 2 - 1;
      const v = (row / (outH - 1)) * 2 - 1;
      if (u < -1 || u > 1 || v < -1 || v > 1) return null;
      return { u, v };
    },
  };
}

/** 世界点是否落在面单矩形内（含褶皱修正），返回面内归一化 uv（-1..1） */
function labelUv(pose: PackagePose, label: LabelSpec, p: Vec3): { u: number; v: number } | null {
  const basis = labelWorldBasis(pose, label);
  const rel = sub(p, basis.center);
  const u = dot(rel, basis.uAxis);
  const v = dot(rel, basis.vAxis);
  if (Math.abs(u) > label.width / 2 + 0.5 || Math.abs(v) > label.height / 2 + 0.5) return null;
  return { u: u / (label.width / 2), v: v / (label.height / 2) };
}

/** 触发序列中 beltY 对应的行号（最近邻，二分） */
export function rowForBeltY(triggers: LineTrigger[], beltY: number): number {
  let lo = 0;
  let hi = triggers.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (triggers[mid].beltY < beltY) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * 面单四角在目标图上的像素坐标。
 * 面阵：针孔投影；线阵：列按投影角，行按触发 beltY 反查。
 */
export function labelPixelCorners(
  cam: CameraSpec,
  pose: PackagePose,
  label: LabelSpec,
  triggers?: LineTrigger[],
): Array<{ col: number; row: number }> {
  const localCorners = labelCornersLocal(pose.pkg, label);
  const center = pkgCenter(pose);
  const pts = localCorners.map((lc) => {
    const world = add(center, lc);
    const proj = project(cam, world);
    const row =
      cam.type === 'line' && triggers && triggers.length > 0
        ? rowForBeltY(triggers, world.y)
        : proj.row;
    return { col: proj.col, row, depth: proj.depth, inFront: proj.inFront };
  });
  // 任一角点落到相机背后或过近，面单无法稳定成像
  if (pts.some((q) => !q.inFront || q.depth <= 1 || !Number.isFinite(q.col) || !Number.isFinite(q.row))) {
    return [];
  }
  return pts.map(({ col, row }) => ({ col, row }));
}

export interface GrayImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** 条码因超出面单而整体缩放的因子（1 = 原始物理尺寸放得下） */
export function codeFitScale(
  label: LabelSpec,
  bitmap: { width: number; height: number },
  moduleMm: number,
): number {
  const phys = codePhysicalSize(label.codeType, bitmap, moduleMm);
  return Math.min(1, (label.width * 0.9) / phys.widthMm, (label.height * 0.9) / phys.heightMm);
}

/** 条码按真实物理尺寸在面单上居中渲染的归一化半宽/半高（UV 域） */
export function codeHalfUv(label: LabelSpec, fitScale: number, bitmap: { width: number; height: number }, moduleMm: number) {
  const phys = codePhysicalSize(label.codeType, bitmap, moduleMm);
  return {
    halfUW: (phys.widthMm * fitScale) / label.width,
    halfVH: (phys.heightMm * fitScale) / label.height,
  };
}

/** 可分离高斯模糊（sigma=0 跳过）。sigma 钳到 12px，避免极端离焦时核半径爆炸 */
export function gaussianBlur(img: GrayImage, sigmaX: number, sigmaY: number): void {
  const sx = Math.min(12, Math.max(0, sigmaX));
  const sy = Math.min(12, Math.max(0, sigmaY));
  if (sx < 0.05 && sy < 0.05) return;
  const tmp = new Float32Array(img.data);
  const pass = (sigma: number, horizontal: boolean) => {
    if (sigma < 0.05) return;
    const radius = Math.max(1, Math.ceil(sigma * 3));
    const kernel = new Float32Array(radius * 2 + 1);
    let norm = 0;
    for (let i = -radius; i <= radius; i++) {
      const k = Math.exp(-(i * i) / (2 * sigma * sigma));
      kernel[i + radius] = k;
      norm += k;
    }
    const src = Float32Array.from(tmp);
    const { width: w, height: h } = img;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let acc = 0;
        for (let i = -radius; i <= radius; i++) {
          const xx = horizontal ? Math.min(w - 1, Math.max(0, x + i)) : x;
          const yy = horizontal ? y : Math.min(h - 1, Math.max(0, y + i));
          acc += src[yy * w + xx] * kernel[i + radius];
        }
        tmp[y * w + x] = acc / norm;
      }
    }
  };
  pass(sx, true);
  pass(sy, false);
  for (let i = 0; i < img.data.length; i++) img.data[i] = tmp[i];
}

/** 加读出噪声 + 与亮度相关的散粒噪声 */
export function addNoise(img: GrayImage, readSigma: number, rng: Rng): void {
  if (readSigma <= 0.01) return;
  for (let i = 0; i < img.data.length; i++) {
    const shot = Math.sqrt(img.data[i] / 255) * readSigma * 0.6;
    img.data[i] = img.data[i] + rng.gaussian(0, Math.hypot(readSigma, shot));
  }
}

export interface CropOptions {
  /** 裁剪宽度上限（批量模式控成本） */
  maxWidth: number;
  blurSigmaX: number;
  blurSigmaY: number;
  noiseSigma: number;
  codeBitmap: { width: number; height: number; data: Uint8Array };
  lights: LightSpec[];
  rng: Rng;
}

export interface LabelCrop extends GrayImage {
  labelId: string;
  /** 裁剪区在传感器全图中的像素位置 */
  offsetX: number;
  offsetY: number;
  /** 条码在裁剪图内的区域 */
  codeBounds: { x0: number; y0: number; x1: number; y1: number };
  /** 传感器原生像素 → 输出像素的采样步长（>1 表示降采样） */
  step: number;
  /** 条码因超出面单而整体缩放的因子（1 = 原始物理尺寸） */
  fitScale: number;
}

/**
 * 渲染单张面单的裁剪灰度图（逆映射）。
 * 条码占面单中间 82% 区域，其余为纸面；颜色/反光/褶皱逐像素计算。
 */
export function renderLabelCrop(
  cam: CameraSpec,
  pose: PackagePose,
  label: LabelSpec,
  sampler: WorldSampler,
  opts: CropOptions,
  triggers?: LineTrigger[],
): LabelCrop | null {
  // 确定渲染区域：
  // 线阵 labelSpace 采样器本身就是面单方形网格，整张铺满；
  // 面阵按面单四角投影包围盒从传感器像素中裁剪。
  let x0: number;
  let y0: number;
  let cropW: number;
  let cropH: number;
  if (sampler.labelSpace) {
    x0 = 0;
    y0 = 0;
    cropW = sampler.width;
    cropH = sampler.height;
  } else {
    const corners = labelPixelCorners(cam, pose, label, cam.type === 'line' ? triggers : undefined);
    if (corners.length === 0) return null;
    let minC = Infinity;
    let minR = Infinity;
    let maxC = -Infinity;
    let maxR = -Infinity;
    for (const q of corners) {
      if (!Number.isFinite(q.col) || !Number.isFinite(q.row)) return null;
      minC = Math.min(minC, q.col);
      maxC = Math.max(maxC, q.col);
      minR = Math.min(minR, q.row);
      maxR = Math.max(maxR, q.row);
    }
    if (!Number.isFinite(minC)) return null;
    if (minC < -sampler.width || maxC > sampler.width * 2 || minR < -sampler.height || maxR > sampler.height * 2) {
      return null;
    }
    const pad = 4;
    x0 = Math.max(0, Math.floor(minC) - pad);
    y0 = Math.max(0, Math.floor(minR) - pad);
    const x1 = Math.min(sampler.width - 1, Math.ceil(maxC) + pad);
    const y1 = Math.min(sampler.height - 1, Math.ceil(maxR) + pad);
    if (x1 <= x0 || y1 <= y0) return null;
    cropW = x1 - x0 + 1;
    cropH = y1 - y0 + 1;
    if (cropW > sampler.width * 2 || cropH > sampler.height * 2 || cropW * cropH > 40_000_000) {
      return null;
    }
  }
  // 各向同性降采样：宽高用同一整数步长，保证输出像素始终方形（条码不被拉伸）
  const step = Math.max(1, Math.ceil(Math.max(cropW, cropH) / opts.maxWidth));
  const w = Math.ceil(cropW / step);
  const h = Math.ceil(cropH / step);
  const img: GrayImage = { width: w, height: h, data: new Uint8ClampedArray(w * h) };
  const basis = labelWorldBasis(pose, label);
  const code = opts.codeBitmap;
  // 条码按真实物理尺寸在面单上居中。
  // 一维码模块数多（含静区），物理宽可能超过面单：此时整体等比缩放到面单的 90%，
  // 缩放因子同时作用于"有效模块像素"，保证模块分辨率指标与画面一致。
  const phys = codePhysicalSize(label.codeType, code, label.moduleMm);
  const fitScale = Math.min(1, (label.width * 0.9) / phys.widthMm, (label.height * 0.9) / phys.heightMm);
  const renderWidthMm = phys.widthMm * fitScale;
  const renderHeightMm = phys.heightMm * fitScale;
  // UV 在面单内跨 -1..1；条码半宽占面单半宽比例 = 条码宽/面单宽
  const halfUW = renderWidthMm / label.width;
  const halfVH = renderHeightMm / label.height;
  // 实际渲染模块像素 = 理论模块像素 × 缩放（供指标对齐）
  const effectiveModuleScale = fitScale;

  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      const col = x0 + xx * step;
      const row = y0 + yy * step;
      const p = sampler.worldAt(col, row);
      // 线阵走解析 UV；面阵由世界点反算
      const uv = sampler.labelUvAt ? sampler.labelUvAt(col, row) : p ? labelUv(pose, label, p) : null;
      let gray = 0;
      if (p && uv) {
        // 法线：褶皱顶面取数值梯度法线
        let normal = basis.normal;
        if (label.face === 'top' && label.wrinkle) {
          normal = topNormalAt(label.wrinkle, p.x - pose.pkg.x, p.y - pose.yCenter);
        }
        const shading = shade({
          point: p,
          normal,
          roughness: pose.pkg.roughness,
          specularMaterial: label.laminate || pose.pkg.type === 'plastic',
          camera: cam,
          lights: opts.lights,
        });
        // 条码物理区域内按模块映射（静区含在 bitmap 里，自然留白）
        const cu = uv.u / halfUW;
        const cv = uv.v / halfVH;
        const inCode = cu >= -1 && cu <= 1 && cv >= -1 && cv <= 1;
        let ink = 0; // 0=纸面
        if (inCode) {
          const bx = Math.min(code.width - 1, Math.max(0, Math.floor(((cu + 1) / 2) * code.width)));
          const by = Math.min(code.height - 1, Math.max(0, Math.floor(((cv + 1) / 2) * code.height)));
          ink = code.data[by * code.width + bx];
        }
        const paperWhite = 228;
        const inkBlack = 26;
        const base = ink ? inkBlack : paperWhite;
        const lit = base * shading.diffuse * cam.gain;
        // 镜面反光把条码"晃没"：hotSpot 处向白色抬升
        const glare = shading.hotSpot ? 200 * shading.specular : shading.specular * 60;
        gray = Math.min(255, lit + glare);
      }
      img.data[yy * w + xx] = gray;
    }
  }

  // 模糊 sigma 从传感器原生像素折算到输出像素域。
  // 线阵 labelSpace：输出网格按面单物理尺寸/mmPx 方形化，纵向原生行与输出像素
  // 物理尺度不同，按 nativeMm/输出mm 折算；面阵输出步长即 step。
  let blurScaleX = step;
  let blurScaleY = step;
  if (cam.type === 'line' && sampler.labelSpace && triggers && triggers.length > 1) {
    const nativeMmPerRow = (triggers[triggers.length - 1].beltY - triggers[0].beltY) / (triggers.length - 1);
    const outMmPerPxY = label.height / Math.max(1, h);
    const outMmPerPxX = label.width / Math.max(1, w);
    blurScaleY = nativeMmPerRow / Math.max(1e-6, outMmPerPxY);
    blurScaleX = mmPerPixel(cam, labelDepth(cam, pose, label)) / Math.max(1e-6, outMmPerPxX);
  }
  gaussianBlur(img, opts.blurSigmaX / Math.max(0.01, blurScaleX), opts.blurSigmaY / Math.max(0.01, blurScaleY));
  addNoise(img, opts.noiseSigma, opts.rng);

  // 条码物理区域在裁剪图（=面单包围盒，UV 跨 -1..1）内的像素范围
  const codeBounds = {
    x0: Math.round(((1 - halfUW) / 2) * w),
    x1: Math.round(((1 + halfUW) / 2) * w),
    y0: Math.round(((1 - halfVH) / 2) * h),
    y1: Math.round(((1 + halfVH) / 2) * h),
  };
  return { width: w, height: h, data: img.data, labelId: label.id, offsetX: x0, offsetY: y0, codeBounds, step, fitScale: effectiveModuleScale };
}

/** 面单中心深度（mm） */
export function labelDepth(cam: CameraSpec, pose: PackagePose, label: LabelSpec): number {
  const basis = labelWorldBasis(pose, label);
  const b = cameraBasis(cam);
  return Math.max(1, dot(sub(basis.center, cam.position), b.fwd));
}

/** 模块在图上的像素尺寸（取最差方向，含透视缩短） */
export function modulePixels(cam: CameraSpec, pose: PackagePose, label: LabelSpec): number {
  const depth = labelDepth(cam, pose, label);
  const basis = labelWorldBasis(pose, label);
  const b = cameraBasis(cam);
  const cosIncidence = Math.abs(dot(basis.normal, b.fwd));
  const mmPx = mmPerPixel(cam, depth);
  return (label.moduleMm * Math.max(0.15, cosIncidence)) / mmPx;
}
