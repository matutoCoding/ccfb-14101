/// <reference lib="webworker" />
import type { PackageResult } from './types';
import { SimEngine, buildPoses } from './engine';
import type { WorkerRequest, WorkerResponse } from './workerProtocol';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let paused = false;
let stopped = false;

function post(msg: WorkerResponse): void {
  ctx.postMessage(msg);
}

async function waitWhilePaused(): Promise<void> {
  while (paused && !stopped) {
    await new Promise((r) => setTimeout(r, 120));
  }
}

ctx.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  if (msg.kind === 'pause') {
    paused = true;
    return;
  }
  if (msg.kind === 'resume') {
    paused = false;
    return;
  }
  if (msg.kind === 'stop') {
    stopped = true;
    paused = false;
    return;
  }
  if (msg.kind !== 'start') return;

  paused = false;
  stopped = false;
  const { config, packages, layout, resumeFrom = 0 } = msg;
  const engine = new SimEngine({
    layout,
    maxRenderWidth: config.maxRenderWidth,
    noiseSeed: config.seed ^ 0x55aa,
  });
  const poses = buildPoses(packages);
  const results: PackageResult[] = [];
  const CHUNK = 25;

  try {
    for (let i = resumeFrom; i < poses.length; i++) {
      if (stopped) {
        post({ kind: 'paused', processed: i });
        return;
      }
      await waitWhilePaused();
      if (stopped) {
        post({ kind: 'paused', processed: i });
        return;
      }
      results.push(engine.processPackage(poses[i]));
      if (results.length % CHUNK === 0 || i === poses.length - 1) {
        // 断点续跑：每块回传，主线程落 IndexedDB
        post({ kind: 'progress', processed: i + 1, total: poses.length, chunk: results.slice(-CHUNK) });
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    post({ kind: 'done', total: poses.length, results });
  } catch (err) {
    post({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
