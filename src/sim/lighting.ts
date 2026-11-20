import type { CameraSpec, LightSpec, Vec3 } from './types';
import { dot, normalize, sub } from './geometry';

export interface ShadingInput {
  point: Vec3;
  normal: Vec3;
  /** 表面粗糙度 0(镜面)..1(漫射) */
  roughness: number;
  /** 是否覆膜/塑料镜面材质 */
  specularMaterial: boolean;
  camera: CameraSpec;
  lights: LightSpec[];
}

export interface ShadingResult {
  /** 漫反射灰度系数 0..1+ */
  diffuse: number;
  /** 镜面峰值 0..1 */
  specular: number;
  /** 反光斑覆盖判定：该点是否落在强镜面反射瓣内 */
  hotSpot: boolean;
}

/**
 * 光照着色（Phong 几何）。
 * 漫反射：Σ I·max(n·l)，条形光按入射角衰减；
 * 镜面：(r·v)^shininess，shininess 由粗糙度映射，
 * 塑料/覆膜 roughness 低，反光斑集中且随光源角度移动。
 */
export function shade(input: ShadingInput): ShadingResult {
  const { point, normal, camera, lights } = input;
  const n = normalize(normal);
  const view = normalize(sub(camera.position, point));
  let diffuse = 0.08; // 环境光底
  let specular = 0;
  let hotSpot = false;

  for (const light of lights) {
    // 同轴光经分光棱镜与相机同轴，方向取相机视线；条形光由灯位指向照射点
    const toLight =
      light.kind === 'coaxial'
        ? view
        : normalize(sub(light.position, point));
    const ndl = Math.max(0, dot(n, toLight));
    const angleAtten = light.kind === 'bar'
      ? Math.cos((light.angleDeg * Math.PI) / 180) * 0.5 + 0.5
      : 1;
    diffuse += light.intensity * ndl * angleAtten;

    // 反射向量 r = 2(n·l)n - l
    const r = sub({ x: 2 * ndl * n.x, y: 2 * ndl * n.y, z: 2 * ndl * n.z }, toLight);
    const rdv = Math.max(0, dot(normalize(r), view));
    const shininess = Math.max(2, Math.round(2 + (1 - input.roughness) * 180));
    const specWeight = input.specularMaterial ? 1.4 : 0.25;
    const s = light.intensity * Math.pow(rdv, shininess) * specWeight;
    specular = Math.max(specular, s);
    // 强反射瓣阈值：塑料/覆膜上的发白反光斑
    if (s > 0.55 && input.specularMaterial) hotSpot = true;
  }

  return { diffuse: Math.min(1.4, diffuse), specular: Math.min(1, specular), hotSpot };
}

/**
 * 反光斑在条码区域的覆盖率估算（0..1）。
 * 对条码包围格点采样，统计 hotSpot 命中比例 —— 与光源角度直接相关，
 * 移动光源角度，光斑中心沿表面滑动，覆盖位置随之变化。
 */
export function glareCoverage(
  camera: CameraSpec,
  lights: LightSpec[],
  samples: Array<{ point: Vec3; normal: Vec3; roughness: number; specularMaterial: boolean }>,
): number {
  if (samples.length === 0) return 0;
  let hit = 0;
  for (const s of samples) {
    const r = shade({ ...s, camera, lights });
    if (r.hotSpot) hit++;
  }
  return hit / samples.length;
}
