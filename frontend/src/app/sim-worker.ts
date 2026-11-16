// Worker entry point: thin glue between the worker scope and the testable
// runtime handler (ADR 0004). Interval and scope adaptation live here only.
import { createWorkerHandler } from '../runtime/worker-handler';
import type { WorkerPort } from '../runtime/worker-handler';
import { resolveSetup } from './resolve-setup';

const port = globalThis as unknown as WorkerPort;

const handler = createWorkerHandler({
  post: (message, transfer) => {
    port.postMessage(message, transfer);
  },
  resolve: (setup) => resolveSetup(setup, { timer: () => performance.now() }),
  now: () => performance.now(),
});

port.addEventListener('message', (event) => {
  handler.onMessage(event.data);
});

setInterval(() => {
  handler.pump();
}, 16);
