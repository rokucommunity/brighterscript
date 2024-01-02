import type { LspProject } from '../LspProject';
import { Project } from '../Project';
import type { MethodNames, WorkerMessage } from './MessageHandler';
import { MessageHandler } from './MessageHandler';
import type { MessagePort } from 'worker_threads';

/**
 * Runner logic for Running a Project in a worker thread.
 */
export class WorkerThreadProjectRunner {
    //collection of interceptors that will be called when events are fired
    private requestInterceptors = {} as Record<MethodNames<LspProject>, (data: any) => any>;

    private project: Project;

    private messageHandler: MessageHandler<LspProject>;

    public run(parentPort: MessagePort) {
        this.messageHandler = new MessageHandler({
            name: 'WorkerThread',
            port: parentPort,
            onRequest: async (request: WorkerMessage) => {
                try {
                    //if we have a request interceptor registered for this event, call it
                    this.requestInterceptors[request.name]?.(request.data);

                    //only the LspProject interface method names will be passed as request names, so just call those functions on the Project class directly
                    let responseData = await this.project[request.name](...request.data ?? []);
                    this.messageHandler.sendResponse(request, { data: responseData });

                    //we encountered a runtime crash. Pass that error along as the response to this request
                } catch (e) {
                    const error: Error = e as any;
                    this.messageHandler.sendResponse(request, { error: error });
                }
            },
            onUpdate: (update) => {

            }
        });

        this.requestInterceptors.activate = this.onActivate.bind(this);
    }

    /**
     * Fired anytime we get an `activate` request from the client. This allows us to clean up the previous project and make a new one
     */
    private onActivate() {
        //clean up any existing project
        this.project.dispose();

        //make a new instance of the project (which is the same way we run it in the main thread).
        this.project = new Project();

        this.project.on('all', (eventName: string, data: any) => {
            this.messageHandler.sendUpdate(eventName, {
                data: data
            });
        });
    }
}
