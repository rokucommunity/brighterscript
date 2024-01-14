import { standardizePath as s, util } from '../util';
import { rokuDeploy } from 'roku-deploy';
import * as path from 'path';
import * as EventEmitter from 'eventemitter3';
import type { LspDiagnostic, LspProject, MaybePromise } from './LspProject';
import { Project } from './Project';
import { WorkerThreadProject } from './worker/WorkerThreadProject';
import type { Position } from 'vscode-languageserver';
import { Deferred } from '../deferred';
import type { FlushEvent } from './DocumentManager';
import { DocumentManager } from './DocumentManager';

/**
 * Manages all brighterscript projects for the language server
 */
export class ProjectManager {

    /**
     * Collection of all projects
     */
    public projects: LspProject[] = [];

    private documentManager = new DocumentManager({
        delay: 150
    });


    constructor() {
        this.documentManager.on('flush', (event) => {
            void this.applyDocumentChanges(event);
        });
    }

    /**
     * Apply all of the queued document changes. This should only be called as a result of the documentManager flushing changes, and never called manually
     * @param event the document changes that have occurred since the last time we applied
     */
    private async applyDocumentChanges(event: FlushEvent) {
        //apply all of the document actions to each project in parallel
        await Promise.all(this.projects.map(async (project) => {
            await project.applyFileChanges(event.actions);
        }));
    }

    /**
     * Given a list of all desired projects, create any missing projects and destroy and projects that are no longer available
     * Treat workspaces that don't have a bsconfig.json as a project.
     * Handle situations where bsconfig.json files were added or removed (to elevate/lower workspaceFolder projects accordingly)
     * Leave existing projects alone if they are not affected by these changes
     * @param workspaceConfigs an array of workspaces
     */
    public async syncProjects(workspaceConfigs: WorkspaceConfig[]) {
        //build a list of unique projects across all workspace folders
        let projectConfigs = (await Promise.all(
            workspaceConfigs.map(async workspaceConfig => {
                const projectPaths = await this.getProjectPaths(workspaceConfig);
                return projectPaths.map(projectPath => ({
                    projectPath: s`${projectPath}`,
                    workspaceFolder: s`${workspaceConfig}`,
                    excludePatterns: workspaceConfig.excludePatterns,
                    threadingEnabled: workspaceConfig.threadingEnabled
                }));
            })
        )).flat(1);

        //delete projects not represented in the list
        for (const project of this.projects) {
            //we can't find this existing project in our new list, so scrap it
            if (!projectConfigs.find(x => x.projectPath === project.projectPath)) {
                this.removeProject(project);
            }
        }

        // skip projects we already have (they're already loaded...no need to reload them)
        projectConfigs = projectConfigs.filter(x => {
            return !this.hasProject(x.projectPath);
        });

        //dedupe by project path
        projectConfigs = [
            ...projectConfigs.reduce(
                (acc, x) => acc.set(x.projectPath, x),
                new Map<string, typeof projectConfigs[0]>()
            ).values()
        ];

        //create missing projects
        await Promise.all(
            projectConfigs.map(config => this.createProject(config))
        );
    }

    /**
     * Set new contents for a file. This is safe to call any time. Changes will be queued and flushed at the correct times
     * during the program's lifecycle flow
     * @param srcPath absolute source path of the file
     * @param fileContents the text contents of the file
     */
    public setFile(srcPath: string, fileContents: string) {
        this.documentManager.set(srcPath, fileContents);
    }

    /**
     * Return the first project where the async matcher returns true
     */
    private findFirstMatchingProject(callback: (project: LspProject) => boolean | PromiseLike<boolean>) {
        const deferred = new Deferred<LspProject>();
        let projectCount = this.projects.length;
        let doneCount = 0;
        this.projects.map(async (project) => {
            try {
                //wait for the project to activate
                await project.whenActivated();

                if (await Promise.resolve(callback(project)) === true) {
                    deferred.tryResolve(project);
                }
            } catch (e) {
                console.error(e);
            } finally {
                doneCount++;
            }
            //if this was the last promise, and we didn't resolve, then resolve with undefined
            if (doneCount >= projectCount) {
                deferred.tryResolve(undefined);
            }
        });
        return deferred.promise;
    }

    public async getSemanticTokens(srcPath: string) {
        //find the first program that has this file, since it would be incredibly inefficient to generate semantic tokens for the same file multiple times.
        const project = await this.findFirstMatchingProject((p) => {
            return p.hasFile(srcPath);
        });

        //if we found a project
        if (project) {
            const result = await Promise.resolve(
                project.getSemanticTokens(srcPath)
            );
            return result;
        }
    }

    public async getCompletions(srcPath: string, position: Position) {
        // const completions = await Promise.all(
        //     this.projects.map(x => x.getCompletions(srcPath, position))
        // );

        // for (let completion of completions) {
        //     completion.commitCharacters = ['.'];
        // }
    }

    /**
     * Scan a given workspace for all `bsconfig.json` files. If at least one is found, then only folders who have bsconfig.json are returned.
     * If none are found, then the workspaceFolder itself is treated as a project
     */
    private async getProjectPaths(workspaceConfig: WorkspaceConfig) {
        //get the list of exclude patterns, and negate them (so they actually work like excludes)
        const excludePatterns = (workspaceConfig.excludePatterns ?? []).map(x => s`!${x}`);
        const files = await rokuDeploy.getFilePaths([
            '**/bsconfig.json',
            //exclude all files found in `files.exclude`
            ...excludePatterns
        ], workspaceConfig.workspaceFolder);

        //if we found at least one bsconfig.json, then ALL projects must have a bsconfig.json.
        if (files.length > 0) {
            return files.map(file => s`${path.dirname(file.src)}`);
        }

        //look for roku project folders
        const rokuLikeDirs = (await Promise.all(
            //find all folders containing a `manifest` file
            (await rokuDeploy.getFilePaths([
                '**/manifest',
                ...excludePatterns

                //is there at least one .bs|.brs file under the `/source` folder?
            ], workspaceConfig.workspaceFolder)).map(async manifestEntry => {
                const manifestDir = path.dirname(manifestEntry.src);
                const files = await rokuDeploy.getFilePaths([
                    'source/**/*.{brs,bs}',
                    ...excludePatterns
                ], manifestDir);
                if (files.length > 0) {
                    return manifestDir;
                }
            })
            //throw out nulls
        )).filter(x => !!x);
        if (rokuLikeDirs.length > 0) {
            return rokuLikeDirs;
        }

        //treat the workspace folder as a brightscript project itself
        return [workspaceConfig.workspaceFolder];
    }

    /**
     * Returns true if we have this project, or false if we don't
     * @param projectPath path to the project
     * @returns true if the project exists, or false if it doesn't
     */
    private hasProject(projectPath: string) {
        return !!this.getProject(projectPath);
    }

    /**
     * Get a project with the specified path
     * @param param path to the project or an obj that has `projectPath` prop
     * @returns a project, or undefined if no project was found
     */
    private getProject(param: string | { projectPath: string }) {
        const projectPath = (typeof param === 'string') ? param : param.projectPath;
        return this.projects.find(x => x.projectPath === s`${projectPath}`);
    }

    /**
     * Remove a project from the language server
     */
    private removeProject(project: LspProject) {
        const idx = this.projects.findIndex(x => x.projectPath === project?.projectPath);
        if (idx > -1) {
            this.projects.splice(idx, 1);
        }
        project?.dispose();
    }

    /**
     * A unique project counter to help distinguish log entries in lsp mode
     */
    private static projectNumberSequence = 0;

    /**
     * Create a project for the given config
     * @param config
     * @returns a new project, or the existing project if one already exists with this config info
     */
    private async createProject(config1: ProjectConfig) {
        //skip this project if we already have it
        if (this.hasProject(config1.projectPath)) {
            return this.getProject(config1.projectPath);
        }

        let project: LspProject = config1.threadingEnabled
            ? new WorkerThreadProject()
            : new Project();

        this.projects.push(project);

        //pipe all project-specific events through our emitter, and include the project reference
        project.on('all', (eventName, data) => {
            this.emit(eventName as any, {
                ...data,
                project: project
            } as any);
        });

        await project.activate({
            projectPath: config1.projectPath,
            workspaceFolder: config1.workspaceFolder,
            projectNumber: config1.projectNumber ?? ProjectManager.projectNumberSequence++
        });
        console.log('Activated');
    }

    public on(eventName: 'critical-failure', handler: (data: { project: LspProject; message: string }) => MaybePromise<void>);
    public on(eventName: 'diagnostics', handler: (data: { project: LspProject; diagnostics: LspDiagnostic[] }) => MaybePromise<void>);
    public on(eventName: string, handler: (payload: any) => MaybePromise<void>) {
        this.emitter.on(eventName, handler as any);
        return () => {
            this.emitter.removeListener(eventName, handler as any);
        };
    }

    private emit(eventName: 'critical-failure', data: { project: LspProject; message: string });
    private emit(eventName: 'diagnostics', data: { project: LspProject; diagnostics: LspDiagnostic[] });
    private async emit(eventName: string, data?) {
        //emit these events on next tick, otherwise they will be processed immediately which could cause issues
        await util.sleep(0);
        this.emitter.emit(eventName, data);
    }
    private emitter = new EventEmitter();
}

export interface WorkspaceConfig {
    /**
     * Absolute path to the folder where the workspace resides
     */
    workspaceFolder: string;
    /**
     * A list of glob patterns used to _exclude_ files from various bsconfig searches
     */
    excludePatterns?: string[];
    /**
     * Path to a bsconfig that should be used instead of the auto-discovery algorithm. If this is present, no bsconfig discovery should be used. and an error should be emitted if this file is missing
     */
    bsconfigPath?: string;
    /**
     * Should the projects in this workspace be run in their own dedicated worker threads, or all run on the main thread
     * TODO - is there a better name for this?
     */
    threadingEnabled?: boolean;
}

interface ProjectConfig {
    /**
     * Path to the project
     */
    projectPath: string;
    /**
     * Path to the workspace in which all project files reside or are referenced by
     */
    workspaceFolder: string;
    /**
     * A list of glob patterns used to _exclude_ files from various bsconfig searches
     */
    excludePatterns?: string[];
    /**
     * An optional project number to assign to the project within the context of a language server. reloaded projects should keep the same number if possible
     */
    projectNumber?: number;
    /**
     * Path to a bsconfig that should be used instead of the auto-discovery algorithm. If this is present, no bsconfig discovery should be used. and an error should be emitted if this file is missing
     */
    bsconfigPath?: string;
    /**
     * Should this project run in its own dedicated worker thread
     * TODO - is there a better name for this?
     */
    threadingEnabled?: boolean;
}
