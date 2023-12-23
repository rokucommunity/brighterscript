import { ProgramBuilder } from '../ProgramBuilder';
import * as EventEmitter from 'eventemitter3';
import util, { standardizePath as s } from '../util';
import * as path from 'path';
import type { ActivateOptions, LspProject } from './LspProject';
import type { CompilerPlugin } from '../interfaces';
import { DiagnosticMessages } from '../DiagnosticMessages';
import { URI } from 'vscode-uri';

export class Project implements LspProject {

    /**
     * Activates this project. Every call to `activate` should completely reset the project, clear all used ram and start from scratch.
     * @param options
     */
    public async activate(options: ActivateOptions) {
        this.dispose();

        this.projectPath = options.projectPath;
        this.workspaceFolder = options.workspaceFolder;
        this.projectNumber = options.projectNumber;
        this.configFilePath = await this.getConfigFilePath(options);

        this.builder = new ProgramBuilder();
        this.builder.logger.prefix = `[prj${this.projectNumber}]`;
        this.builder.logger.log(`Created project #${this.projectNumber} for: "${this.projectPath}"`);

        let cwd;
        //if the config file exists, use it and its folder as cwd
        if (this.configFilePath && await util.pathExists(this.configFilePath)) {
            cwd = path.dirname(this.configFilePath);
        } else {
            cwd = this.projectPath;
            //config file doesn't exist...let `brighterscript` resolve the default way
            this.configFilePath = undefined;
        }

        //flush diagnostics every time the program finishes validating
        this.builder.plugins.add({
            name: 'bsc-language-server',
            afterProgramValidate: () => {
                this.emit('flush-diagnostics', { project: this });
            }
        } as CompilerPlugin);

        //register any external file resolvers
        //TODO handle in-memory file stuff
        // builder.addFileResolver(...this.fileResolvers);

        try {
            await this.builder.run({
                cwd: cwd,
                project: this.configFilePath,
                watch: false,
                createPackage: false,
                deploy: false,
                copyToStaging: false,
                showDiagnosticsInConsole: false
            });
        } catch (e) {
            this.builder.logger.error(e);
        }

        //if we found a deprecated brsconfig.json, add a diagnostic warning the user
        if (this.configFilePath && path.basename(this.configFilePath) === 'brsconfig.json') {
            this.builder.addDiagnostic(this.configFilePath, {
                ...DiagnosticMessages.brsConfigJsonIsDeprecated(),
                range: util.createRange(0, 0, 0, 0)
            });
            this.emit('flush-diagnostics', { project: this });
        }
    }

    public getDiagnostics() {
        return Promise.resolve(
            this.builder.getDiagnostics().map(x => {
                const uri = URI.file(x.file.srcPath).toString();
                return {
                    ...util.toDiagnostic(x, uri),
                    uri: uri
                };
            })
        );
    }

    public dispose() {
        this.builder?.dispose();
        this.emitter?.removeAllListeners();
    }

    /**
     * Manages the BrighterScript program. The main interface into the compiler/validator
     */
    private builder: ProgramBuilder;

    /**
     * The path to where the project resides
     */
    public projectPath: string;

    /**
     * A unique number for this project, generated during this current language server session. Mostly used so we can identify which project is doing logging
     */
    public projectNumber: number;

    /**
     * The path to the workspace where this project resides. A workspace can have multiple projects (by adding a bsconfig.json to each folder).
     * Defaults to `.projectPath` if not set
     */
    public workspaceFolder: string;

    /**
     * Path to a bsconfig.json file that will be used for this project
     */
    public configFilePath?: string;


    /**
     * Find the path to the bsconfig.json file for this project
     * @param config options that help us find the bsconfig.json
     * @returns path to bsconfig.json, or undefined if unable to find it
     */
    private async getConfigFilePath(config: { configFilePath?: string; projectPath: string }) {
        let configFilePath: string;
        //if there's a setting, we need to find the file or show error if it can't be found
        if (config?.configFilePath) {
            configFilePath = path.resolve(config.projectPath, config.configFilePath);
            if (await util.pathExists(configFilePath)) {
                return configFilePath;
            } else {
                this.emit('critical-failure', {
                    message: `Cannot find config file specified in user or workspace settings at '${configFilePath}'`,
                    project: this
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
    private emitter = new EventEmitter();
}