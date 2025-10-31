/**
 * This script is the entry point for worker threads that run LSP Projects.
 * It sets up the WorkerThreadProjectRunner to handle messages from the main thread.
 */
import { parentPort } from 'worker_threads';
import { WorkerThreadProjectRunner } from './WorkerThreadProjectRunner';

// eslint-disable-next-line no-debugger
const runner = new WorkerThreadProjectRunner();
if (!parentPort) {
    throw new Error('This script must be run as a worker thread');
}
runner.run(parentPort);
