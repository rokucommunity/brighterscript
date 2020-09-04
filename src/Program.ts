import * as assert from 'assert';
import { EventEmitter } from 'eventemitter3';
import * as fsExtra from 'fs-extra';
import * as path from 'path';
import { StandardizedFileEntry } from 'roku-deploy';
import { CompletionItem, Location, Position, Range, CompletionItemKind } from 'vscode-languageserver';
import { BsConfig } from './BsConfig';
import { Scope } from './Scope';
import { DiagnosticMessages } from './DiagnosticMessages';
import { BrsFile } from './files/BrsFile';
import { XmlFile } from './files/XmlFile';
import { BsDiagnostic, File, FileReference } from './interfaces';
import { standardizePath as s, util } from './util';
import { XmlScope } from './XmlScope';
import { DiagnosticFilterer } from './DiagnosticFilterer';
import { DependencyGraph } from './DependencyGraph';
import { Logger, LogLevel } from './Logger';
import chalk from 'chalk';
import { globalFile } from './globalCallables';
import { parseManifest, ManifestValue } from './preprocessor/Manifest';
import { URI } from 'vscode-uri';
const startOfSourcePkgPath = `source${path.sep}`;

export class Program {
    constructor(
        /**
         * The root directory for this program
         */
        public options: BsConfig,
        logger?: Logger
    ) {
        this.options = util.normalizeConfig(options);
        this.logger = logger ? logger : new Logger(options.logLevel as LogLevel);

        //normalize the root dir path
        this.options.rootDir = util.getRootDir(this.options);

        this.createGlobalScope();

        //create the "source" scope
        let sourceScope = new Scope('source', 'scope:source', this);
        this.scopes.source = sourceScope;

        //add the default file resolver (used by this program to load source file contents).
        this.fileResolvers.push(async (pathAbsolute) => {
            let contents = await this.util.getFileContents(pathAbsolute);
            return contents;
        });
    }

    public logger: Logger;

    private createGlobalScope() {
        //create the 'global' scope
        this.globalScope = new Scope('global', 'scope:global', this);
        this.scopes.global = this.globalScope;
        //hardcode the files list for global scope to only contain the global file
        this.globalScope.getFiles = () => [globalFile];
        this.globalScope.validate();
        //for now, disable validation of global scope because the global files have some duplicate method declarations
        this.globalScope.getDiagnostics = () => [];
        //TODO we might need to fix this because the isValidated clears stuff now
        (this.globalScope as any).isValidated = true;
    }

    /**
     * A graph of all files and their dependencies.
     * For example:
     *      File.xml -> [lib1.brs, lib2.brs]
     *      lib2.brs -> [lib3.brs] //via an import statement
     */
    public dependencyGraph = new DependencyGraph();

    private diagnosticFilterer = new DiagnosticFilterer();

    private util = util;

    /**
     * A list of functions that will be used to load file contents.
     * In most cases, there will only be the "read from filesystem" resolver.
     * However, when running inside the LanguageServer, a second resolver will be added
     * to resolve the opened file contents from memory instead of going to disk.
     */
    public fileResolvers = [] as FileResolver[];

    /**
     * A scope that contains all built-in global functions.
     * All scopes should directly or indirectly inherit from this scope
     */
    public globalScope: Scope;

    /**
     * A set of diagnostics. This does not include any of the scope diagnostics.
     * Should only be set from `this.validate()`
     */
    private diagnostics = [] as BsDiagnostic[];

    /**
     * A map of every file loaded into this program
     */
    public files = {} as { [pathAbsolute: string]: BrsFile | XmlFile };

    private scopes = {} as { [name: string]: Scope };

    /**
     * A map of every component currently loaded into the program, indexed by the component name
     */
    private components = {} as { [lowerComponentName: string]: { file: XmlFile; scope: XmlScope } };

    private readonly emitter = new EventEmitter();

    /**
     * Get the component with the specified name
     */
    public getComponent(componentName: string) {
        if (componentName) {
            return this.components[componentName.toLowerCase()];
        }
    }

    /**
     * Register (or replace) the reference to a component in the component map
     */
    private registerComponent(xmlFile: XmlFile, scope: XmlScope) {
        //store a reference to this component by its component name
        this.components[(xmlFile.componentName ?? xmlFile.pkgPath).toLowerCase()] = {
            file: xmlFile,
            scope: scope
        };
    }

    /**
     * Remove the specified component from the components map
     */
    private unregisterComponent(xmlFile: XmlFile) {
        delete this.components[(xmlFile.componentName ?? xmlFile.pkgPath).toLowerCase()];
    }

    /**
     * Get the contents of the specified file as a string.
     * This walks backwards through the file resolvers until we get a value.
     * This allow the language server to provide file contents directly from memory.
     */
    public async getFileContents(pathAbsolute: string) {
        pathAbsolute = s`${pathAbsolute}`;
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
            diagnostics.push(
                ...scope.getDiagnostics()
            );
        }

        //get the diagnostics from all unreferenced files
        let unreferencedFiles = this.getUnreferencedFiles();
        for (let file of unreferencedFiles) {
            diagnostics.push(
                ...file.getDiagnostics()
            );
        }

        //filter out diagnostics based on our diagnostic filters
        let finalDiagnostics = this.diagnosticFilterer.filter({
            ...this.options,
            rootDir: this.options.rootDir
        }, diagnostics);
        return finalDiagnostics;
    }


    /**
     * Determine if the specified file is loaded in this program right now.
     * @param filePath
     */
    public hasFile(filePath: string) {
        filePath = s`${filePath}`;
        return this.files[filePath] !== undefined;
    }

    /**
     * Add and parse all of the provided files.
     * Files that are already loaded will be replaced by the latest
     * contents from the file system.
     * @param filePaths
     */
    public async addOrReplaceFiles(fileObjects: Array<StandardizedFileEntry>) {
        let promises = [];
        for (let fileObject of fileObjects) {
            promises.push(
                this.addOrReplaceFile(fileObject)
            );
        }
        return Promise.all(promises);
    }

    public getPkgPath(...args: any[]): any { //eslint-disable-line
        throw new Error('Not implemented');
    }

    /**
     * roku filesystem is case INsensitive, so find the scope by key case insensitive
     * @param scopeName
     */
    public getScopeByName(scopeName: string) {
        if (!scopeName) {
            return undefined;
        }
        //most scopes are xml file pkg paths. however, the ones that are not are single names like "global" and "scope",
        //so it's safe to run the standardizePkgPath method
        scopeName = s`${scopeName}`;
        let key = Object.keys(this.scopes).find(x => x.toLowerCase() === scopeName.toLowerCase());
        return this.scopes[key];
    }

    /**
     * Find the scope for the specified component
     */
    public getComponentScope(componentName: string) {
        return this.getComponent(componentName)?.scope;
    }

    /**
     * Load a file into the program. If that file already exists, it is replaced.
     * If file contents are provided, those are used, Otherwise, the file is loaded from the file system
     * @param relativePath the file path relative to the root dir
     * @param fileContents the file contents. If not provided, the file will be loaded from disk
     */
    public async addOrReplaceFile(relativePath: string, fileContents?: string): Promise<XmlFile | BrsFile>;
    /**
     * Load a file into the program. If that file already exists, it is replaced.
     * If file contents are provided, those are used, Otherwise, the file is loaded from the file system
     * @param fileEntry an object that specifies src and dest for the file.
     * @param fileContents the file contents. If not provided, the file will be loaded from disk
     */
    public async addOrReplaceFile(fileEntry: StandardizedFileEntry, fileContents?: string): Promise<XmlFile | BrsFile>;
    public async addOrReplaceFile(fileParam: StandardizedFileEntry | string, fileContents?: string): Promise<XmlFile | BrsFile> {
        assert.ok(fileParam, 'fileEntry is required');
        let pathAbsolute: string;
        let pkgPath: string;
        if (typeof fileParam === 'string') {
            pathAbsolute = s`${this.options.rootDir}/${fileParam}`;
            pkgPath = s`${fileParam}`;
        } else {
            pathAbsolute = s`${fileParam.src}`;
            pkgPath = s`${fileParam.dest}`;
        }
        let file = await this.logger.time(LogLevel.debug, ['Program.addOrReplaceFile()', chalk.green(pathAbsolute)], async () => {

            assert.ok(pathAbsolute, 'fileEntry.src is required');
            assert.ok(pkgPath, 'fileEntry.dest is required');

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

                //add file to the `source` dependency list
                if (brsFile.pkgPath.startsWith(startOfSourcePkgPath)) {
                    this.dependencyGraph.addDependency('scope:source', brsFile.dependencyGraphKey);
                }

                //add the file to the program
                this.files[pathAbsolute] = brsFile;
                let fileContents = await getFileContents();
                this.logger.time(LogLevel.info, ['parse', chalk.green(pathAbsolute)], () => {
                    brsFile.parse(fileContents);
                });
                file = brsFile;

                this.dependencyGraph.addOrReplace(brsFile.dependencyGraphKey, brsFile.ownScriptImports.map(x => x.pkgPath.toLowerCase()));


            } else if (
                //is xml file
                fileExtension === '.xml' &&
                //resides in the components folder (Roku will only parse xml files in the components folder)
                pkgPath.toLowerCase().startsWith(util.pathSepNormalize(`components/`))
            ) {
                let xmlFile = new XmlFile(pathAbsolute, pkgPath, this);
                //add the file to the program
                this.files[pathAbsolute] = xmlFile;
                let fileContents = await getFileContents();
                await xmlFile.parse(fileContents);

                file = xmlFile;

                //create a new scope for this xml file
                let scope = new XmlScope(xmlFile, this);

                this.scopes[scope.name] = scope;

                //register this compoent now that we have parsed it and know its component name
                this.registerComponent(xmlFile, scope);

                //attach the dependency graph, so the component can
                //   a) be regularly notified of changes
                //   b) immediately emit its own changes
                xmlFile.attachDependencyGraph(this.dependencyGraph);

            } else {
                //TODO do we actually need to implement this? Figure out how to handle img paths
                // let genericFile = this.files[pathAbsolute] = <any>{
                //     pathAbsolute: pathAbsolute,
                //     pkgPath: pkgPath,
                //     wasProcessed: true
                // } as File;
                // file = <any>genericFile;
            }
            return file;
        });
        return file;
    }

    /**
     * Find the file by its absolute path. This is case INSENSITIVE, since
     * Roku is a case insensitive file system. It is an error to have multiple files
     * with the same path with only case being different.
     * @param pathAbsolute
     */
    public getFileByPathAbsolute(pathAbsolute: string) {
        pathAbsolute = s`${pathAbsolute}`;
        for (let filePath in this.files) {
            if (filePath.toLowerCase() === pathAbsolute.toLowerCase()) {
                return this.files[filePath];
            }
        }
    }

    /**
     * Get a list of files for the given pkgPath array.
     * Missing files are just ignored.
     */
    public getFilesByPkgPaths(pkgPaths: string[]) {
        pkgPaths = pkgPaths.map(x => s`${x}`.toLowerCase());

        let result = [] as Array<XmlFile | BrsFile>;
        for (let filePath in this.files) {
            let file = this.files[filePath];
            if (pkgPaths.includes(s`${file.pkgPath}`.toLowerCase())) {
                result.push(file);
            }
        }
        return result;
    }

    /**
     * Get a file with the specified pkg path.
     * If not found, return undefined
     */
    public getFileByPkgPath(pkgPath: string) {
        return this.getFilesByPkgPaths([pkgPath])[0];
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
        pathAbsolute = s`${pathAbsolute}`;
        let file = this.getFile(pathAbsolute);
        if (file) {

            //if there is a scope named the same as this file's path, remove it (i.e. xml scopes)
            let scope = this.scopes[file.pkgPath];
            if (scope) {
                scope.dispose();
                //notify dependencies of this scope that it has been removed
                this.dependencyGraph.remove(scope.dependencyGraphKey);
                delete this.scopes[file.pkgPath];
            }
            //remove the file from the program
            delete this.files[pathAbsolute];

            this.dependencyGraph.remove(file.dependencyGraphKey);

            //if this is a pkg:/source file, notify the `source` scope that it has changed
            if (file.pkgPath.startsWith(startOfSourcePkgPath)) {
                this.dependencyGraph.removeDependency('scope:source', file.dependencyGraphKey);
            }

            //if this is a component, remove it from our components map
            if (file instanceof XmlFile) {
                this.unregisterComponent(file);
            }
        }
    }

    /**
     * Traverse the entire project, and validate all scopes
     * @param force - if true, then all scopes are force to validate, even if they aren't marked as dirty
     */
    public async validate() {
        await this.logger.time(LogLevel.debug, ['Program.validate()'], async () => {
            this.diagnostics = [];
            for (let scopeName in this.scopes) {
                let scope = this.scopes[scopeName];
                scope.validate();
            }

            //find any files NOT loaded into a scope
            for (let filePath in this.files) {
                let file = this.files[filePath];

                if (!this.fileIsIncludedInAnyScope(file)) {
                    this.logger.debug('Program.validate(): fileNotReferenced by any scope', () => chalk.green(file?.pkgPath));
                    //the file is not loaded in any scope
                    this.diagnostics.push({
                        ...DiagnosticMessages.fileNotReferencedByAnyOtherFile(),
                        file: file,
                        range: Range.create(0, 0, 0, Number.MAX_VALUE)
                    });
                }
            }

            this.detectDuplicateComponentNames();
            await Promise.resolve();
        });
    }

    /**
     * Flag all duplicate component names
     */
    private detectDuplicateComponentNames() {
        const componentsByName = Object.keys(this.files).reduce((map, filePath) => {
            const file = this.files[filePath];
            if (file instanceof XmlFile) {
                let lowerName = file.componentName.toLowerCase();
                if (!map[lowerName]) {
                    map[lowerName] = [];
                }
                map[lowerName].push(file);
            }
            return map;
        }, {} as { [lowerComponentName: string]: XmlFile[] });

        for (let componentName in componentsByName) {
            const xmlFiles = componentsByName[componentName];
            //add diagnostics for every duplicate component with this name
            if (xmlFiles.length > 1) {
                for (let xmlFile of xmlFiles) {
                    this.diagnostics.push({
                        ...DiagnosticMessages.duplicateComponentName(xmlFile.componentName),
                        range: xmlFile.componentNameRange,
                        file: xmlFile,
                        relatedInformation: xmlFiles.filter(x => x !== xmlFile).map(x => {
                            return {
                                location: Location.create(
                                    URI.file(xmlFile.pathAbsolute).toString(),
                                    x.componentNameRange
                                ),
                                message: 'Also defined here'
                            };
                        })
                    });
                }
            }
        }
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
        pathAbsolute = s`${pathAbsolute}`;
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

        //if there are no scopes, include the global scope so we at least get the built-in functions
        scopes = scopes.length > 0 ? scopes : [this.globalScope];

        //get the completions for this file for every scope

        //get the completions from all scopes for this file
        let allCompletions = util.flatMap(
            await Promise.all(
                scopes.map(async ctx => file.getCompletions(position, ctx))
            ),
            c => c
        );

        let result = [] as CompletionItem[];

        //only keep completions common to every scope for this file
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


    /**
     * Get a list of all script imports, relative to the specified pkgPath
     * @param sourcePkgPath - the pkgPath of the source that wants to resolve script imports.
     */
    public getScriptImportCompletions(sourcePkgPath: string, scriptImport: FileReference) {
        let lowerSourcePkgPath = sourcePkgPath.toLowerCase();

        let result = [] as CompletionItem[];
        /**
         * hashtable to prevent duplicate results
         */
        let resultPkgPaths = {} as { [lowerPkgPath: string]: boolean };

        //restrict to only .brs files
        for (let key in this.files) {
            let file = this.files[key];
            if (
                //is a BrightScript or BrighterScript file
                (file.extension === '.bs' || file.extension === '.brs') &&
                //this file is not the current file
                lowerSourcePkgPath !== file.pkgPath.toLowerCase()
            ) {
                //add the relative path
                let relativePath = util.getRelativePath(sourcePkgPath, file.pkgPath).replace(/\\/g, '/');
                let pkgPathStandardized = file.pkgPath.replace(/\\/g, '/');
                let filePkgPath = `pkg:/${pkgPathStandardized}`;
                let lowerFilePkgPath = filePkgPath.toLowerCase();
                if (!resultPkgPaths[lowerFilePkgPath]) {
                    resultPkgPaths[lowerFilePkgPath] = true;

                    result.push({
                        label: relativePath,
                        detail: file.pathAbsolute,
                        kind: CompletionItemKind.File,
                        textEdit: {
                            newText: relativePath,
                            range: scriptImport.filePathRange
                        }
                    });

                    //add the absolute path
                    result.push({
                        label: filePkgPath,
                        detail: file.pathAbsolute,
                        kind: CompletionItemKind.File,
                        textEdit: {
                            newText: filePkgPath,
                            range: scriptImport.filePathRange
                        }
                    });
                }
            }
        }
        return result;
    }

    /**
     * Transpile a single file and get the result as a string.
     * This does not write anything to the file system.
     */
    public async getTranspiledFileContents(pathAbsolute: string) {
        let file = this.getFile(pathAbsolute);
        //wait for the file to finish being parsed
        await file.isReady();
        let result = file.transpile();
        return {
            ...result,
            pathAbsolute: file.pathAbsolute,
            pkgPath: file.pkgPath
        };
    }

    public async transpile(fileEntries: StandardizedFileEntry[], stagingFolderPath: string) {
        let promises = Object.keys(this.files).map(async (filePath) => {
            let file = this.files[filePath];
            let filePathObj = fileEntries.find(x => s`${x.src}` === s`${file.pathAbsolute}`);
            if (!filePathObj) {
                throw new Error(`Cannot find fileMap record in fileMaps for '${file.pathAbsolute}'`);
            }
            //replace the file extension
            let outputCodePath = filePathObj.dest.replace(/\.bs$/gi, '.brs');
            //prepend the staging folder path
            outputCodePath = s`${stagingFolderPath}/${outputCodePath}`;
            let outputCodeMapPath = outputCodePath + '.map';

            let result = file.transpile();

            //make sure the full dir path exists
            await fsExtra.ensureDir(path.dirname(outputCodePath));

            if (await fsExtra.pathExists(outputCodePath)) {
                throw new Error(`Error while transpiling "${filePath}". A file already exists at "${outputCodePath}" and will not be overwritten.`);
            }
            let writeMapPromise = result.map ? fsExtra.writeFile(outputCodeMapPath, result.map.toString()) : null;
            await Promise.all([
                fsExtra.writeFile(outputCodePath, result.code),
                writeMapPromise
            ]);
        });

        //copy the brighterscript stdlib to the output directory
        promises.push(
            fsExtra.ensureDir(s`${stagingFolderPath}/source`).then(() => {
                return fsExtra.copyFile(
                    s`${__dirname}/../bslib.brs`,
                    s`${stagingFolderPath}/source/bslib.brs`
                );
            })
        );
        await Promise.all(promises);
    }

    /**
     * Get a map of the manifest information
     */
    public getManifest() {
        if (!this._manifest) {
            //load the manifest file.
            //TODO update this to get the manifest from the files array or require it in the options...we shouldn't assume the location of the manifest
            let manifestPath = path.join(this.options.rootDir, 'manifest');

            let contents: string;
            try {
                //we only load this manifest once, so do it sync to improve speed downstream
                contents = fsExtra.readFileSync(manifestPath, 'utf-8');
                this._manifest = parseManifest(contents);
            } catch (err) {
                this._manifest = new Map();
            }
        }
        return this._manifest;
    }
    private _manifest: Map<string, ManifestValue>;

    public dispose() {
        this.emitter.removeAllListeners();
        for (let filePath in this.files) {
            this.files[filePath].dispose();
        }
        for (let name in this.scopes) {
            this.scopes[name].dispose();
        }
        this.globalScope.dispose();
        this.dependencyGraph.dispose();
    }
}

export type FileResolver = (pathAbsolute: string) => string | undefined | Thenable<string | undefined>;
