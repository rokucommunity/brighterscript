import { ProgramBuilder } from '../ProgramBuilder';
import * as EventEmitter from 'eventemitter3';
import util, { standardizePath as s } from '../util';
import * as path from 'path';
import type { ActivateOptions, ActivateResponse, LspDiagnostic, LspProject } from './LspProject';
import type { CompilerPlugin, Hover, MaybePromise } from '../interfaces';
import { DiagnosticMessages } from '../DiagnosticMessages';
import { URI } from 'vscode-uri';
import { Deferred } from '../deferred';
import { rokuDeploy } from 'roku-deploy';
import type { CodeAction, DocumentSymbol, Position, Range, Location, WorkspaceSymbol } from 'vscode-languageserver-protocol';
import { CompletionList } from 'vscode-languageserver-protocol';
import { CancellationTokenSource } from 'vscode-languageserver-protocol';
import type { DocumentAction } from './DocumentManager';
import type { SignatureInfoObj } from '../Program';
import type { ProjectConfig } from './ProjectManager';

export class Project implements LspProject {
    constructor(
        /**
         * The config used to create this project. Mostly just here to use when reloading this project
         */
        public projectConfig: ProjectConfig
    ) {

    }

    /**
     * Activates this project. Every call to `activate` should completely reset the project, clear all used ram and start from scratch.
     */
    public async activate(options: ActivateOptions): Promise<ActivateResponse> {
        this.projectPath = options.projectPath;
        this.workspaceFolder = options.workspaceFolder;
        this.projectNumber = options.projectNumber;
        this.configFilePath = await this.getConfigFilePath(options);

        this.builder = new ProgramBuilder();
        this.builder.logger.prefix = `[prj${this.projectNumber}]`;
        this.builder.logger.log(`Created project #${this.projectNumber} for: "${this.projectPath}"`);

        let cwd: string;
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
                const diagnostics = this.getDiagnostics();
                this.emit('diagnostics', {
                    diagnostics: diagnostics
                });
            }
        } as CompilerPlugin);

        //register any external file resolvers
        //TODO handle in-memory file stuff
        // builder.addFileResolver(...this.fileResolvers);

        await this.builder.run({
            cwd: cwd,
            project: this.configFilePath,
            watch: false,
            createPackage: false,
            deploy: false,
            copyToStaging: false,
            showDiagnosticsInConsole: false,
            skipInitialValidation: true
        });

        //if we found a deprecated brsconfig.json, add a diagnostic warning the user
        if (this.configFilePath && path.basename(this.configFilePath) === 'brsconfig.json') {
            this.builder.addDiagnostic(this.configFilePath, {
                ...DiagnosticMessages.brsConfigJsonIsDeprecated(),
                range: util.createRange(0, 0, 0, 0)
            });
        }

        //trigger a validation (but don't wait for it. That way we can cancel it sooner if we get new incoming data or requests)
        void this.validate();

        this.activationDeferred.resolve();

        return {
            configFilePath: this.configFilePath,
            rootDir: this.builder.program.options.rootDir
        };
    }

    public get rootDir() {
        return this.builder.program.options.rootDir;
    }

    /**
     * Gets resolved when the project has finished activating
     */
    private activationDeferred = new Deferred();

    /**
     * Promise that resolves when the project finishes activating
     * @returns a promise that resolves when the project finishes activating
     */
    public whenActivated() {
        return this.activationDeferred.promise;
    }

    private validationCancelToken: CancellationTokenSource;

    /**
     * Validate the project. This will trigger a full validation on any scopes that were changed since the last validation,
     * and will also eventually emit a new 'diagnostics' event that includes all diagnostics for the project.
     *
     * This will cancel any currently running validation and then run a new one.
     */
    public async validate() {
        this.cancelValidate();
        //store
        this.validationCancelToken = new CancellationTokenSource();

        await this.builder.program.validate({
            async: true,
            cancellationToken: this.validationCancelToken.token
        });
    }

    /**
     * Cancel any active validation that's running
     */
    public cancelValidate() {
        this.validationCancelToken?.cancel();
        delete this.validationCancelToken;
    }

    public getDiagnostics() {
        const diagnostics = this.builder.getDiagnostics();
        return diagnostics.map(x => {
            const uri = URI.file(x.file.srcPath).toString();
            return {
                ...util.toDiagnostic(x, uri),
                uri: uri
            };
        });
    }

    /**
     * Promise that resolves the next time the system is idle. If the system is already idle, it will resolve immediately
     */
    private async onIdle(): Promise<void> {
        await Promise.all([
            this.activationDeferred.promise
        ]);
    }

    /**
     * Determine if this project has the specified file
     * @param srcPath the absolute path to the file
     * @returns true if the project has the file, false if it does not
     */
    public hasFile(srcPath: string) {
        return this.builder.program.hasFile(srcPath);
    }

    /**
     * Add or replace the in-memory contents of the file at the specified path. This is typically called as the user is typing.
     * This will cancel any pending validation cycles and queue a future validation cycle instead.
     */
    public async applyFileChanges(documentActions: DocumentAction[]): Promise<boolean> {
        await this.onIdle();
        let didChangeFiles = false;
        for (const action of documentActions) {
            let didChangeThisFile = false;
            //if this is a `set` and the file matches the project's files array, set it
            if (action.type === 'set' && this.willAcceptFile(action.srcPath)) {
                didChangeThisFile = this.setFile(action.srcPath, action.fileContents);

                //try to delete the file or directory
            } else if (action.type === 'delete') {
                didChangeThisFile = this.removeFileOrDirectory(action.srcPath);
            }
            didChangeFiles = didChangeFiles || didChangeThisFile;
        }
        if (didChangeFiles) {
            await this.validate();
        }
        return didChangeFiles;
    }

    /**
     * Determine if this project will accept the file at the specified path (i.e. does it match a pattern in the project's files array)
     */
    private willAcceptFile(srcPath: string) {
        return !!rokuDeploy.getDestPath(srcPath, this.builder.program.options.files, this.builder.program.options.rootDir);
    }

    /**
     * Set new contents for a file. This is safe to call any time. Changes will be queued and flushed at the correct times
     * during the program's lifecycle flow
     * @param srcPath absolute source path of the file
     * @param fileContents the text contents of the file
     * @returns true if this program accepted and added the file. false if this file doesn't match against the program's files array
     */
    private setFile(srcPath: string, fileContents: string) {
        const { files, rootDir } = this.builder.program.options;

        //get the dest path for this file.
        let destPath = rokuDeploy.getDestPath(srcPath, files, rootDir);

        //if we got a dest path, then the program wants this file
        if (destPath) {
            this.builder.program.setFile(
                {
                    src: srcPath,
                    dest: destPath
                },
                fileContents
            );
            return true;
        }
        return false;
    }

    /**
     * Remove the in-memory file at the specified path. This is typically called when the user (or file system watcher) triggers a file delete
     * @param srcPath absolute path to the File
     * @returns true if we found and removed at least one file, or false if no files were removed
     */
    private removeFileOrDirectory(srcPath: string) {
        srcPath = util.standardizePath(srcPath);
        //if this is a direct file match, remove the file
        if (this.builder.program.hasFile(srcPath)) {
            this.builder.program.removeFile(srcPath);
            return true;
        }

        //maybe this is a directory. Remove all files that start with this path
        let removedSomeFiles = false;
        let lowerSrcPath = srcPath.toLowerCase();
        for (let file of Object.values(this.builder.program.files)) {
            //if the file path starts with the parent path and the file path does not exactly match the folder path
            if (file.srcPath?.toLowerCase().startsWith(lowerSrcPath)) {
                this.builder.program.removeFile(file.srcPath, false);
                removedSomeFiles = true;
            }
        }
        //return true if we removed at least one file
        return removedSomeFiles;
    }

    /**
     * Get the list of all file paths that are currently loaded in the project
     */
    public getFilePaths() {
        //get all the files in the program
        return Object.values(this.builder.program.files)
            //grab their srcPath values, and toLowerCase them here in case we're in a different thread just to save cycles from the main thread
            .map(x => x.srcPath?.toLowerCase())
            //exclude nulls
            .filter(x => !!x)
            //sort them so it's easier to reason about downstream
            .sort();
    }

    /**
     * Get the full list of semantic tokens for the given file path
     * @param options options for getting semantic tokens
     * @param options.srcPath absolute path to the source file
     */
    public async getSemanticTokens(options: { srcPath: string }) {
        await this.onIdle();
        return this.builder.program.getSemanticTokens(options.srcPath);
    }

    public async transpileFile(options: { srcPath: string }) {
        await this.onIdle();
        return this.builder.program.getTranspiledFileContents(options.srcPath);
    }

    public async getHover(options: { srcPath: string; position: Position }): Promise<Hover[]> {
        await this.onIdle();
        return this.builder.program.getHover(options.srcPath, options.position);
    }

    public async getDefinition(options: { srcPath: string; position: Position }): Promise<Location[]> {
        await this.onIdle();
        return this.builder.program.getDefinition(options.srcPath, options.position);
    }

    public async getSignatureHelp(options: { srcPath: string; position: Position }): Promise<SignatureInfoObj[]> {
        await this.onIdle();
        return this.builder.program.getSignatureHelp(options.srcPath, options.position);
    }

    public async getDocumentSymbol(options: { srcPath: string }): Promise<DocumentSymbol[]> {
        await this.onIdle();
        return this.builder.program.getDocumentSymbols(options.srcPath);
    }

    public async getWorkspaceSymbol(): Promise<WorkspaceSymbol[]> {
        await this.onIdle();
        console.time('getWorkspaceSymbol');
        const result = this.builder.program.getWorkspaceSymbols();
        console.timeEnd('getWorkspaceSymbol');
        return result;
    }

    public async getReferences(options: { srcPath: string; position: Position }): Promise<Location[]> {
        await this.onIdle();
        return this.builder.program.getReferences(options.srcPath, options.position);
    }

    public async getCodeActions(options: { srcPath: string; range: Range }): Promise<CodeAction[]> {
        await this.onIdle();
        return this.builder.program.getCodeActions(options.srcPath, options.range);
    }

    public async getCompletions(options: { srcPath: string; position: Position }): Promise<CompletionList> {
        await this.onIdle();
        const completions = this.builder.program.getCompletions(options.srcPath, options.position);
        const result = CompletionList.create(completions);
        result.itemDefaults = {
            commitCharacters: ['.']
        };
        return result;
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
                    message: `Cannot find config file specified in user or workspace settings at '${configFilePath}'`
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

    public on(eventName: 'critical-failure', handler: (data: { project: Project; message: string }) => MaybePromise<void>);
    public on(eventName: 'diagnostics', handler: (data: { diagnostics: LspDiagnostic[] }) => MaybePromise<void>);
    public on(eventName: 'all', handler: (eventName: string, data: any) => MaybePromise<void>);
    public on(eventName: string, handler: (...args: any[]) => MaybePromise<void>) {
        this.emitter.on(eventName, handler as any);
        return () => {
            this.emitter.removeListener(eventName, handler as any);
        };
    }

    private emit(eventName: 'critical-failure', data: { message: string });
    private emit(eventName: 'diagnostics', data: { diagnostics: LspDiagnostic[] });
    private async emit(eventName: string, data?) {
        //emit these events on next tick, otherwise they will be processed immediately which could cause issues
        await util.sleep(0);
        this.emitter.emit(eventName, data);
        //emit the 'all' event
        this.emitter.emit('all', eventName, data);
    }
    private emitter = new EventEmitter();

    public dispose() {
        this.builder?.dispose();
        this.emitter?.removeAllListeners();
        if (this.activationDeferred?.isCompleted === false) {
            this.activationDeferred.reject(
                new Error('Project was disposed, activation has been aborted')
            );
        }
    }
}
