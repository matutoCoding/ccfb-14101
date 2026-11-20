import type { SpeedKnot, TriggerSpec } from './types';
import { BeltMotion } from './belt';

/** 一次行触发：lineIndex 为图像行号，t 为触发时刻，beltY 为该时刻皮带纵向世界坐标 */
export interface LineTrigger {
  lineIndex: number;
  t: number;
  beltY: number;
}

export interface SampleOptions {
  trigger: TriggerSpec;
  /** 恒速（无变速曲线时使用）mm/s */
  constantSpeed: number;
  speedProfile: SpeedKnot[];
  /** 采样区间对应的皮带世界坐标（mm，沿运动方向递增） */
  yStart: number;
  yEnd: number;
  /** 起始时刻 s，默认 0 */
  tStart?: number;
}

/**
 * 线阵相机触发采样 —— 本系统几何正确性的核心。
 *
 * 编码器模式：行 i 固定对应皮带位移 i·mmPerLine，与速度完全无关。
 *   100mm 的面单、1 行/mm 时恒为 100 行；变速只改变行触发的时间间隔。
 * 自由运行模式：行 i 固定对应时间 i/lineRateHz，beltY 由皮带积分得到；
 *   速度变大则每行覆盖的物理距离变长，图像纵向被拉伸（过包行数变少）。
 */
export function sampleTriggerLines(opts: SampleOptions): LineTrigger[] {
  const motion = new BeltMotion(opts.speedProfile, opts.constantSpeed);
  const t0 = opts.tStart ?? 0;
  const y0 = opts.yStart;
  const y1 = opts.yEnd;
  if (y1 < y0) throw new Error('yEnd 必须不小于 yStart');
  const lines: LineTrigger[] = [];

  if (opts.trigger.mode === 'encoder') {
    const mmPerLine = opts.trigger.mmPerLine;
    if (!(mmPerLine > 0)) throw new Error('编码器触发的 mmPerLine 必须为正');
    // 半开区间 [y0, y1)：distance/mmPerLine 恰好是行数，100mm @1mm/行 => 100 行
    const count = Math.floor((y1 - y0) / mmPerLine);
    for (let i = 0; i < count; i++) {
      const dist = i * mmPerLine;
      const t = motion.tAfterDistance(t0, dist);
      lines.push({ lineIndex: i, t, beltY: y0 + dist });
    }
    return lines;
  }

  // freerun：按固定行频推进时间，位移由运动学积分
  const rate = opts.trigger.lineRateHz;
  if (!(rate > 0)) throw new Error('自由运行的行频必须为正');
  const dt = 1 / rate;
  // 先由运动学反解走完窗口所需时间，得到严格的行数上限（皮带静止时直接为空）
  let maxLines: number;
  try {
    const tEnd = motion.tAfterDistance(t0, y1 - y0);
    maxLines = Math.ceil((tEnd - t0) * rate) + 1;
  } catch {
    return lines; // 皮带无法在有限时间内走完窗口
  }
  for (let i = 0; i < maxLines; i++) {
    const t = t0 + i * dt;
    const beltY = y0 + motion.distance(t0, t);
    if (beltY >= y1) break;
    lines.push({ lineIndex: i, t, beltY });
  }
  return lines;
}

/** 自由运行模式下，给定瞬时速度的纵向像素拉伸比（相对基准速度） */
export function freerunStretchRatio(vMmPerS: number, lineRateHz: number): number {
  return vMmPerS / lineRateHz; // 每行覆盖的物理 mm 数
}

/**
 * 理论过包行数（freerun）：N = rate · T = rate · ∫dt，
 * 恒速时 N = L · rate / v，四舍五入到行。
 */
export function theoreticalFreerunLines(
  lengthMm: number,
  vMmPerS: number,
  lineRateHz: number,
): number {
  return Math.round((lengthMm * lineRateHz) / vMmPerS);
}
