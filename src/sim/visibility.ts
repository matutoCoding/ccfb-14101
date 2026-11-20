import type { CameraSpec, LabelSpec, Package, Vec3 } from './types';
import { dot, faceFrames, normalize, sub } from './geometry';
import { cameraBasis, focalPixels, fovPolygonOnBelt, inSensor, project } from './camera';
import { labelWorldBasis, type PackagePose } from './render';

export interface Visibility {
  /** 面朝向相机且无自遮挡 */
  visible: boolean;
  /** 面单中心投影落在传感器范围内 */
  inFov: boolean;
  /** 朝向点积（调试用） */
  facing: number;
}

/**
 * 面单对相机的可见性。
 * 底面永远不可见；侧面只被对应一侧的相机看到；
 * 顶面要求相机在面单法线半球内，且投影进传感器。
 */
export function checkVisibility(cam: CameraSpec, pose: PackagePose, label: LabelSpec): Visibility {
  const pkg: Package = pose.pkg;
  const frames = faceFrames(pkg);
  const frame = frames[label.face];
  const basis = labelWorldBasis(pose, label);
  const toCam = normalize(sub(cam.position, basis.center));
  const facing = dot(frame.normal, toCam);

  let visible = false;
  if (label.face === 'bottom') {
    visible = false;
  } else if (label.face === 'left') {
    visible = cam.role === 'left' && facing > 0.05;
  } else if (label.face === 'right') {
    visible = cam.role === 'right' && facing > 0.05;
  } else if (label.face === 'front' || label.face === 'back') {
    visible = (cam.role === 'left' || cam.role === 'right') && facing > 0.05;
  } else {
    // 顶面：阈值放宽，褶皱/倾斜顶面仍应被顶扫看到
    visible = cam.role === 'top' && facing > 0.05;
  }

  const proj = project(cam, basis.center);
  let inFov: boolean;
  if (cam.type === 'line') {
    // 线阵：纵向由编码器/行频逐行覆盖，只判列向是否落在单行传感器内
    inFov = proj.inFront && proj.col >= 0 && proj.col < cam.sensorWidthPx;
  } else {
    inFov = proj.inFront && inSensor(cam, proj.col, proj.row);
  }
  return { visible, inFov, facing };
}

/** 包裹是否落在任一相机的视场覆盖内（线阵按面单实际位置判列向覆盖） */
export function packageInAnyFov(cams: CameraSpec[], pose: PackagePose): boolean {
  // 优先用各面单实际位置判断；无面单时退回包裹半高处
  const targets: Vec3[] = pose.pkg.labels.length
    ? pose.pkg.labels.map((l) => labelWorldBasis(pose, l).center)
    : [{ x: pose.pkg.x, y: pose.yCenter, z: pose.pkg.height / 2 }];
  return cams.some((cam) => {
    if (cam.type === 'line') {
      // 线阵视场是横跨皮带的光带：纵向逐行覆盖，只判列向
      const b = cameraBasis(cam);
      const { fx } = focalPixels(cam);
      return targets.some((t) => {
        const rel = sub({ x: t.x, y: cam.position.y, z: t.z }, cam.position);
        const X = dot(rel, b.right);
        const Z = Math.max(1, dot(rel, b.fwd));
        const col = cam.sensorWidthPx / 2 + (fx * X) / Z;
        return col >= 0 && col < cam.sensorWidthPx;
      });
    }
    const poly = fovPolygonOnBelt(cam);
    if (poly.length < 3) return false;
    return pointInPolygon({ x: pose.pkg.x, y: pose.yCenter }, poly);
  });
}

function pointInPolygon(p: { x: number; y: number }, poly: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersect = yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
