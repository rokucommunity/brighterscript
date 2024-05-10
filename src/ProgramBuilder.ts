import * as debounce from 'debounce-promise';
import * as path from 'path';
import { rokuDeploy } from 'roku-deploy';
import type { LogLevel as RokuDeployLogLevel } from 'roku-deploy/dist/Logger';
import type { BsConfig, FinalizedBsConfig } from './BsConfig';
import type { BsDiagnostic, FileObj, FileResolver } from './interfaces';
import { Program } from './Program';
import { standardizePath as s, util } from './util';
import { Watcher } from './Watcher';
import { DiagnosticSeverity } from 'vscode-languageserver';
import { LogLevel, createLogger } from './logging';
import PluginInterface from './PluginInterface';
import * as diagnosticUtils from './diagnosticUtils';
import * as fsExtra from 'fs-extra';
import * as requireRelative from 'require-relative';
import { Throttler } from './Throttler';
import { AssetFile } from './files/AssetFile';
import type { BscFile } from './files/BscFile';
import type { BrsFile } from './files/BrsFile';
import { URI } from 'vscode-uri';
import { DiagnosticManager } from './DiagnosticManager';

/**
 * A runner class that handles
 */
export class ProgramBuilder {

    public constructor() {
        //add the default file resolver (used to load source file contents).
        this.addFileResolver((filePath) => {
            return fsExtra.readFile(filePath);
        });
    }
    /**
     * Determines whether the console should be cleared after a run (true for cli, false for languageserver)
     */
    public allowConsoleClearing = true;

    public options: FinalizedBsConfig = util.normalizeConfig({});
    private isRunning = false;
    private watcher: Watcher | undefined;
    public program: Program | undefined;
    public logger = createLogger();
    public plugins: PluginInterface = new PluginInterface([], { logger: this.logger });
    private fileResolvers = [] as FileResolver[];

    public addFileResolver(fileResolver: FileResolver) {
        this.fileResolvers.push(fileResolver);
    }

    /**
     * Get the contents of the specified file as a string.
     * This walks backwards through the file resolvers until we get a value.
     * This allow the language server to provide file contents directly from memory.
     */
    public async getFileContents(srcPath: string) {
        srcPath = s`${srcPath}`;
        let reversedResolvers = [...this.fileResolvers].reverse();
        for (let fileResolver of reversedResolvers) {
            let result = await fileResolver(srcPath);
            if (typeof result === 'string' || Buffer.isBuffer(result)) {
                return result;
            }
        }
        throw new Error(`Could not load file "${srcPath}"`);
    }

    public diagnostics = new DiagnosticManager();

    public addDiagnostic(srcPath: string, diagnostic: Partial<BsDiagnostic>) {
        if (!this.program) {
            throw new Error('Cannot call `ProgramBuilder.addDiagnostic` before `ProgramBuilder.run()`');
        }
        let file: BscFile | undefined = this.program.getFile(srcPath);
        if (!file) {
            // eslint-disable-next-line @typescript-eslint/dot-notation
            const paths = this.program['getPaths'](srcPath, this.program.options.rootDir ?? this.options.rootDir);
            file = new AssetFile(paths);
            //keep this for backwards-compatibility. TODO remove in v1
            // eslint-disable-next-line @typescript-eslint/dot-notation
            file['pathAbsolute'] = file.srcPath;
            diagnostic.file = file;
        }

        diagnostic.file = file;
        this.diagnostics.register(<any>diagnostic, { tags: ['ProgramBuilder'] });
    }

    public getDiagnostics() {
        return this.diagnostics.getDiagnostics();
    }

    /**
     * Load the project and all the files, but don't run the validation, transpile, or watch cycles
     */
    public async load(options: BsConfig) {
        try {
            this.options = util.normalizeAndResolveConfig(options);
            if (this.options.noProject) {
                this.logger.log(`'no-project' flag is set so bsconfig.json loading is disabled'`);
            } else if (this.options.project) {
                this.logger.log(`Using config file: "${this.options.project}"`);
            } else {
                this.logger.log(`No bsconfig.json file found, using default options`);
            }
            this.loadRequires();
            this.loadPlugins();
        } catch (e: any) {
            if (e?.file && e.message && e.code) {
                let err = e as BsDiagnostic;
                this.diagnostics.register(err);
            } else {
                //if this is not a diagnostic, something else is wrong...
                throw e;
            }
            this.printDiagnostics();

            //we added diagnostics, so hopefully that draws attention to the underlying issues.
            //For now, just use a default options object so we have a functioning program
            this.options = util.normalizeConfig({});
        }
        this.logger.logLevel = this.options.logLevel;

        this.createProgram();

        //parse every file in the entire project
        await this.loadFiles();
    }

    public async run(options: BsConfig) {
        this.logger.logLevel = options.logLevel as LogLevel;

        if (this.isRunning) {
            throw new Error('Server is already running');
        }
        this.isRunning = true;

        await this.load(options);

        if (this.options.watch) {
            this.logger.log('Starting compilation in watch mode...');
            await this.runOnce();
            this.enableWatchMode();
        } else {
            await this.runOnce();
        }
    }

    protected createProgram() {
        this.program = new Program(this.options, this.logger, this.plugins, this.diagnostics);

        this.plugins.emit('afterProgramCreate', {
            builder: this,
            program: this.program
        });

        return this.program;
    }

    protected loadPlugins() {
        const cwd = this.options.cwd ?? process.cwd();
        const plugins = util.loadPlugins(
            cwd,
            this.options.plugins ?? [],
            (pathOrModule, err) => this.logger.error(`Error when loading plugin '${pathOrModule}':`, err)
        );
        this.logger.log(`Loading ${this.options.plugins?.length ?? 0} plugins for cwd "${cwd}"`);
        for (let plugin of plugins) {
            this.plugins.add(plugin);
        }

        this.plugins.emit('beforeProgramCreate', {
            builder: this
        });
    }

    /**
     * `require()` every options.require path
     */
    protected loadRequires() {
        for (const dep of this.options.require ?? []) {
            requireRelative(dep, this.options.cwd);
        }
    }

    private clearConsole() {
        if (this.allowConsoleClearing) {
            util.clearConsole();
        }
    }

    /**
     * A handle for the watch mode interval that keeps the process alive.
     * We need this so we can clear it if the builder is disposed
     */
    private watchInterval: NodeJS.Timer | undefined;

    public enableWatchMode() {
        this.watcher = new Watcher(this.options);
        if (this.watchInterval) {
            clearInterval(this.watchInterval);
        }
        //keep the process alive indefinitely by setting an interval that runs once every 12 days
        this.watchInterval = setInterval(() => { }, 1073741824);

        //clear the console
        this.clearConsole();

        let fileObjects = rokuDeploy.normalizeFilesArray(this.options.files ? this.options.files : []);

        //add each set of files to the file watcher
        for (let fileObject of fileObjects) {
            let src = typeof fileObject === 'string' ? fileObject : fileObject.src;
            this.watcher.watch(src);
        }

        this.logger.log('Watching for file changes...');

        let debouncedRunOnce = debounce(async () => {
            this.logger.log('File change detected. Starting incremental compilation...');
            await this.runOnce();
            this.logger.log(`Watching for file changes.`);
        }, 50);

        //on any file watcher event
        this.watcher.on('all', async (event: string, thePath: string) => { //eslint-disable-line @typescript-eslint/no-misused-promises
            if (!this.program) {
                throw new Error('Internal invariant exception: somehow file watcher ran before `ProgramBuilder.run()`');
            }
            thePath = s`${path.resolve(this.rootDir, thePath)}`;
            if (event === 'add' || event === 'change') {
                const fileObj = {
                    src: thePath,
                    dest: rokuDeploy.getDestPath(
                        thePath,
                        this.program.options.files,
                        //some shells will toTowerCase the drive letter, so do it to rootDir for consistency
                        util.driveLetterToLower(this.rootDir)
                    )
                };
                this.program.setFile(
                    fileObj,
                    await this.getFileContents(fileObj.src)
                );
            } else if (event === 'unlink') {
                this.program.removeFile(thePath);
            }
            //wait for change events to settle, and then execute `run`
            await debouncedRunOnce();
        });
    }

    /**
     * The rootDir for this program.
     */
    public get rootDir() {
        if (!this.program) {
            throw new Error('Cannot access `ProgramBuilder.rootDir` until after `ProgramBuilder.run()`');
        }
        return this.program.options.rootDir;
    }

    /**
     * A method that is used to cancel a previous run task.
     * Does nothing if previous run has completed or was already canceled
     */
    private cancelLastRun = () => {
        return Promise.resolve();
    };

    /**
     * Run the entire process exactly one time.
     */
    private runOnce() {
        //clear the console
        this.clearConsole();
        let cancellationToken = { isCanceled: false };
        //wait for the previous run to complete
        let runPromise = this.cancelLastRun().then(() => {
            //start the new run
            return this._runOnce(cancellationToken);
        }) as any;

        //a function used to cancel this run
        this.cancelLastRun = () => {
            cancellationToken.isCanceled = true;
            return runPromise;
        };
        return runPromise;
    }

    private printDiagnostics(diagnostics?: BsDiagnostic[]) {
        if (this.options?.showDiagnosticsInConsole === false) {
            return;
        }
        if (!diagnostics) {
            diagnostics = this.getDiagnostics();
        }

        //group the diagnostics by file
        let diagnosticsByFile = {} as Record<string, BsDiagnostic[]>;
        for (let diagnostic of diagnostics) {
            if (!diagnosticsByFile[diagnostic.file.srcPath]) {
                diagnosticsByFile[diagnostic.file.srcPath] = [];
            }
            diagnosticsByFile[diagnostic.file.srcPath].push(diagnostic);
        }

        //get printing options
        const options = diagnosticUtils.getPrintDiagnosticOptions(this.options);
        const { cwd, emitFullPaths } = options;

        let srcPaths = Object.keys(diagnosticsByFile).sort();
        for (let srcPath of srcPaths) {
            let diagnosticsForFile = diagnosticsByFile[srcPath];
            //sort the diagnostics in line and column order
            let sortedDiagnostics = diagnosticsForFile.sort((a, b) => {
                return (
                    (a.range?.start.line ?? -1) - (b.range?.start.line ?? -1) ||
                    (a.range?.start.character ?? -1) - (b.range?.start.character ?? -1)
                );
            });

            let filePath = srcPath;
            if (!emitFullPaths) {
                filePath = path.relative(cwd, filePath);
            }
            //load the file text
            const file = this.program?.getFile(srcPath);
            //get the file's in-memory contents if available
            const lines = (file as BrsFile)?.fileContents?.split(/\r?\n/g) ?? [];

            for (let diagnostic of sortedDiagnostics) {
                //default the severity to error if undefined
                let severity = typeof diagnostic.severity === 'number' ? diagnostic.severity : DiagnosticSeverity.Error;
                let relatedInformation = (util.toDiagnostic(diagnostic, diagnostic.source)?.relatedInformation ?? []).map(x => {
                    let relatedInfoFilePath = URI.parse(x.location.uri).fsPath;
                    if (!emitFullPaths) {
                        relatedInfoFilePath = path.relative(cwd, relatedInfoFilePath);
                    }
                    return {
                        filePath: relatedInfoFilePath,
                        range: x.location.range,
                        message: x.message
                    };
                });
                //format output
                diagnosticUtils.printDiagnostic(options, severity, filePath, lines, diagnostic, relatedInformation);
            }
        }
    }

    /**
     * Run the process once, allowing cancelability.
     * NOTE: This should only be called by `runOnce`.
     */
    private async _runOnce(cancellationToken: { isCanceled: any }) {
        let wereDiagnosticsPrinted = false;
        try {
            //maybe cancel?
            if (cancellationToken.isCanceled === true) {
                return -1;
            }
            //validate program
            this.validateProject();

            //maybe cancel?
            if (cancellationToken.isCanceled === true) {
                return -1;
            }

            const diagnostics = this.getDiagnostics();
            this.printDiagnostics(diagnostics);
            wereDiagnosticsPrinted = true;
            let errorCount = diagnostics.filter(x => x.severity === DiagnosticSeverity.Error).length;

            if (errorCount > 0) {
                this.logger.log(`Found ${errorCount} ${errorCount === 1 ? 'error' : 'errors'}`);
                return errorCount;
            }

            //create the deployment package (and transpile as well)
            await this.createPackageIfEnabled();

            //maybe cancel?
            if (cancellationToken.isCanceled === true) {
                return -1;
            }

            //deploy the package
            await this.deployPackageIfEnabled();

            return 0;
        } catch (e) {
            if (wereDiagnosticsPrinted === false) {
                this.printDiagnostics();
            }
            throw e;
        }
    }

    private async createPackageIfEnabled() {
        if (this.options.copyToStaging || this.options.createPackage || this.options.deploy) {

            //transpile the project
            await this.transpile();

            //create the zip file if configured to do so
            if (this.options.createPackage !== false || this.options.deploy) {
                await this.logger.time(LogLevel.log, [`Creating package at ${this.options.outFile}`], async () => {
                    await rokuDeploy.zipPackage({
                        ...this.options,
                        logLevel: this.options.logLevel as unknown as RokuDeployLogLevel,
                        outDir: util.getOutDir(this.options),
                        outFile: path.basename(this.options.outFile)
                    });
                });
            }
        }
    }

    private buildThrottler = new Throttler(0);

    /**
     * Build the entire project and place the contents into the staging directory
     */
    public async build() {
        await this.buildThrottler.run(async () => {
            //get every file referenced by the files array
            let fileMap = Object.values(this.program.files).map(x => {
                return {
                    src: x.srcPath,
                    dest: x.destPath
                };
            });

            //remove files currently loaded in the program, we will transpile those instead (even if just for source maps)
            let filteredFileMap = [] as FileObj[];

            for (let fileEntry of fileMap) {
                if (this.program!.hasFile(fileEntry.src) === false) {
                    filteredFileMap.push(fileEntry);
                }
            }

            await this.logger.time(LogLevel.log, ['Building'], async () => {
                //transpile any brighterscript files
                await this.program!.build();
            });
        });
    }

    /**
     * Transpiles the entire program into the staging folder
     * @deprecated use `.build()` instead
     */
    public async transpile() {
        return this.build();
    }

    private async deployPackageIfEnabled() {
        //deploy the project if configured to do so
        if (this.options.deploy) {
            await this.logger.time(LogLevel.log, ['Deploying package to', this.options.host], async () => {
                await rokuDeploy.publish({
                    ...this.options,
                    logLevel: this.options.logLevel as unknown as RokuDeployLogLevel,
                    outDir: util.getOutDir(this.options),
                    outFile: path.basename(this.options.outFile)
                });
            });
        }
    }

    /**
     * Load every file into the project
     */
    private async loadFiles() {
        await this.logger.time(LogLevel.log, ['load files'], async () => {
            let files = await this.logger.time(LogLevel.debug, ['getFilePaths'], async () => {
                return util.getFilePaths(this.options);
            });
            this.logger.trace('ProgramBuilder.loadFiles() files:', files);

            const typedefFiles = [] as FileObj[];
            const allOtherFiles = [] as FileObj[];
            let manifestFile: FileObj | null = null;

            for (const file of files) {
                // typedef files
                if (/\.d\.bs$/i.test(file.dest)) {
                    typedefFiles.push(file);

                    // all other files
                } else {
                    if (/^manifest$/i.test(file.dest)) {
                        //manifest file
                        manifestFile = file;
                    }
                    allOtherFiles.push(file);
                }
            }

            //load the manifest file first
            if (manifestFile) {
                this.program!.loadManifest(manifestFile, false);
            }

            const loadFile = async (fileObj) => {
                try {
                    this.program!.setFile(fileObj, await this.getFileContents(fileObj.src));
                } catch (e) {
                    this.logger.log(e); // log the error, but don't fail this process because the file might be fixable later
                }
            };
            // preload every type definition file, which eliminates duplicate file loading
            await Promise.all(typedefFiles.map(loadFile));
            // load all other files
            await Promise.all(allOtherFiles.map(loadFile));
        });
    }

    /**
     * Remove all files from the program that are in the specified folder path
     * @param srcPath the path to the
     */
    public removeFilesInFolder(srcPath: string) {
        for (let filePath in this.program.files) {
            //if the file path starts with the parent path and the file path does not exactly match the folder path
            if (filePath.startsWith(srcPath) && filePath !== srcPath) {
                this.program.removeFile(filePath);
            }
        }
    }

    /**
     * Scan every file and resolve all variable references.
     * If no errors were encountered, return true. Otherwise return false.
     */
    private validateProject() {
        this.program.validate();
    }

    public dispose() {
        if (this.watcher) {
            this.watcher.dispose();
        }
        if (this.program) {
            this.program.dispose?.();
        }
        if (this.watchInterval) {
            clearInterval(this.watchInterval);
        }
    }
}
