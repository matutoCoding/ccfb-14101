import * as zx from '@zxing/library';

/** 黑白二值位图（true = 黑条/黑模块），已含静区 */
export interface CodeBitmap {
  width: number;
  height: number;
  data: Uint8Array;
}

/** Code128 全部 107 个符号的条空模式（6 元素 = 3 条 3 空，单位模块宽） */
export const CODE128_PATTERNS: number[][] = [
  [2, 1, 2, 2, 2, 2],
  [2, 2, 2, 1, 2, 2],
  [2, 2, 2, 2, 2, 1],
  [1, 2, 1, 2, 2, 3],
  [1, 2, 1, 3, 2, 2],
  [1, 3, 1, 2, 2, 2],
  [1, 2, 2, 2, 1, 3],
  [1, 2, 2, 3, 1, 2],
  [1, 3, 2, 2, 1, 2],
  [2, 2, 1, 2, 1, 3],
  [2, 2, 1, 3, 1, 2],
  [2, 3, 1, 2, 1, 2],
  [1, 1, 2, 2, 3, 2],
  [1, 2, 2, 1, 3, 2],
  [1, 2, 2, 2, 3, 1],
  [1, 1, 3, 2, 2, 2],
  [1, 2, 3, 1, 2, 2],
  [1, 2, 3, 2, 2, 1],
  [2, 2, 3, 2, 1, 1],
  [2, 2, 1, 1, 3, 2],
  [2, 2, 1, 2, 3, 1],
  [2, 1, 3, 2, 1, 2],
  [2, 2, 3, 1, 1, 2],
  [3, 1, 2, 1, 3, 1],
  [3, 1, 1, 2, 2, 2],
  [3, 2, 1, 1, 2, 2],
  [3, 2, 1, 2, 2, 1],
  [3, 1, 2, 2, 1, 2],
  [3, 2, 2, 1, 1, 2],
  [3, 2, 2, 2, 1, 1],
  [2, 1, 2, 1, 2, 3],
  [2, 1, 2, 3, 2, 1],
  [2, 3, 2, 1, 2, 1],
  [1, 1, 1, 3, 2, 3],
  [1, 3, 1, 1, 2, 3],
  [1, 3, 1, 3, 2, 1],
  [1, 1, 2, 3, 1, 3],
  [1, 3, 2, 1, 1, 3],
  [1, 3, 2, 3, 1, 1],
  [2, 1, 1, 3, 1, 3],
  [2, 3, 1, 1, 1, 3],
  [2, 3, 1, 3, 1, 1],
  [1, 1, 2, 1, 3, 3],
  [1, 1, 2, 3, 3, 1],
  [1, 3, 2, 1, 3, 1],
  [1, 1, 3, 1, 2, 3],
  [1, 1, 3, 3, 2, 1],
  [1, 3, 3, 1, 2, 1],
  [3, 1, 3, 1, 2, 1],
  [2, 1, 1, 3, 3, 1],
  [2, 3, 1, 1, 3, 1],
  [2, 1, 3, 1, 1, 3],
  [2, 1, 3, 3, 1, 1],
  [2, 1, 3, 1, 3, 1],
  [3, 1, 1, 1, 2, 3],
  [3, 1, 1, 3, 2, 1],
  [3, 3, 1, 1, 2, 1],
  [3, 1, 2, 1, 1, 3],
  [3, 1, 2, 3, 1, 1],
  [3, 3, 2, 1, 1, 1],
  [3, 1, 4, 1, 1, 1],
  [2, 2, 1, 4, 1, 1],
  [4, 3, 1, 1, 1, 1],
  [1, 1, 1, 2, 2, 4],
  [1, 1, 1, 4, 2, 2],
  [1, 2, 1, 1, 2, 4],
  [1, 2, 1, 4, 2, 1],
  [1, 4, 1, 1, 2, 2],
  [1, 4, 1, 2, 2, 1],
  [1, 1, 2, 2, 1, 4],
  [1, 1, 2, 4, 1, 2],
  [1, 2, 2, 1, 1, 4],
  [1, 2, 2, 4, 1, 1],
  [1, 4, 2, 1, 1, 2],
  [1, 4, 2, 2, 1, 1],
  [2, 4, 1, 2, 1, 1],
  [2, 2, 1, 1, 1, 4],
  [4, 1, 3, 1, 1, 1],
  [2, 4, 1, 1, 1, 2],
  [1, 3, 4, 1, 1, 1],
  [1, 1, 1, 2, 4, 2],
  [1, 2, 1, 1, 4, 2],
  [1, 2, 1, 2, 4, 1],
  [1, 1, 4, 2, 1, 2],
  [1, 2, 4, 1, 1, 2],
  [1, 2, 4, 2, 1, 1],
  [4, 1, 1, 2, 1, 2],
  [4, 2, 1, 1, 1, 2],
  [4, 2, 1, 2, 1, 1],
  [2, 1, 2, 1, 4, 1],
  [2, 1, 4, 1, 2, 1],
  [4, 1, 2, 1, 2, 1],
  [1, 1, 1, 1, 4, 3],
  [1, 1, 1, 3, 4, 1],
  [1, 3, 1, 1, 4, 1],
  [1, 1, 4, 1, 1, 3],
  [1, 1, 4, 3, 1, 1],
  [4, 1, 1, 1, 1, 3],
  [4, 1, 1, 3, 1, 1],
  [1, 1, 3, 1, 4, 1],
  [1, 1, 4, 1, 3, 1],
  [3, 1, 1, 1, 4, 1],
  [4, 1, 1, 1, 3, 1],
  [2, 1, 1, 4, 1, 2],
  [2, 1, 1, 2, 1, 4],
  [2, 1, 1, 2, 3, 2],
  [2, 3, 3, 1, 1, 1, 2]
];
const START_B = 104;
const STOP = 106; // zxing 表 0..106，106 为 7 元素停止符
const QUIET = 10; // 静区模块数（规范最少 10）

/**
 * Code128-B 编码（ASCII 32..126）。
 * 返回模块级一维黑白序列（true=黑），含起止符与静区。
 */
export function encodeCode128(text: string): Uint8Array {
  if (!/^[\x20-\x7e]+$/.test(text)) {
    throw new Error('Code128-B 仅支持 ASCII 32-126 字符');
  }
  const values: number[] = [START_B];
  let checksum = START_B;
  for (let i = 0; i < text.length; i++) {
    const v = text.charCodeAt(i) - 32;
    values.push(v);
    checksum += v * (i + 1);
  }
  values.push(checksum % 103);
  values.push(STOP);

  const modules: number[] = [];
  for (const v of values) {
    const p = CODE128_PATTERNS[v];
    for (let i = 0; i < p.length; i++) {
      for (let k = 0; k < p[i]; k++) modules.push(i % 2 === 0 ? 1 : 0);
    }
  }
  const out = new Uint8Array(modules.length + QUIET * 2).fill(0);
  out.set(modules, QUIET);
  return out;
}

/** 二维码（zxing），含四周静区 */
export function encodeQr(text: string): CodeBitmap {
  const matrix = new zx.QRCodeWriter().encode(text, zx.BarcodeFormat.QR_CODE, 0, 0, new Map());
  const w = matrix.getWidth();
  const data = new Uint8Array(w * w);
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      data[y * w + x] = matrix.get(x, y) ? 1 : 0;
    }
  }
  return { width: w, height: w, data };
}

/** 一维码位图：模块序列提升为单行（高度方向由渲染器按物理高度映射） */
export function encode1D(text: string): CodeBitmap {
  const modules = encodeCode128(text);
  return { width: modules.length, height: 1, data: modules };
}

export interface CodePhysicalSize {
  /** 条码物理宽（mm，含静区） */
  widthMm: number;
  /** 条码物理高（mm，一维码取典型 12mm；二维码 = 模块数×模块宽） */
  heightMm: number;
}

/** 条码在面单上的物理尺寸 */
export function codePhysicalSize(
  type: 'code128' | 'qr',
  bitmap: { width: number; height: number },
  moduleMm: number,
): CodePhysicalSize {
  const widthMm = bitmap.width * moduleMm;
  const heightMm = type === 'qr' ? bitmap.height * moduleMm : 12;
  return { widthMm, heightMm };
}

export function encodeCode(payload: string, type: 'code128' | 'qr'): CodeBitmap {
  return type === 'qr' ? encodeQr(payload) : encode1D(payload);
}
