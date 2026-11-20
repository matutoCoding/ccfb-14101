/**
 * 平面单应性（homography）：图像像素 (x,y) → 目标平面归一化坐标。
 * 用 4 对点的 DLT 求解 3×3 矩阵，透视下面单四角到 UV 的映射比双线性更准，
 * 保证条码模块在斜视角下仍按真实投影缩放。
 */

export interface Point2 {
  x: number;
  y: number;
}

/** 高斯消元解线性方程组 Ax=b（A 为 n×n，增广矩阵原地消元） */
function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  const m = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    // 选主元
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    }
    [m[col], m[pivot]] = [m[pivot], m[col]];
    const piv = m[col][col] || 1e-12;
    for (let j = col; j <= n; j++) m[col][j] /= piv;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = m[r][col];
      for (let j = col; j <= n; j++) m[r][j] -= factor * m[col][j];
    }
  }
  return m.map((row) => row[n]);
}

/**
 * 由 4 对对应点求 3×3 单应性 H（行主序），使 dst ≈ H·src（齐次）。
 * src/dst 长度均为 4，顺序一致。
 */
export function findHomography(src: Point2[], dst: Point2[]): number[] {
  // 8 个未知数（h8 固定为 1），每对点给 2 个方程
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solveLinear(A, b);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/** 应用单应性：返回归一化（除以齐次 w）后的目标点 */
export function applyHomography(H: number[], p: Point2): Point2 {
  const w = H[6] * p.x + H[7] * p.y + H[8];
  return {
    x: (H[0] * p.x + H[1] * p.y + H[2]) / w,
    y: (H[3] * p.x + H[4] * p.y + H[5]) / w,
  };
}
