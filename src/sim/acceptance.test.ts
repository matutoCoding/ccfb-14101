import { describe, it, expect } from 'vitest';
import { sampleTriggerLines } from './lineScan';
import { defaultLayout } from './presets';

/**
 * 验收级测试：对应现场最在意的线阵几何。
 * 皮带 1.8m/s、编码器每毫米触发一行时，100mm 面单在图里正好 100 行；
 * 速度改 2.5m/s 行频不变时，纵向拉伸按理论值且误差不超过 1 行。
 */
describe('线阵扫描验收（端到端几何）', () => {
  const layout = defaultLayout();
  const top = layout.cameras.find((c) => c.type === 'line')!;

  it('编码器 1 行/mm：1.8 与 2.5 m/s 下 100mm 面单均严格 100 行', () => {
    for (const v of [1800, 2500]) {
      const lines = sampleTriggerLines({
        trigger: top.trigger,
        constantSpeed: v,
        speedProfile: [],
        yStart: 1000,
        yEnd: 1500,
      });
      const labelRows = lines.filter((l) => l.beltY >= 1200 && l.beltY < 1300).length;
      expect(labelRows).toBe(100);
      // 行物理间距恒为 1mm，与速度无关
      expect(lines[1].beltY - lines[0].beltY).toBeCloseTo(1, 9);
    }
  });

  it('自由运行 1800Hz：1.8m/s 为 100 行；2.5m/s 为 72 行，误差 ≤1 行', () => {
    const freerun = { mode: 'freerun' as const, mmPerLine: 1, lineRateHz: 1800 };
    const l1800 = sampleTriggerLines({ trigger: freerun, constantSpeed: 1800, speedProfile: [], yStart: 1000, yEnd: 1500 });
    const l2500 = sampleTriggerLines({ trigger: freerun, constantSpeed: 2500, speedProfile: [], yStart: 1000, yEnd: 1500 });
    expect(l1800.filter((l) => l.beltY >= 1200 && l.beltY < 1300).length).toBe(100);
    const span2500 = l2500.filter((l) => l.beltY >= 1200 && l.beltY < 1300).length;
    expect(Math.abs(span2500 - 72)).toBeLessThanOrEqual(1);
  });

  it('变速过程中编码器行数仍严格等于位移，时间间隔随速度变化', () => {
    const profile = [
      { t: 0, v: 1800 },
      { t: 0.5, v: 2500 },
    ];
    const lines = sampleTriggerLines({
      trigger: top.trigger,
      constantSpeed: 1800,
      speedProfile: profile,
      yStart: 1000,
      yEnd: 1600,
    });
    expect(lines).toHaveLength(600);
    // 第一段（低速）行时间间隔大于第二段（高速）；首行严格等于 1/1800
    const dtFirst = lines[1].t - lines[0].t;
    const dtSlow = lines[10].t - lines[9].t;
    const dtFast = lines[400].t - lines[399].t;
    expect(dtSlow).toBeGreaterThan(dtFast);
    expect(dtFirst).toBeCloseTo(1 / 1800, 6);
    // 斜坡上速度略升，行间隔略小于初始值但量级正确
    expect(dtSlow).toBeGreaterThan(1 / 2500);
    expect(dtFast).toBeLessThan(1 / 2000);
  });

  it('皮带静止时自由运行不死循环，返回空采样', () => {
    const freerun = { mode: 'freerun' as const, mmPerLine: 1, lineRateHz: 1800 };
    const lines = sampleTriggerLines({ trigger: freerun, constantSpeed: 0, speedProfile: [], yStart: 1000, yEnd: 1100 });
    expect(lines).toHaveLength(0);
  });
});
