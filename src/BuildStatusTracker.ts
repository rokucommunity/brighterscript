import type { Connection } from 'vscode-languageserver/node';
import type { Project } from './LanguageServer';

/**
 * Tracks the building/success/error status of various projects in the language server.
 * Reports the overall status (is nothing building, is something building, did something fail) to the language client
 */
export class BuildStatusTracker {
    constructor(
        private connection: Connection
    ) { }

    private projectContainers = new Map<Project, {
        /**
         * The min amount of time this project took to run a task
         */
        min: number;
        /**
         * The max amount of time this project took to run a task
         */
        max: number;
        /**
         * Average build time for this project, in ms
         */
        average: number;
        /**
         * The number of builds used to create the above average
         */
        count: number;
        /**
         * The latest resolved status once all `inProgress` have completed
         */
        mostRecentStatus: BuildStatus;
        /**
         * A set of in-flight active runs. When no work is being done, this list should be empty
         */
        activeRuns: Set<BuildStatusRun>;
    }>();

    private globalProject = {
        projectNumber: undefined,
        projectPath: undefined
    } as Project;

    public run<T, R = T | Promise<T>>(project: Project, callback: (finalize?: FinalizeBuildStatusRun) => R): R {
        const finalizeRun = this.createRun(project);
        let result: R | PromiseLike<R>;
        //call the callback function
        try {
            result = callback(finalizeRun);
            //if the result is a promise, don't finalize until it completes
            if (typeof (result as any)?.then === 'function') {
                return Promise.resolve(result).then(() => {
                    finalizeRun();
                }).catch((e) => {
                    finalizeRun(BuildStatus.criticalError);
                }).then(() => result) as any;
            } else {
                finalizeRun();
                return result;
            }
        } catch (e) {
            finalizeRun(BuildStatus.criticalError);
            throw e;
        }
    }

    /**
     * Create a new run, and return the "finished" callback function"
     */
    private createRun(project: Project) {
        project ??= this.globalProject;

        //create the project container if missing
        if (!this.projectContainers.has(project)) {
            this.projectContainers.set(project, {
                min: Number.MAX_SAFE_INTEGER,
                max: 0,
                average: 0,
                count: 0,
                mostRecentStatus: BuildStatus.success,
                activeRuns: new Set()
            });
        }
        const projectContainer = this.projectContainers.get(project);

        //create the current run
        const currentRunData: BuildStatusRun = {
            status: BuildStatus.building,
            startTime: Date.now()
        };
        projectContainer.activeRuns.add(currentRunData);

        //return a function that should be called when the job has completed
        return (status = BuildStatus.success) => {
            this.finalizeRun(project, currentRunData, status);
        };
    }

    /**
     * Roll up the new build time average and send the event
     */
    private finalizeRun(project: Project, statusRun: BuildStatusRun, status: BuildStatus) {
        const container = this.projectContainers.get(project);
        //skip processing if we can't find that builder or we can't find this active run
        if (!container || !container.activeRuns.has(statusRun)) {
            return;
        }

        const buildTime = this.getDuration(statusRun.startTime);

        //if this is the first completed status, just use the current build time
        if (container.count === 0) {
            container.min = buildTime;
            container.max = buildTime;
            container.average = buildTime;
        } else {
            container.min = Math.min(container.min, buildTime);
            container.max = Math.max(container.max, buildTime);
            //calculate a new average
            container.average = ((container.average * container.count) + buildTime) / (container.count + 1);
        }
        container.count++;
        container.mostRecentStatus = status;

        container.activeRuns.delete(statusRun);

        this.sendEvent(
            this.buildEvent()
        );
    }

    private getDuration(time: number) {
        return Date.now() - time;
    }

    /**
     * Build the event object for this status event that will be sent to the client
     */
    private buildEvent() {
        const event: BuildStatusEvent = {
            status: BuildStatus.success,
            projectInfo: []
        };
        const projects = [...this.projectContainers].map(x => x[0]).sort((a, b) => a.projectNumber - b.projectNumber);
        for (const project of projects) {
            const container = this.projectContainers.get(project);
            event.projectInfo.push({
                projectNumber: project.projectNumber,
                projectPath: project.projectPath,
                statistics: {
                    min: container.min,
                    max: container.max,
                    count: container.count,
                    average: container.average
                }
            });

            //if there's a critical error, set the state to that
            if (container.mostRecentStatus === BuildStatus.criticalError || event.status === BuildStatus.criticalError) {
                event.status = BuildStatus.criticalError;

                //if there are in-flight runs, set the state to "building"
            } else if (container.activeRuns.size > 0) {
                event.status = BuildStatus.building;
            }
        }
        return event;
    }

    /**
     * Rolls up all the current data into a single status event
     */
    private sendEvent(event: BuildStatusEvent) {
        this.connection.sendNotification('build-status', event);
    }

}

interface BuildStatusRun {
    status: BuildStatus;
    startTime: number;
}

export type FinalizeBuildStatusRun = (status?: BuildStatus) => void;

export enum BuildStatus {
    building = 'building',
    success = 'success',
    criticalError = 'criticalError'
}

export interface BuildStatusEvent {
    status: BuildStatus;
    projectInfo: Array<ProjectInfo>;
}
export interface ProjectInfo {
    projectNumber?: number;
    projectPath?: string;
    status: BuildStatus;
    statistics: {
        min: number;
        max: number;
        average: number;
        count: number;
    };
}
