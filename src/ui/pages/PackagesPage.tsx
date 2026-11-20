import { useMemo, useState } from 'preact/hooks';
import { useApp } from '../store';
import { generateBatch, generateOne } from '../../sim/packageGen';
import { PACKAGE_TYPES, type PackageType, type Package } from '../../sim/types';
import { idbPutPackages, idbCountPackages } from '../../sim/storage';

const TYPE_LABEL: Record<PackageType, string> = {
  carton: '纸箱',
  woven: '编织袋',
  plastic: '塑料快递袋',
  soft: '软包',
};

export function PackagesPage() {
  const { pkgConfig, setPkgConfig } = useApp();
  const [preview, setPreview] = useState<Package | null>(null);
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const proportions = useMemo(() => {
    const total = PACKAGE_TYPES.reduce((s, t) => s + (pkgConfig.proportions[t] || 0), 0);
    return Object.fromEntries(PACKAGE_TYPES.map((t) => [t, total ? (pkgConfig.proportions[t] || 0) / total : 0])) as Record<PackageType, number>;
  }, [pkgConfig]);

  function update<K extends keyof typeof pkgConfig>(key: K, value: (typeof pkgConfig)[K]) {
    setPkgConfig({ ...pkgConfig, [key]: value });
  }

  function setProp(t: PackageType, v: number) {
    update('proportions', { ...pkgConfig.proportions, [t]: Math.max(0, v) });
  }

  function setSize(t: PackageType, field: string, v: number) {
    update('sizeRanges', { ...pkgConfig.sizeRanges, [t]: { ...pkgConfig.sizeRanges[t], [field]: v } });
  }

  async function generateAndSave() {
    setBusy(true);
    try {
      const pkgs = generateBatch(pkgConfig);
      await idbPutPackages(pkgs);
      setSavedCount(await idbCountPackages());
      setPreview(pkgs[0]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1>包裹样本</h1>
      <p class="subtitle">按类型比例与尺寸分布生成确定性样本；面单位置、倾斜、褶皱与鼓包程序化随机，全部存浏览器 IndexedDB。</p>

      <div class="card">
        <div class="row" style="justify-content:space-between">
          <h2 style="margin:0">生成控制</h2>
          <div class="row">
            <label class="field" style="flex-direction:row;align-items:center;gap:8px">
              <span>数量</span>
              <input type="number" value={pkgConfig.total} style="width:110px" onInput={(e) => update('total', Number((e.target as HTMLInputElement).value))} />
            </label>
            <label class="field" style="flex-direction:row;align-items:center;gap:8px">
              <span>种子</span>
              <input type="number" value={pkgConfig.seed} style="width:120px" onInput={(e) => update('seed', Number((e.target as HTMLInputElement).value))} />
            </label>
            <button class="primary" onClick={generateAndSave} disabled={busy}>
              {busy ? '生成中…' : `生成 ${pkgConfig.total} 件并入库`}
            </button>
          </div>
        </div>
        {savedCount !== null && <p class="muted" style="margin:10px 0 0">IndexedDB 当前共 {savedCount} 件包裹样本。</p>}
      </div>

      <div class="card">
        <h2>类型比例</h2>
        <div class="grid cols-4">
          {PACKAGE_TYPES.map((t) => (
            <label class="field" key={t}>
              <span>{TYPE_LABEL[t]}（{Math.round(proportions[t] * 100)}%）</span>
              <input type="number" step="0.05" min="0" value={pkgConfig.proportions[t]} onInput={(e) => setProp(t, Number((e.target as HTMLInputElement).value))} />
              <div class="bar"><i style={`width:${proportions[t] * 100}%`} /></div>
            </label>
          ))}
        </div>
      </div>

      <div class="card">
        <h2>尺寸分布（mm，高斯截断到区间）</h2>
        <div class="grid cols-4">
          {PACKAGE_TYPES.map((t) => {
            const r = pkgConfig.sizeRanges[t];
            const fields: Array<[string, string]> = [
              ['lMin', '长 min'], ['lMax', '长 max'], ['wMin', '宽 min'], ['wMax', '宽 max'], ['hMin', '高 min'], ['hMax', '高 max'],
            ];
            return (
              <div key={t} style="background:var(--panel-2);padding:12px;border-radius:8px">
                <strong style="display:block;margin-bottom:8px">{TYPE_LABEL[t]}</strong>
                {fields.map(([f, label]) => (
                  <label class="field" key={f} style="margin-bottom:6px">
                    <span>{label}</span>
                    <input type="number" value={(r as unknown as Record<string, number>)[f]} onInput={(e) => setSize(t, f, Number((e.target as HTMLInputElement).value))} />
                  </label>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      <div class="card">
        <h2>面单与表面参数</h2>
        <div class="grid cols-4">
          <label class="field"><span>模块尺寸 min (mm)</span><input type="number" step="0.05" value={pkgConfig.label.moduleMmMin} onInput={(e) => update('label', { ...pkgConfig.label, moduleMmMin: Number((e.target as HTMLInputElement).value) })} /></label>
          <label class="field"><span>模块尺寸 max (mm)</span><input type="number" step="0.05" value={pkgConfig.label.moduleMmMax} onInput={(e) => update('label', { ...pkgConfig.label, moduleMmMax: Number((e.target as HTMLInputElement).value) })} /></label>
          <label class="field"><span>倾斜角上限 (°)</span><input type="number" value={pkgConfig.label.tiltDegMax} onInput={(e) => update('label', { ...pkgConfig.label, tiltDegMax: Number((e.target as HTMLInputElement).value) })} /></label>
          <label class="field"><span>褶皱幅度上限 (mm)</span><input type="number" value={pkgConfig.label.wrinkleAmpMax} onInput={(e) => update('label', { ...pkgConfig.label, wrinkleAmpMax: Number((e.target as HTMLInputElement).value) })} /></label>
          <label class="field"><span>底面单概率</span><input type="number" step="0.01" value={pkgConfig.label.downFaceProb} onInput={(e) => update('label', { ...pkgConfig.label, downFaceProb: Number((e.target as HTMLInputElement).value) })} /></label>
          <label class="field"><span>侧面单概率</span><input type="number" step="0.01" value={pkgConfig.label.sideFaceProb} onInput={(e) => update('label', { ...pkgConfig.label, sideFaceProb: Number((e.target as HTMLInputElement).value) })} /></label>
          <label class="field"><span>覆膜面单概率</span><input type="number" step="0.01" value={pkgConfig.label.laminateProb} onInput={(e) => update('label', { ...pkgConfig.label, laminateProb: Number((e.target as HTMLInputElement).value) })} /></label>
          <label class="field"><span>码制权重（一维/二维）</span>
            <div class="row">
              <input type="number" step="0.1" value={pkgConfig.label.codeWeights[0]} onInput={(e) => update('label', { ...pkgConfig.label, codeWeights: [Number((e.target as HTMLInputElement).value), pkgConfig.label.codeWeights[1]] })} />
              <input type="number" step="0.1" value={pkgConfig.label.codeWeights[1]} onInput={(e) => update('label', { ...pkgConfig.label, codeWeights: [pkgConfig.label.codeWeights[0], Number((e.target as HTMLInputElement).value)] })} />
            </div>
          </label>
        </div>
        <div class="row" style="margin-top:14px">
          <button class="ghost" onClick={() => setPreview(generateOne(pkgConfig, Math.floor(Math.random() * 99999)))}>随机预览一件</button>
        </div>
      </div>

      {preview && <PackagePreview pkg={preview} />}
    </div>
  );
}

function PackagePreview({ pkg }: { pkg: Package }) {
  return (
    <div class="card">
      <h2>样本预览 #{pkg.id} <span class="tag info">{TYPE_LABEL[pkg.type]}</span></h2>
      <div class="grid cols-4">
        <div><div class="muted">尺寸 L×W×H (mm)</div><div class="mono">{pkg.length} × {pkg.width} × {pkg.height}</div></div>
        <div><div class="muted">横向位置 x (mm)</div><div class="mono">{pkg.x.toFixed(1)}</div></div>
        <div><div class="muted">基底灰度 / 粗糙度</div><div class="mono">{pkg.baseGray} / {pkg.roughness.toFixed(2)}</div></div>
        <div><div class="muted">褶皱幅度 / 鼓包 (mm)</div><div class="mono">{pkg.topSurface.amp.toFixed(1)} / {pkg.topSurface.bulge.toFixed(1)}</div></div>
      </div>
      <table style="margin-top:14px">
        <thead><tr><th>面单</th><th>贴附面</th><th>面单尺寸 (mm)</th><th>倾斜°</th><th>码制</th><th>模块 (mm)</th><th>覆膜</th></tr></thead>
        <tbody>
          {pkg.labels.map((l) => (
            <tr key={l.id}>
              <td class="mono">{l.id}</td><td>{l.face}</td><td class="num">{l.width.toFixed(0)}×{l.height.toFixed(0)}</td>
              <td class="num">{l.tiltDeg.toFixed(1)}</td><td>{l.codeType}</td><td class="num">{l.moduleMm.toFixed(2)}</td>
              <td>{l.laminate ? <span class="tag warn">是</span> : <span class="tag ok">否</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
