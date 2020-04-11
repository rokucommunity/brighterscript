import * as assert from 'assert';
import { EventEmitter } from 'events';
import * as fsExtra from 'fs-extra';
import * as path from 'path';
import { StandardizedFileEntry } from 'roku-deploy';
import { CompletionItem, Location, Position, Range } from 'vscode-languageserver';

import { BsConfig } from './BsConfig';
import { Scope } from './Scope';
import { DiagnosticMessages } from './DiagnosticMessages';
import { BrsFile } from './files/BrsFile';
import { XmlFile } from './files/XmlFile';
import { BsDiagnostic, File } from './interfaces';
import { platformFile } from './platformCallables';
import { util } from './util';
import { XmlScope } from './XmlScope';

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
        this.rootDir = util.getRootDir(this.options);

        //create the 'platform' scope
        this.platformScope = new Scope('platform', () => false);

        //add all platform callables
        this.platformScope.addOrReplaceFile(platformFile);
        platformFile.program = this;
        this.platformScope.attachProgram(this);
        //for now, disable validation of this scope because the platform files have some duplicate method declarations
        this.platformScope.validate = () => [];
        this.platformScope.isValidated = true;

        //create the "global" scope
        let globalScope = new Scope('global', (file) => {
            //global scope includes every file under the `source` folder
            return file.pkgPath.startsWith(`source${path.sep}`);
        });
        globalScope.attachProgram(this);
        //the global scope inherits from platform scope
        globalScope.attachParentScope(this.platformScope);
        this.scopes[globalScope.name] = globalScope;

        //add the default file resolver
        this.fileResolvers.push(async (pathAbsolute) => {
            let contents = await this.util.getFileContents(pathAbsolute);
            return contents;
        });
    }

    private util = util;

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
        pathAbsolute = util.standardizePath(pathAbsolute);
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
     * A scope that contains all platform-provided functions.
     * All scopes should directly or indirectly inherit from this scope
     */
    public platformScope: Scope;

    /**
     * The full path to the root of the project (where the manifest file lives)
     */
    public rootDir: string;

    /**
     * A set of diagnostics. This does not include any of the scope diagnostics.
     * Should only be set from `this.validate()`
     */
    private diagnostics = [] as BsDiagnostic[];

    /**
     * Get a list of all files that are inlcuded in the project but are not referenced
     * by any scope in the program.
     */
    public getUnreferencedFiles() {
        let result = [] as File[];
        for (let filePath in this.files) {
            let file = this.files[filePath];
            if (!this.fileIsIncludedInAnyScope(file)) {
                //no scopes reference this file. add it to the list
                result.push(file);
            }
        }
        return result;
    }

    /**
     * Get the list of errors for the entire program. It's calculated on the fly
     * by walking through every file, so call this sparingly.
     */
    public getDiagnostics() {
        let diagnostics = [...this.diagnostics];

        //get the diagnostics from all scopes
        for (let scopeName in this.scopes) {
            let scope = this.scopes[scopeName];
            diagnostics = [
                ...diagnostics,
                ...scope.getDiagnostics()
            ];
        }

        //get the diagnostics from all unreferenced files
        let unreferencedFiles = this.getUnreferencedFiles();
        for (let file of unreferencedFiles) {
            diagnostics = [
                ...diagnostics,
                ...file.getDiagnostics()
            ];
        }

        let finalDiagnostics = [] as BsDiagnostic[];

        for (let diagnostic of diagnostics) {
            if (
                //skip duplicate diagnostics (by reference).
                //This skips file parse diagnostics when multiple scopes include same file
                !finalDiagnostics.includes(diagnostic) &&

                //skip any specified error codes
                !this.options.ignoreErrorCodes?.includes(diagnostic.code as number)
            ) {
                //add the diagnostic to the final list
                finalDiagnostics.push(diagnostic);
            }
        }

        return finalDiagnostics;
    }

    /**
     * A map of every file loaded into this program
     */
    public files = {} as { [filePath: string]: BrsFile | XmlFile };

    private scopes = {} as { [name: string]: Scope };

    /**
     * Determine if the specified file is loaded in this program right now.
     * @param filePath
     */
    public hasFile(filePath: string) {
        filePath = util.standardizePath(filePath);
        return this.files[filePath] !== undefined;
    }

    /**
     * Add and parse all of the provided files.
     * Files that are already loaded will be replaced by the latest
     * contents from the file system.
     * @param filePaths
     */
    public async addOrReplaceFiles(fileObjects: Array<StandardizedFileEntry>) {
        return Promise.all(
            fileObjects.map(async (fileObject) => this.addOrReplaceFile(fileObject))
        );
    }

    public getPkgPath(...args: any[]): any { //eslint-disable-line
        throw new Error('Not implemented');
    }

    /**
     * roku filesystem is case INsensitive, so find the scope by key case insensitive
     * @param scopeName
     */
    public getScopeByName(scopeName: string) {
        //most scopes are xml file pkg paths. however, the ones that are not are single names like "platform" and "global",
        //so it's safe to run the standardizePkgPath method
        scopeName = util.standardizePkgPath(scopeName);
        let key = Object.keys(this.scopes).find(x => x.toLowerCase() === scopeName.toLowerCase());
        return this.scopes[key];
    }

    /**
     * Load a file into the program. If that file already exists, it is replaced.
     * If file contents are provided, those are used, Otherwise, the file is loaded from the file system
     * @param pathAbsolute
     * @param fileContents
     */
    public async addOrReplaceFile(fileEntry: StandardizedFileEntry, fileContents?: string) {
        assert.ok(fileEntry, 'fileEntry is required');
        assert.ok(fileEntry.src, 'fileEntry.src is required');
        assert.ok(fileEntry.dest, 'fileEntry.dest is required');

        let pathAbsolute = util.standardizePath(fileEntry.src);
        let pkgPath = util.standardizePkgPath(fileEntry.dest);

        //if the file is already loaded, remove it
        if (this.hasFile(pathAbsolute)) {
            this.removeFile(pathAbsolute);
        }
        let fileExtension = path.extname(pathAbsolute).toLowerCase();
        let file: BrsFile | XmlFile | undefined;

        //load the file contents by file path if not provided
        let getFileContents = async () => {
            if (fileContents === undefined) {
                return this.getFileContents(pathAbsolute);
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

        } else if (
            //is xml file
            fileExtension === '.xml' &&
            //resides in the components folder (Roku will only parse xml files in the components folder)
            pkgPath.toLowerCase().startsWith(util.pathSepNormalize(`components/`))
        ) {
            let xmlFile = new XmlFile(pathAbsolute, pkgPath, this);
            //add the file to the program
            this.files[pathAbsolute] = xmlFile;
            await xmlFile.parse(await getFileContents());
            file = xmlFile;

            //create a new scope for this xml file
            let scope = new XmlScope(xmlFile);
            //attach this program to the new scope
            scope.attachProgram(this);

            //if the scope doesn't have a parent scope, give it the platform scope
            if (!scope.parentScope) {
                scope.parentScope = this.platformScope;
            }

            this.scopes[scope.name] = scope;
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

    private readonly emitter = new EventEmitter();

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
        pathAbsolute = util.standardizePath(pathAbsolute);
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
        pkgPath = util.pathSepNormalize(pkgPath);
        for (let filePath in this.files) {
            let file = this.files[filePath];
            if (util.standardizePath(file.pkgPath) === util.standardizePath(pkgPath)) {
                return file;
            }
        }
    }

    /**
     * Remove a set of files from the program
     * @param absolutePaths
     */
    public removeFiles(absolutePaths: string[]) {
        for (let pathAbsolute of absolutePaths) {
            this.removeFile(pathAbsolute);
        }
    }

    /**
     * Remove a file from the program
     * @param pathAbsolute
     */
    public removeFile(pathAbsolute: string) {
        pathAbsolute = util.standardizePath(pathAbsolute);
        let file = this.getFile(pathAbsolute);

        //notify every scope of this file removal
        for (let scopeName in this.scopes) {
            let scope = this.scopes[scopeName];
            scope.removeFile(file);
        }

        //if there is a scope named the same as this file's path, remove it (i.e. xml scopes)
        let scope = this.scopes[file.pkgPath];
        if (scope) {
            scope.dispose();
            delete this.scopes[file.pkgPath];
        }
        //remove the file from the program
        delete this.files[pathAbsolute];
        this.emit('file-removed', file);
    }

    /**
     * Traverse the entire project, and validate all scopes
     */
    public async validate() {
        this.diagnostics = [];
        for (let scopeName in this.scopes) {
            let scope = this.scopes[scopeName];
            scope.validate();
        }

        //find any files NOT loaded into a scope
        for (let filePath in this.files) {
            let file = this.files[filePath];
            if (!this.fileIsIncludedInAnyScope(file)) {
                //the file is not loaded in any scope
                this.diagnostics.push({
                    ...DiagnosticMessages.fileNotReferencedByAnyOtherFile(),
                    file: file,
                    range: Range.create(0, 0, 0, Number.MAX_VALUE)
                });
            }
        }
        await Promise.resolve();
    }

    /**
     * Determine if the given file is included in at least one scope in this program
     */
    private fileIsIncludedInAnyScope(file: BrsFile | XmlFile) {
        for (let scopeName in this.scopes) {
            if (this.scopes[scopeName].hasFile(file)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Get the file at the given path
     * @param pathAbsolute
     */
    private getFile(pathAbsolute: string) {
        pathAbsolute = util.standardizePath(pathAbsolute);
        return this.files[pathAbsolute];
    }

    /**
     * Get a list of all scopes the file is loaded into
     * @param file
     */
    public getScopesForFile(file: XmlFile | BrsFile) {
        let result = [] as Scope[];
        for (let key in this.scopes) {
            let scope = this.scopes[key];

            if (scope.hasFile(file)) {
                result.push(scope);
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
        let file = this.getFile(pathAbsolute);
        if (!file) {
            return [];
        }

        //wait for the file to finish loading
        await file.isReady();

        //find the scopes for this file
        let scopes = this.getScopesForFile(file);

        //if there are no scopes, include the platform scope so we at least get the built-in functions
        scopes = scopes.length > 0 ? scopes : [this.platformScope];

        //get the completions for this file for every scope

        //get the completions from all scopes for this file
        let allCompletions = util.flatMap(
            await Promise.all(
                scopes.map(async ctx => file.getCompletions(position, ctx))
            ),
            c => c
        );

        let result = [] as CompletionItem[];

        //only keep completions common to every completion
        let keyCounts = {} as { [key: string]: number };
        for (let completion of allCompletions) {
            let key = `${completion.label}-${completion.kind}`;
            keyCounts[key] = keyCounts[key] ? keyCounts[key] + 1 : 1;
            if (keyCounts[key] === scopes.length) {
                result.push(completion);
            }
        }
        return result;
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
        let scopes = this.getScopesForFile(file);
        for (let scope of scopes) {
            results = results.concat(...scope.getDefinition(file, position));
        }
        return results;
    }

    public async getHover(pathAbsolute: string, position: Position) {
        //find the file
        let file = this.getFile(pathAbsolute);
        if (!file) {
            return null;
        }

        return file.getHover(position);
    }

    public async transpile(fileEntries: StandardizedFileEntry[], stagingFolderPath: string) {
        let promises = Object.keys(this.files).map(async (filePath) => {
            let file = this.files[filePath];
            if (file.needsTranspiled) {
                let result = file.transpile();
                let filePathObj = fileEntries.find(x => util.standardizePath(x.src) === util.standardizePath(file.pathAbsolute));
                if (!filePathObj) {
                    throw new Error(`Cannot find fileMap record in fileMaps for '${file.pathAbsolute}'`);
                }

                //replace the file extension
                let outputCodePath = filePathObj.dest.replace(/\.bs$/gi, '.brs');
                //prepend the staging folder path
                outputCodePath = util.standardizePath(`${stagingFolderPath}/${outputCodePath}`);
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
        for (let name in this.scopes) {
            this.scopes[name].dispose();
        }
        this.platformScope.dispose();
    }
}

export type FileResolver = (pathAbsolute: string) => string | undefined | Thenable<string | undefined>;
