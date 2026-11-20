import * as zx from '@zxing/library';
import type { FailureReason, LabelMetrics, CodeType } from './types';
import type { GrayImage } from './render';

/** zxing 灰度源（无 DOM 依赖，Worker 可用） */
class GrayLuminanceSource extends zx.LuminanceSource {
  private readonly g: Uint8ClampedArray;
  private readonly w: number;
  constructor(image: GrayImage) {
    super(image.width, image.height);
    this.g = image.data;
    this.w = image.width;
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
    const inverted = new Uint8ClampedArray(this.g.length);
    for (let i = 0; i < this.g.length; i++) inverted[i] = 255 - this.g[i];
    return new GrayLuminanceSource({ width: this.w, height: this.getHeight(), data: inverted });
  }
}

const READER = new zx.MultiFormatReader();
const HINTS = new Map();
HINTS.set(zx.DecodeHintType.POSSIBLE_FORMATS, [zx.BarcodeFormat.CODE_128, zx.BarcodeFormat.QR_CODE]);
HINTS.set(zx.DecodeHintType.TRY_HARDER, true);

/** 解码灰度图，成功返回文本，失败 null */
export function decodeGray(image: GrayImage): string | null {
  try {
    const bitmap = new zx.BinaryBitmap(new zx.HybridBinarizer(new GrayLuminanceSource(image)));
    return READER.decode(bitmap, HINTS).getText();
  } catch {
    return null;
  }
}

/** 从裁剪图条码区域统计 Michelson 对比度 */
export function measureContrast(image: GrayImage, bounds: { x0: number; y0: number; x1: number; y1: number }): number {
  let min = 255;
  let max = 0;
  const { x0, y0, x1, y1 } = bounds;
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const g = image.data[y * image.width + x];
      if (g < min) min = g;
      if (g > max) max = g;
    }
  }
  return max + min === 0 ? 0 : (max - min) / (max + min);
}

/** 工程阈值：低于该模块像素数判为分辨率不足 */
export function minModulePixels(codeType: CodeType): number {
  return codeType === 'qr' ? 2.5 : 2.0;
}

/**
 * 解不出来的失败归类，按现场排查优先级：
 * 出视场 > 分辨率不够 > 反光 > 模糊 > 其他
 */
export function classifyFailure(m: Pick<LabelMetrics, 'inFov' | 'visible' | 'modulePx' | 'glareCoverage' | 'blurSigmaPx' | 'codeType'>): FailureReason {
  if (!m.visible || !m.inFov) return 'outOfFov';
  if (m.modulePx < minModulePixels(m.codeType)) return 'resolution';
  if (m.glareCoverage >= 0.35) return 'glare';
  if (m.blurSigmaPx >= 1.0) return 'blur';
  return 'unknown';
}
