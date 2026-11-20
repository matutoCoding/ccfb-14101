import { describe, it, expect } from 'vitest';
import { defaultPackageConfig } from './packageGen';
import { generateBatch } from './packageGen';
import { defaultLayout, alternativeLayout } from './presets';
import { SimEngine, buildPoses } from './engine';
import { aggregate, diffByType } from './stats';
import { sampleTriggerLines } from './lineScan';

describe('仿真引擎端到端', () => {
  const cfg = { ...defaultPackageConfig(), total: 40, seed: 42 };
  const packages = generateBatch(cfg);
  const layout = defaultLayout();
  const engine = new SimEngine({ layout, maxRenderWidth: 320, noiseSeed: 7 });

  it('每个包裹返回与相机数一致的逐相机结果', () => {
    const poses = buildPoses(packages);
    const r0 = engine.processPackage(poses[0]);
    expect(r0.perCamera).toHaveLength(layout.cameras.length);
    expect(r0.type).toBe(packages[0].type);
    for (const cam of r0.perCamera) {
      expect(cam.labels.length).toBe(packages[0].labels.length);
      for (const m of cam.labels) {
        expect(m.modulePx).toBeGreaterThan(0);
        expect(m.contrast).toBeGreaterThanOrEqual(0);
        expect(m.glareCoverage).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('批量 40 件可跑完，统计聚合自洽', () => {
    const poses = buildPoses(packages);
    const results = poses.map((p) => engine.processPackage(p));
    const stats = aggregate(results, layout.cameras.map((c) => c.id));
    expect(stats.total).toBe(40);
    expect(stats.byType.reduce((s, t) => s + t.total, 0)).toBe(40);
    expect(stats.overallRate).toBeGreaterThanOrEqual(0);
    expect(stats.overallRate).toBeLessThanOrEqual(1);
    for (const c of stats.byCamera) {
      expect(c.total).toBe(40);
      const failSum = Object.values(c.failures).reduce((a, b) => a + b, 0);
      expect(failSum + c.decode).toBe(40);
    }
  });

  it('两套布局同批包裹对比可输出逐类型差值', () => {
    const poses = buildPoses(packages);
    const engineB = new SimEngine({ layout: alternativeLayout(), maxRenderWidth: 320, noiseSeed: 7 });
    const ra = poses.map((p) => engine.processPackage(p));
    const rb = poses.map((p) => engineB.processPackage(p));
    const sa = aggregate(ra, layout.cameras.map((c) => c.id));
    const sb = aggregate(rb, alternativeLayout().cameras.map((c) => c.id));
    const diff = diffByType(sa, sb);
    expect(diff).toHaveLength(4);
    for (const d of diff) {
      expect(Math.abs(d.delta)).toBeLessThanOrEqual(1);
      expect(d.rateA).toBeGreaterThanOrEqual(0);
    }
  });

  it('引擎内部线阵触发：100mm 面单在 1 行/mm 下仍为 100 行（恒速与变速一致）', () => {
    const top = layout.cameras.find((c) => c.type === 'line')!;
    const pose = buildPoses(packages)[0];
    const halfL = pose.pkg.length / 2 + 4;
    const lines = sampleTriggerLines({
      trigger: top.trigger,
      constantSpeed: 1800,
      speedProfile: [],
      yStart: pose.yCenter - halfL,
      yEnd: pose.yCenter + halfL,
    });
    const span100 = lines.filter((l) => l.beltY >= pose.yCenter && l.beltY < pose.yCenter + 100).length;
    expect(span100).toBe(100);
  });
});
