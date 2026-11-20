import { useEffect, useRef } from 'preact/hooks';
import { useApp } from '../store';
import { fovPolygonOnBelt } from '../../sim/camera';
import { defaultPackageConfig, generateBatch } from '../../sim/packageGen';
import { buildPoses } from '../../sim/engine';
import { packageInAnyFov } from '../../sim/visibility';
import type { CameraSpec } from '../../sim/types';

const ROLE_COLOR: Record<string, string> = { top: '#4da3ff', left: '#36d399', right: '#fbbd23' };

export function LayoutPage() {
  const { layouts, activeLayoutId, saveLayout } = useApp();
  const layout = layouts.find((l) => l.id === activeLayoutId) ?? layouts[0];
  const topRef = useRef<HTMLCanvasElement>(null);
  const sideRef = useRef<HTMLCanvasElement>(null);

  // 用一批样本估算 FOV 覆盖与死角
  const coverage = (() => {
    const cfg = defaultPackageConfig();
    const pkgs = generateBatch({ ...cfg, total: 300, seed: 2026 });
    const poses = buildPoses(pkgs);
    let covered = 0;
    for (const p of poses) if (packageInAnyFov(layout.cameras, p)) covered++;
    return { covered, total: poses.length };
  })();

  useEffect(() => {
    drawTopView(topRef.current, layout.cameras, layout.belt.widthMm);
    drawSideView(sideRef.current, layout.cameras, layout.belt.widthMm);
  }, [layout]);

  function moveCam(camId: string, axis: 'x' | 'y' | 'z', delta: number) {
    const cameras = layout.cameras.map((c) =>
      c.id === camId ? { ...c, position: { ...c.position, [axis]: c.position[axis] + delta } } : c,
    );
    saveLayout({ ...layout, cameras });
  }

  return (
    <div>
      <h1>安装布局</h1>
      <p class="subtitle">在龙门架上布置顶扫与左右侧扫，视场多边形投影到皮带面；样本驱动的覆盖率与死角统计实时更新。</p>

      <div class="grid cols-3">
        <div class="card"><div class="kpi">{layout.cameras.length}</div><div class="muted">相机数量</div></div>
        <div class="card"><div class="kpi">{((coverage.covered / coverage.total) * 100).toFixed(1)}<small>%</small></div><div class="muted">样本 FOV 覆盖率（n={coverage.total}）</div></div>
        <div class="card"><div class="kpi">{coverage.total - coverage.covered}</div><div class="muted">落在所有视场外的包裹</div></div>
      </div>

      <div class="card">
        <h2>俯视图（皮带平面，X 横向 / Y 运动方向）</h2>
        <canvas ref={topRef} width="860" height="380" />
      </div>
      <div class="card">
        <h2>侧视图（X 横向 / Z 高度）</h2>
        <canvas ref={sideRef} width="860" height="320" />
      </div>

      <div class="card">
        <h2>相机位姿微调（mm）</h2>
        <table>
          <thead><tr><th>相机</th><th class="num">X</th><th class="num">Y</th><th class="num">Z</th><th>位姿调整</th></tr></thead>
          <tbody>
            {layout.cameras.map((cam) => (
              <tr key={cam.id}>
                <td><span class="tag" style={`background:${ROLE_COLOR[cam.role]}22;color:${ROLE_COLOR[cam.role]}`}>{cam.role}</span> {cam.name}</td>
                <td class="num">{cam.position.x}</td><td class="num">{cam.position.y}</td><td class="num">{cam.position.z}</td>
                <td>
                  <div class="row">
                    {(['x', 'y', 'z'] as const).map((ax) => (
                      <span class="row" key={ax} style="gap:3px">
                        <button class="ghost" onClick={() => moveCam(cam.id, ax, -10)}>-{ax}</button>
                        <button class="ghost" onClick={() => moveCam(cam.id, ax, 10)}>+{ax}</button>
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function drawTopView(canvas: HTMLCanvasElement | null, cams: CameraSpec[], beltWidth: number) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d')!;
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  // 世界坐标窗口：x ∈ [-beltWidth, beltWidth]，y ∈ [400, 2000]
  const xMin = -beltWidth;
  const xMax = beltWidth;
  const yMin = 400;
  const yMax = 2000;
  const sx = (x: number) => ((x - xMin) / (xMax - xMin)) * W;
  const sy = (y: number) => H - ((y - yMin) / (yMax - yMin)) * H;

  // 皮带
  ctx.fillStyle = '#151b22';
  ctx.fillRect(sx(-beltWidth / 2), sy(yMax), sx(beltWidth / 2) - sx(-beltWidth / 2), sy(yMin) - sy(yMax));
  ctx.strokeStyle = '#2f3b47';
  ctx.strokeRect(sx(-beltWidth / 2), sy(yMax), sx(beltWidth / 2) - sx(-beltWidth / 2), sy(yMin) - sy(yMax));
  // 中线
  ctx.strokeStyle = '#22303c';
  ctx.setLineDash([6, 6]);
  ctx.beginPath(); ctx.moveTo(sx(0), sy(yMin)); ctx.lineTo(sx(0), sy(yMax)); ctx.stroke();
  ctx.setLineDash([]);

  for (const cam of cams) {
    const color = ROLE_COLOR[cam.role] ?? '#fff';
    // FOV 多边形
    const poly = fovPolygonOnBelt(cam);
    if (poly.length >= 3) {
      ctx.beginPath();
      poly.forEach((p, i) => (i === 0 ? ctx.moveTo(sx(p.x), sy(p.y)) : ctx.lineTo(sx(p.x), sy(p.y))));
      ctx.closePath();
      ctx.fillStyle = color + '22';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    // 相机位置
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(sx(cam.position.x), sy(cam.position.y), 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e6edf3';
    ctx.font = '12px sans-serif';
    ctx.fillText(cam.name, sx(cam.position.x) + 9, sy(cam.position.y) + 4);
  }
}

function drawSideView(canvas: HTMLCanvasElement | null, cams: CameraSpec[], beltWidth: number) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d')!;
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const xMin = -beltWidth;
  const xMax = beltWidth;
  const zMin = 0;
  const zMax = 1400;
  const sx = (x: number) => ((x - xMin) / (xMax - xMin)) * W;
  const sz = (z: number) => H - ((z - zMin) / (zMax - zMin)) * (H - 20) - 10;

  // 皮带面
  ctx.strokeStyle = '#3a4754';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0, sz(0)); ctx.lineTo(W, sz(0)); ctx.stroke();

  for (const cam of cams) {
    const color = ROLE_COLOR[cam.role] ?? '#fff';
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(sx(cam.position.x), sz(cam.position.z), 6, 0, Math.PI * 2);
    ctx.fill();
    // 光轴方向投影到 xz 平面
    const len = 90;
    const ax = cam.aim.x;
    const az = cam.aim.z;
    const m = Math.hypot(ax, az) || 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(sx(cam.position.x), sz(cam.position.z));
    ctx.lineTo(sx(cam.position.x) + (ax / m) * len, sz(cam.position.z) - (az / m) * len);
    ctx.stroke();
    ctx.fillStyle = '#e6edf3';
    ctx.font = '12px sans-serif';
    ctx.fillText(`${cam.name} (f${cam.lens.focalMm}mm F${cam.lens.fNumber})`, sx(cam.position.x) + 9, sz(cam.position.z) + 4);
  }
}
