import type {
  BoxFace,
  LabelSpec,
  Package,
  PackageGenConfig,
  PackageType,
  WrinkledSurface,
} from './types';
import { PACKAGE_TYPES } from './types';
import { Rng } from './rng';

/** 行业常见默认值（mm），用户可在页面上调整 */
export function defaultPackageConfig(): PackageGenConfig {
  const carton = { lMin: 200, lMax: 500, wMin: 150, wMax: 350, hMin: 100, hMax: 350 };
  const woven = { lMin: 300, lMax: 700, wMin: 250, wMax: 500, hMin: 80, hMax: 300 };
  const plastic = { lMin: 180, lMax: 450, wMin: 150, wMax: 350, hMin: 20, hMax: 120 };
  const soft = { lMin: 200, lMax: 500, wMin: 150, wMax: 400, hMin: 30, hMax: 180 };
  return {
    total: 10000,
    seed: 20261120,
    proportions: { carton: 0.35, woven: 0.2, plastic: 0.3, soft: 0.15 },
    sizeRanges: { carton, woven, plastic, soft: soft },
    label: {
      codeTypes: ['code128', 'qr'],
      codeWeights: [0.7, 0.3],
      moduleMmMin: 0.25,
      moduleMmMax: 0.6,
      tiltDegMax: 15,
      wrinkleAmpMax: 8,
      downFaceProb: 0.04,
      sideFaceProb: 0.5,
      laminateProb: 0.25,
    },
  };
}

interface MaterialProps {
  roughness: number;
  baseGray: number;
}

const MATERIAL: Record<PackageType, MaterialProps> = {
  carton: { roughness: 0.85, baseGray: 168 },
  woven: { roughness: 0.9, baseGray: 150 },
  plastic: { roughness: 0.18, baseGray: 190 },
  soft: { roughness: 0.55, baseGray: 175 },
};

function makeWrinkledSurface(rng: Rng, type: PackageType, ampMax: number): WrinkledSurface {
  const wrinkly = type === 'plastic' || type === 'soft';
  const amp = wrinkly ? rng.uniform(ampMax * 0.3, ampMax) : 0;
  return {
    amp,
    bulge: wrinkly ? rng.uniform(amp * 0.5, amp * 1.4) : 0,
    freqX: rng.uniform(0.008, 0.02),
    freqY: rng.uniform(0.008, 0.02),
    phaseX: rng.uniform(0, Math.PI * 2),
    phaseY: rng.uniform(0, Math.PI * 2),
  };
}

function chooseFace(rng: Rng, cfg: PackageGenConfig, height: number): BoxFace {
  const r = rng.next();
  if (r < cfg.label.downFaceProb) return 'bottom';
  if (r < cfg.label.downFaceProb + (1 - cfg.label.downFaceProb) * cfg.label.sideFaceProb) {
    // 高包裹才贴侧面（左右面，对应侧扫相机）；扁平软包退回顶面
    if (height < 60) return 'top';
    return rng.next() < 0.5 ? 'left' : 'right';
  }
  return 'top';
}

function makeLabel(rng: Rng, cfg: PackageGenConfig, pkg: Package, index: number): LabelSpec {
  const face = chooseFace(rng, cfg, pkg.height);
  const frame = faceDimensions(pkg, face);
  // 面单 80×100mm 量级，随包裹尺寸缩放但不超出面
  const width = Math.min(rng.uniform(70, 100), frame.u * 1.6);
  const height = Math.min(rng.uniform(90, 130), frame.v * 1.6);
  const u = rng.gaussian(0, frame.u * 0.22);
  const v = rng.gaussian(0, frame.v * 0.22);
  const codeIdx = rng.weightedIndex(cfg.label.codeWeights);
  const codeType = cfg.label.codeTypes[codeIdx];
  const moduleMm = rng.uniform(cfg.label.moduleMmMin, cfg.label.moduleMmMax);
  const wrinkle =
    face === 'top' && pkg.topSurface.amp > 0
      ? pkg.topSurface
      : undefined;
  const payload =
    codeType === 'qr'
      ? `SF${pkg.id.toString().padStart(8, '0')}Q${index}`
      : `CN${pkg.id.toString().padStart(10, '0')}-${index}`;
  return {
    id: `${pkg.id}-L${index}`,
    face,
    u: clamp(u, -frame.u / 2 + width / 2, frame.u / 2 - width / 2),
    v: clamp(v, -frame.v / 2 + height / 2, frame.v / 2 - height / 2),
    width,
    height,
    tiltDeg: rng.uniform(-cfg.label.tiltDegMax, cfg.label.tiltDegMax),
    codeType,
    payload,
    moduleMm,
    wrinkle,
    laminate: rng.next() < cfg.label.laminateProb,
  };
}

function faceDimensions(pkg: Package, face: BoxFace): { u: number; v: number } {
  switch (face) {
    case 'top':
    case 'bottom':
      return { u: pkg.width, v: pkg.length };
    case 'front':
    case 'back':
      return { u: pkg.width, v: pkg.height };
    case 'left':
    case 'right':
      return { u: pkg.length, v: pkg.height };
  }
}

function clamp(x: number, lo: number, hi: number): number {
  if (hi < lo) return (lo + hi) / 2;
  return Math.max(lo, Math.min(hi, x));
}

/** 生成一个包裹（位置 x 仅横向，纵向 y 在仿真时按过包时序给定） */
export function generatePackage(rng: Rng, cfg: PackageGenConfig, id: number): Package {
  const weights = PACKAGE_TYPES.map((t) => cfg.proportions[t] ?? 0);
  const type = PACKAGE_TYPES[rng.weightedIndex(weights)];
  const r = cfg.sizeRanges[type];
  // 尺寸对数正态-ish：高斯截断，集中在中段
  const length = clamp(rng.gaussian((r.lMin + r.lMax) / 2, (r.lMax - r.lMin) / 6), r.lMin, r.lMax);
  const width = clamp(rng.gaussian((r.wMin + r.wMax) / 2, (r.wMax - r.wMin) / 6), r.wMin, r.wMax);
  const height = clamp(rng.gaussian((r.hMin + r.hMax) / 2, (r.hMax - r.hMin) / 6), r.hMin, r.hMax);
  const mat = MATERIAL[type];
  const pkg: Package = {
    id,
    type,
    length: round1(length),
    width: round1(width),
    height: round1(height),
    x: rng.gaussian(0, cfg.sizeRanges[type].wMax * 0.18),
    topSurface: makeWrinkledSurface(rng, type, cfg.label.wrinkleAmpMax),
    roughness: clamp(mat.roughness + rng.gaussian(0, 0.05), 0.05, 1),
    baseGray: clamp(mat.baseGray + rng.gaussian(0, 12), 60, 235),
    labels: [],
  };
  // 1~2 张面单，约 15% 概率两张
  const labelCount = rng.next() < 0.15 ? 2 : 1;
  for (let i = 0; i < labelCount; i++) {
    pkg.labels.push(makeLabel(rng, cfg, pkg, i));
  }
  // 横向位置夹在皮带内
  return pkg;
}

export function generateBatch(cfg: PackageGenConfig): Package[] {
  const rng = new Rng(cfg.seed);
  const out: Package[] = [];
  for (let i = 0; i < cfg.total; i++) {
    out.push(generatePackage(rng, cfg, i));
  }
  return out;
}

/** 生成单个（页面预览用），种子 + id 决定全部随机性 */
export function generateOne(cfg: PackageGenConfig, id: number): Package {
  return generatePackage(new Rng((cfg.seed ^ Math.imul(id + 1, 0x9e3779b9)) >>> 0), cfg, id);
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
