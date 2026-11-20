import type { BoxFace, LabelSpec, Package, Vec3, WrinkledSurface } from './types';

/** 面的局部坐标系：u/v 为面上两轴（mm），normal 为面外法线（世界单位向量） */
export interface FaceFrame {
  face: BoxFace;
  uAxis: Vec3;
  vAxis: Vec3;
  normal: Vec3;
  /** 面中心世界坐标（包裹中心在原点时） */
  center: Vec3;
  /** 面的 u/v 半尺寸（mm） */
  halfU: number;
  halfV: number;
}

const X: Vec3 = { x: 1, y: 0, z: 0 };
const Y: Vec3 = { x: 0, y: 1, z: 0 };
const Z: Vec3 = { x: 0, y: 0, z: 1 };

/** 六个面的局部坐标框架，v 轴尽量朝世界 +z 或 +y，便于面单方向直观 */
export function faceFrames(p: Pick<Package, 'length' | 'width' | 'height'>): Record<BoxFace, FaceFrame> {
  const { length: l, width: w, height: h } = p;
  return {
    top: { face: 'top', uAxis: X, vAxis: Y, normal: Z, center: { x: 0, y: 0, z: h / 2 }, halfU: w / 2, halfV: l / 2 },
    bottom: { face: 'bottom', uAxis: X, vAxis: { ...Y, y: -1 }, normal: { ...Z, z: -1 }, center: { x: 0, y: 0, z: -h / 2 }, halfU: w / 2, halfV: l / 2 },
    front: { face: 'front', uAxis: X, vAxis: Z, normal: Y, center: { x: 0, y: l / 2, z: 0 }, halfU: w / 2, halfV: h / 2 },
    back: { face: 'back', uAxis: { ...X, x: -1 }, vAxis: Z, normal: { ...Y, y: -1 }, center: { x: 0, y: -l / 2, z: 0 }, halfU: w / 2, halfV: h / 2 },
    left: { face: 'left', uAxis: Y, vAxis: Z, normal: { ...X, x: -1 }, center: { x: -w / 2, y: 0, z: 0 }, halfU: l / 2, halfV: h / 2 },
    right: { face: 'right', uAxis: { ...Y, y: -1 }, vAxis: Z, normal: X, center: { x: w / 2, y: 0, z: 0 }, halfU: l / 2, halfV: h / 2 },
  };
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
export function scale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}
export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
export function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}
export function norm(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z);
}
export function normalize(a: Vec3): Vec3 {
  const n = norm(a) || 1;
  return { x: a.x / n, y: a.y / n, z: a.z / n };
}

/**
 * 面单四角的包裹本地坐标（包裹中心为原点，未加平移）。
 * 面单先在面内平移 (u,v)，再绕面法线旋转 tiltDeg。
 */
export function labelCornersLocal(p: Package, label: LabelSpec): Vec3[] {
  const frames = faceFrames(p);
  const f = frames[label.face];
  const c = Math.cos((label.tiltDeg * Math.PI) / 180);
  const s = Math.sin((label.tiltDeg * Math.PI) / 180);
  const hu = label.width / 2;
  const hv = label.height / 2;
  const uv: Array<[number, number]> = [
    [-hu, -hv],
    [hu, -hv],
    [hu, hv],
    [-hu, hv],
  ];
  return uv.map(([u0, v0]) => {
    const u = c * u0 - s * v0 + label.u;
    const v = s * u0 + c * v0 + label.v;
    const corner = add(f.center, add(scale(f.uAxis, u), scale(f.vAxis, v)));
    if (label.face === 'top' && label.wrinkle) {
      corner.z = p.height / 2 + topHeightAt(label.wrinkle, corner.x, corner.y);
    }
    return corner;
  });
}

/** 顶面褶皱/鼓包高度场（mm），中心鼓包 + 双向正弦褶皱 */
export function topHeightAt(s: WrinkledSurface, x: number, y: number): number {
  const wave =
    s.amp * 0.5 *
    (Math.sin(2 * Math.PI * s.freqX * x + s.phaseX) +
      Math.sin(2 * Math.PI * s.freqY * y + s.phaseY));
  const r2 = x * x + y * y;
  const bulge = s.bulge * Math.exp(-r2 / (2 * Math.pow(60, 2)));
  return wave + bulge;
}

/** 顶面任意点的数值梯度法线 */
export function topNormalAt(s: WrinkledSurface, x: number, y: number): Vec3 {
  const e = 0.5;
  const dzdx = (topHeightAt(s, x + e, y) - topHeightAt(s, x - e, y)) / (2 * e);
  const dzdy = (topHeightAt(s, x, y + e) - topHeightAt(s, x, y - e)) / (2 * e);
  return normalize({ x: -dzdx, y: -dzdy, z: 1 });
}
