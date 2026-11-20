import type { BatchRunConfig, LayoutSpec, Package, PackageResult } from './types';

/** 主线程 → Worker 消息 */
export type WorkerRequest =
  | { kind: 'start'; config: BatchRunConfig; packages: Package[]; layout: LayoutSpec; resumeFrom?: number }
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'stop' };

/** Worker → 主线程消息 */
export type WorkerResponse =
  | { kind: 'progress'; processed: number; total: number; chunk: PackageResult[] }
  | { kind: 'done'; total: number; results: PackageResult[] }
  | { kind: 'paused'; processed: number }
  | { kind: 'error'; message: string };
