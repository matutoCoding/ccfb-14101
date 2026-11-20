import type { BatchRunConfig, BatchRunState, LayoutSpec, Package, PackageResult } from './types';
import { idbPut, idbGet, STORE } from './storage';
import type { WorkerResponse } from './workerProtocol';

export interface RunCallbacks {
  onProgress?: (state: BatchRunState) => void;
  onDone?: (state: BatchRunState) => void;
  onError?: (message: string) => void;
}

function runId(cfg: BatchRunConfig): string {
  return `run:${cfg.packageConfigId}:${cfg.layoutId}:${cfg.total}:${cfg.seed}`;
}

/**
 * 批量运行管理器：Worker 计算 + IndexedDB 断点持久化。
 * 每收到一个 chunk 就落库，关闭/刷新页面后用 resume() 从上次进度继续。
 */
export class RunManager {
  private worker: Worker | null = null;
  private state: BatchRunState | null = null;
  private cb: RunCallbacks = {};

  async start(
    cfg: BatchRunConfig,
    packages: Package[],
    layout: LayoutSpec,
    cb: RunCallbacks,
  ): Promise<void> {
    this.cb = cb;
    const id = runId(cfg);
    const existing = await idbGet<BatchRunState>(STORE.runs, id);
    const resumeFrom = existing && existing.status !== 'done' ? existing.processed : 0;

    this.state = {
      id,
      config: cfg,
      status: 'running',
      processed: resumeFrom,
      results: existing?.results ?? [],
      startedAt: existing?.startedAt ?? Date.now(),
      updatedAt: Date.now(),
    };
    await idbPut(STORE.runs, this.state);

    this.worker = new Worker(new URL('./simWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => this.handle(ev.data);
    this.worker.onerror = (ev) => this.cb.onError?.(ev.message);
    this.worker.postMessage({ kind: 'start', config: cfg, packages, layout, resumeFrom });
  }

  private async handle(msg: WorkerResponse): Promise<void> {
    if (!this.state) return;
    if (msg.kind === 'progress') {
      this.state.processed = msg.processed;
      this.state.results.push(...msg.chunk);
      this.state.updatedAt = Date.now();
      await idbPut(STORE.runs, this.state);
      this.cb.onProgress?.(this.state);
    } else if (msg.kind === 'done') {
      this.state.processed = msg.total;
      this.state.status = 'done';
      this.state.updatedAt = Date.now();
      await idbPut(STORE.runs, this.state);
      this.cb.onDone?.(this.state);
      this.terminate();
    } else if (msg.kind === 'paused') {
      this.state.processed = msg.processed;
      this.state.status = 'paused';
      this.state.updatedAt = Date.now();
      await idbPut(STORE.runs, this.state);
      this.cb.onProgress?.(this.state);
    } else if (msg.kind === 'error') {
      this.state.status = 'error';
      this.state.error = msg.message;
      await idbPut(STORE.runs, this.state);
      this.cb.onError?.(msg.message);
      this.terminate();
    }
  }

  pause(): void {
    this.worker?.postMessage({ kind: 'pause' });
  }

  stop(): void {
    this.worker?.postMessage({ kind: 'stop' });
  }

  private terminate(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  static async resumeState(cfg: BatchRunConfig): Promise<BatchRunState | undefined> {
    return idbGet<BatchRunState>(STORE.runs, runId(cfg));
  }
}

export { runId };
export type { PackageResult };
