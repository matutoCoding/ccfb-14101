import * as zx from '@zxing/library';
import { describe, it, expect } from 'vitest';
import { encode1D, encodeQr } from './barcode';

/** 自定义灰度 LuminanceSource（Node/Worker 均可用，无 DOM 依赖） */
class GrayLuminanceSource extends zx.LuminanceSource {
  private readonly g: Uint8ClampedArray;
  private readonly w: number;
  constructor(w: number, h: number, gray: Uint8ClampedArray) {
    super(w, h);
    this.g = gray;
    this.w = w;
  }
  getRow(y: number): Uint8ClampedArray {
    return this.g.slice(y * this.w, y * this.w + this.w);
  }
  getMatrix(): Uint8ClampedArray {
    return this.g;
  }
  isCropSupported(): boolean {
    return true;
  }
  invert(): zx.LuminanceSource {
    const inv = new Uint8ClampedArray(this.g.length);
    for (let i = 0; i < this.g.length; i++) inv[i] = 255 - this.g[i];
    return new GrayLuminanceSource(this.w, this.getHeight(), inv);
  }
}

function render(bitmap: { width: number; height: number; data: Uint8Array }, scale: number): Uint8ClampedArray {
  const W = bitmap.width * scale;
  const H = Math.max(8, bitmap.height * scale * 10);
  const gray = new Uint8ClampedArray(W * H).fill(235);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < bitmap.width; x++) {
      if (bitmap.data[(y / scale >= bitmap.height ? bitmap.height - 1 : Math.floor(y / scale)) * bitmap.width + x]) {
        gray[y * W + x * scale] = 25;
        for (let dx = 0; dx < scale; dx++) gray[y * W + x * scale + dx] = 25;
      }
    }
  }
  return gray;
}

function decode(w: number, h: number, gray: Uint8ClampedArray): string | null {
  const bitmap = new zx.BinaryBitmap(new zx.HybridBinarizer(new GrayLuminanceSource(w, h, gray)));
  const hints = new Map();
  hints.set(zx.DecodeHintType.POSSIBLE_FORMATS, [zx.BarcodeFormat.CODE_128, zx.BarcodeFormat.QR_CODE]);
  hints.set(zx.DecodeHintType.TRY_HARDER, true);
  try {
    return new zx.MultiFormatReader().decode(bitmap, hints).getText();
  } catch {
    return null;
  }
}

describe('条码编码/解码闭环', () => {
  it('Code128-B 自写编码器可被 zxing 解码且文本一致', () => {
    const text = 'CN0000001234-0';
    const bmp = encode1D(text);
    const gray = render(bmp, 3);
    expect(decode(gray.length / 30, 30, gray)).toBe(text);
  });

  it('二维码编码解码一致', () => {
    const text = 'SF00000001Q0';
    const bmp = encodeQr(text);
    const gray = render(bmp, 3);
    expect(decode(bmp.width * 3, bmp.width * 3, gray)).toBe(text);
  });

  it('静区存在：位图左右边缘为白', () => {
    const bmp = encode1D('CN999');
    expect(bmp.height).toBe(1);
    expect(bmp.data[0]).toBe(0);
    expect(bmp.data[bmp.width - 1]).toBe(0);
  });
});
