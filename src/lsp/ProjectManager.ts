import { standardizePath as s, util } from '../util';
import { rokuDeploy } from 'roku-deploy';
import * as path from 'path';
import * as EventEmitter from 'eventemitter3';
import type { LspDiagnostic, LspProject, ProjectConfig } from './LspProject';
import { Project } from './Project';
import { WorkerThreadProject } from './worker/WorkerThreadProject';
import { FileChangeType } from 'vscode-languageserver-protocol';
import type { Hover, Position, Range, Location, SignatureHelp, DocumentSymbol, SymbolInformation, WorkspaceSymbol, CompletionList } from 'vscode-languageserver-protocol';
import { Deferred } from '../deferred';
import type { DocumentActionWithStatus, FlushEvent } from './DocumentManager';
import { DocumentManager } from './DocumentManager';
import type { FileChange, MaybePromise } from '../interfaces';
import { BusyStatusTracker } from '../BusyStatusTracker';
import * as fastGlob from 'fast-glob';
import { PathCollection, PathFilterer } from './PathFilterer';
import type { Logger } from '../logging';
import { createLogger } from '../logging';
import { Trace } from '../common/Decorators';

/**
 * Manages all brighterscript projects for the language server
 */
@Trace()
export class ProjectManager {
    constructor(options?: {
        pathFilterer: PathFilterer;
        logger?: Logger;
    }) {
        this.logger = options?.logger ?? createLogger();
        this.pathFilterer = options?.pathFilterer ?? new PathFilterer({ logger: options?.logger });
        this.documentManager.on('flush', (event) => {
            void this.flushDocumentChanges(event).catch(e => console.error(e));
        });

        this.on('validate-begin', (event) => {
            this.busyStatusTracker.beginScopedRun(event.project, `validate-project-${event.project.projectNumber}`);
        });
        this.on('validate-end', (event) => {
            void this.busyStatusTracker.endScopedRun(event.project, `validate-project-${event.project.projectNumber}`);
        });
    }

    private pathFilterer: PathFilterer;

    private logger: Logger;

    /**
     * Collection of all projects
     */
    public projects: LspProject[] = [];

    /**
     * Collection of standalone projects. These are projects that are not part of a workspace, but are instead single files.
     * All of these are also present in the `projects` collection.
     */
    private standaloneProjects: StandaloneProject[] = [];

    private documentManager = new DocumentManager({
        delay: ProjectManager.documentManagerDelay
    });
    public static documentManagerDelay = 150;

    public busyStatusTracker = new BusyStatusTracker();

    /**
     * Apply all of the queued document changes. This should only be called as a result of the documentManager flushing changes, and never called manually
     * @param event the document changes that have occurred since the last time we applied
     */
    @TrackBusyStatus
    @OnReady
    private async flushDocumentChanges(event: FlushEvent) {
        const actions = [...event.actions] as DocumentActionWithStatus[];

        let idSequence = 0;
        //add an ID to every action (so we can track which actions were handled by which projects)
        for (const action of actions) {
            action.id = idSequence++;
        }

        //apply all of the document actions to each project in parallel
        const responses = await Promise.all(this.projects.map(async (project) => {
            //wait for this project to finish activating
            await project.whenActivated();

            const filterer = new PathCollection({
                rootDir: project.rootDir,
                globs: project.filePatterns
            });
            // only include files that are applicable to this specific project (still allow deletes to flow through since they're cheap)
            const projectActions = actions.filter(action => {
                return action.type === 'delete' || filterer.isMatch(action.srcPath);
            });
            return project.applyFileChanges(projectActions);
        }));

        //create standalone projects for any files not handled by any project
        const flatResponses = responses.flat();
        for (const action of actions) {
            //skip this action if it doesn't support standalone projects
            if (!action.allowStandaloneProject || action.type === 'delete') {
                continue;
            }

            // create a standalone project if this action was handled by zero projects and was a 'set' operation
            const wasHandled = flatResponses.some(x => x.id === action.id && action.type === 'set');
            if (wasHandled === false) {
                await this.createStandaloneProject(action.srcPath);
            }
        }
    }

    /**
     * Create a project that validates a single file. This is useful for getting language support for files that don't belong to a project
     */
    private async createStandaloneProject(srcPath: string) {
        srcPath = util.standardizePath(srcPath);
        const projectNumber = ProjectManager.projectNumberSequence++;
        const rootDir = path.join(__dirname, `standalone-project-${projectNumber}`);
        const projectOptions = {
            //these folders don't matter for standalone projects
            workspaceFolder: rootDir,
            projectPath: rootDir,
            enableThreading: false,
            projectNumber: projectNumber,
            files: [{
                src: srcPath,
                dest: 'source/standalone.brs'
            }]
        };
        const project = this.constructProject(projectOptions) as StandaloneProject;
        project.srcPath = srcPath;
        this.standaloneProjects.push(project);
        await this.activateProject(project, projectOptions);
    }

    private removeStandaloneProject(srcPath: string) {
        srcPath = util.standardizePath(srcPath);
        //remove all standalone projects that have this srcPath
        for (let i = this.standaloneProjects.length - 1; i >= 0; i--) {
            const project = this.standaloneProjects[i];
            if (project.srcPath === srcPath) {
                this.removeProject(project);
                this.standaloneProjects.splice(i, 1);
            }
        }
    }

    /**
     * A promise that's set when a sync starts, and resolved when the sync is complete
     */
    private syncPromise: Promise<void> | undefined;
    private firstSync = new Deferred();

    /**
     * Get a promise that resolves when this manager is finished initializing
     */
    public onReady() {
        return Promise.allSettled([
            //wait for the first sync to finish
            this.firstSync.promise,
            //make sure we're not in the middle of a sync
            this.syncPromise,
            //make sure all pending file changes have been flushed
            this.documentManager.onSettle(),
            //make sure all projects are activated
            ...this.projects.map(x => x.whenActivated())
        ]);
    }
    /**
     * Given a list of all desired projects, create any missing projects and destroy and projects that are no longer available
     * Treat workspaces that don't have a bsconfig.json as a project.
     * Handle situations where bsconfig.json files were added or removed (to elevate/lower workspaceFolder projects accordingly)
     * Leave existing projects alone if they are not affected by these changes
     * @param workspaceConfigs an array of workspaces
     */
    @TrackBusyStatus
    public async syncProjects(workspaceConfigs: WorkspaceConfig[], forceReload = false) {
        //if we're force reloading, destroy all projects and start fresh
        if (forceReload) {
            this.logger.log('Force reloading all projects');
            for (const project of this.projects) {
                this.removeProject(project);
            }
        }

        this.syncPromise = (async () => {
            //build a list of unique projects across all workspace folders
            let projectConfigs = (await Promise.all(
                workspaceConfigs.map(async workspaceConfig => {
                    const projectPaths = await this.getProjectPaths(workspaceConfig);
                    return projectPaths.map(projectPath => ({
                        projectPath: s`${projectPath}`,
                        workspaceFolder: s`${workspaceConfig.workspaceFolder}`,
                        excludePatterns: workspaceConfig.excludePatterns,
                        enableThreading: workspaceConfig.enableThreading
                    }));
                })
            )).flat(1);

            //filter the project paths to only include those that are allowed by the path filterer
            projectConfigs = this.pathFilterer.filter(projectConfigs, x => x.projectPath);

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
                projectConfigs.map(async (config) => {
                    await this.createAndActivateProject(config);
                })
            );

            //mark that we've completed our first sync
            this.firstSync.tryResolve();
        })();

        //return the sync promise
        return this.syncPromise;
    }

    /**
     * Promise that resolves when all file changes have been processed (so we can queue file changes in sequence)
     */
    private handleFileChangesPromise: Promise<any> = Promise.resolve();

    public async handleFileChanges(changes: FileChange[]) {
        //wait for the previous file change handling to finish, then handle these changes
        this.handleFileChangesPromise = this.handleFileChangesPromise.catch((e) => {
            console.error(e);
            //ignore errors, they will be handled by the previous caller
        }).then(() => {
            //wait for the initial sync to finish
            return this._handleFileChanges(changes);
        });
        return this.handleFileChangesPromise;
    }

    /**
     * Handle when files or directories are added, changed, or deleted in the workspace.
     * This is safe to call any time. Changes will be queued and flushed at the correct times
     */
    public async _handleFileChanges(changes: FileChange[]) {
        //wait for any pending syncs to finish
        await this.onReady();

        //filter any changes that are not allowed by the path filterer
        changes = this.pathFilterer.filter(changes, x => x.srcPath);

        //process all file changes in parallel
        await Promise.all(changes.map(async (change) => {
            await this.handleFileChange(change);
        }));
    }

    /**
     * Handle a single file change. If the file is a directory, this will recursively read all files in the directory and call `handleFileChanges` again
     */
    private async handleFileChange(change: FileChange) {
        const srcPath = util.standardizePath(change.srcPath);
        if (change.type === FileChangeType.Deleted) {
            //mark this document or directory as deleted
            this.documentManager.delete(srcPath);

            //file added or changed
        } else {
            //if this is a new directory, read all files recursively and register those as file changes too
            if (util.isDirectorySync(srcPath)) {
                const files = await fastGlob('**/*', {
                    cwd: change.srcPath,
                    onlyFiles: true,
                    absolute: true
                });
                //pipe all files found recursively in the new directory through this same function so they can be processed correctly
                await Promise.all(files.map((srcPath) => {
                    return this.handleFileChange({
                        srcPath: srcPath,
                        type: FileChangeType.Changed,
                        allowStandaloneProject: change.allowStandaloneProject
                    });
                }));

                //this is a new file. set the file contents
            } else {
                this.documentManager.set({
                    srcPath: change.srcPath,
                    fileContents: change.fileContents,
                    allowStandaloneProject: change.allowStandaloneProject
                });
            }
        }

        //reload any projects whose bsconfig.json was changed
        const projectsToReload = this.projects.filter(x => x.bsconfigPath?.toLowerCase() === change.srcPath.toLowerCase());
        await Promise.all(
            projectsToReload.map(x => this.reloadProject(x))
        );
    }

    /**
     * Handle when a file is closed in the editor (this mostly just handles removing standalone projects)
     */
    public async handleFileClose(event: { srcPath: string }) {
        this.removeStandaloneProject(event.srcPath);
        //most other methods on this class are async, might as well make this one async too for consistency and future expansion
        await Promise.resolve();
    }

    /**
     * Given a project, forcibly reload it by removing it and re-adding it
     */
    private async reloadProject(project: LspProject) {
        this.removeProject(project);
        project = await this.createAndActivateProject(project.activateOptions);
        this.emit('project-reload', { project: project });
    }

    /**
     * Get all the semantic tokens for the given file
     * @returns an array of semantic tokens
     */
    @TrackBusyStatus
    @OnReady
    public async getSemanticTokens(options: { srcPath: string }) {
        let result = await util.promiseRaceMatch(
            this.projects.map(x => x.getSemanticTokens(options)),
            //keep the first non-falsey result
            (result) => result?.length > 0
        );
        return result;
    }

    /**
     * Get a string containing the transpiled contents of the file at the given path
     * @returns the transpiled contents of the file as a string
     */
    @TrackBusyStatus
    @OnReady
    public async transpileFile(options: { srcPath: string }) {
        let result = await util.promiseRaceMatch(
            this.projects.map(x => x.transpileFile(options)),
            //keep the first non-falsey result
            (result) => !!result
        );
        return result;
    }

    /**
     *  Get the completions for the given position in the file
     */
    @TrackBusyStatus
    @OnReady
    public async getCompletions(options: { srcPath: string; position: Position }): Promise<CompletionList> {
        //Ask every project for results, keep whichever one responds first that has a valid response
        let result = await util.promiseRaceMatch(
            this.projects.map(x => x.getCompletions(options)),
            //keep the first non-falsey result
            (result) => result?.items?.length > 0
        );
        return result;
    }

    /**
     * Get the hover information for the given position in the file. If multiple projects have hover information, the projects will be raced and
     * the fastest result will be returned
     * @returns the hover information or undefined if no hover information was found
     */
    @TrackBusyStatus
    @OnReady
    public async getHover(options: { srcPath: string; position: Position }): Promise<Hover> {
        //Ask every project for hover info, keep whichever one responds first that has a valid response
        let hover = await util.promiseRaceMatch(
            this.projects.map(x => x.getHover(options)),
            //keep the first set of non-empty results
            (result) => result?.length > 0
        );
        return hover?.[0];
    }

    /**
     * Get the definition for the symbol at the given position in the file
     * @returns a list of locations where the symbol under the position is defined in the project
     */
    @TrackBusyStatus
    @OnReady
    public async getDefinition(options: { srcPath: string; position: Position }): Promise<Location[]> {
        //TODO should we merge definitions across ALL projects? or just return definitions from the first project we found

        //Ask every project for definition info, keep whichever one responds first that has a valid response
        let result = await util.promiseRaceMatch(
            this.projects.map(x => x.getDefinition(options)),
            //keep the first non-falsey result
            (result) => !!result
        );
        return result;
    }

    @TrackBusyStatus
    @OnReady
    public async getSignatureHelp(options: { srcPath: string; position: Position }): Promise<SignatureHelp> {
        //Ask every project for definition info, keep whichever one responds first that has a valid response
        let signatures = await util.promiseRaceMatch(
            this.projects.map(x => x.getSignatureHelp(options)),
            //keep the first non-falsey result
            (result) => !!result
        );

        if (signatures?.length > 0) {
            const activeSignature = signatures.length > 0 ? 0 : undefined;

            const activeParameter = activeSignature >= 0 ? signatures[activeSignature]?.index : undefined;

            let result: SignatureHelp = {
                signatures: signatures.map((s) => s.signature),
                activeSignature: activeSignature,
                activeParameter: activeParameter
            };
            return result;
        }
    }

    @TrackBusyStatus
    @OnReady
    public async getDocumentSymbol(options: { srcPath: string }): Promise<DocumentSymbol[]> {
        //Ask every project for definition info, keep whichever one responds first that has a valid response
        let result = await util.promiseRaceMatch(
            this.projects.map(x => x.getDocumentSymbol(options)),
            //keep the first non-falsey result
            (result) => !!result
        );
        return result;
    }

    @TrackBusyStatus
    @OnReady
    public async getWorkspaceSymbol(): Promise<WorkspaceSymbol[]> {
        //Ask every project for definition info, keep whichever one responds first that has a valid response
        let responses = await Promise.allSettled(
            this.projects.map(x => x.getWorkspaceSymbol())
        );
        let results = responses
            //keep all symbol results
            .map((x) => {
                return x.status === 'fulfilled' ? x.value : [];
            })
            //flatten the array
            .flat()
            //throw out nulls
            .filter(x => !!x);

        // Remove duplicates
        const allSymbols = Object.values(
            results.reduce((map, symbol) => {
                const key = symbol.location.uri + symbol.name;
                map[key] = symbol;
                return map;
            }, {})
        );

        return allSymbols as SymbolInformation[];
    }

    @TrackBusyStatus
    @OnReady
    public async getReferences(options: { srcPath: string; position: Position }): Promise<Location[]> {
        //Ask every project for definition info, keep whichever one responds first that has a valid response
        let result = await util.promiseRaceMatch(
            this.projects.map(x => x.getReferences(options)),
            //keep the first non-falsey result
            (result) => !!result
        );
        return result ?? [];
    }

    @TrackBusyStatus
    @OnReady
    public async getCodeActions(options: { srcPath: string; range: Range }) {
        //Ask every project for definition info, keep whichever one responds first that has a valid response
        let result = await util.promiseRaceMatch(
            this.projects.map(x => x.getCodeActions(options)),
            //keep the first non-falsey result
            (result) => !!result
        );
        return result;
    }

    /**
     * Scan a given workspace for all `bsconfig.json` files. If at least one is found, then only folders who have bsconfig.json are returned.
     * If none are found, then the workspaceFolder itself is treated as a project
     */
    private async getProjectPaths(workspaceConfig: WorkspaceConfig) {
        //get the list of exclude patterns, and negate them (so they actually work like excludes)
        const excludePatterns = (workspaceConfig.excludePatterns ?? []).map(x => s`!${x}`);
        let files = await rokuDeploy.getFilePaths([
            '**/bsconfig.json',
            //exclude all files found in `files.exclude`
            ...excludePatterns
        ], workspaceConfig.workspaceFolder);

        //filter the files to only include those that are allowed by the path filterer
        files = this.pathFilterer.filter(files, x => x.src);

        //if we found at least one bsconfig.json, then ALL projects must have a bsconfig.json.
        if (files.length > 0) {
            return files.map(file => s`${path.dirname(file.src)}`);
        }

        //look for roku project folders
        let rokuLikeDirs = (await Promise.all(
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

        //throw out any directories that are not allowed by the path filterer
        rokuLikeDirs = this.pathFilterer.filter(rokuLikeDirs, srcPath => srcPath);

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
        const projectPath = util.standardizePath(
            (typeof param === 'string') ? param : param.projectPath
        );
        return this.projects.find(x => x.projectPath === projectPath);
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
        this.busyStatusTracker.endAllRunsForScope(project);
    }

    /**
     * A unique project counter to help distinguish log entries in lsp mode
     */
    private static projectNumberSequence = 0;

    /**
     * Constructs a project for the given config. Just makes the project, doesn't activate it
     * @returns a new project, or the existing project if one already exists with this config info
     */
    private constructProject(config: ProjectConfig): LspProject {
        //skip this project if we already have it
        if (this.hasProject(config.projectPath)) {
            return this.getProject(config.projectPath);
        }

        config.projectNumber ??= ProjectManager.projectNumberSequence++;

        let project: LspProject = config.enableThreading
            ? new WorkerThreadProject()
            : new Project();

        this.logger.log(`Created project #${config.projectNumber} for: "${config.projectPath}" (${config.enableThreading ? 'worker thread' : 'main thread'})`);

        this.projects.push(project);

        //pipe all project-specific events through our emitter, and include the project reference
        project.on('all', (eventName, data) => {
            this.emit(eventName as any, {
                ...data,
                project: project
            } as any);
        });
        return project;
    }

    /**
     * Constructs a project for the given config
     * @returns a new project, or the existing project if one already exists with this config info
     */
    @TrackBusyStatus
    private async createAndActivateProject(config: ProjectConfig): Promise<LspProject> {
        //skip this project if we already have it
        if (this.hasProject(config.projectPath)) {
            return this.getProject(config.projectPath);
        }
        const project = this.constructProject(config);
        await this.activateProject(project, config);
        return project;
    }

    @TrackBusyStatus
    private async activateProject(project: LspProject, config: ProjectConfig) {
        await project.activate(config);

        //register this project's list of files with the path filterer
        const unregister = this.pathFilterer.registerIncludeList(project.rootDir, project.filePatterns);
        project.disposables.push({ dispose: unregister });
    }

    public on(eventName: 'validate-begin', handler: (data: { project: LspProject }) => MaybePromise<void>);
    public on(eventName: 'validate-end', handler: (data: { project: LspProject }) => MaybePromise<void>);
    public on(eventName: 'critical-failure', handler: (data: { project: LspProject; message: string }) => MaybePromise<void>);
    public on(eventName: 'project-reload', handler: (data: { project: LspProject }) => MaybePromise<void>);
    public on(eventName: 'diagnostics', handler: (data: { project: LspProject; diagnostics: LspDiagnostic[] }) => MaybePromise<void>);
    public on(eventName: string, handler: (payload: any) => MaybePromise<void>) {
        this.emitter.on(eventName, handler as any);
        return () => {
            this.emitter.removeListener(eventName, handler as any);
        };
    }

    private emit(eventName: 'validate-begin', data: { project: LspProject });
    private emit(eventName: 'validate-end', data: { project: LspProject });
    private emit(eventName: 'critical-failure', data: { project: LspProject; message: string });
    private emit(eventName: 'project-reload', data: { project: LspProject });
    private emit(eventName: 'diagnostics', data: { project: LspProject; diagnostics: LspDiagnostic[] });
    private async emit(eventName: string, data?) {
        //emit these events on next tick, otherwise they will be processed immediately which could cause issues
        await util.sleep(0);
        this.emitter.emit(eventName, data);
    }
    private emitter = new EventEmitter();

    public dispose() {
        this.emitter.removeAllListeners();
        for (const project of this.projects) {
            project?.dispose?.();
        }
    }
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
     */
    enableThreading?: boolean;
}

interface StandaloneProject extends LspProject {
    /**
     * The path to the file that this project represents
     */
    srcPath: string;
}

/**
 * An annotation used to wrap the method in a busyStatus tracking call
 */
function TrackBusyStatus(target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    let originalMethod = descriptor.value;

    //wrapping the original method
    descriptor.value = function value(this: ProjectManager, ...args: any[]) {
        return this.busyStatusTracker.run(() => {
            return originalMethod.apply(this, args);
        }, originalMethod.name);
    };
}

/**
 * Wraps the method in a an awaited call to `onReady` to ensure the project manager is ready before the method is called
 */
function OnReady(target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    let originalMethod = descriptor.value;

    //wrapping the original method
    descriptor.value = async function value(this: ProjectManager, ...args: any[]) {
        await this.onReady();
        return originalMethod.apply(this, args);
    };
}
