import type { Project } from './Project';
import { standardizePath as s, util } from '../util';
import { rokuDeploy } from 'roku-deploy';
import * as path from 'path';
import { ProgramBuilder } from '../ProgramBuilder';
import * as EventEmitter from 'eventemitter3';
import type { CompilerPlugin, FileResolver } from '../interfaces';
import { Deferred } from '../deferred';
import { DiagnosticMessages } from '../DiagnosticMessages';

/**
 * Manages all brighterscript projects for the language server
 */
export class ProjectManager {

    /**
     * Collection of all projects
     */
    public projects: Project[] = [];

    /**
     * A unique project counter to help distinguish log entries in lsp mode
     */
    private projectCounter = 0;

    private emitter = new EventEmitter();

    public on(eventName: 'critical-failure', handler: (data: { project: Project; message: string }) => void);
    public on(eventName: 'flush-diagnostics', handler: (data: { project: Project }) => void);
    public on(eventName: string, handler: (payload: any) => void) {
        this.emitter.on(eventName, handler);
        return () => {
            this.emitter.removeListener(eventName, handler);
        };
    }

    private emit(eventName: 'critical-failure', data: { project: Project; message: string });
    private emit(eventName: 'flush-diagnostics', data: { project: Project });
    private async emit(eventName: string, data?) {
        //emit these events on next tick, otherwise they will be processed immediately which could cause issues
        await util.sleep(0);
        this.emitter.emit(eventName, data);
    }

    private fileResolvers = [] as FileResolver[];

    public addFileResolver(fileResolver: FileResolver) {
        this.fileResolvers.push(fileResolver);
    }

    /**
     * Given a list of all desired projects, create any missing projects and destroy and projects that are no longer available
     * Treat workspaces that don't have a bsconfig.json as a project.
     * Handle situations where bsconfig.json files were added or removed (to elevate/lower workspaceFolder projects accordingly)
     * Leave existing projects alone if they are not affected by these changes
     * @param workspaceConfigs an array of workspaces
     */
    public async syncProjects(workspaceConfigs: WorkspaceConfig[]) {
        //build a list of unique projects
        let projectConfigs = (await Promise.all(
            workspaceConfigs.map(async workspaceConfig => {
                const projectPaths = await this.getProjectPaths(workspaceConfig);
                return projectPaths.map(projectPath => ({
                    projectPath: s`${projectPath}`,
                    workspaceFolder: s`${workspaceConfig}`,
                    excludePatterns: workspaceConfig.excludePatterns
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
    private removeProject(project: Project) {
        const idx = this.projects.findIndex(x => x.projectPath === project?.projectPath);
        if (idx > -1) {
            this.projects.splice(idx, 1);
        }
        project?.builder?.dispose();
    }

    private async createProject(config: ProjectConfig) {
        config.workspaceFolder ??= config.projectPath;

        //skip this project if we already have it
        if (this.hasProject(config.projectPath)) {
            return this.getProject(config.projectPath);
        }

        let builder = new ProgramBuilder();

        config.projectNumber ??= this.projectCounter++;

        builder.logger.prefix = `[prj${config.projectNumber}]`;
        builder.logger.log(`Created project #${config.projectNumber} for: "${config.projectPath}"`);

        //flush diagnostics every time the program finishes validating
        builder.plugins.add({
            name: 'bsc-language-server',
            afterProgramValidate: () => {
                this.emit('flush-diagnostics', { project: this.getProject(config) });
            }
        } as CompilerPlugin);

        //prevent clearing the console on run...this isn't the CLI so we want to keep a full log of everything
        builder.allowConsoleClearing = false;

        //register any external file resolvers
        builder.addFileResolver(...this.fileResolvers);

        let configFilePath = await this.getBsconfigPath(config);

        let cwd = config.projectPath;

        //if the config file exists, use it and its folder as cwd
        if (configFilePath && await util.pathExists(configFilePath)) {
            cwd = path.dirname(configFilePath);
        } else {
            //config file doesn't exist...let `brighterscript` resolve the default way
            configFilePath = undefined;
        }

        const firstRunDeferred = new Deferred<any>();

        let newProject: Project = {
            projectNumber: config.projectNumber,
            builder: builder,
            firstRunPromise: firstRunDeferred.promise,
            projectPath: config.projectPath,
            workspaceFolder: config.workspaceFolder,
            isFirstRunComplete: false,
            isFirstRunSuccessful: false,
            configFilePath: configFilePath,
            isStandaloneFileProject: false
        };

        this.projects.push(newProject);

        try {
            await builder.run({
                cwd: cwd,
                project: configFilePath,
                watch: false,
                createPackage: false,
                deploy: false,
                copyToStaging: false,
                showDiagnosticsInConsole: false
            });
            newProject.isFirstRunComplete = true;
            newProject.isFirstRunSuccessful = true;
            firstRunDeferred.resolve();
        } catch (e) {
            builder.logger.error(e);
            firstRunDeferred.reject(e);
            newProject.isFirstRunComplete = true;
            newProject.isFirstRunSuccessful = false;
        }
        //if we found a deprecated brsconfig.json, add a diagnostic warning the user
        if (configFilePath && path.basename(configFilePath) === 'brsconfig.json') {
            builder.addDiagnostic(configFilePath, {
                ...DiagnosticMessages.brsConfigJsonIsDeprecated(),
                range: util.createRange(0, 0, 0, 0)
            });
            this.emit('flush-diagnostics', { project: newProject });
        }
        return newProject;
    }

    private async getBsconfigPath(config: ProjectConfig) {

        let configFilePath: string;
        //if there's a setting, we need to find the file or show error if it can't be found
        if (config?.bsconfigPath) {
            configFilePath = path.resolve(config.projectPath, config.bsconfigPath);
            if (await util.pathExists(configFilePath)) {
                return configFilePath;
            } else {
                this.emit('critical-failure', {
                    message: `Cannot find config file specified in user / workspace settings at '${configFilePath}'`,
                    project: this.getProject(config)
                });
            }
        }

        //the rest of these require a projectPath, so return early if we don't have one
        if (!config?.projectPath) {
            return undefined;
        }

        //default to config file path found in the root of the workspace
        configFilePath = s`${config.projectPath}/bsconfig.json`;
        if (await util.pathExists(configFilePath)) {
            return configFilePath;
        }

        //look for the deprecated `brsconfig.json` file
        configFilePath = s`${config.projectPath}/brsconfig.json`;
        if (await util.pathExists(configFilePath)) {
            return configFilePath;
        }

        //no config file could be found
        return undefined;
    }
}

interface WorkspaceConfig {
    workspaceFolder: string;
    excludePatterns?: string[];
    /**
     * Path to a bsconfig that should be used instead of the auto-discovery algorithm. If this is present, no bsconfig discovery should be used. and an error should be emitted if this file is missing
     */
    bsconfigPath?: string;
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
}
