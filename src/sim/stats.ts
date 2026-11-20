import type { FailureReason, PackageResult, PackageType } from './types';
import { PACKAGE_TYPES } from './types';

export interface TypeRate {
  type: PackageType;
  total: number;
  read: number;
  rate: number;
}

export interface CameraRate {
  cameraId: string;
  total: number;
  decode: number;
  rate: number;
  /** 各失败原因计数 */
  failures: Record<FailureReason, number>;
}

export interface RunStats {
  total: number;
  read: number;
  overallRate: number;
  noVisibleLabel: number;
  byType: TypeRate[];
  byCamera: CameraRate[];
}

const FAILURE_REASONS: FailureReason[] = ['blur', 'glare', 'outOfFov', 'resolution', 'unknown'];

export function emptyFailures(): Record<FailureReason, number> {
  return { blur: 0, glare: 0, outOfFov: 0, resolution: 0, unknown: 0 };
}

export function aggregate(results: PackageResult[], cameraIds: string[]): RunStats {
  const typeTotal = new Map<PackageType, number>();
  const typeRead = new Map<PackageType, number>();
  for (const t of PACKAGE_TYPES) {
    typeTotal.set(t, 0);
    typeRead.set(t, 0);
  }
  const camAgg = new Map<string, { total: number; decode: number; failures: Record<FailureReason, number> }>();
  for (const id of cameraIds) camAgg.set(id, { total: 0, decode: 0, failures: emptyFailures() });

  let read = 0;
  let noVisible = 0;
  for (const r of results) {
    typeTotal.set(r.type, (typeTotal.get(r.type) ?? 0) + 1);
    if (r.readOk) {
      read++;
      typeRead.set(r.type, (typeRead.get(r.type) ?? 0) + 1);
    }
    if (r.noVisibleLabel) noVisible++;
    for (const cam of r.perCamera) {
      const agg = camAgg.get(cam.cameraId);
      if (!agg) continue;
      agg.total++;
      if (cam.decodeOk) {
        agg.decode++;
      } else {
        // 一个包裹多个面单时，取优先级最高的失败原因
        const reason = pickFailure(cam.labels.map((l) => l.failureReason));
        if (reason) agg.failures[reason]++;
      }
    }
  }

  const byType: TypeRate[] = PACKAGE_TYPES.map((t) => {
    const total = typeTotal.get(t) ?? 0;
    const rd = typeRead.get(t) ?? 0;
    return { type: t, total, read: rd, rate: total ? rd / total : 0 };
  });
  const byCamera: CameraRate[] = cameraIds.map((id) => {
    const a = camAgg.get(id)!;
    return { cameraId: id, total: a.total, decode: a.decode, rate: a.total ? a.decode / a.total : 0, failures: a.failures };
  });

  return {
    total: results.length,
    read,
    overallRate: results.length ? read / results.length : 0,
    noVisibleLabel: noVisible,
    byType,
    byCamera,
  };
}

function pickFailure(reasons: Array<FailureReason | undefined>): FailureReason | undefined {
  for (const r of FAILURE_REASONS) {
    if (reasons.includes(r)) return r;
  }
  return undefined;
}

export interface TypeDiff {
  type: PackageType;
  rateA: number;
  rateB: number;
  delta: number;
}

/** 两套布局同批包裹对比：按包裹类型给出读码率差 */
export function diffByType(a: RunStats, b: RunStats): TypeDiff[] {
  return a.byType.map((ta, i) => {
    const tb = b.byType[i];
    return { type: ta.type, rateA: ta.rate, rateB: tb.rate, delta: tb.rate - ta.rate };
  });
}
