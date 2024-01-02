import type { LspProject } from '../LspProject';
import { Project } from '../Project';
import type { WorkerMessage } from './MessageHandler';
import { MessageHandler } from './MessageHandler';
import type { MessagePort } from 'worker_threads';

/**
 * Runner logic for Running a Project in a worker thread.
 */
export class WorkerThreadProjectRunner {
    public run(parentPort: MessagePort) {
        //make a new instance of the project (which is the same way we run it in the main thread).
        const project = new Project();
        const messageHandler = new MessageHandler<LspProject>({
            name: 'WorkerThread',
            port: parentPort,
            onRequest: async (request: WorkerMessage) => {
                try {
                    //only the LspProject interface method names will be passed as request names, so just call those functions on the Project class directly
                    let responseData = await project[request.name](...request.data ?? []);
                    messageHandler.sendResponse(request, { data: responseData });

                    //we encountered a runtime crash. Pass that error along as the response to this request
                } catch (e) {
                    const error: Error = e as any;
                    messageHandler.sendResponse(request, { error: error });
                }
            },
            onUpdate: (update) => {

            }
        });

        project.on('all', (eventName: string, data: any) => {
            messageHandler.sendUpdate(eventName, {
                data: data
            });
        });
    }
}
