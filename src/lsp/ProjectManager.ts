import { standardizePath as s, util } from '../util';
import { rokuDeploy } from 'roku-deploy';
import * as path from 'path';
import * as EventEmitter from 'eventemitter3';
import type { LspDiagnostic, LspProject } from './LspProject';
import { Project } from './Project';
import { WorkerThreadProject } from './worker/WorkerThreadProject';
import type { Hover, Position, Range, Location, SignatureHelp, DocumentSymbol, SymbolInformation, WorkspaceSymbol, CodeAction } from 'vscode-languageserver-protocol';
import { Deferred } from '../deferred';
import type { FlushEvent } from './DocumentManager';
import { DocumentManager } from './DocumentManager';
import type { MaybePromise } from '../interfaces';
import { BusyStatusTracker } from '../BusyStatusTracker';

/**
 * Manages all brighterscript projects for the language server
 */
export class ProjectManager {
    constructor() {
        this.documentManager.on('flush', (event) => {
            void this.applyDocumentChanges(event);
        });
    }

    /**
     * Collection of all projects
     */
    public projects: LspProject[] = [];

    private documentManager = new DocumentManager({
        delay: 150
    });

    public busyStatusTracker = new BusyStatusTracker();

    /**
     * Apply all of the queued document changes. This should only be called as a result of the documentManager flushing changes, and never called manually
     * @param event the document changes that have occurred since the last time we applied
     */
    @TrackBusyStatus
    private async applyDocumentChanges(event: FlushEvent) {
        //apply all of the document actions to each project in parallel
        await Promise.all(this.projects.map(async (project) => {
            await project.applyFileChanges(event.actions);
        }));
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
            this.syncPromise
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
    public async syncProjects(workspaceConfigs: WorkspaceConfig[]) {
        this.syncPromise = (async () => {
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

            //mark that we've completed our first sync
            this.firstSync.tryResolve();
        })();

        //return the sync promise
        return this.syncPromise;
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
    private async findFirstMatchingProject(matcher: (project: LspProject) => boolean | PromiseLike<boolean>) {
        const deferred = new Deferred<LspProject>();
        let projectCount = this.projects.length;
        let doneCount = 0;
        //wait for pending document changes to settle
        await this.documentManager.onSettle();

        this.projects.map(async (project) => {
            try {
                //wait for the project to activate
                await project.whenActivated();

                if (await Promise.resolve(matcher(project)) === true) {
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

    /**
     * Get all the semantic tokens for the given file
     * @param srcPath absolute path to the file
     * @returns an array of semantic tokens
     */
    @TrackBusyStatus
    @OnReady
    public async getSemanticTokens(options: { srcPath: string }) {
        //find the first program that has this file, since it would be incredibly inefficient to generate semantic tokens for the same file multiple times.
        const project = await this.findFirstMatchingProject((x) => {
            return x.hasFile(options.srcPath);
        });

        //if we found a project
        if (project) {
            const result = await Promise.resolve(
                project.getSemanticTokens(options)
            );
            return result;
        }
    }

    /**
     * Get a string containing the transpiled contents of the file at the given path
     * @param srcPath path to the file
     * @returns the transpiled contents of the file as a string
     */
    @TrackBusyStatus
    @OnReady
    public async transpileFile(options: { srcPath: string }) {
        //find the first program that has this file
        const project = await this.findFirstMatchingProject((p) => {
            return p.hasFile(options.srcPath);
        });

        //if we found a project
        if (project) {
            const result = await Promise.resolve(
                project.transpileFile(options)
            );
            return result;
        }
    }

    /**
     *  Get the completions for the given position in the file
     * @param srcPath the path to the file
     * @param position the position of the cursor in the file
     */
    @TrackBusyStatus
    @OnReady
    public async getCompletions(options: { srcPath: string; position: Position }) {
        // const completions = await Promise.all(
        //     this.projects.map(x => x.getCompletions(srcPath, position))
        // );

        // for (let completion of completions) {
        //     completion.commitCharacters = ['.'];
        // }
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
            //keep the first non-falsey result
            (result) => !!result
        );
        return hover?.[0];
    }

    /**
     * Get the definition for the symbol at the given position in the file
     * @param srcPath the path to the file
     * @param position the position of symbol
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
        return result;
    }

    @TrackBusyStatus
    @OnReady
    public async getCodeActions(options: { srcPath: string; range: Range }): Promise<CodeAction[]> {
        //Ask every project for definition info, keep whichever one responds first that has a valid response
        let result = await util.promiseRaceMatch(
            this.projects.map(x => x.getCodeActions(options)),
            //keep the first non-falsey result
            (result) => !!result
        );

        //clone the diagnostics for each code action, since certain diagnostics can have circular reference properties that kill the language server if serialized
        for (const codeAction of result) {
            if (codeAction.diagnostics) {
                codeAction.diagnostics = codeAction.diagnostics?.map(x => util.toDiagnostic(x, options.srcPath));
            }
        }
        return result;
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
     * @returns a new project, or the existing project if one already exists with this config info
     */
    @TrackBusyStatus
    private async createProject(config: ProjectConfig) {
        //skip this project if we already have it
        if (this.hasProject(config.projectPath)) {
            return this.getProject(config.projectPath);
        }

        let project: LspProject = config.threadingEnabled
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
            projectPath: config.projectPath,
            workspaceFolder: config.workspaceFolder,
            projectNumber: config.projectNumber ?? ProjectManager.projectNumberSequence++
        });
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
