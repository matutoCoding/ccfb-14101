import type { CameraSpec, LayoutSpec, LightSpec } from './types';

/** 典型交叉带分拣机读码龙门默认布局：1 顶扫线阵 + 左右侧扫面阵 + 条形/同轴光 */
export function defaultLayout(): LayoutSpec {
  return {
    id: 'layout-default',
    name: '标准龙门（顶扫线阵+双侧扫）',
    belt: {
      widthMm: 800,
      speedMmPerS: 1800,
      speedProfile: [],
      lightCurtainY: 0,
    },
    gantry: { yMm: 1200, heightMm: 1200 },
    cameras: [defaultTopLineCamera(), defaultSideCamera('left'), defaultSideCamera('right')],
    lights: [defaultBarLight('bar-l', -550), defaultBarLight('bar-r', 550), defaultCoaxial()],
  };
}

export function defaultTopLineCamera(): CameraSpec {
  return {
    id: 'cam-top',
    name: '顶扫线阵',
    role: 'top',
    type: 'line',
    sensorWidthPx: 2048,
    sensorHeightPx: 1,
    pixelUm: 7,
    lens: {
      focalMm: 25,
      fNumber: 4,
      circleOfConfusionMm: 0.007,
      liquidLens: false,
      // 对焦在典型包裹顶面（相机高 1200，典型件高 ~150）
      focusDistanceMm: 1050,
      focusLagMs: 30,
    },
    position: { x: 0, y: 1200, z: 1200 },
    aim: { x: 0, y: 0, z: -1 },
    trigger: { mode: 'encoder', mmPerLine: 1, lineRateHz: 1800 },
    exposureUs: 100,
    gain: 1.1,
    readNoise: 4,
  };
}

export function defaultSideCamera(role: 'left' | 'right'): CameraSpec {
  const sign = role === 'left' ? -1 : 1;
  // 俯角 30°：水平分量 cos30，竖直向下分量 sin30
  const aim = { x: -sign * Math.cos((30 * Math.PI) / 180), y: 0, z: -Math.sin((30 * Math.PI) / 180) };
  return {
    id: `cam-${role}`,
    name: role === 'left' ? '左侧扫面阵' : '右侧扫面阵',
    role,
    type: 'area',
    sensorWidthPx: 1920,
    sensorHeightPx: 1200,
    pixelUm: 5.86,
    lens: {
      focalMm: 12,
      fNumber: 4,
      circleOfConfusionMm: 0.0059,
      liquidLens: false,
      focusDistanceMm: 850,
      focusLagMs: 30,
    },
    position: { x: sign * 700, y: 1200, z: 600 },
    aim,
    trigger: { mode: 'freerun', mmPerLine: 1, lineRateHz: 120 },
    exposureUs: 300,
    gain: 1.2,
    readNoise: 5,
  };
}

export function defaultBarLight(id: string, xMm: number): LightSpec {
  return {
    id,
    kind: 'bar',
    position: { x: xMm, y: 1200, z: 900 },
    aim: { x: 0, y: 1200, z: 0 },
    angleDeg: 35,
    intensity: 0.85,
    length: 900,
  };
}

export function defaultCoaxial(): LightSpec {
  return {
    id: 'light-coax',
    kind: 'coaxial',
    position: { x: 0, y: 1200, z: 1150 },
    aim: { x: 0, y: 1200, z: 0 },
    angleDeg: 0,
    intensity: 0.6,
    length: 200,
  };
}

/** 对比布局：顶扫换液态镜头面阵 + 同轴光（读码统计页 A/B 对比用） */
export function alternativeLayout(): LayoutSpec {
  const base = defaultLayout();
  const top: CameraSpec = {
    ...defaultTopLineCamera(),
    id: 'cam-top-liquid',
    name: '顶扫液态镜头面阵',
    type: 'area',
    sensorHeightPx: 1200,
    lens: { ...defaultTopLineCamera().lens, liquidLens: true, focusDistanceMm: 1200, focusLagMs: 45 },
  };
  return {
    ...base,
    id: 'layout-liquid',
    name: '液态镜头面阵+同轴光',
    cameras: [top, ...base.cameras.filter((c) => c.role !== 'top')],
    lights: [defaultCoaxial(), ...base.lights.filter((l) => l.kind === 'bar')],
  };
}
