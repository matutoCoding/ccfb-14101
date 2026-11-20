/**
 * 全局领域模型：单位约定
 * 长度：mm；时间：s（API 入参里出现 ms 的地方单独标注）
 * 世界坐标系：x = 皮带横向（中心 0），y = 皮带运动方向，z = 竖直向上（皮带面 z=0）
 */

export type PackageType = 'carton' | 'woven' | 'plastic' | 'soft';
export const PACKAGE_TYPES: PackageType[] = ['carton', 'woven', 'plastic', 'soft'];

export type CodeType = 'code128' | 'qr';
export type CameraType = 'area' | 'line';
export type CameraRole = 'top' | 'left' | 'right';
export type LightKind = 'bar' | 'coaxial';
export type TriggerMode = 'encoder' | 'freerun';
export type FailureReason = 'blur' | 'glare' | 'outOfFov' | 'resolution' | 'unknown';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** 皮带分段线性速度曲线节点：t(s) -> v(mm/s) */
export interface SpeedKnot {
  t: number;
  v: number;
}

export interface SizeRange {
  lMin: number;
  lMax: number;
  wMin: number;
  wMax: number;
  hMin: number;
  hMax: number;
}

export interface PackageGenConfig {
  total: number;
  seed: number;
  /** 各类型占比，无需归一化 */
  proportions: Record<PackageType, number>;
  sizeRanges: Record<PackageType, SizeRange>;
  label: {
    codeTypes: CodeType[];
    /** 与 codeTypes 等长的权重 */
    codeWeights: number[];
    moduleMmMin: number;
    moduleMmMax: number;
    /** 面单绕面法线旋转角上限（度） */
    tiltDegMax: number;
    /** 褶皱/鼓包幅度上限（mm，仅塑料/软包顶面） */
    wrinkleAmpMax: number;
    /** 面单贴在底面（朝下）的概率 */
    downFaceProb: number;
    /** 非顶面单中贴侧面的概率（其余为底面） */
    sideFaceProb: number;
    /** 覆膜面单概率（镜面反射材质） */
    laminateProb: number;
  };
}

export interface WrinkledSurface {
  /** 褶皱幅度 mm */
  amp: number;
  /** 中央鼓包高度 mm */
  bulge: number;
  freqX: number;
  freqY: number;
  phaseX: number;
  phaseY: number;
}

export type BoxFace = 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right';

export interface LabelSpec {
  id: string;
  face: BoxFace;
  /** 面单在所在面上的局部中心坐标 u/v（mm） */
  u: number;
  v: number;
  /** 面单尺寸（mm），width 沿面局部 u 轴，height 沿 v 轴 */
  width: number;
  height: number;
  /** 绕面法线的旋转角（度） */
  tiltDeg: number;
  codeType: CodeType;
  payload: string;
  /** 条码最窄模块的物理尺寸（mm） */
  moduleMm: number;
  /** 仅顶面：面单随包裹表面的褶皱参数 */
  wrinkle?: WrinkledSurface;
  /** 覆膜面单：更强的镜面反射 */
  laminate: boolean;
}

export interface Package {
  id: number;
  type: PackageType;
  /** 沿皮带运动方向长度（y） */
  length: number;
  /** 横向宽度（x） */
  width: number;
  /** 高度（z） */
  height: number;
  /** 包裹中心横向位置（mm，相对皮带中心） */
  x: number;
  /** 顶面褶皱场（纸箱为 amp=0 的平面） */
  topSurface: WrinkledSurface;
  /** 材质粗糙度 0(镜面)..1(漫射)，塑料袋/覆膜最低 */
  roughness: number;
  /** 基底灰度 0..255 */
  baseGray: number;
  labels: LabelSpec[];
}

export interface LensSpec {
  focalMm: number;
  fNumber: number;
  /** 弥散圆判据（mm） */
  circleOfConfusionMm: number;
  /** 液态镜头：按测高光幕自动对焦 */
  liquidLens: boolean;
  /** 普通镜头的固定对焦距离（mm，沿光轴） */
  focusDistanceMm: number;
  /** 液态镜头对焦延迟（ms） */
  focusLagMs: number;
}

export interface TriggerSpec {
  mode: TriggerMode;
  /** encoder 模式：每多少 mm 皮带位移触发一行（每毫米一行 => 1） */
  mmPerLine: number;
  /** freerun 模式：固定行频 Hz */
  lineRateHz: number;
}

export interface CameraSpec {
  id: string;
  name: string;
  role: CameraRole;
  type: CameraType;
  sensorWidthPx: number;
  sensorHeightPx: number;
  /** 像元尺寸 μm */
  pixelUm: number;
  lens: LensSpec;
  /** 镜头入瞳世界坐标（mm） */
  position: Vec3;
  /** 光轴单位方向向量（从相机指向场景） */
  aim: Vec3;
  trigger: TriggerSpec;
  /** 面阵曝光时间（μs） */
  exposureUs: number;
  /** 增益（倍，1 = 标准） */
  gain: number;
  /** 读出噪声灰度 sigma（0..255） */
  readNoise: number;
}

export interface LightSpec {
  id: string;
  kind: LightKind;
  position: Vec3;
  /** 照射中心目标点 */
  aim: Vec3;
  /** 相对面法线的入射角（度） */
  angleDeg: number;
  /** 强度 0..1 */
  intensity: number;
  /** 条形光长度（mm） */
  length: number;
}

export interface BeltSpec {
  widthMm: number;
  /** 标称速度 mm/s */
  speedMmPerS: number;
  /** 可选变速曲线；为空表示恒速 */
  speedProfile: SpeedKnot[];
  /** 测高光幕的 y 坐标（液态 lens 用） */
  lightCurtainY: number;
}

export interface LayoutSpec {
  id: string;
  name: string;
  belt: BeltSpec;
  gantry: { yMm: number; heightMm: number };
  cameras: CameraSpec[];
  lights: LightSpec[];
}

export interface LabelMetrics {
  labelId: string;
  codeType: CodeType;
  /** 条码模块在图上的像素尺寸（最小模块，多方向取最差值） */
  modulePx: number;
  /** Michelson 对比度 0..1 */
  contrast: number;
  /** 镜面反光斑覆盖条码区域比例 0..1 */
  glareCoverage: number;
  /** 等效模糊核 sigma（px，含离焦+运动） */
  blurSigmaPx: number;
  /** 噪声 sigma（灰度） */
  noiseSigma: number;
  /** 面单是否朝向该相机且无遮挡 */
  visible: boolean;
  /** 是否落在传感器视场内 */
  inFov: boolean;
  decodeOk: boolean;
  failureReason?: FailureReason;
}

export interface CameraPackageResult {
  cameraId: string;
  decodeOk: boolean;
  labels: LabelMetrics[];
}

export interface PackageResult {
  packageId: number;
  type: PackageType;
  /** 全系统读码成功：任意相机解出任一码 */
  readOk: boolean;
  /** 面单全部朝下或落在所有相机死角 */
  noVisibleLabel: boolean;
  perCamera: CameraPackageResult[];
}

export interface BatchRunConfig {
  packageConfigId: string;
  layoutId: string;
  total: number;
  seed: number;
  /** 渲染宽度上限（控制批量速度） */
  maxRenderWidth: number;
}

export type RunStatus = 'running' | 'paused' | 'done' | 'error';

export interface BatchRunState {
  id: string;
  config: BatchRunConfig;
  status: RunStatus;
  processed: number;
  results: PackageResult[];
  startedAt: number;
  updatedAt: number;
  error?: string;
}
