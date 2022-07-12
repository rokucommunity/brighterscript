import * as assert from 'assert';
import * as fsExtra from 'fs-extra';
import * as path from 'path';
import type { CodeAction, CompletionItem, Position, Range, SignatureInformation, Location } from 'vscode-languageserver';
import { CompletionItemKind } from 'vscode-languageserver';
import type { BsConfig } from './BsConfig';
import { Scope } from './Scope';
import { DiagnosticMessages } from './DiagnosticMessages';
import { BrsFile } from './files/BrsFile';
import { XmlFile } from './files/XmlFile';
import type { BsDiagnostic, File, FileReference, FileObj, BscFile, SemanticToken, AfterFileTranspileEvent, FileLink } from './interfaces';
import { standardizePath as s, util } from './util';
import { XmlScope } from './XmlScope';
import { DiagnosticFilterer } from './DiagnosticFilterer';
import { DependencyGraph } from './DependencyGraph';
import { Logger, LogLevel } from './Logger';
import chalk from 'chalk';
import { globalFile } from './globalCallables';
import { parseManifest } from './preprocessor/Manifest';
import { URI } from 'vscode-uri';
import PluginInterface from './PluginInterface';
import { isBrsFile, isXmlFile, isClassMethodStatement, isXmlScope } from './astUtils/reflection';
import type { FunctionStatement, Statement } from './parser/Statement';
import { ParseMode } from './parser/Parser';
import { TokenKind } from './lexer/TokenKind';
import { BscPlugin } from './bscPlugin/BscPlugin';
import { AstEditor } from './astUtils/AstEditor';
import type { SourceMapGenerator } from 'source-map';
import { rokuDeploy } from 'roku-deploy';

const startOfSourcePkgPath = `source${path.sep}`;
const bslibNonAliasedRokuModulesPkgPath = s`source/roku_modules/rokucommunity_bslib/bslib.brs`;
const bslibAliasedRokuModulesPkgPath = s`source/roku_modules/bslib/bslib.brs`;

export interface SourceObj {
    /**
     * @deprecated use `srcPath` instead
     */
    pathAbsolute: string;
    srcPath: string;
    source: string;
    definitions?: string;
}

export interface TranspileObj {
    file: BscFile;
    outputPath: string;
}

export interface SignatureInfoObj {
    index: number;
    key: string;
    signature: SignatureInformation;
}

interface PartialStatementInfo {
    commaCount: number;
    statementType: string;
    name: string;
    dotPart: string;
}

export class Program {
    constructor(
        /**
         * The root directory for this program
         */
        public options: BsConfig,
        logger?: Logger,
        plugins?: PluginInterface
    ) {
        this.options = util.normalizeConfig(options);
        this.logger = logger || new Logger(options.logLevel as LogLevel);
        this.plugins = plugins || new PluginInterface([], this.logger);

        //inject the bsc plugin as the first plugin in the stack.
        this.plugins.addFirst(new BscPlugin());

        //normalize the root dir path
        this.options.rootDir = util.getRootDir(this.options);

        this.createGlobalScope();
    }

    public logger: Logger;

    private createGlobalScope() {
        //create the 'global' scope
        this.globalScope = new Scope('global', this, 'scope:global');
        this.globalScope.attachDependencyGraph(this.dependencyGraph);
        this.scopes.global = this.globalScope;
        //hardcode the files list for global scope to only contain the global file
        this.globalScope.getAllFiles = () => [globalFile];
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
    private dependencyGraph = new DependencyGraph();

    private diagnosticFilterer = new DiagnosticFilterer();

    /**
     * A scope that contains all built-in global functions.
     * All scopes should directly or indirectly inherit from this scope
     */
    public globalScope: Scope;

    /**
     * Plugins which can provide extra diagnostics or transform AST
     */
    public plugins: PluginInterface;

    /**
     * A set of diagnostics. This does not include any of the scope diagnostics.
     * Should only be set from `this.validate()`
     */
    private diagnostics = [] as BsDiagnostic[];

    /**
     * The path to bslib.brs (the BrightScript runtime for certain BrighterScript features)
     */
    public get bslibPkgPath() {
        //if there's an aliased (preferred) version of bslib from roku_modules loaded into the program, use that
        if (this.getFile(bslibAliasedRokuModulesPkgPath)) {
            return bslibAliasedRokuModulesPkgPath;

            //if there's a non-aliased version of bslib from roku_modules, use that
        } else if (this.getFile(bslibNonAliasedRokuModulesPkgPath)) {
            return bslibNonAliasedRokuModulesPkgPath;

            //default to the embedded version
        } else {
            return `source${path.sep}bslib.brs`;
        }
    }

    public get bslibPrefix() {
        if (this.bslibPkgPath === bslibNonAliasedRokuModulesPkgPath) {
            return 'rokucommunity_bslib';
        } else {
            return 'bslib';
        }
    }


    /**
     * A map of every file loaded into this program, indexed by its original file location
     */
    public files = {} as Record<string, BscFile>;
    private pkgMap = {} as Record<string, BscFile>;

    private scopes = {} as Record<string, Scope>;

    protected addScope(scope: Scope) {
        this.scopes[scope.name] = scope;
        this.plugins.emit('afterScopeCreate', scope);
    }

    /**
     * A map of every component currently loaded into the program, indexed by the component name.
     * It is a compile-time error to have multiple components with the same name. However, we store an array of components
     * by name so we can provide a better developer expreience. You shouldn't be directly accessing this array,
     * but if you do, only ever use the component at index 0.
     */
    private components = {} as Record<string, { file: XmlFile; scope: XmlScope }[]>;

    /**
     * Get the component with the specified name
     */
    public getComponent(componentName: string) {
        if (componentName) {
            //return the first compoment in the list with this name
            //(components are ordered in this list by pkgPath to ensure consistency)
            return this.components[componentName.toLowerCase()]?.[0];
        } else {
            return undefined;
        }
    }

    /**
     * Register (or replace) the reference to a component in the component map
     */
    private registerComponent(xmlFile: XmlFile, scope: XmlScope) {
        const key = (xmlFile.componentName?.text ?? xmlFile.pkgPath).toLowerCase();
        if (!this.components[key]) {
            this.components[key] = [];
        }
        this.components[key].push({
            file: xmlFile,
            scope: scope
        });
        this.components[key].sort(
            (x, y) => x.file.pkgPath.toLowerCase().localeCompare(y.file.pkgPath.toLowerCase())
        );
        this.syncComponentDependencyGraph(this.components[key]);
    }

    /**
     * Remove the specified component from the components map
     */
    private unregisterComponent(xmlFile: XmlFile) {
        const key = (xmlFile.componentName?.text ?? xmlFile.pkgPath).toLowerCase();
        const arr = this.components[key] || [];
        for (let i = 0; i < arr.length; i++) {
            if (arr[i].file === xmlFile) {
                arr.splice(i, 1);
                break;
            }
        }
        this.syncComponentDependencyGraph(arr);
    }

    /**
     * re-attach the dependency graph with a new key for any component who changed
     * their position in their own named array (only matters when there are multiple
     * components with the same name)
     */
    private syncComponentDependencyGraph(components: Array<{ file: XmlFile; scope: XmlScope }>) {
        //reattach every dependency graph
        for (let i = 0; i < components.length; i++) {
            const { file, scope } = components[i];

            //attach (or re-attach) the dependencyGraph for every component whose position changed
            if (file.dependencyGraphIndex !== i) {
                file.dependencyGraphIndex = i;
                file.attachDependencyGraph(this.dependencyGraph);
                scope.attachDependencyGraph(this.dependencyGraph);
            }
        }
    }

    /**
     * Get a list of all files that are included in the project but are not referenced
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
        return this.logger.time(LogLevel.info, ['Program.getDiagnostics()'], () => {

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
            const filteredDiagnostics = this.logger.time(LogLevel.debug, ['filter diagnostics'], () => {
                //filter out diagnostics based on our diagnostic filters
                let finalDiagnostics = this.diagnosticFilterer.filter({
                    ...this.options,
                    rootDir: this.options.rootDir
                }, diagnostics);
                return finalDiagnostics;
            });

            this.logger.info(`diagnostic counts: total=${chalk.yellow(diagnostics.length.toString())}, after filter=${chalk.yellow(filteredDiagnostics.length.toString())}`);
            return filteredDiagnostics;
        });
    }

    public addDiagnostics(diagnostics: BsDiagnostic[]) {
        this.diagnostics.push(...diagnostics);
    }

    /**
     * Determine if the specified file is loaded in this program right now.
     * @param filePath
     * @param normalizePath should the provided path be normalized before use
     */
    public hasFile(filePath: string, normalizePath = true) {
        return !!this.getFile(filePath, normalizePath);
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
     * Return all scopes
     */
    public getScopes() {
        return Object.values(this.scopes);
    }

    /**
     * Find the scope for the specified component
     */
    public getComponentScope(componentName: string) {
        return this.getComponent(componentName)?.scope;
    }

    /**
     * Update internal maps with this file reference
     */
    private assignFile<T extends BscFile = BscFile>(file: T) {
        this.files[file.srcPath.toLowerCase()] = file;
        this.pkgMap[file.pkgPath.toLowerCase()] = file;
        return file;
    }

    /**
     * Remove this file from internal maps
     */
    private unassignFile<T extends BscFile = BscFile>(file: T) {
        delete this.files[file.srcPath.toLowerCase()];
        delete this.pkgMap[file.pkgPath.toLowerCase()];
        return file;
    }

    /**
     * Load a file into the program. If that file already exists, it is replaced.
     * If file contents are provided, those are used, Otherwise, the file is loaded from the file system
     * @param srcPath the file path relative to the root dir
     * @param fileContents the file contents
     * @deprecated use `setFile` instead
     */
    public addOrReplaceFile<T extends BscFile>(srcPath: string, fileContents: string): T;
    /**
     * Load a file into the program. If that file already exists, it is replaced.
     * @param fileEntry an object that specifies src and dest for the file.
     * @param fileContents the file contents. If not provided, the file will be loaded from disk
     * @deprecated use `setFile` instead
     */
    public addOrReplaceFile<T extends BscFile>(fileEntry: FileObj, fileContents: string): T;
    public addOrReplaceFile<T extends BscFile>(fileParam: FileObj | string, fileContents: string): T {
        return this.setFile<T>(fileParam as any, fileContents);
    }

    /**
     * Load a file into the program. If that file already exists, it is replaced.
     * If file contents are provided, those are used, Otherwise, the file is loaded from the file system
     * @param srcDestOrPkgPath the absolute path, the pkg path (i.e. `pkg:/path/to/file.brs`), or the destPath (i.e. `path/to/file.brs` relative to `pkg:/`)
     * @param fileContents the file contents
     */
    public setFile<T extends BscFile>(srcDestOrPkgPath: string, fileContents: string): T;
    /**
     * Load a file into the program. If that file already exists, it is replaced.
     * @param fileEntry an object that specifies src and dest for the file.
     * @param fileContents the file contents. If not provided, the file will be loaded from disk
     */
    public setFile<T extends BscFile>(fileEntry: FileObj, fileContents: string): T;
    public setFile<T extends BscFile>(fileParam: FileObj | string, fileContents: string): T {
        assert.ok(fileParam, 'fileParam is required');
        let srcPath: string;
        let pkgPath: string;
        if (typeof fileParam === 'string') {
            srcPath = s`${this.options.rootDir}/${fileParam}`;
            pkgPath = s`${fileParam}`;
        } else {
            srcPath = s`${fileParam.src}`;
            pkgPath = s`${fileParam.dest}`;
        }
        let file = this.logger.time(LogLevel.debug, ['Program.setFile()', chalk.green(srcPath)], () => {

            assert.ok(srcPath, 'fileEntry.src is required');
            assert.ok(pkgPath, 'fileEntry.dest is required');

            //if the file is already loaded, remove it
            if (this.hasFile(srcPath)) {
                this.removeFile(srcPath);
            }
            let fileExtension = path.extname(srcPath).toLowerCase();
            let file: BscFile | undefined;

            if (fileExtension === '.brs' || fileExtension === '.bs') {
                //add the file to the program
                const brsFile = this.assignFile(
                    new BrsFile(srcPath, pkgPath, this)
                );

                //add file to the `source` dependency list
                if (brsFile.pkgPath.startsWith(startOfSourcePkgPath)) {
                    this.createSourceScope();
                    this.dependencyGraph.addDependency('scope:source', brsFile.dependencyGraphKey);
                }

                let sourceObj: SourceObj = {
                    //TODO remove `pathAbsolute` in v1
                    pathAbsolute: srcPath,
                    srcPath: srcPath,
                    source: fileContents
                };
                this.plugins.emit('beforeFileParse', sourceObj);

                this.logger.time(LogLevel.debug, ['parse', chalk.green(srcPath)], () => {
                    brsFile.parse(sourceObj.source);
                });

                //notify plugins that this file has finished parsing
                this.plugins.emit('afterFileParse', brsFile);

                file = brsFile;

                brsFile.attachDependencyGraph(this.dependencyGraph);

            } else if (
                //is xml file
                fileExtension === '.xml' &&
                //resides in the components folder (Roku will only parse xml files in the components folder)
                pkgPath.toLowerCase().startsWith(util.pathSepNormalize(`components/`))
            ) {
                //add the file to the program
                const xmlFile = this.assignFile(
                    new XmlFile(srcPath, pkgPath, this)
                );

                let sourceObj: SourceObj = {
                    //TODO remove `pathAbsolute` in v1
                    pathAbsolute: srcPath,
                    srcPath: srcPath,
                    source: fileContents
                };
                this.plugins.emit('beforeFileParse', sourceObj);

                this.logger.time(LogLevel.debug, ['parse', chalk.green(srcPath)], () => {
                    xmlFile.parse(sourceObj.source);
                });

                //notify plugins that this file has finished parsing
                this.plugins.emit('afterFileParse', xmlFile);

                file = xmlFile;

                //create a new scope for this xml file
                let scope = new XmlScope(xmlFile, this);
                this.addScope(scope);

                //register this compoent now that we have parsed it and know its component name
                this.registerComponent(xmlFile, scope);

            } else {
                //TODO do we actually need to implement this? Figure out how to handle img paths
                // let genericFile = this.files[srcPath] = <any>{
                //     srcPath: srcPath,
                //     pkgPath: pkgPath,
                //     wasProcessed: true
                // } as File;
                // file = <any>genericFile;
            }
            return file;
        });
        return file as T;
    }

    /**
     * Ensure source scope is created.
     * Note: automatically called internally, and no-op if it exists already.
     */
    public createSourceScope() {
        if (!this.scopes.source) {
            const sourceScope = new Scope('source', this, 'scope:source');
            sourceScope.attachDependencyGraph(this.dependencyGraph);
            this.addScope(sourceScope);
        }
    }

    /**
     * Find the file by its absolute path. This is case INSENSITIVE, since
     * Roku is a case insensitive file system. It is an error to have multiple files
     * with the same path with only case being different.
     * @param srcPath
     * @deprecated use `getFile` instead, which auto-detects the path type
     */
    public getFileByPathAbsolute<T extends BrsFile | XmlFile>(srcPath: string) {
        srcPath = s`${srcPath}`;
        for (let filePath in this.files) {
            if (filePath.toLowerCase() === srcPath.toLowerCase()) {
                return this.files[filePath] as T;
            }
        }
    }

    /**
     * Get a list of files for the given (platform-normalized) pkgPath array.
     * Missing files are just ignored.
     * @deprecated use `getFiles` instead, which auto-detects the path types
     */
    public getFilesByPkgPaths<T extends BscFile[]>(pkgPaths: string[]) {
        return pkgPaths
            .map(pkgPath => this.getFileByPkgPath(pkgPath))
            .filter(file => file !== undefined) as T;
    }

    /**
     * Get a file with the specified (platform-normalized) pkg path.
     * If not found, return undefined
     * @deprecated use `getFile` instead, which auto-detects the path type
     */
    public getFileByPkgPath<T extends BscFile>(pkgPath: string) {
        return this.pkgMap[pkgPath.toLowerCase()] as T;
    }

    /**
     * Remove a set of files from the program
     * @param filePaths can be an array of srcPath or destPath strings
     * @param normalizePath should this function repair and standardize the filePaths? Passing false should have a performance boost if you can guarantee your paths are already sanitized
     */
    public removeFiles(srcPaths: string[], normalizePath = true) {
        for (let srcPath of srcPaths) {
            this.removeFile(srcPath, normalizePath);
        }
    }

    /**
     * Remove a file from the program
     * @param filePath can be a srcPath, a pkgPath, or a destPath (same as pkgPath but without `pkg:/`)
     * @param normalizePath should this function repair and standardize the path? Passing false should have a performance boost if you can guarantee your path is already sanitized
     */
    public removeFile(filePath: string, normalizePath = true) {
        this.logger.debug('Program.removeFile()', filePath);

        let file = this.getFile(filePath, normalizePath);
        if (file) {
            this.plugins.emit('beforeFileDispose', file);

            //if there is a scope named the same as this file's path, remove it (i.e. xml scopes)
            let scope = this.scopes[file.pkgPath];
            if (scope) {
                this.plugins.emit('beforeScopeDispose', scope);
                scope.dispose();
                //notify dependencies of this scope that it has been removed
                this.dependencyGraph.remove(scope.dependencyGraphKey);
                delete this.scopes[file.pkgPath];
                this.plugins.emit('afterScopeDispose', scope);
            }
            //remove the file from the program
            this.unassignFile(file);

            this.dependencyGraph.remove(file.dependencyGraphKey);

            //if this is a pkg:/source file, notify the `source` scope that it has changed
            if (file.pkgPath.startsWith(startOfSourcePkgPath)) {
                this.dependencyGraph.removeDependency('scope:source', file.dependencyGraphKey);
            }

            //if this is a component, remove it from our components map
            if (isXmlFile(file)) {
                this.unregisterComponent(file);
            }
            //dispose file
            file?.dispose();
            this.plugins.emit('afterFileDispose', file);
        }
    }

    /**
     * Traverse the entire project, and validate all scopes
     */
    public validate() {
        this.logger.time(LogLevel.log, ['Validating project'], () => {
            this.diagnostics = [];
            this.plugins.emit('beforeProgramValidate', this);

            //validate every file
            for (const file of Object.values(this.files)) {

                //find any files NOT loaded into a scope
                if (!this.fileIsIncludedInAnyScope(file)) {
                    this.logger.debug('Program.validate(): fileNotReferenced by any scope', () => chalk.green(file?.pkgPath));
                    //the file is not loaded in any scope
                    this.diagnostics.push({
                        ...DiagnosticMessages.fileNotReferencedByAnyOtherFile(),
                        file: file,
                        range: util.createRange(0, 0, 0, Number.MAX_VALUE)
                    });
                }

                //for every unvalidated file, validate it
                if (!file.isValidated) {
                    this.plugins.emit('beforeFileValidate', {
                        program: this,
                        file: file
                    });

                    //emit an event to allow plugins to contribute to the file validation process
                    this.plugins.emit('onFileValidate', {
                        program: this,
                        file: file
                    });
                    //call file.validate() IF the file has that function defined
                    file.validate?.();
                    file.isValidated = true;

                    this.plugins.emit('afterFileValidate', file);
                }
            }


            this.logger.time(LogLevel.info, ['Validate all scopes'], () => {
                for (let scopeName in this.scopes) {
                    let scope = this.scopes[scopeName];
                    scope.validate();
                }
            });

            this.detectDuplicateComponentNames();

            this.plugins.emit('afterProgramValidate', this);
        });
    }

    /**
     * Flag all duplicate component names
     */
    private detectDuplicateComponentNames() {
        const componentsByName = Object.keys(this.files).reduce<Record<string, XmlFile[]>>((map, filePath) => {
            const file = this.files[filePath];
            //if this is an XmlFile, and it has a valid `componentName` property
            if (isXmlFile(file) && file.componentName?.text) {
                let lowerName = file.componentName.text.toLowerCase();
                if (!map[lowerName]) {
                    map[lowerName] = [];
                }
                map[lowerName].push(file);
            }
            return map;
        }, {});

        for (let name in componentsByName) {
            const xmlFiles = componentsByName[name];
            //add diagnostics for every duplicate component with this name
            if (xmlFiles.length > 1) {
                for (let xmlFile of xmlFiles) {
                    const { componentName } = xmlFile;
                    this.diagnostics.push({
                        ...DiagnosticMessages.duplicateComponentName(componentName.text),
                        range: xmlFile.componentName.range,
                        file: xmlFile,
                        relatedInformation: xmlFiles.filter(x => x !== xmlFile).map(x => {
                            return {
                                location: util.createLocation(
                                    URI.file(xmlFile.srcPath ?? xmlFile.srcPath).toString(),
                                    x.componentName.range
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
    private fileIsIncludedInAnyScope(file: BscFile) {
        for (let scopeName in this.scopes) {
            if (this.scopes[scopeName].hasFile(file)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Get the files for a list of filePaths
     * @param filePaths can be an array of srcPath or a destPath strings
     * @param normalizePath should this function repair and standardize the paths? Passing false should have a performance boost if you can guarantee your paths are already sanitized
     */
    public getFiles<T extends BscFile>(filePaths: string[], normalizePath = true) {
        return filePaths
            .map(filePath => this.getFile(filePath, normalizePath))
            .filter(file => file !== undefined) as T[];
    }

    /**
     * Get the file at the given path
     * @param filePath can be a srcPath or a destPath
     * @param normalizePath should this function repair and standardize the path? Passing false should have a performance boost if you can guarantee your path is already sanitized
     */
    public getFile<T extends BscFile>(filePath: string, normalizePath = true) {
        if (typeof filePath !== 'string') {
            return undefined;
        } else if (path.isAbsolute(filePath)) {
            return this.files[
                (normalizePath ? util.standardizePath(filePath) : filePath).toLowerCase()
            ] as T;
        } else {
            return this.pkgMap[
                (normalizePath ? util.standardizePath(filePath) : filePath).toLowerCase()
            ] as T;
        }
    }

    /**
     * Get a list of all scopes the file is loaded into
     * @param file
     */
    public getScopesForFile(file: XmlFile | BrsFile | string) {
        if (typeof file === 'string') {
            file = this.getFile(file);
        }
        let result = [] as Scope[];
        if (file) {
            for (let key in this.scopes) {
                let scope = this.scopes[key];

                if (scope.hasFile(file)) {
                    result.push(scope);
                }
            }
        }
        return result;
    }

    /**
     * Get the first found scope for a file.
     */
    public getFirstScopeForFile(file: XmlFile | BrsFile): Scope {
        for (let key in this.scopes) {
            let scope = this.scopes[key];

            if (scope.hasFile(file)) {
                return scope;
            }
        }
    }

    public getStatementsByName(name: string, originFile: BrsFile, namespaceName?: string): FileLink<Statement>[] {
        let results = new Map<Statement, FileLink<Statement>>();
        const filesSearched = new Set<BrsFile>();
        let lowerNamespaceName = namespaceName?.toLowerCase();
        let lowerName = name?.toLowerCase();
        //look through all files in scope for matches
        for (const scope of this.getScopesForFile(originFile)) {
            for (const file of scope.getAllFiles()) {
                if (isXmlFile(file) || filesSearched.has(file)) {
                    continue;
                }
                filesSearched.add(file);

                for (const statement of [...file.parser.references.functionStatements, ...file.parser.references.classStatements.flatMap((cs) => cs.methods)]) {
                    let parentNamespaceName = statement.namespaceName?.getName(originFile.parseMode)?.toLowerCase();
                    if (statement.name.text.toLowerCase() === lowerName && (!parentNamespaceName || parentNamespaceName === lowerNamespaceName)) {
                        if (!results.has(statement)) {
                            results.set(statement, { item: statement, file: file });
                        }
                    }
                }
            }
        }
        return [...results.values()];
    }

    public getStatementsForXmlFile(scope: XmlScope, filterName?: string): FileLink<FunctionStatement>[] {
        let results = new Map<Statement, FileLink<FunctionStatement>>();
        const filesSearched = new Set<BrsFile>();

        //get all function names for the xml file and parents
        let funcNames = new Set<string>();
        let currentScope = scope;
        while (isXmlScope(currentScope)) {
            for (let name of currentScope.xmlFile.ast.component.api?.functions.map((f) => f.name) ?? []) {
                if (!filterName || name === filterName) {
                    funcNames.add(name);
                }
            }
            currentScope = currentScope.getParentScope() as XmlScope;
        }

        //look through all files in scope for matches
        for (const file of scope.getOwnFiles()) {
            if (isXmlFile(file) || filesSearched.has(file)) {
                continue;
            }
            filesSearched.add(file);

            for (const statement of file.parser.references.functionStatements) {
                if (funcNames.has(statement.name.text)) {
                    if (!results.has(statement)) {
                        results.set(statement, { item: statement, file: file });
                    }
                }
            }
        }
        return [...results.values()];
    }

    /**
     * Find all available completion items at the given position
     * @param filePath can be a srcPath or a destPath
     * @param position the position (line & column) where completions should be found
     */
    public getCompletions(filePath: string, position: Position) {
        let file = this.getFile(filePath);
        if (!file) {
            return [];
        }
        let result = [] as CompletionItem[];

        if (isBrsFile(file) && file.isPositionNextToTokenKind(position, TokenKind.Callfunc)) {
            // is next to a @. callfunc invocation - must be an interface method
            for (const scope of this.getScopes().filter((s) => isXmlScope(s))) {
                let fileLinks = this.getStatementsForXmlFile(scope as XmlScope);
                for (let fileLink of fileLinks) {

                    result.push(scope.createCompletionFromFunctionStatement(fileLink.item));
                }
            }
            //no other result is possible in this case
            return result;

        }
        //find the scopes for this file
        let scopes = this.getScopesForFile(file);

        //if there are no scopes, include the global scope so we at least get the built-in functions
        scopes = scopes.length > 0 ? scopes : [this.globalScope];

        //get the completions from all scopes for this file
        let allCompletions = util.flatMap(
            scopes.map(ctx => file.getCompletions(position, ctx)),
            c => c
        );

        //only keep completions common to every scope for this file
        let keyCounts = {} as Record<string, number>;
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
     * Goes through each file and builds a list of workspace symbols for the program. Used by LanguageServer's onWorkspaceSymbol functionality
     */
    public getWorkspaceSymbols() {
        const results = Object.keys(this.files).map(key => {
            const file = this.files[key];
            if (isBrsFile(file)) {
                return file.getWorkspaceSymbols();
            }
            return [];
        });
        return util.flatMap(results, c => c);
    }

    /**
     * Given a position in a file, if the position is sitting on some type of identifier,
     * go to the definition of that identifier (where this thing was first defined)
     */
    public getDefinition(srcPath: string, position: Position) {
        let file = this.getFile(srcPath);
        if (!file) {
            return [];
        }

        if (isBrsFile(file)) {
            return file.getDefinition(position);
        } else {
            let results = [] as Location[];
            const scopes = this.getScopesForFile(file);
            for (const scope of scopes) {
                results = results.concat(...scope.getDefinition(file, position));
            }
            return results;
        }
    }

    public getHover(srcPath: string, position: Position) {
        //find the file
        let file = this.getFile(srcPath);
        if (!file) {
            return null;
        }
        const hover = file.getHover(position);

        return Promise.resolve(hover);
    }

    /**
     * Compute code actions for the given file and range
     */
    public getCodeActions(srcPath: string, range: Range) {
        const codeActions = [] as CodeAction[];
        const file = this.getFile(srcPath);
        if (file) {
            const diagnostics = this
                //get all current diagnostics (filtered by diagnostic filters)
                .getDiagnostics()
                //only keep diagnostics related to this file
                .filter(x => x.file === file)
                //only keep diagnostics that touch this range
                .filter(x => util.rangesIntersect(x.range, range));

            const scopes = this.getScopesForFile(file);

            this.plugins.emit('onGetCodeActions', {
                program: this,
                file: file,
                range: range,
                diagnostics: diagnostics,
                scopes: scopes,
                codeActions: codeActions
            });
        }
        return codeActions;
    }

    /**
     * Get semantic tokens for the specified file
     */
    public getSemanticTokens(srcPath: string) {
        const file = this.getFile(srcPath);
        if (file) {
            const result = [] as SemanticToken[];
            this.plugins.emit('onGetSemanticTokens', {
                program: this,
                file: file,
                scopes: this.getScopesForFile(file),
                semanticTokens: result
            });
            return result;
        }
    }

    public getSignatureHelp(filepath: string, position: Position): SignatureInfoObj[] {
        let file: BrsFile = this.getFile(filepath);
        if (!file || !isBrsFile(file)) {
            return [];
        }

        const results = new Map<string, SignatureInfoObj>();

        let functionScope = file.getFunctionScopeAtPosition(position);
        let identifierInfo = this.getPartialStatementInfo(file, position);
        if (identifierInfo.statementType === '') {
            // just general function calls
            let statements = file.program.getStatementsByName(identifierInfo.name, file);
            for (let statement of statements) {
                //TODO better handling of collisions - if it's a namespace, then don't show any other overrides
                //if we're on m - then limit scope to the current class, if present
                let sigHelp = statement.file.getSignatureHelpForStatement(statement.item);
                if (sigHelp && !results.has[sigHelp.key]) {
                    sigHelp.index = identifierInfo.commaCount;
                    results.set(sigHelp.key, sigHelp);
                }
            }
        } else if (identifierInfo.statementType === '.') {
            //if m class reference.. then
            //only get statements from the class I am in..
            if (functionScope) {
                let myClass = file.getClassFromMReference(position, file.getTokenAt(position), functionScope);
                if (myClass) {
                    for (let scope of this.getScopesForFile(myClass.file)) {
                        let classes = scope.getClassHierarchy(myClass.item.getName(ParseMode.BrighterScript).toLowerCase());
                        //and anything from any class in scope to a non m class
                        for (let statement of [...classes].filter((i) => isClassMethodStatement(i.item))) {
                            let sigHelp = statement.file.getSignatureHelpForStatement(statement.item);
                            if (sigHelp && !results.has[sigHelp.key]) {

                                results.set(sigHelp.key, sigHelp);
                                return;
                            }
                        }
                    }
                }
            }

            if (identifierInfo.dotPart) {
                //potential namespaces
                let statements = file.program.getStatementsByName(identifierInfo.name, file, identifierInfo.dotPart);
                if (statements.length === 0) {
                    //was not a namespaced function, it could be any method on any class now
                    statements = file.program.getStatementsByName(identifierInfo.name, file);
                }
                for (let statement of statements) {
                    //TODO better handling of collisions - if it's a namespace, then don't show any other overrides
                    //if we're on m - then limit scope to the current class, if present
                    let sigHelp = statement.file.getSignatureHelpForStatement(statement.item);
                    if (sigHelp && !results.has[sigHelp.key]) {
                        sigHelp.index = identifierInfo.commaCount;
                        results.set(sigHelp.key, sigHelp);
                    }
                }
            }


        } else if (identifierInfo.statementType === '@.') {
            for (const scope of this.getScopes().filter((s) => isXmlScope(s))) {
                let fileLinks = this.getStatementsForXmlFile(scope as XmlScope, identifierInfo.name);
                for (let fileLink of fileLinks) {

                    let sigHelp = fileLink.file.getSignatureHelpForStatement(fileLink.item);
                    if (sigHelp && !results.has[sigHelp.key]) {
                        sigHelp.index = identifierInfo.commaCount;
                        results.set(sigHelp.key, sigHelp);
                    }
                }
            }
        } else if (identifierInfo.statementType === 'new') {
            let classItem = file.getClassFileLink(identifierInfo.dotPart ? `${identifierInfo.dotPart}.${identifierInfo.name}` : identifierInfo.name);
            let sigHelp = classItem?.file?.getClassSignatureHelp(classItem?.item);
            if (sigHelp && !results.has(sigHelp.key)) {
                sigHelp.index = identifierInfo.commaCount;
                results.set(sigHelp.key, sigHelp);
            }
        }

        return [...results.values()];
    }

    private getPartialStatementInfo(file: BrsFile, position: Position): PartialStatementInfo {
        let lines = util.splitIntoLines(file.fileContents);
        let line = lines[position.line];
        let index = position.character;
        let itemCounts = this.getPartialItemCounts(line, index);
        if (!itemCounts.isArgStartFound && line.charAt(index) === ')') {
            //try previous char, in case we were on a close bracket..
            index--;
            itemCounts = this.getPartialItemCounts(line, index);
        }
        let argStartIndex = itemCounts.argStartIndex;
        index = itemCounts.argStartIndex - 1;
        let statementType = '';
        let name;
        let dotPart;

        if (!itemCounts.isArgStartFound) {
            //try to get sig help based on the name
            index = position.character;
            let currentToken = file.getTokenAt(position);
            if (currentToken && currentToken.kind !== TokenKind.Comment) {
                name = file.getPartialVariableName(currentToken, [TokenKind.New]);
                if (!name) {
                    //try the previous token, incase we're on a bracket
                    currentToken = file.getPreviousToken(currentToken);
                    name = file.getPartialVariableName(currentToken, [TokenKind.New]);
                }
                if (name?.indexOf('.')) {
                    let parts = name.split('.');
                    name = parts[parts.length - 1];
                }

                index = currentToken.range.start.character;
                argStartIndex = index;
            } else {
                // invalid location
                index = 0;
                itemCounts.comma = 0;
            }
        }
        //this loop is quirky. walk to -1 (which will result in the last char being '' thus satisfying the situation where there is no leading whitespace).
        while (index >= -1) {
            if (!(/[a-z0-9_\.\@]/i).test(line.charAt(index))) {
                if (!name) {
                    name = line.substring(index + 1, argStartIndex);
                } else {
                    dotPart = line.substring(index + 1, argStartIndex);
                    if (dotPart.endsWith('.')) {
                        dotPart = dotPart.substr(0, dotPart.length - 1);
                    }
                }
                break;
            }
            if (line.substr(index - 2, 2) === '@.') {
                statementType = '@.';
                name = name || line.substring(index, argStartIndex);
                break;
            } else if (line.charAt(index - 1) === '.' && statementType === '') {
                statementType = '.';
                name = name || line.substring(index, argStartIndex);
                argStartIndex = index;
            }
            index--;
        }

        if (line.substring(0, index).trim().endsWith('new')) {
            statementType = 'new';
        }

        return {
            commaCount: itemCounts.comma,
            statementType: statementType,
            name: name,
            dotPart: dotPart
        };
    }

    private getPartialItemCounts(line: string, index: number) {
        let isArgStartFound = false;
        let itemCounts = {
            normal: 0,
            square: 0,
            curly: 0,
            comma: 0,
            endIndex: 0,
            argStartIndex: index,
            isArgStartFound: false
        };
        while (index >= 0) {
            const currentChar = line.charAt(index);

            if (currentChar === '\'') { //found comment, invalid index
                itemCounts.isArgStartFound = false;
                break;
            }

            if (isArgStartFound) {
                if (currentChar !== ' ') {
                    break;
                }
            } else {
                if (currentChar === ')') {
                    itemCounts.normal++;
                }

                if (currentChar === ']') {
                    itemCounts.square++;
                }

                if (currentChar === '}') {
                    itemCounts.curly++;
                }

                if (currentChar === ',' && itemCounts.normal <= 0 && itemCounts.curly <= 0 && itemCounts.square <= 0) {
                    itemCounts.comma++;
                }

                if (currentChar === '(') {
                    if (itemCounts.normal === 0) {
                        itemCounts.isArgStartFound = true;
                        itemCounts.argStartIndex = index;
                    } else {
                        itemCounts.normal--;
                    }
                }

                if (currentChar === '[') {
                    itemCounts.square--;
                }

                if (currentChar === '{') {
                    itemCounts.curly--;
                }
            }
            index--;
        }
        return itemCounts;

    }

    public getReferences(srcPath: string, position: Position) {
        //find the file
        let file = this.getFile(srcPath);
        if (!file) {
            return null;
        }

        return file.getReferences(position);
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
        let resultPkgPaths = {} as Record<string, boolean>;

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
                        detail: file.srcPath,
                        kind: CompletionItemKind.File,
                        textEdit: {
                            newText: relativePath,
                            range: scriptImport.filePathRange
                        }
                    });

                    //add the absolute path
                    result.push({
                        label: filePkgPath,
                        detail: file.srcPath,
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
     *
     * This should only be called by `LanguageServer`.
     * Internal usage should call `_getTranspiledFileContents` instead.
     * @param filePath can be a srcPath or a destPath
     */
    public async getTranspiledFileContents(filePath: string) {
        let fileMap = await rokuDeploy.getFilePaths(this.options.files, this.options.rootDir);
        //remove files currently loaded in the program, we will transpile those instead (even if just for source maps)
        let filteredFileMap = [] as FileObj[];
        for (let fileEntry of fileMap) {
            if (this.hasFile(fileEntry.src) === false) {
                filteredFileMap.push(fileEntry);
            }
        }
        const { entries, astEditor } = this.beforeProgramTranspile(fileMap, this.options.stagingFolderPath);
        const result = this._getTranspiledFileContents(
            this.getFile(filePath)
        );
        this.afterProgramTranspile(entries, astEditor);
        return result;
    }

    /**
     * Internal function used to transpile files.
     * This does not write anything to the file system
     */
    private _getTranspiledFileContents(file: BscFile, outputPath?: string): FileTranspileResult {
        const editor = new AstEditor();

        this.plugins.emit('beforeFileTranspile', {
            program: this,
            file: file,
            outputPath: outputPath,
            editor: editor
        });

        //if we have any edits, assume the file needs to be transpiled
        if (editor.hasChanges) {
            //use the `editor` because it'll track the previous value for us and revert later on
            editor.setProperty(file, 'needsTranspiled', true);
        }

        //transpile the file
        const result = file.transpile();

        //generate the typedef if enabled
        let typedef: string;
        if (isBrsFile(file) && this.options.emitDefinitions) {
            typedef = file.getTypedef();
        }

        const event: AfterFileTranspileEvent = {
            program: this,
            file: file,
            outputPath: outputPath,
            editor: editor,
            code: result.code,
            map: result.map,
            typedef: typedef
        };
        this.plugins.emit('afterFileTranspile', event);

        //undo all `editor` edits that may have been applied to this file.
        editor.undoAll();

        return {
            srcPath: file.srcPath,
            pkgPath: file.pkgPath,
            code: event.code,
            map: event.map,
            typedef: event.typedef
        };
    }

    private beforeProgramTranspile(fileEntries: FileObj[], stagingFolderPath: string) {
        // map fileEntries using their path as key, to avoid excessive "find()" operations
        const mappedFileEntries = fileEntries.reduce<Record<string, FileObj>>((collection, entry) => {
            collection[s`${entry.src}`] = entry;
            return collection;
        }, {});

        const getOutputPath = (file: BscFile) => {
            let filePathObj = mappedFileEntries[s`${file.srcPath}`];
            if (!filePathObj) {
                //this file has been added in-memory, from a plugin, for example
                filePathObj = {
                    //add an interpolated src path (since it doesn't actually exist in memory)
                    src: `bsc:/${file.pkgPath}`,
                    dest: file.pkgPath
                };
            }
            //replace the file extension
            let outputPath = filePathObj.dest.replace(/\.bs$/gi, '.brs');
            //prepend the staging folder path
            outputPath = s`${stagingFolderPath}/${outputPath}`;
            return outputPath;
        };

        const entries = Object.values(this.files).map(file => {
            return {
                file: file,
                outputPath: getOutputPath(file)
            };
        });

        const astEditor = new AstEditor();

        this.plugins.emit('beforeProgramTranspile', this, entries, astEditor);
        return {
            entries: entries,
            getOutputPath: getOutputPath,
            astEditor: astEditor
        };
    }

    public async transpile(fileEntries: FileObj[], stagingFolderPath: string) {
        const { entries, getOutputPath, astEditor } = this.beforeProgramTranspile(fileEntries, stagingFolderPath);

        const processedFiles = new Set<File>();

        const transpileFile = async (srcPath: string, outputPath?: string) => {
            //find the file in the program
            const file = this.getFile(srcPath);
            //mark this file as processed so we don't process it more than once
            processedFiles.add(file);

            //skip transpiling typedef files
            if (isBrsFile(file) && file.isTypedef) {
                return;
            }

            const fileTranspileResult = this._getTranspiledFileContents(file, outputPath);

            //make sure the full dir path exists
            await fsExtra.ensureDir(path.dirname(outputPath));

            if (await fsExtra.pathExists(outputPath)) {
                throw new Error(`Error while transpiling "${file.srcPath}". A file already exists at "${outputPath}" and will not be overwritten.`);
            }
            const writeMapPromise = fileTranspileResult.map ? fsExtra.writeFile(`${outputPath}.map`, fileTranspileResult.map.toString()) : null;
            await Promise.all([
                fsExtra.writeFile(outputPath, fileTranspileResult.code),
                writeMapPromise
            ]);

            if (fileTranspileResult.typedef) {
                const typedefPath = outputPath.replace(/\.brs$/i, '.d.bs');
                await fsExtra.writeFile(typedefPath, fileTranspileResult.typedef);
            }
        };

        let promises = entries.map(async (entry) => {
            return transpileFile(entry?.file?.srcPath, entry.outputPath);
        });

        //if there's no bslib file already loaded into the program, copy it to the staging directory
        if (!this.getFile(bslibAliasedRokuModulesPkgPath) && !this.getFile(s`source/bslib.brs`)) {
            promises.push(util.copyBslibToStaging(stagingFolderPath));
        }
        await Promise.all(promises);

        //transpile any new files that plugins added since the start of this transpile process
        do {
            promises = [];
            for (const key in this.files) {
                const file = this.files[key];
                //this is a new file
                if (!processedFiles.has(file)) {
                    promises.push(
                        transpileFile(file?.srcPath, getOutputPath(file))
                    );
                }
            }
            if (promises.length > 0) {
                this.logger.info(`Transpiling ${promises.length} new files`);
                await Promise.all(promises);
            }
        }
        while (promises.length > 0);
        this.afterProgramTranspile(entries, astEditor);
    }

    private afterProgramTranspile(entries: TranspileObj[], astEditor: AstEditor) {
        this.plugins.emit('afterProgramTranspile', this, entries, astEditor);
        astEditor.undoAll();
    }

    /**
     * Find a list of files in the program that have a function with the given name (case INsensitive)
     */
    public findFilesForFunction(functionName: string) {
        const files = [] as BscFile[];
        const lowerFunctionName = functionName.toLowerCase();
        //find every file with this function defined
        for (const file of Object.values(this.files)) {
            if (isBrsFile(file)) {
                //TODO handle namespace-relative function calls
                //if the file has a function with this name
                if (file.parser.references.functionStatementLookup.get(lowerFunctionName) !== undefined) {
                    files.push(file);
                }
            }
        }
        return files;
    }

    /**
     * Find a list of files in the program that have a class with the given name (case INsensitive)
     */
    public findFilesForClass(className: string) {
        const files = [] as BscFile[];
        const lowerClassName = className.toLowerCase();
        //find every file with this class defined
        for (const file of Object.values(this.files)) {
            if (isBrsFile(file)) {
                //TODO handle namespace-relative classes
                //if the file has a function with this name
                if (file.parser.references.classStatementLookup.get(lowerClassName) !== undefined) {
                    files.push(file);
                }
            }
        }
        return files;
    }

    public findFilesForNamespace(name: string) {
        const files = [] as BscFile[];
        const lowerName = name.toLowerCase();
        //find every file with this class defined
        for (const file of Object.values(this.files)) {
            if (isBrsFile(file)) {
                if (file.parser.references.namespaceStatements.find(x => x.name.toLowerCase() === lowerName)) {
                    files.push(file);
                }
            }
        }
        return files;
    }

    public findFilesForEnum(name: string) {
        const files = [] as BscFile[];
        const lowerName = name.toLowerCase();
        //find every file with this class defined
        for (const file of Object.values(this.files)) {
            if (isBrsFile(file)) {
                if (file.parser.references.enumStatementLookup.get(lowerName)) {
                    files.push(file);
                }
            }
        }
        return files;
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
    private _manifest: Map<string, string>;

    public dispose() {
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

export interface FileTranspileResult {
    srcPath: string;
    pkgPath: string;
    code: string;
    map: SourceMapGenerator;
    typedef: string;
}
