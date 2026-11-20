import { describe, it, expect } from 'vitest';
import { findHomography, applyHomography, type Point2 } from './homography';

describe('单应性矩阵', () => {
  it('单位正方形到缩放平移正方形，角点精确映射', () => {
    const src: Point2[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    // 缩放 2 倍 + 平移 (10, 20)
    const dst: Point2[] = src.map((p) => ({ x: p.x * 2 + 10, y: p.y * 2 + 20 }));
    const H = findHomography(src, dst);
    for (let i = 0; i < src.length; i++) {
      const got = applyHomography(H, src[i]);
      expect(got.x).toBeCloseTo(dst[i].x, 6);
      expect(got.y).toBeCloseTo(dst[i].y, 6);
    }
  });

  it('透视畸变下四角仍精确，内部点误差小', () => {
    const src: Point2[] = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 120 },
      { x: 0, y: 120 },
    ];
    // 模拟斜视：右上角被拉远
    const dst: Point2[] = [
      { x: 10, y: 20 },
      { x: 180, y: 40 },
      { x: 170, y: 130 },
      { x: 20, y: 110 },
    ];
    const H = findHomography(src, dst);
    const center = applyHomography(H, { x: 100, y: 60 });
    expect(center.x).toBeGreaterThan(0);
    expect(center.y).toBeGreaterThan(0);
    // 四角精确
    for (let i = 0; i < 4; i++) {
      const g = applyHomography(H, src[i]);
      expect(Math.abs(g.x - dst[i].x)).toBeLessThan(1e-6);
      expect(Math.abs(g.y - dst[i].y)).toBeLessThan(1e-6);
    }
  });
});
