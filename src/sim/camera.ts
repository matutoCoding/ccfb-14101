import type { CameraSpec, Vec3 } from './types';
import { add, cross, dot, normalize, scale, sub } from './geometry';
import { sensorSizeMm } from './optics';

export interface CameraBasis {
  right: Vec3;
  up: Vec3;
  fwd: Vec3;
}

/** 由光轴方向构造正交基；顶扫以 +y 为上方向，侧扫以 +z 为上方向 */
export function cameraBasis(cam: CameraSpec): CameraBasis {
  const fwd = normalize(cam.aim);
  const worldUp: Vec3 = cam.role === 'top' ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 };
  let right = normalize(cross(fwd, worldUp));
  if (dot(right, right) < 1e-12) right = { x: 1, y: 0, z: 0 };
  const up = cross(right, fwd);
  return { right, up, fwd };
}

/** 像素焦距（px） */
export function focalPixels(cam: CameraSpec): { fx: number; fy: number } {
  const px = cam.pixelUm / 1000;
  return { fx: cam.lens.focalMm / px, fy: cam.lens.focalMm / px };
}

export interface ProjectedPoint {
  /** 像素坐标（传感器原点在左上角） */
  col: number;
  row: number;
  /** 沿光轴深度 mm */
  depth: number;
  inFront: boolean;
}

/** 面阵针孔投影 */
export function project(cam: CameraSpec, p: Vec3): ProjectedPoint {
  const b = cameraBasis(cam);
  const rel = sub(p, cam.position);
  const X = dot(rel, b.right);
  const Y = dot(rel, b.up);
  const Z = dot(rel, b.fwd);
  const { fx, fy } = focalPixels(cam);
  return {
    col: cam.sensorWidthPx / 2 + (fx * X) / Z,
    row: cam.sensorHeightPx / 2 - (fy * Y) / Z,
    depth: Z,
    inFront: Z > 0,
  };
}

/**
 * 线阵相机：第 col 列像元对应的世界射线。
 * 线传感器只有一行，射线由 (列角, 光轴) 张成。
 */
export function lineRay(cam: CameraSpec, col: number): { origin: Vec3; dir: Vec3 } {
  const b = cameraBasis(cam);
  const { fx } = focalPixels(cam);
  const dx = (col - cam.sensorWidthPx / 2) / fx;
  const dir = normalize(add(b.fwd, scale(b.right, dx)));
  return { origin: cam.position, dir };
}

/** 射线与 y = const 平面的交点（皮带运动方向平面），无交点返回 null */
export function intersectYPlane(origin: Vec3, dir: Vec3, y: number): Vec3 | null {
  if (Math.abs(dir.y) < 1e-12) return null;
  const t = (y - origin.y) / dir.y;
  if (t <= 0) return null;
  return add(origin, scale(dir, t));
}

/** 射线与 z = const 平面的交点 */
export function intersectZPlane(origin: Vec3, dir: Vec3, z: number): Vec3 | null {
  if (Math.abs(dir.z) < 1e-12) return null;
  const t = (z - origin.z) / dir.z;
  if (t <= 0) return null;
  return add(origin, scale(dir, t));
}

/**
 * 相机视场在皮带面（z=0）上的覆盖四边形（世界坐标 mm）。
 * 布局页用它画 FOV 覆盖范围；线阵相机退化为横跨皮带的两条线（取传感器四角）。
 */
export function fovPolygonOnBelt(cam: CameraSpec): Vec3[] {
  const corners = [
    { c: 0, r: 0 },
    { c: cam.sensorWidthPx - 1, r: 0 },
    { c: cam.sensorWidthPx - 1, r: cam.sensorHeightPx - 1 },
    { c: 0, r: cam.sensorHeightPx - 1 },
  ];
  const poly: Vec3[] = [];
  for (const q of corners) {
    const b = cameraBasis(cam);
    const { fx, fy } = focalPixels(cam);
    const dx = (q.c - cam.sensorWidthPx / 2) / fx;
    const dy = -(q.r - cam.sensorHeightPx / 2) / fy;
    const dir = normalize(add(add(b.fwd, scale(b.right, dx)), scale(b.up, dy)));
    const hit = intersectZPlane(cam.position, dir, 0);
    if (hit) poly.push(hit);
  }
  return poly;
}

/** 点是否落在传感器像素范围内 */
export function inSensor(cam: CameraSpec, col: number, row: number): boolean {
  return col >= 0 && col < cam.sensorWidthPx && row >= 0 && row < cam.sensorHeightPx;
}

/** 工作距离处像素分辨率 mm/px（横向） */
export function pixelPitchAt(cam: CameraSpec, depthMm: number): number {
  const s = sensorSizeMm(cam);
  return (depthMm * s.w) / (cam.lens.focalMm * cam.sensorWidthPx);
}
