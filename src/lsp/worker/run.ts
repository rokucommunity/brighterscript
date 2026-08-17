/**
 * This script is the entry point for worker threads that run LSP Projects.
 *
 * A worker thread can host multiple projects at once (see `WorkerPool.assignProject()`): each project
 * gets its own dedicated `MessagePort`, delivered to this worker as an `attachProject` message on
 * `parentPort`. For every such message, we spin up a new `WorkerThreadProjectRunner` bound to that
 * project's port, so each project's request/response traffic stays fully independent even though they
 * share this worker's JS realm (and its module-level caches).
 */
import { parentPort } from 'worker_threads';
import type { MessagePort } from 'worker_threads';
import { WorkerThreadProjectRunner } from './WorkerThreadProjectRunner';

if (!parentPort) {
    throw new Error('This script must be run as a worker thread');
}

parentPort.on('message', (message: { type: string; port: MessagePort }) => {
    if (message?.type === 'attachProject') {
        const runner = new WorkerThreadProjectRunner();
        runner.run(message.port);
    }
});
