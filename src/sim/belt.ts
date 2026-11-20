import type { SpeedKnot } from './types';

/**
 * 皮带运动学：分段线性速度曲线 v(t)。
 * 位置 s(t) 为 v 的解析积分（分段二次），反解 t(s) 用游标沿线段推进，
 * 避免逐行二分 —— 万件级仿真里每行都要查一次。
 */
export class BeltMotion {
  private readonly knots: SpeedKnot[];
  private readonly vConst: number;

  /** knots 为空时按恒速 vConst 处理 */
  constructor(knots: SpeedKnot[], vConst = 0) {
    this.knots = [...knots].sort((a, b) => a.t - b.t);
    this.vConst = vConst;
    for (let i = 1; i < this.knots.length; i++) {
      if (this.knots[i].t === this.knots[i - 1].t) {
        throw new Error('速度曲线时间节点必须严格递增');
      }
      if (this.knots[i].v < 0 || this.knots[i - 1].v < 0) {
        throw new Error('皮带速度不能为负');
      }
    }
  }

  /** t 时刻速度 mm/s，曲线外按端点速度外推 */
  speedAt(t: number): number {
    const k = this.knots;
    if (k.length === 0) return this.vConst;
    if (t <= k[0].t) return k[0].v;
    if (t >= k[k.length - 1].t) return k[k.length - 1].v;
    for (let i = 0; i < k.length - 1; i++) {
      const a = k[i];
      const b = k[i + 1];
      if (t >= a.t && t <= b.t) {
        const w = (t - a.t) / (b.t - a.t);
        return a.v + (b.v - a.v) * w;
      }
    }
    return k[k.length - 1].v;
  }

  /** t0→t1 的皮带位移 mm（恒速段或线性段解析积分） */
  distance(t0: number, t1: number): number {
    if (t1 <= t0) return 0;
    if (this.knots.length === 0) return this.vConst * (t1 - t0);
    let total = 0;
    const segs = this.segmentsCovering(t0, t1);
    for (const [ta, va, tb, vb] of segs) {
      total += ((va + vb) / 2) * (tb - ta);
    }
    return total;
  }

  /**
   * 已知起始时刻 t0，求走过 d mm 后的时刻（d>=0）。
   * 段内 v 线性：d = v0·Δt + ½a·Δt²，解析求根并逐段推进。
   */
  tAfterDistance(t0: number, d: number): number {
    if (d <= 0) return t0;
    if (this.knots.length === 0) {
      if (this.vConst <= 0) throw new Error('皮带静止且非编码器触发，无法推进时间');
      return t0 + d / this.vConst;
    }
    let t = t0;
    let remain = d;
    let i = this.segmentIndexAt(t);
    // 越过最后一个节点后按末速度恒速外推
    while (remain > 0) {
      if (i >= this.knots.length - 1) {
        const v = this.knots[this.knots.length - 1].v;
        if (v <= 0) throw new Error('皮带在该时刻静止，无法在有限时间内走完位移');
        return t + remain / v;
      }
      const b = this.knots[i + 1];
      const v0 = this.speedAt(t);
      const dtMax = b.t - t;
      const dMax = ((v0 + b.v) / 2) * dtMax;
      if (remain <= dMax + 1e-9) {
        const acc = (b.v - v0) / dtMax;
        if (Math.abs(acc) < 1e-9) {
          t += remain / Math.max(v0, 1e-12);
        } else {
          const disc = v0 * v0 + 2 * acc * remain;
          const dt = (-v0 + Math.sqrt(Math.max(0, disc))) / acc;
          t += dt;
        }
        remain = 0;
      } else {
        remain -= dMax;
        t = b.t;
        i++;
      }
    }
    return t;
  }

  private segmentIndexAt(t: number): number {
    const k = this.knots;
    if (t <= k[0].t) return 0;
    for (let i = 0; i < k.length - 1; i++) {
      if (t >= k[i].t && t < k[i + 1].t) return i;
    }
    return k.length - 1;
  }

  /** 返回覆盖 [t0,t1] 的裁剪段 [ta,va,tb,vb] */
  private segmentsCovering(t0: number, t1: number): Array<[number, number, number, number]> {
    const out: Array<[number, number, number, number]> = [];
    let t = t0;
    let i = this.segmentIndexAt(t0);
    while (t < t1) {
      if (i >= this.knots.length - 1) {
        out.push([t, this.speedAt(t), t1, this.speedAt(t1)]);
        break;
      }
      const b = this.knots[i + 1];
      const tb = Math.min(t1, b.t);
      out.push([t, this.speedAt(t), tb, this.speedAt(tb)]);
      t = tb;
      i++;
    }
    return out;
  }
}
