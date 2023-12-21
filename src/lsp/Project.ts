import type { ProgramBuilder } from '../ProgramBuilder';

export interface Project {
    /**
     * A unique number for this project, generated during this current language server session. Mostly used so we can identify which project is doing logging
     */
    projectNumber: number;
    firstRunPromise: Promise<any>;
    builder: ProgramBuilder;
    /**
     * The path to where the project resides
     */
    projectPath: string;
    /**
     * The path to the workspace where this project resides. A workspace can have multiple projects (by adding a bsconfig.json to each folder).
     */
    workspaceFolder: string;
    isFirstRunComplete: boolean;
    isFirstRunSuccessful: boolean;
    configFilePath?: string;
    isStandaloneFileProject: boolean;
}
