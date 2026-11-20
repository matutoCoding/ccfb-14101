import { describe, it, expect } from 'vitest';
import { sampleTriggerLines, theoreticalFreerunLines } from './lineScan';
import { BeltMotion } from './belt';

const ENCODER_1MM = { mode: 'encoder' as const, mmPerLine: 1, lineRateHz: 1800 };
const FREERUN_1800 = { mode: 'freerun' as const, mmPerLine: 1, lineRateHz: 1800 };

/** 统计面单 [labelStart, labelStart+100) 在采样行里覆盖的行数 */
function labelSpanRows(
  lines: { beltY: number }[],
  yStart: number,
  labelStart: number,
  labelLen = 100,
): number {
  const lo = yStart + labelStart;
  const hi = lo + labelLen;
  return lines.filter((l) => l.beltY >= lo && l.beltY < hi).length;
}

describe('BeltMotion 运动学积分', () => {
  it('恒速距离与反解一致', () => {
    const m = new BeltMotion([], 1800);
    expect(m.distance(0, 1)).toBeCloseTo(1800, 6);
    expect(m.tAfterDistance(0, 1800)).toBeCloseTo(1, 9);
    expect(m.speedAt(0.5)).toBe(1800);
  });

  it('变速斜坡：1.8→2.5 m/s 在 0.5s 内线性变化，积分等于梯形面积', () => {
    const profile = [
      { t: 0, v: 1800 },
      { t: 0.5, v: 2500 },
    ];
    const m = new BeltMotion(profile);
    expect(m.distance(0, 0.5)).toBeCloseTo(((1800 + 2500) / 2) * 0.5, 9);
    // 反解往返一致
    const d = m.distance(0, 0.37);
    expect(m.distance(0, m.tAfterDistance(0, d))).toBeCloseTo(d, 6);
  });
});

describe('线阵扫描几何 —— 编码器触发（每毫米一行）', () => {
  it('皮带 1.8 m/s 时 100mm 面单正好 100 行', () => {
    const lines = sampleTriggerLines({
      trigger: ENCODER_1MM,
      constantSpeed: 1800,
      speedProfile: [],
      yStart: 0,
      yEnd: 500,
    });
    expect(lines).toHaveLength(500);
    expect(labelSpanRows(lines, 0, 120)).toBe(100);
    // 触发时刻与 1.8m/s 对得上：第 100 行在 100/1800 s
    expect(lines[100].t).toBeCloseTo(100 / 1800, 9);
    expect(lines[100].beltY).toBe(100);
  });

  it('速度改成 2.5 m/s，编码器模式行数不变（只改触发时间间隔）', () => {
    const lines = sampleTriggerLines({
      trigger: ENCODER_1MM,
      constantSpeed: 2500,
      speedProfile: [],
      yStart: 0,
      yEnd: 500,
    });
    expect(lines).toHaveLength(500);
    expect(labelSpanRows(lines, 0, 120)).toBe(100);
    expect(lines[100].t).toBeCloseTo(100 / 2500, 9);
  });

  it('变速过程中编码器行数仍严格等于物理位移（mmPerLine=1）', () => {
    const profile = [
      { t: 0, v: 1800 },
      { t: 0.4, v: 2500 },
      { t: 0.8, v: 2000 },
    ];
    const lines = sampleTriggerLines({
      trigger: ENCODER_1MM,
      constantSpeed: 1800,
      speedProfile: profile,
      yStart: 1000,
      yEnd: 1600,
    });
    expect(lines).toHaveLength(600);
    expect(labelSpanRows(lines, 1000, 33.3)).toBe(100);
    // 每行物理间距恒为 1mm，与速度无关
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i].beltY - lines[i - 1].beltY).toBeCloseTo(1, 9);
    }
  });

  it('mmPerLine=0.5 时 100mm 面单为 200 行', () => {
    const lines = sampleTriggerLines({
      trigger: { mode: 'encoder', mmPerLine: 0.5, lineRateHz: 0 },
      constantSpeed: 1800,
      speedProfile: [],
      yStart: 0,
      yEnd: 200,
    });
    expect(lines).toHaveLength(400);
    expect(labelSpanRows(lines, 0, 50)).toBe(200);
  });
});

describe('线阵扫描几何 —— 自由运行（固定行频）', () => {
  it('1.8m/s @1800Hz：每行 1mm，100mm 面单 100 行，与理论值误差 0 行', () => {
    const lines = sampleTriggerLines({
      trigger: FREERUN_1800,
      constantSpeed: 1800,
      speedProfile: [],
      yStart: 0,
      yEnd: 500,
    });
    expect(lines).toHaveLength(500); // 500mm 窗口 / 每行 1mm
    expect(labelSpanRows(lines, 0, 200)).toBe(100);
    expect(theoreticalFreerunLines(100, 1800, 1800)).toBe(100);
  });

  it('2.5m/s 行频不变：100mm 面单 72 行，拉伸比 = 2500/1800', () => {
    const lines = sampleTriggerLines({
      trigger: FREERUN_1800,
      constantSpeed: 2500,
      speedProfile: [],
      yStart: 0,
      yEnd: 500,
    });
    const span = labelSpanRows(lines, 0, 100);
    const theory = theoreticalFreerunLines(100, 2500, 1800); // round(72)=72
    expect(theory).toBe(72);
    expect(Math.abs(span - theory)).toBeLessThanOrEqual(1);
    // 每行覆盖物理距离
    expect(lines[1].beltY - lines[0].beltY).toBeCloseTo(2500 / 1800, 9);
    // 拉伸比例按理论值对上：100/72 vs 2500/1800，误差 < 0.5%
    const measuredMmPerLine = 100 / span;
    const theoryMmPerLine = 2500 / 1800;
    expect(Math.abs(measuredMmPerLine - theoryMmPerLine) / theoryMmPerLine).toBeLessThan(0.005);
  });

  it('变速斜坡 freerun：行数 = 行频 × 过包时间，误差 ≤1 行', () => {
    const profile = [
      { t: 0, v: 1800 },
      { t: 0.5, v: 2500 },
    ];
    // 先算 100mm 面单通过所需时间（数值积分反解）
    const m = new BeltMotion(profile);
    const tPass = m.tAfterDistance(0, 100);
    const theory = Math.round(1800 * tPass);
    const lines = sampleTriggerLines({
      trigger: FREERUN_1800,
      constantSpeed: 1800,
      speedProfile: profile,
      yStart: 0,
      yEnd: 400,
    });
    const span = labelSpanRows(lines, 0, 0);
    expect(Math.abs(span - theory)).toBeLessThanOrEqual(1);
  });
});
