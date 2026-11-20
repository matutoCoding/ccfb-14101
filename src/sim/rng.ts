/**
 * 确定性随机数：mulberry32 + Box-Muller 高斯。
 * 批量任务用种子驱动，同一种子在主线程/Worker/断点续跑中结果完全一致。
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** [0, 1) 均匀分布 */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let z = this.state;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  }

  /** [min, max) 均匀 */
  uniform(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** 整数 [min, max] */
  int(min: number, max: number): number {
    return Math.floor(this.uniform(min, max + 1));
  }

  /** 正态分布（截断到 ±3σ） */
  gaussian(mean = 0, std = 1): number {
    let u = 0;
    let v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    const g = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    return mean + std * Math.max(-3, Math.min(3, g));
  }

  /** 按权重抽索引 */
  weightedIndex(weights: number[]): number {
    const sum = weights.reduce((a, b) => a + b, 0);
    let r = this.next() * sum;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r < 0) return i;
    }
    return weights.length - 1;
  }

  pick<T>(items: T[]): T {
    return items[this.int(0, items.length - 1)];
  }
}

/** 字符串哈希到 32 位种子（FNV-1a） */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
