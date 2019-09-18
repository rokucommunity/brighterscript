import { EventEmitter } from 'events';
import * as fsExtra from 'fs-extra';
import * as path from 'path';
import { CompletionItem, Location, Position, Range } from 'vscode-languageserver';

import { BsConfig } from './BsConfig';
import { Context } from './Context';
import { diagnosticMessages } from './DiagnosticMessages';
import { BrsFile } from './files/BrsFile';
import { XmlFile } from './files/XmlFile';
import { Diagnostic } from './interfaces';
import { platformFile } from './platformCallables';
import util from './util';
import { XmlContext } from './XmlContext';

export class Program {
    constructor(
        /**
         * The root directory for this program
         */
        public options: BsConfig
    ) {
        //allow unlimited listeners
        this.emitter.setMaxListeners(0);

        this.options = util.normalizeConfig(options);

        //normalize the root dir path
        this.rootDir = util.getRootDir(options);

        //create the 'platform' context
        this.platformContext = new Context('platform', (file) => false);

        //add all platform callables
        this.platformContext.addOrReplaceFile(platformFile);
        platformFile.program = this;
        this.platformContext.attachProgram(this);
        //for now, disable validation of this context because the platform files have some duplicate method declarations
        this.platformContext.validate = () => [];
        this.platformContext.isValidated = true;

        //create the "global" context
        let globalContext = new Context('global', (file) => {
            //global context includes every file under the `source` folder
            return file.pkgPath.indexOf(`source${path.sep}`) === 0;
        });
        globalContext.attachProgram(this);
        //the global context inherits from platform context
        globalContext.attachParentContext(this.platformContext);
        this.contexts[globalContext.name] = globalContext;

        //add the default file resolver
        this.fileResolvers.push((pathAbsolute) => {
            return util.getFileContents(pathAbsolute);
        });
    }

    /**
     * A list of functions that will be used to load file contents.
     * In most cases, there will only be the "read from filesystem" resolver.
     * However, when running inside the LanguageServer, a second resolver will be added
     * to resolve the opened file contents from memory instead of going to disk.
     */
    public fileResolvers = [] as FileResolver[];

    /**
     * Get the contents of the specified file as a string.
     * This walks backwards through the file resolvers until we get a value.
     * This allow the language server to provide file contents directly from memory.
     */
    public async getFileContents(pathAbsolute: string) {
        let reversedResolvers = [...this.fileResolvers].reverse();
        for (let fileResolver of reversedResolvers) {
            let result = await fileResolver(pathAbsolute);
            if (typeof result === 'string') {
                return result;
            }
        }
        throw new Error(`Could not load file "${pathAbsolute}"`);
    }

    /**
     * A context that contains all platform-provided functions.
     * All contexts should directly or indirectly inherit from this context
     */
    public platformContext: Context;

    /**
     * The full path to the root of the project (where the manifest file lives)
     */
    public rootDir: string;

    /**
     * A set of diagnostics. This does not include any of the context diagnostics.
     * Should only be set from `this.validate()`
     */
    private diagnostics = [] as Diagnostic[];

    /**
     * Get the list of errors for the entire program. It's calculated on the fly
     * by walking through every file, so call this sparingly.
     */
    public getDiagnostics() {
        let errorLists = [this.diagnostics];
        for (let contextName in this.contexts) {
            let context = this.contexts[contextName];
            errorLists.push(context.getDiagnostics());
        }
        let allDiagnistics = Array.prototype.concat.apply([], errorLists) as Diagnostic[];

        let finalDiagnostics = [] as Diagnostic[];

        for (let diagnostic of allDiagnistics) {
            //skip duplicate diagnostics (by reference). This skips file parse diagnostics when multiple contexts include same file
            if (finalDiagnostics.indexOf(diagnostic) > -1) {
                continue;
            }

            //skip any specified error codes
            if (this.options.ignoreErrorCodes.indexOf(diagnostic.code) > -1) {
                continue;
            }

            //add the diagnostic to the final list
            finalDiagnostics.push(diagnostic);
        }

        return finalDiagnostics;
    }

    /**
     * A map of every file loaded into this program
     */
    public files = {} as { [filePath: string]: BrsFile | XmlFile };

    public contexts = {} as { [name: string]: Context };

    /**
     * Determine if the specified file is loaded in this program right now.
     * @param filePath
     */
    public hasFile(filePath: string) {
        filePath = util.normalizeFilePath(filePath);
        return this.files[filePath] !== undefined;
    }

    /**
     * Add and parse all of the provided files.
     * Files that are already loaded will be replaced by the latest
     * contents from the file system.
     * @param filePaths
     */
    public addOrReplaceFiles(filePaths: string[]) {
        return Promise.all(
            filePaths.map((filePath) => this.addOrReplaceFile(filePath))
        );
    }

    /**
     * Get the pkgPath for an absolute file path
     * @param pathAbsolute
     */
    public getPkgPath(pathAbsolute: string) {
        return pathAbsolute.replace(this.rootDir + path.sep, '');
    }

    /**
     * Load a file into the program. If that file already exists, it is replaced.
     * If file contents are provided, those are used, Otherwise, the file is loaded from the file system
     * @param pathAbsolute
     * @param fileContents
     */
    public async addOrReplaceFile(pathAbsolute: string, fileContents?: string) {
        pathAbsolute = util.normalizeFilePath(pathAbsolute);

        //if the file is already loaded, remove it
        if (this.hasFile(pathAbsolute)) {
            this.removeFile(pathAbsolute);
        }
        let pkgPath = this.getPkgPath(pathAbsolute);
        let fileExtension = path.extname(pathAbsolute).toLowerCase();
        let file: BrsFile | XmlFile;

        //load the file contents by file path if not provided
        let getFileContents = async () => {
            if (fileContents === undefined) {
                return await this.getFileContents(pathAbsolute);
            } else {
                return fileContents;
            }
        };

        //get the extension of the file
        if (fileExtension === '.brs' || fileExtension === '.bs') {
            let brsFile = new BrsFile(pathAbsolute, pkgPath, this);

            //add the file to the program
            this.files[pathAbsolute] = brsFile;
            await brsFile.parse(await getFileContents());
            file = brsFile;
        } else if (fileExtension === '.xml') {
            let xmlFile = new XmlFile(pathAbsolute, pkgPath, this);
            //add the file to the program
            this.files[pathAbsolute] = xmlFile;
            await xmlFile.parse(await getFileContents());
            file = xmlFile;

            //create a new context for this xml file
            let context = new XmlContext(xmlFile);
            //attach this program to the new context
            context.attachProgram(this);

            //if the context doesn't have a parent context, give it the platform context
            if (!context.parentContext) {
                context.parentContext = this.platformContext;
            }

            this.contexts[context.name] = context;
        } else {
            //TODO do we actually need to implement this? Figure out how to handle img paths
            // let genericFile = this.files[pathAbsolute] = <any>{
            //     pathAbsolute: pathAbsolute,
            //     pkgPath: pkgPath,
            //     wasProcessed: true
            // } as File;
            // file = <any>genericFile;
        }

        //notify listeners about this file change
        if (file) {
            this.emit('file-added', file);
            file.setFinishedLoading();
        } else {
            //skip event when file is undefined
        }

        return file;
    }

    private emitter = new EventEmitter();

    public on(name: 'file-added', callback: (file: BrsFile | XmlFile) => void);
    public on(name: 'file-removed', callback: (file: BrsFile | XmlFile) => void);
    public on(name: string, callback: (data: any) => void) {
        this.emitter.on(name, callback);
        return () => {
            this.emitter.removeListener(name, callback);
        };
    }

    protected emit(name: 'file-added', file: BrsFile | XmlFile);
    protected emit(name: 'file-removed', file: BrsFile | XmlFile);
    protected emit(name: string, data?: any) {
        this.emitter.emit(name, data);
    }

    /**
     * Find the file by its absolute path. This is case INSENSITIVE, since
     * Roku is a case insensitive file system. It is an error to have multiple files
     * with the same path with only case being different.
     * @param pathAbsolute
     */
    public getFileByPathAbsolute(pathAbsolute: string) {
        for (let filePath in this.files) {
            if (filePath.toLowerCase() === pathAbsolute.toLowerCase()) {
                return this.files[filePath];
            }
        }
    }

    /**
     * Get a file with the specified pkg path.
     * If not found, return undefined
     */
    public getFileByPkgPath(pkgPath: string) {
        for (let filePath in this.files) {
            let file = this.files[filePath];
            if (file.pkgPath === pkgPath) {
                return file;
            }
        }
    }

    /**
     * Remove a set of files from the program
     * @param filePaths
     */
    public removeFiles(filePaths: string[]) {
        for (let filePath of filePaths) {
            this.removeFile(filePath);
        }
    }

    /**
     * Remove a file from the program
     * @param filePath
     */
    public removeFile(filePath: string) {
        filePath = path.normalize(filePath);
        let file = this.files[filePath];

        //notify every context of this file removal
        for (let contextName in this.contexts) {
            let context = this.contexts[contextName];
            context.removeFile(file);
        }

        //if there is a context named the same as this file's path, remove it (i.e. xml contexts)
        let context = this.contexts[file.pkgPath];
        if (context) {
            context.dispose();
            delete this.contexts[file.pkgPath];
        }
        //remove the file from the program
        delete this.files[filePath];
        this.emit('file-removed', file);
    }

    /**
     * Traverse the entire project, and validate all contexts
     */
    public async validate() {
        this.diagnostics = [];
        for (let contextName in this.contexts) {
            let context = this.contexts[contextName];
            context.validate();
        }

        //find any files NOT loaded into a context
        outer: for (let filePath in this.files) {
            let file = this.files[filePath];
            for (let contextName in this.contexts) {
                if (this.contexts[contextName].hasFile(file)) {
                    continue outer;
                }
            }
            //if we got here, the file is not loaded in any context
            this.diagnostics.push({
                file: file,
                location: Range.create(0, 0, 0, Number.MAX_VALUE),
                severity: 'warning',
                ...diagnosticMessages.File_not_referenced_by_any_file_1013()
            });
        }
    }

    /**
     * Get the file at the given path
     * @param pathAbsolute
     */
    private getFile(pathAbsolute: string) {
        pathAbsolute = path.resolve(pathAbsolute);
        return this.files[pathAbsolute];
    }

    /**
     * Get a list of all contexts the file is loaded into
     * @param file
     */
    public getContextsForFile(file: XmlFile | BrsFile) {
        let result = [] as Context[];
        for (let key in this.contexts) {
            let context = this.contexts[key];

            if (context.hasFile(file)) {
                result.push(context);
            }
        }
        return result;
    }

    /**
     * Find all available completion items at the given position
     * @param pathAbsolute
     * @param lineIndex
     * @param columnIndex
     */
    public async getCompletions(pathAbsolute: string, position: Position) {
        let completions = [] as CompletionItem[];

        let file = this.getFile(pathAbsolute);
        if (!file) {
            return [];
        }

        //wait for the file to finish loading
        await file.isReady();

        //find the contexts for this file (hopefully there's only one)
        let contexts = this.getContextsForFile(file);
        if (contexts.length > 1) {
            //TODO - make the user choose which context to use.
        }
        let context = contexts[0];
        if (context) {
            let fileResult = await file.getCompletions(position, context);
            completions.push(...fileResult.completions);
            if (fileResult.includeContextCallables) {
                completions.push(...context.getCallablesAsCompletions());
            }
        } else {
            console.error(`Cannot find context for ${file.pkgPath}`);
        }

        return completions;
    }

    /**
     * Given a position in a file, if the position is sitting on some type of identifier,
     * go to the definition of that identifier (where this thing was first defined)
     */
    public getDefinition(pathAbsolute: string, position: Position): Location[] {
        let file = this.getFile(pathAbsolute);
        if (!file) {
            return [];
        }
        let results = [] as Location[];
        let contexts = this.getContextsForFile(file);
        for (let context of contexts) {
            results = results.concat(...context.getDefinition(file, position));
        }
        return results;
    }

    public getHover(pathAbsolute: string, position: Position) {
        //find the file
        let file = this.getFile(pathAbsolute);
        if (!file) {
            return null;
        }

        return file.getHover(position);
    }

    public async transpile(fileMaps: Array<{ src: string; dest: string; }>) {
        let promises = Object.keys(this.files).map(async (filePath) => {
            let file = this.files[filePath];
            if (file.needsTranspiled) {
                let result = file.transpile();
                let filePathObj = fileMaps.find(x => x.src === file.pathAbsolute);

                let outputCodePath = filePathObj.dest.replace(new RegExp('\.bs$'), '.brs');
                let outputCodeMapPath = outputCodePath + '.map';

                //make sure the full dir path exists
                await fsExtra.ensureDir(path.dirname(outputCodePath));

                if (await fsExtra.pathExists(outputCodePath)) {
                    throw new Error(`Error while transpiling "${filePath}". A file already exists at "${outputCodePath}" and will not be overwritten.`);
                }
                await Promise.all([
                    fsExtra.writeFile(outputCodePath, result.code),
                    fsExtra.writeFile(outputCodeMapPath, result.map)
                ]);
            }
        });
        await Promise.all(promises);
    }

    public dispose() {
        this.emitter.removeAllListeners();
        for (let filePath in this.files) {
            this.files[filePath].dispose();
        }
        for (let name in this.contexts) {
            this.contexts[name].dispose();
        }
        this.platformContext.dispose();
    }
}

export type FileResolver = (pathAbsolute: string) => string | undefined | Thenable<string | undefined>;
