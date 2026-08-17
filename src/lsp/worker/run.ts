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
        try {
            const runner = new WorkerThreadProjectRunner();
            runner.run(message.port);
        } catch (e) {
            //don't let one project's setup failure crash this worker thread and take down every other project sharing it
            console.error('Failed to attach project to worker thread', e);
        }
    }
});

//let the main thread know this worker has finished booting (loaded ts-node/register and registered its message
//listener) and is actually ready to receive `attachProject` messages. Spinning up a brand new worker thread involves
//real OS thread creation plus a `ts-node/register` bootstrap, which can take anywhere from milliseconds to tens of
//seconds depending on the machine - this signal lets callers (see WorkerPool) distinguish "the Worker object exists"
//from "the worker can actually do anything yet".
parentPort.postMessage({ type: 'ready' });
