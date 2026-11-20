import type { CameraSpec, Package, Vec3 } from './types';
import { add, norm, scale, sub } from './geometry';

/** 传感器尺寸（mm） */
export function sensorSizeMm(cam: CameraSpec): { w: number; h: number } {
  return {
    w: (cam.sensorWidthPx * cam.pixelUm) / 1000,
    h: (cam.sensorHeightPx * cam.pixelUm) / 1000,
  };
}

/**
 * 对焦工作距离下的理论视场（mm），针孔近似：
 * FOV = 工作距离 × 靶面尺寸 / 焦距
 */
export function fieldOfView(cam: CameraSpec, focusDistanceMm: number): { width: number; height: number } {
  const s = sensorSizeMm(cam);
  return {
    width: (focusDistanceMm * s.w) / cam.lens.focalMm,
    height: (focusDistanceMm * s.h) / cam.lens.focalMm,
  };
}

/**
 * 超焦距与景深（薄透镜几何）。
 * H = f²/(N·c) + f；近/远限由对焦距离 s 与 H 推出。
 */
export function depthOfField(cam: CameraSpec, focusDistanceMm: number) {
  const { focalMm: f, fNumber: N, circleOfConfusionMm: c } = cam.lens;
  const H = (f * f) / (N * c) + f;
  const near = (H * focusDistanceMm) / (H + focusDistanceMm - f);
  const far = (H * focusDistanceMm) / (H - focusDistanceMm + f);
  return { hyperfocal: H, near, far };
}

/**
 * 离焦弥散圆直径（像方 mm）。
 * 薄透镜关系 1/f = 1/s + 1/v，对焦像距 v_f 与主体像距 v_s 之差按光圈 N 折算。
 */
export function defocusCircleImageMm(cam: CameraSpec, focusDistanceMm: number, subjectDistanceMm: number): number {
  const f = cam.lens.focalMm;
  const N = cam.lens.fNumber;
  const vFocus = 1 / (1 / f - 1 / focusDistanceMm);
  const vSub = 1 / (1 / f - 1 / subjectDistanceMm);
  if (!Number.isFinite(vSub)) return Infinity;
  return Math.abs(vFocus - vSub) / N;
}

/** 主体处单个像素覆盖的物方尺寸（mm/px），针孔投影 */
export function mmPerPixel(cam: CameraSpec, subjectDistanceMm: number): number {
  const pxPitchMm = cam.pixelUm / 1000;
  return (subjectDistanceMm * pxPitchMm) / cam.lens.focalMm;
}

/** 离焦模糊 sigma（像素）：像方弥散圆直接除以像元尺寸，再按 1σ 等效取半 */
export function defocusSigmaPx(cam: CameraSpec, focusDistanceMm: number, subjectDistanceMm: number): number {
  const bImg = defocusCircleImageMm(cam, focusDistanceMm, subjectDistanceMm);
  const pxPitchMm = cam.pixelUm / 1000;
  return bImg / (2 * pxPitchMm);
}

/**
 * 液态镜头：包裹过测高光幕时记录高度，对焦延迟后镜头才对到该高度。
 * 延迟期内保持皮带面对焦；延迟结束后对到包裹顶面。
 */
export function liquidFocusAt(
  cam: CameraSpec,
  pkg: Package,
  cameraToBeltDistance: number,
  curtainHitT: number,
  atT: number,
): number {
  const lagS = cam.lens.focusLagMs / 1000;
  if (atT < curtainHitT + lagS) return cameraToBeltDistance;
  return Math.max(50, cameraToBeltDistance - pkg.height);
}

/** 相机到某世界点的工作距离 */
export function distanceTo(cam: CameraSpec, p: Vec3): number {
  return norm(sub(p, cam.position));
}

/** 相机到皮带面（沿光轴近似）的距离 */
export function cameraBeltDistance(cam: CameraSpec): number {
  return norm(cam.position); // 皮带 z=0
}

/** 光轴上给定距离的世界点 */
export function focusPoint(cam: CameraSpec, distanceMm: number): Vec3 {
  const dir = scale(cam.aim, 1 / (norm(cam.aim) || 1));
  return add(cam.position, scale(dir, distanceMm));
}
