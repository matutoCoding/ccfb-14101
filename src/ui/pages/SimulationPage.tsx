import { useEffect, useRef, useState } from 'preact/hooks';
import { useApp } from '../store';
import { SimEngine, buildPoses } from '../../sim/engine';
import { generateBatch } from '../../sim/packageGen';
import { sampleTriggerLines } from '../../sim/lineScan';
import { areaSampler, lineSampler, renderLabelCrop, type LabelCrop } from '../../sim/render';
import { labelWorldBasis } from '../../sim/render';
import { encodeCode } from '../../sim/barcode';
import { decodeGray, measureContrast } from '../../sim/decoder';
import { Rng } from '../../sim/rng';
import type { CameraSpec, LabelSpec, PackageResult } from '../../sim/types';

interface LiveView {
  cam: CameraSpec;
  crop: LabelCrop | null;
  decoded: string | null;
  modulePx: number;
  contrast: number;
  noise: number;
  reason?: string;
}

export function SimulationPage() {
  const { pkgConfig, layouts, activeLayoutId } = useApp();
  const layout = layouts.find((l) => l.id === activeLayoutId) ?? layouts[0];
  const [beltSpeed, setBeltSpeed] = useState(layout.belt.speedMmPerS);
  const [index, setIndex] = useState(0);
  const [views, setViews] = useState<LiveView[]>([]);
  const [running, setRunning] = useState(false);
  const [packages] = useState(() => generateBatch({ ...pkgConfig, total: 40, seed: pkgConfig.seed }));
  const timer = useRef<number | null>(null);

  const engine = new SimEngine({ layout: { ...layout, belt: { ...layout.belt, speedMmPerS: beltSpeed } }, maxRenderWidth: 360, noiseSeed: 7 });
  const poses = buildPoses(packages);

  function renderAt(i: number) {
    const pose = poses[i % poses.length];
    const out: LiveView[] = layout.cameras.map((cam) => {
      const label = pose.pkg.labels[0];
      const result: PackageResult = engine.processPackage(pose);
      const camResult = result.perCamera.find((c) => c.cameraId === cam.id);
      const metric = camResult?.labels.find((l) => l.labelId === label.id);
      const crop = renderSingle(engine, cam, pose, label, beltSpeed);
      const decoded = crop ? decodeGray(crop) : null;
      return {
        cam,
        crop,
        decoded,
        modulePx: metric?.modulePx ?? 0,
        contrast: crop ? measureContrast(crop, crop.codeBounds) : 0,
        noise: cam.readNoise,
        reason: metric?.failureReason,
      };
    });
    setViews(out);
    setIndex(i % poses.length);
  }

  useEffect(() => {
    renderAt(0);
    return () => { if (timer.current) clearInterval(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, beltSpeed]);

  function toggleRun() {
    if (running) {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
      setRunning(false);
    } else {
      setRunning(true);
      timer.current = window.setInterval(() => renderAt((index + 1) % poses.length), 900);
    }
  }

  return (
    <div>
      <h1>成像仿真</h1>
      <p class="subtitle">包裹按皮带速度连续过包，每台相机实时输出灰度图；条码模块尺寸、对比度、噪声与解码结果同步显示，一维码与二维码均覆盖。</p>

      <div class="card">
        <div class="row" style="justify-content:space-between">
          <div class="row">
            <label class="field" style="flex-direction:row;align-items:center;gap:8px">
              <span>皮带速度 (mm/s)</span>
              <input type="number" step="50" value={beltSpeed} style="width:120px" onInput={(e) => setBeltSpeed(Number((e.target as HTMLInputElement).value))} />
            </label>
            <span class="muted mono">{(beltSpeed / 1000).toFixed(2)} m/s</span>
            <button class="primary" onClick={toggleRun}>{running ? '⏸ 暂停过包' : '▶ 连续过包'}</button>
            <button class="ghost" onClick={() => renderAt((index + 1) % poses.length)}>下一件 →</button>
          </div>
          <span class="muted">包裹 {index + 1} / {poses.length} · {packages[index]?.type}</span>
        </div>
      </div>

      <div class="grid cols-3">
        {views.map((v) => (
          <div class="card" key={v.cam.id}>
            <div class="row" style="justify-content:space-between">
              <strong>{v.cam.name} <span class="tag info">{v.cam.type === 'line' ? '线阵' : '面阵'}</span></strong>
              {v.decoded ? <span class="tag ok">解码成功</span> : <span class="tag bad">{v.reason ?? '未解码'}</span>}
            </div>
            <GrayCanvas view={v} />
            <div class="grid cols-2" style="margin-top:10px;gap:8px">
              <Metric label="模块像素" value={v.modulePx.toFixed(2)} />
              <Metric label="对比度" value={v.contrast.toFixed(2)} />
              <Metric label="噪声 σ" value={v.noise.toFixed(1)} />
              <Metric label="码制" value={packages[index]?.labels[0]?.codeType ?? '-'} />
            </div>
            <div class="muted mono" style="margin-top:8px;font-size:11px;word-break:break-all">
              {v.decoded ? `解码: ${v.decoded}` : '期望: ' + (packages[index]?.labels[0]?.payload ?? '')}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style="background:var(--panel-2);padding:8px;border-radius:6px">
      <div class="muted" style="font-size:11px">{label}</div>
      <div class="mono" style="font-weight:700">{value}</div>
    </div>
  );
}

function GrayCanvas({ view }: { view: LiveView }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !view.crop) return;
    const { width, height, data } = view.crop;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(width, height);
    for (let i = 0; i < data.length; i++) {
      img.data[i * 4] = data[i];
      img.data[i * 4 + 1] = data[i];
      img.data[i * 4 + 2] = data[i];
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [view]);
  if (!view.crop) return <div class="muted" style="padding:30px;text-align:center;background:#000;border-radius:8px;margin-top:10px">该面单不在视场内</div>;
  return <canvas ref={ref} style="width:100%;margin-top:10px" />;
}

/** 单相机单面单渲染（复用引擎几何，独立于批量路径，供实时预览） */
function renderSingle(engine: SimEngine, cam: CameraSpec, pose: ReturnType<typeof buildPoses>[number], label: LabelSpec, beltSpeed: number): LabelCrop | null {
  const layout = engine.layout;
  const camPose = cam.type === 'area' ? { pkg: pose.pkg, yCenter: cam.position.y } : pose;
  const codeBitmap = encodeCode(label.payload, label.codeType);
  const basis = labelWorldBasis(camPose, label);
  const triggers = cam.type === 'line'
    ? sampleTriggerLines({
        trigger: cam.trigger,
        constantSpeed: beltSpeed,
        speedProfile: layout.belt.speedProfile,
        yStart: camPose.yCenter - camPose.pkg.length / 2 - 4,
        yEnd: camPose.yCenter + camPose.pkg.length / 2 + 4,
      })
    : undefined;
  const sampler = cam.type === 'line' ? lineSampler(cam, camPose, label, triggers!) : areaSampler(cam, basis.center, basis.normal);
  return renderLabelCrop(cam, camPose, label, sampler, {
    maxWidth: 360,
    blurSigmaX: 1,
    blurSigmaY: 1,
    noiseSigma: cam.readNoise,
    codeBitmap,
    lights: layout.lights,
    rng: new Rng(99),
  }, triggers);
}
