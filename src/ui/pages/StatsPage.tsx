import { useMemo, useState } from 'preact/hooks';
import { useApp } from '../store';
import { RunManager } from '../../sim/runManager';
import { generateBatch } from '../../sim/packageGen';
import { SimEngine, buildPoses } from '../../sim/engine';
import { aggregate, diffByType, type RunStats } from '../../sim/stats';
import { idbGetAll, STORE } from '../../sim/storage';
import type { BatchRunConfig, BatchRunState, FailureReason, LayoutSpec } from '../../sim/types';

const FAIL_LABEL: Record<FailureReason, string> = {
  blur: '模糊',
  glare: '反光',
  outOfFov: '出视场',
  resolution: '分辨率不够',
  unknown: '其他',
};
const FAIL_COLOR: Record<FailureReason, string> = {
  blur: '#fbbd23',
  glare: '#f87272',
  outOfFov: '#93a1b0',
  resolution: '#4da3ff',
  unknown: '#a78bfa',
};

export function StatsPage() {
  const { pkgConfig, layouts } = useApp();
  const [total, setTotal] = useState(10000);
  const [progress, setProgress] = useState<BatchRunState | null>(null);
  const [compareB, setCompareB] = useState<string>(layouts[1]?.id ?? '');
  const [statsB, setStatsB] = useState<RunStats | null>(null);
  const manager = useMemo(() => new RunManager(), []);

  const activeLayout = layouts[0];
  const statsA: RunStats | null = useMemo(() => {
    if (!progress || progress.results.length === 0) return null;
    return aggregate(progress.results, activeLayout.cameras.map((c) => c.id));
  }, [progress, activeLayout]);

  async function runBatch(layout: LayoutSpec) {
    const cfg: BatchRunConfig = {
      packageConfigId: 'current',
      layoutId: layout.id,
      total,
      seed: pkgConfig.seed,
      maxRenderWidth: 360,
    };
    // 同一批包裹（同种子）保证两套布局可比
    const packages = generateBatch({ ...pkgConfig, total });
    await manager.start(cfg, packages, layout, {
      onProgress: (s) => setProgress({ ...s }),
      onDone: (s) => setProgress({ ...s }),
      onError: (m) => alert('批量运行出错: ' + m),
    });
  }

  async function runComparison() {
    const layoutB = layouts.find((l) => l.id === compareB);
    if (!layoutB || !progress?.results) return;
    // 用相同种子重新生成同一批包裹，跑第二套布局（简化为同步聚合，大批量仍建议 Worker）
    const packages = generateBatch({ ...pkgConfig, total });
    const engine = new SimEngine({ layout: layoutB, maxRenderWidth: 360, noiseSeed: pkgConfig.seed ^ 0x55aa });
    const results = buildPoses(packages).map((p) => engine.processPackage(p));
    setStatsB(aggregate(results, layoutB.cameras.map((c) => c.id)));
  }

  async function resume() {
    const saved = await idbGetAll<BatchRunState>(STORE.runs);
    if (saved.length) setProgress(saved[saved.length - 1]);
  }

  const pct = progress ? (progress.processed / progress.config.total) * 100 : 0;

  return (
    <div>
      <h1>读码统计</h1>
      <p class="subtitle">Worker 内批量重跑，不卡界面；进度每块落 IndexedDB，关闭页面后可续跑。两套布局用同一批包裹对比。</p>

      <div class="card">
        <div class="row" style="justify-content:space-between">
          <div class="row">
            <label class="field" style="flex-direction:row;align-items:center;gap:8px">
              <span>批量件数</span>
              <input type="number" value={total} style="width:120px" onInput={(e) => setTotal(Number((e.target as HTMLInputElement).value))} />
            </label>
            <button class="primary" onClick={() => runBatch(activeLayout)} disabled={progress?.status === 'running'}>
              🚀 一键批量重跑 {total} 件
            </button>
            <button class="ghost" onClick={() => manager.pause()} disabled={progress?.status !== 'running'}>暂停</button>
            <button class="ghost" onClick={resume}>读取上次断点</button>
          </div>
          {progress && <span class={`tag ${progress.status === 'done' ? 'ok' : 'warn'}`}>{statusLabel(progress.status)}</span>}
        </div>
        {progress && (
          <div style="margin-top:14px">
            <div class="progress-track"><i style={`width:${pct}%`} /></div>
            <div class="row" style="justify-content:space-between;margin-top:6px">
              <span class="muted mono">{progress.processed} / {progress.config.total}</span>
              <span class="mono">{pct.toFixed(1)}%</span>
            </div>
          </div>
        )}
      </div>

      {statsA && (
        <>
          <div class="grid cols-3">
            <div class="card"><div class="kpi">{(statsA.overallRate * 100).toFixed(1)}<small>%</small></div><div class="muted">整体读码率</div></div>
            <div class="card"><div class="kpi">{statsA.read}<small> / {statsA.total}</small></div><div class="muted">成功件数</div></div>
            <div class="card"><div class="kpi">{statsA.noVisibleLabel}</div><div class="muted">无可见面单（朝下/死角）</div></div>
          </div>

          <div class="card">
            <h2>按包裹类型读码率</h2>
            <table>
              <thead><tr><th>类型</th><th class="num">样本数</th><th class="num">成功</th><th>读码率</th><th class="num">数值</th></tr></thead>
              <tbody>
                {statsA.byType.map((t) => (
                  <tr key={t.type}>
                    <td>{typeLabel(t.type)}</td><td class="num">{t.total}</td><td class="num">{t.read}</td>
                    <td style="width:35%"><div class={`bar ${rateClass(t.rate)}`}><i style={`width:${t.rate * 100}%`} /></div></td>
                    <td class="num">{(t.rate * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div class="card">
            <h2>按相机读码率与失败归类</h2>
            <table>
              <thead><tr><th>相机</th><th class="num">处理</th><th class="num">成功</th><th>读码率</th>{(Object.keys(FAIL_LABEL) as FailureReason[]).map((r) => <th class="num" key={r}>{FAIL_LABEL[r]}</th>)}</tr></thead>
              <tbody>
                {statsA.byCamera.map((c) => (
                  <tr key={c.cameraId}>
                    <td class="mono">{c.cameraId}</td><td class="num">{c.total}</td><td class="num">{c.decode}</td>
                    <td style="width:20%"><div class={`bar ${rateClass(c.rate)}`}><i style={`width:${c.rate * 100}%`} /></div></td>
                    {(Object.keys(FAIL_LABEL) as FailureReason[]).map((r) => (
                      <td class="num" key={r} style={`color:${c.failures[r] ? FAIL_COLOR[r] : 'var(--fg-dim)'}`}>{c.failures[r]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div class="card">
            <h2>两套布局对比（同一批包裹）</h2>
            <div class="row">
              <select value={compareB} onChange={(e) => setCompareB((e.target as HTMLSelectElement).value)}>
                {layouts.filter((l) => l.id !== activeLayout.id).map((l) => <option value={l.id} key={l.id}>{l.name}</option>)}
              </select>
              <button class="primary" onClick={runComparison}>用布局 B 重跑对比</button>
            </div>
            {statsB && (
              <table style="margin-top:12px">
                <thead><tr><th>类型</th><th class="num">布局A 读码率</th><th class="num">布局B 读码率</th><th class="num">差值(B−A)</th></tr></thead>
                <tbody>
                  {diffByType(statsA, statsB).map((d) => (
                    <tr key={d.type}>
                      <td>{typeLabel(d.type)}</td>
                      <td class="num">{(d.rateA * 100).toFixed(1)}%</td>
                      <td class="num">{(d.rateB * 100).toFixed(1)}%</td>
                      <td class="num" style={`color:${d.delta > 0 ? 'var(--accent-2)' : d.delta < 0 ? 'var(--bad)' : 'var(--fg-dim)'}`}>
                        {d.delta > 0 ? '+' : ''}{(d.delta * 100).toFixed(1)}pt
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function statusLabel(s: string): string {
  return s === 'done' ? '已完成' : s === 'running' ? '运行中' : s === 'paused' ? '已暂停' : '出错';
}
function rateClass(r: number): string {
  return r >= 0.9 ? 'good' : r >= 0.7 ? 'mid' : 'low';
}
function typeLabel(t: string): string {
  return { carton: '纸箱', woven: '编织袋', plastic: '塑料快递袋', soft: '软包' }[t] ?? t;
}
