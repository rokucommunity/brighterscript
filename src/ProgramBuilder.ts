import * as debounce from 'debounce-promise';
import * as path from 'path';
import * as rokuDeploy from 'roku-deploy';
import { BsConfig } from './BsConfig';
import { BsDiagnostic, File, FileObj } from './interfaces';
import { FileResolver, Program } from './Program';
import { standardizePath as s, util, loadPlugins } from './util';
import { Watcher } from './Watcher';
import { DiagnosticSeverity } from 'vscode-languageserver';
import { Logger, LogLevel } from './Logger';
import { getPrintDiagnosticOptions, printDiagnostic } from './diagnosticUtils';
import PluginInterface from './PluginInterface';

/**
 * A runner class that handles
 */
export class ProgramBuilder {
    /**
     * Determines whether the console should be cleared after a run (true for cli, false for languageserver)
     */
    public allowConsoleClearing = true;

    public options: BsConfig;
    private isRunning = false;
    private watcher: Watcher;
    public program: Program;
    public logger = new Logger();
    public plugins: PluginInterface = new PluginInterface([], this.logger);
    private fileResolvers = [] as FileResolver[];

    public addFileResolver(fileResolver: FileResolver) {
        this.fileResolvers.push(fileResolver);
        if (this.program) {
            this.program.fileResolvers.push(fileResolver);
        }
    }

    /**
     * A list of diagnostics that are always added to the `getDiagnostics()` call.
     */
    private staticDiagnostics = [] as BsDiagnostic[];

    public addDiagnostic(filePathAbsolute: string, diagnostic: Partial<BsDiagnostic>) {
        let file: File = this.program.getFileByPathAbsolute(filePathAbsolute);
        if (!file) {
            file = {
                pkgPath: this.program.getPkgPath(filePathAbsolute),
                pathAbsolute: filePathAbsolute,
                getDiagnostics: () => {
                    return [<any>diagnostic];
                }
            };
        }
        diagnostic.file = file;
        this.staticDiagnostics.push(<any>diagnostic);
    }

    public getDiagnostics() {
        return [
            ...this.staticDiagnostics,
            ...this.program ? this.program.getDiagnostics() : []
        ];
    }

    public async run(options: BsConfig) {
        this.logger.logLevel = options.logLevel as LogLevel;

        if (this.isRunning) {
            throw new Error('Server is already running');
        }
        this.isRunning = true;
        try {
            this.options = await util.normalizeAndResolveConfig(options);
            this.loadPlugins();
        } catch (e) {
            if (e?.file && e.message && e.code) {
                let err = e as BsDiagnostic;
                this.staticDiagnostics.push(err);
            } else {
                //if this is not a diagnostic, something else is wrong...
                throw e;
            }
            await this.printDiagnostics();

            //we added diagnostics, so hopefully that draws attention to the underlying issues.
            //For now, just use a default options object so we have a functioning program
            this.options = util.normalizeConfig({});
        }
        this.logger.logLevel = this.options.logLevel as LogLevel;

        this.program = this.createProgram();

        //parse every file in the entire project
        this.logger.log('Parsing files');
        await this.loadAllFilesAST();

        if (this.options.watch) {
            this.logger.log('Starting compilation in watch mode...');
            await this.runOnce();
            this.enableWatchMode();
        } else {
            await this.runOnce();
        }
    }

    protected createProgram() {
        const program = new Program(this.options, undefined, this.plugins);

        //add the initial FileResolvers
        program.fileResolvers.push(...this.fileResolvers);

        this.plugins.emit('afterProgramCreate', program);
        return program;
    }

    protected loadPlugins() {
        loadPlugins(
            this.options.plugins,
            (pathOrModule, err) => this.logger.error(`Error when loading plugin '${pathOrModule}':`, err)
        ).forEach(plugin => this.plugins.add(plugin));

        this.plugins.emit('beforeProgramCreate', this);
    }

    private clearConsole() {
        if (this.allowConsoleClearing) {
            util.clearConsole();
        }
    }

    public enableWatchMode() {
        this.watcher = new Watcher(this.options);
        //keep the process alive indefinitely by setting an interval that runs once every 12 days
        setInterval(() => { }, 1073741824);

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
            let errorCount = this.getDiagnostics().length;
            this.logger.log(`Found ${errorCount} errors. Watching for file changes.`);
        }, 50);

        //on any file watcher event
        this.watcher.on('all', async (event: string, thePath: string) => { //eslint-disable-line @typescript-eslint/no-misused-promises
            thePath = s`${path.resolve(this.rootDir, thePath)}`;
            if (event === 'add' || event === 'change') {
                await this.program.addOrReplaceFile({
                    src: thePath,
                    dest: rokuDeploy.getDestPath(thePath, this.program.options.files, this.rootDir)
                });
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

    private async printDiagnostics() {
        if (this.options.showDiagnosticsInConsole === false) {
            return;
        }
        let diagnostics = this.getDiagnostics();

        //group the diagnostics by file
        let diagnosticsByFile = {} as { [pathAbsolute: string]: BsDiagnostic[] };
        for (let diagnostic of diagnostics) {
            if (!diagnosticsByFile[diagnostic.file.pathAbsolute]) {
                diagnosticsByFile[diagnostic.file.pathAbsolute] = [];
            }
            diagnosticsByFile[diagnostic.file.pathAbsolute].push(diagnostic);
        }

        //get printing options
        const options = getPrintDiagnosticOptions(this.options);
        const { cwd, emitFullPaths } = options;

        let pathsAbsolute = Object.keys(diagnosticsByFile).sort();
        for (let pathAbsolute of pathsAbsolute) {
            let diagnosticsForFile = diagnosticsByFile[pathAbsolute];
            //sort the diagnostics in line and column order
            let sortedDiagnostics = diagnosticsForFile.sort((a, b) => {
                return (
                    a.range.start.line - b.range.start.line ||
                    a.range.start.character - b.range.start.character
                );
            });

            let filePath = pathAbsolute;
            if (!emitFullPaths) {
                filePath = path.relative(cwd, filePath);
            }

            //load the file text
            let fileText = await util.getFileContents(pathAbsolute);
            let lines = util.getLines(fileText);

            for (let diagnostic of sortedDiagnostics) {
                //default the severity to error if undefined
                let severity = typeof diagnostic.severity === 'number' ? diagnostic.severity : DiagnosticSeverity.Error;
                //format output
                printDiagnostic(options, severity, filePath, lines, diagnostic);
            }
        }
    }

    /**
     * Run the process once, allowing cancelability.
     * NOTE: This should only be called by `runOnce`.
     * @param cancellationToken
     */
    private async _runOnce(cancellationToken: { isCanceled: any }) {
        let wereDiagnosticsPrinted = false;
        try {
            //maybe cancel?
            if (cancellationToken.isCanceled === true) {
                return -1;
            }
            this.logger.log('Validating project');
            //validate program
            await this.validateProject();

            //maybe cancel?
            if (cancellationToken.isCanceled === true) {
                return -1;
            }

            await this.printDiagnostics();
            wereDiagnosticsPrinted = true;
            let errorCount = this.getDiagnostics().filter(x => x.severity === DiagnosticSeverity.Error).length;

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
                await this.printDiagnostics();
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
                        outDir: util.getOutDir(this.options),
                        outFile: path.basename(this.options.outFile)
                    });
                });
            }
        }
    }

    /**
     * Transpiles the entire program into the staging folder
     */
    public async transpile() {
        let options = util.cwdWork(this.options.cwd, () => {
            return rokuDeploy.getOptions({
                ...this.options,
                outDir: util.getOutDir(this.options),
                outFile: path.basename(this.options.outFile)
            });
        });

        //get every file referenced by the files array
        let fileMap = await rokuDeploy.getFilePaths(options.files, options.rootDir);

        //remove files currently loaded in the program, we will transpile those instead (even if just for source maps)
        let filteredFileMap = [] as FileObj[];
        for (let fileEntry of fileMap) {
            if (this.program.hasFile(fileEntry.src) === false) {
                filteredFileMap.push(fileEntry);
            }
        }

        this.plugins.emit('beforePrepublish', this, filteredFileMap);

        await this.logger.time(LogLevel.log, ['Copying to staging directory'], async () => {
            //prepublish all non-program-loaded files to staging
            await rokuDeploy.prepublishToStaging({
                ...options,
                files: filteredFileMap
            });
        });

        this.plugins.emit('afterPrepublish', this, filteredFileMap);
        this.plugins.emit('beforePublish', this, fileMap);

        await this.logger.time(LogLevel.log, ['Transpiling'], async () => {
            //transpile any brighterscript files
            await this.program.transpile(fileMap, options.stagingFolderPath);
        });

        this.plugins.emit('afterPublish', this, fileMap);
    }

    private async deployPackageIfEnabled() {
        //deploy the project if configured to do so
        if (this.options.deploy) {
            await this.logger.time(LogLevel.log, ['Deploying package to', this.options.host], async () => {
                await rokuDeploy.publish({
                    ...this.options,
                    outDir: util.getOutDir(this.options),
                    outFile: path.basename(this.options.outFile)
                });
            });
        }
    }

    /**
     * Parse and load the AST for every file in the project
     */
    private async loadAllFilesAST() {
        let errorCount = 0;
        let files = await this.logger.time(LogLevel.debug, ['ProgramBuilder.loadAllFilesAST()'], async () => {
            return util.getFilePaths(this.options);
        });
        this.logger.debug('ProgramBuilder.loadAllFilesAST() files:', files);

        const allTypedefFiles = [] as string[];
        const actualTypedefMap = {};
        const actualTypedefFiles = [] as FileObj[];
        const nonTypeFiles = [] as FileObj[];
        for (const file of files) {
            const srcLower = file.src.toLowerCase();
            if (srcLower.endsWith('.d.bs')) {
                actualTypedefMap[srcLower] = true;
                actualTypedefFiles.push(file);
            } else {
                nonTypeFiles.push(file);
            }
            if (srcLower.endsWith('.brs')) {
                allTypedefFiles.push(srcLower.slice(0, -4) + '.d.bs');
            }
        }

        //mark the missing type files as `null` so Program doesn't ask the FS for them
        for (const filePath of allTypedefFiles) {
            if (!actualTypedefMap[filePath]) {
                this.program.typedefCache[s(filePath)] = null;
            }
        }

        //preload every type definition file first, which eliminates duplicate file loading
        await Promise.all(
            actualTypedefFiles.map(async (file) => {
                try {
                    await this.program.addOrReplaceFile(file);
                } catch (e) {
                    //log the error, but don't fail this process because the file might be fixable later
                    this.logger.log(e);
                }
            })
        );

        //parse every file other than the type definitions
        await Promise.all(
            nonTypeFiles.map(async (file) => {
                try {
                    let fileExtension = path.extname(file.src).toLowerCase();

                    //only process certain file types
                    if (['.bs', '.brs', '.xml'].includes(fileExtension)) {
                        await this.program.addOrReplaceFile(file);
                    }
                } catch (e) {
                    //log the error, but don't fail this process because the file might be fixable later
                    this.logger.log(e);
                }
            })
        );
        return errorCount;
    }

    /**
     * Remove all files from the program that are in the specified folder path
     * @param folderPathAbsolute
     */
    public removeFilesInFolder(folderPathAbsolute: string) {
        for (let filePath in this.program.files) {
            //if the file path starts with the parent path and the file path does not exactly match the folder path
            if (filePath.startsWith(folderPathAbsolute) && filePath !== folderPathAbsolute) {
                this.program.removeFile(filePath);
            }
        }
    }

    /**
     * Scan every file and resolve all variable references.
     * If no errors were encountered, return true. Otherwise return false.
     */
    private async validateProject() {
        await this.program.validate();
    }

    public dispose() {
        if (this.watcher) {
            this.watcher.dispose();
        }
        if (this.program) {
            this.program.dispose?.();
        }
    }
}
