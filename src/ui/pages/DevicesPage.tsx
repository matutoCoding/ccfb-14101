import { useApp } from '../store';
import type { CameraSpec, LightSpec } from '../../sim/types';
import { depthOfField, fieldOfView, mmPerPixel } from '../../sim/optics';

export function DevicesPage() {
  const { layouts, activeLayoutId, saveLayout } = useApp();
  const layout = layouts.find((l) => l.id === activeLayoutId) ?? layouts[0];

  function updateCam(camId: string, patch: Partial<CameraSpec>) {
    const cameras = layout.cameras.map((c) => (c.id === camId ? { ...c, ...patch } : c));
    saveLayout({ ...layout, cameras });
  }
  function updateLens(camId: string, patch: Partial<CameraSpec['lens']>) {
    const cameras = layout.cameras.map((c) => (c.id === camId ? { ...c, lens: { ...c.lens, ...patch } } : c));
    saveLayout({ ...layout, cameras });
  }
  function updateLight(lightId: string, patch: Partial<LightSpec>) {
    const lights = layout.lights.map((l) => (l.id === lightId ? { ...l, ...patch } : l));
    saveLayout({ ...layout, lights });
  }

  return (
    <div>
      <h1>相机与光源</h1>
      <p class="subtitle">面阵/线阵相机的传感器、镜头、光圈、触发与曝光参数；条形光/同轴光角度与强度。景深、视场与像素分辨率实时计算。</p>
      {layout.cameras.map((cam) => {
        const dof = depthOfField(cam, cam.lens.focusDistanceMm);
        const fov = fieldOfView(cam, cam.lens.focusDistanceMm);
        return (
          <div class="card" key={cam.id}>
            <div class="row" style="justify-content:space-between">
              <h2 style="margin:0">
                {cam.name} <span class="tag info">{cam.type === 'line' ? '线阵' : '面阵'} · {cam.role}</span>
              </h2>
              <span class="muted mono">{cam.id}</span>
            </div>
            <div class="grid cols-4" style="margin-top:12px">
              <label class="field"><span>传感器宽 (px)</span><input type="number" value={cam.sensorWidthPx} onInput={(e) => updateCam(cam.id, { sensorWidthPx: Number((e.target as HTMLInputElement).value) })} /></label>
              <label class="field"><span>传感器高 (px)</span><input type="number" value={cam.sensorHeightPx} onInput={(e) => updateCam(cam.id, { sensorHeightPx: Number((e.target as HTMLInputElement).value) })} /></label>
              <label class="field"><span>像元尺寸 (μm)</span><input type="number" step="0.1" value={cam.pixelUm} onInput={(e) => updateCam(cam.id, { pixelUm: Number((e.target as HTMLInputElement).value) })} /></label>
              <label class="field"><span>增益 (倍)</span><input type="number" step="0.1" value={cam.gain} onInput={(e) => updateCam(cam.id, { gain: Number((e.target as HTMLInputElement).value) })} /></label>
              <label class="field"><span>焦距 (mm)</span><input type="number" value={cam.lens.focalMm} onInput={(e) => updateLens(cam.id, { focalMm: Number((e.target as HTMLInputElement).value) })} /></label>
              <label class="field"><span>光圈 F#</span><input type="number" step="0.1" value={cam.lens.fNumber} onInput={(e) => updateLens(cam.id, { fNumber: Number((e.target as HTMLInputElement).value) })} /></label>
              <label class="field"><span>对焦距离 (mm)</span><input type="number" value={cam.lens.focusDistanceMm} onInput={(e) => updateLens(cam.id, { focusDistanceMm: Number((e.target as HTMLInputElement).value) })} /></label>
              <label class="field"><span>曝光 (μs)</span><input type="number" value={cam.exposureUs} onInput={(e) => updateCam(cam.id, { exposureUs: Number((e.target as HTMLInputElement).value) })} /></label>
              {cam.type === 'line' && (
                <>
                  <label class="field"><span>触发模式</span>
                    <select value={cam.trigger.mode} onChange={(e) => updateCam(cam.id, { trigger: { ...cam.trigger, mode: (e.target as HTMLSelectElement).value as 'encoder' | 'freerun' } })}>
                      <option value="encoder">编码器触发</option>
                      <option value="freerun">自由运行(固定行频)</option>
                    </select>
                  </label>
                  <label class="field"><span>每行行距 mm/行</span><input type="number" step="0.1" value={cam.trigger.mmPerLine} onInput={(e) => updateCam(cam.id, { trigger: { ...cam.trigger, mmPerLine: Number((e.target as HTMLInputElement).value) } })} /></label>
                  <label class="field"><span>行频 (Hz)</span><input type="number" value={cam.trigger.lineRateHz} onInput={(e) => updateCam(cam.id, { trigger: { ...cam.trigger, lineRateHz: Number((e.target as HTMLInputElement).value) } })} /></label>
                </>
              )}
              <label class="field"><span>液态镜头</span>
                <select value={cam.lens.liquidLens ? '1' : '0'} onChange={(e) => updateLens(cam.id, { liquidLens: (e.target as HTMLSelectElement).value === '1' })}>
                  <option value="0">普通定焦</option>
                  <option value="1">液态自动对焦</option>
                </select>
              </label>
              {cam.lens.liquidLens && (
                <label class="field"><span>对焦延迟 (ms)</span><input type="number" value={cam.lens.focusLagMs} onInput={(e) => updateLens(cam.id, { focusLagMs: Number((e.target as HTMLInputElement).value) })} /></label>
              )}
            </div>
            <div class="grid cols-4" style="margin-top:12px">
              <div class="kpi">{dof.near.toFixed(0)}<small> / {dof.far.toFixed(0)} mm</small><div class="muted" style="font-size:12px">景深近限 / 远限</div></div>
              <div class="kpi">{fov.width.toFixed(0)}<small> × {fov.height.toFixed(0)} mm</small><div class="muted" style="font-size:12px">对焦面视场 W×H</div></div>
              <div class="kpi">{mmPerPixel(cam, cam.lens.focusDistanceMm).toFixed(3)}<small> mm/px</small><div class="muted" style="font-size:12px">对焦面像素分辨率</div></div>
              <div class="kpi">{(cam.lens.focalMm / mmPerPixel(cam, cam.lens.focusDistanceMm) / 1000).toFixed(0)}<small> px/mm</small><div class="muted" style="font-size:12px">空间采样密度</div></div>
            </div>
          </div>
        );
      })}

      <h2>光源</h2>
      {layout.lights.map((light) => (
        <div class="card" key={light.id}>
          <div class="row" style="justify-content:space-between">
            <strong>{light.kind === 'bar' ? '条形光' : '同轴光'} <span class="tag info">{light.id}</span></strong>
          </div>
          <div class="grid cols-4" style="margin-top:10px">
            <label class="field"><span>入射角 (°)</span><input type="number" value={light.angleDeg} onInput={(e) => updateLight(light.id, { angleDeg: Number((e.target as HTMLInputElement).value) })} /></label>
            <label class="field"><span>强度 (0..1)</span><input type="number" step="0.05" value={light.intensity} onInput={(e) => updateLight(light.id, { intensity: Number((e.target as HTMLInputElement).value) })} /></label>
            <label class="field"><span>灯长 (mm)</span><input type="number" value={light.length} onInput={(e) => updateLight(light.id, { length: Number((e.target as HTMLInputElement).value) })} /></label>
            <label class="field"><span>位置 X (mm)</span><input type="number" value={light.position.x} onInput={(e) => updateLight(light.id, { position: { ...light.position, x: Number((e.target as HTMLInputElement).value) } })} /></label>
            <label class="field"><span>位置 Y (mm)</span><input type="number" value={light.position.y} onInput={(e) => updateLight(light.id, { position: { ...light.position, y: Number((e.target as HTMLInputElement).value) } })} /></label>
            <label class="field"><span>位置 Z (mm)</span><input type="number" value={light.position.z} onInput={(e) => updateLight(light.id, { position: { ...light.position, z: Number((e.target as HTMLInputElement).value) } })} /></label>
          </div>
        </div>
      ))}
    </div>
  );
}
