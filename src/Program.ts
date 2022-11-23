import * as assert from 'assert';
import * as fsExtra from 'fs-extra';
import * as path from 'path';
import type { CodeAction, CompletionItem, Position, Range, SignatureInformation, Location, Hover } from 'vscode-languageserver';
import { CompletionItemKind } from 'vscode-languageserver';
import type { BsConfig } from './BsConfig';
import { Scope } from './Scope';
import { DiagnosticMessages } from './DiagnosticMessages';
import type { BrsFile } from './files/BrsFile';
import type { XmlFile } from './files/XmlFile';
import type { BsDiagnostic, FileReference, FileObj, SemanticToken, AfterFileTranspileEvent, FileLink, ProvideCompletionsEvent, ProvideHoverEvent, ProvideFileEvent, BeforeFileAddEvent, BeforeFileRemoveEvent } from './interfaces';
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
import { isBrsFile, isXmlFile, isXmlScope, isNamespaceStatement } from './astUtils/reflection';
import type { FunctionStatement, NamespaceStatement } from './parser/Statement';
import { BscPlugin } from './bscPlugin/BscPlugin';
import { AstEditor } from './astUtils/AstEditor';
import type { SourceMapGenerator } from 'source-map';
import type { Statement } from './parser/AstNode';
import { CallExpressionInfo } from './bscPlugin/CallExpressionInfo';
import { SignatureHelpUtil } from './bscPlugin/SignatureHelpUtil';
import { rokuDeploy } from 'roku-deploy';
import { FileFactory } from './files/Factory';
import type { File } from './files/File';

const bslibNonAliasedRokuModulesPkgPath = s`source/roku_modules/rokucommunity_bslib/bslib.brs`;
const bslibAliasedRokuModulesPkgPath = s`source/roku_modules/bslib/bslib.brs`;

export interface TranspileObj {
    file: File;
    outputPath: string;
}

export interface SignatureInfoObj {
    index: number;
    key: string;
    signature: SignatureInformation;
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

        this.fileFactory = new FileFactory(this);
    }

    public logger: Logger;

    /**
     * A factory that creates `File` instances
     */
    private fileFactory: FileFactory;

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
    public files = {} as Record<string, File>;
    /**
     * A map of every file loaded into this program, indexed by its destPath
     */
    private destMap = new Map<string, File>();
    /**
     * Plugins can contribute multiple virtual files for a single physical file.
     * This collection links the virtual files back to the physical file that produced them.
     * The key is the standardized and lower-cased srcPath
     */
    private fileClusters = new Map<string, File[]>();

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
            //(components are ordered in this list by destPath to ensure consistency)
            return this.components[componentName.toLowerCase()]?.[0];
        } else {
            return undefined;
        }
    }

    /**
     * Register (or replace) the reference to a component in the component map
     */
    private registerComponent(xmlFile: XmlFile, scope: XmlScope) {
        const key = (xmlFile.componentName?.text ?? xmlFile.destPath).toLowerCase();
        if (!this.components[key]) {
            this.components[key] = [];
        }
        this.components[key].push({
            file: xmlFile,
            scope: scope
        });
        this.components[key].sort((a, b) => {
            const pathA = a.file.destPath.toLowerCase();
            const pathB = b.file.destPath.toLowerCase();
            if (pathA < pathB) {
                return -1;
            } else if (pathA > pathB) {
                return 1;
            }
            return 0;
        });
        this.syncComponentDependencyGraph(this.components[key]);
    }

    /**
     * Remove the specified component from the components map
     */
    private unregisterComponent(xmlFile: XmlFile) {
        const key = (xmlFile.componentName?.text ?? xmlFile.destPath).toLowerCase();
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
                this.dependencyGraph.addOrReplace(file.dependencyGraphKey, file.dependencies);
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
                    ...file.diagnostics
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
     * @param filePath the absolute or relative path to the file
     * @param normalizePath should the provided path be normalized before use
     */
    public hasFile(filePath: string, normalizePath = true) {
        return !!this.getFile(filePath, normalizePath);
    }

    /**
     * roku filesystem is case INsensitive, so find the scope by key case insensitive
     * @param scopeName xml scope names are their `destPath`. Source scope is stored with the key `"source"`
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
    private assignFile<T extends File = File>(file: T) {
        const fileAddEvent: BeforeFileAddEvent = {
            file: file,
            program: this
        };

        this.plugins.emit('beforeFileAdd', fileAddEvent);

        this.files[file.srcPath.toLowerCase()] = file;
        this.destMap.set(file.destPath.toLowerCase(), file);

        this.plugins.emit('afterFileAdd', fileAddEvent);

        return file;
    }

    /**
     * Remove this file from internal maps
     */
    private unassignFile<T extends File = File>(file: T) {
        delete this.files[file.srcPath.toLowerCase()];
        this.destMap.delete(file.destPath.toLowerCase());
        return file;
    }

    /**
     * Load a file into the program. If that file already exists, it is replaced.
     * If file contents are provided, those are used, Otherwise, the file is loaded from the file system
     * @param srcPath the file path relative to the root dir
     * @param fileContents the file contents
     * @deprecated use `setFile` instead
     */
    public addOrReplaceFile<T extends File>(srcPath: string, fileContents: string): T;
    /**
     * Load a file into the program. If that file already exists, it is replaced.
     * @param fileEntry an object that specifies src and dest for the file.
     * @param fileContents the file contents
     * @deprecated use `setFile` instead
     */
    public addOrReplaceFile<T extends File>(fileEntry: FileObj, fileContents: string): T;
    public addOrReplaceFile<T extends File>(fileParam: FileObj | string, fileContents: string): T {
        return this.setFile<T>(fileParam as any, fileContents);
    }

    /**
     * Load a file into the program. If that file already exists, it is replaced.
     * If file contents are provided, those are used, Otherwise, the file is loaded from the file system
     * @param srcDestOrPkgPath the absolute path, the pkg path (i.e. `pkg:/path/to/file.brs`), or the destPath (i.e. `path/to/file.brs` relative to `pkg:/`)
     * @param fileData the file contents
     */
    public setFile<T extends File>(srcDestOrPkgPath: string, fileData: FileData): T;
    /**
     * Load a file into the program. If that file already exists, it is replaced.
     * @param fileEntry an object that specifies src and dest for the file.
     * @param fileData the file contents
     */
    public setFile<T extends File>(fileEntry: FileObj, fileData: FileData): T;
    public setFile<T extends File>(fileParam: FileObj | string, fileData: FileData): T {
        //normalize the file paths
        const { srcPath, destPath } = this.getPaths(fileParam, this.options.rootDir);

        let file = this.logger.time(LogLevel.debug, ['Program.setFile()', chalk.green(srcPath)], () => {
            //if the file is already loaded, remove it
            if (this.hasFile(srcPath)) {
                this.removeFile(srcPath);
            }

            const event = new ProvideFileEventInternal(this, srcPath, destPath, fileData, this.fileFactory);

            this.plugins.emit('beforeProvideFile', event);
            this.plugins.emit('provideFile', event);
            this.plugins.emit('afterProvideFile', event);

            //if no files were provided, create a AssetFile to represent it.
            if (event.files.length === 0) {
                event.files.push(
                    this.fileFactory.AssetFile({
                        srcPath: event.srcPath,
                        destPath: event.destPath,
                        pkgPath: event.destPath
                    })
                );
            }

            //find the file instance for the srcPath that triggered this action.
            const primaryFile = event.files.find(x => x.srcPath === srcPath);

            if (!primaryFile) {
                throw new Error(`No file provided for srcPath '${srcPath}'. Instead, received ${JSON.stringify(event.files.map(x => ({
                    type: x.type,
                    srcPath: x.srcPath,
                    destPath: x.destPath
                })))}`);
            }

            //link the virtual files to the primary file
            this.fileClusters.set(primaryFile.srcPath?.toLowerCase(), event.files);

            for (const file of event.files) {
                file.srcPath = s(file.srcPath);
                if (file.destPath) {
                    file.destPath = s`${util.replaceCaseInsensitive(file.destPath, this.options.rootDir, '')}`;
                }
                if (file.pkgPath) {
                    file.pkgPath = s`${util.replaceCaseInsensitive(file.pkgPath, this.options.rootDir, '')}`;
                } else {
                    file.pkgPath = file.destPath;
                }
                file.excludeFromOutput = file.excludeFromOutput === true;

                //set the dependencyGraph key for every file to its destPath
                file.dependencyGraphKey = file.destPath.toLowerCase();

                this.assignFile(file);

                //register a callback anytime this file's dependencies change
                if (typeof file.onDependenciesChanged === 'function') {
                    file.disposables ??= [];
                    file.disposables.push(
                        this.dependencyGraph.onchange(file.dependencyGraphKey, file.onDependenciesChanged.bind(file))
                    );
                }

                //register this file (and its dependencies) with the dependency graph
                this.dependencyGraph.addOrReplace(file.dependencyGraphKey, file.dependencies ?? []);

                //if this is a `source` file, add it to the source scope's dependency list
                if (this.isSourceBrsFile(file)) {
                    this.createSourceScope();
                    this.dependencyGraph.addDependency('scope:source', file.dependencyGraphKey);
                }

                //if this is an xml file in the components folder, register it as a component
                if (this.isComponentsXmlFile(file)) {
                    //create a new scope for this xml file
                    let scope = new XmlScope(file, this);
                    this.addScope(scope);

                    //register this compoent now that we have parsed it and know its component name
                    this.registerComponent(file, scope);
                }
            }

            return primaryFile;
        });
        return file as T;
    }

    /**
     * Given a srcPath, a destPath, or both, resolve whichever is missing, relative to rootDir.
     * @param fileParam an object representing file paths
     * @param rootDir must be a pre-normalized path
     */
    private getPaths(fileParam: string | FileObj, rootDir: string) {
        let srcPath: string;
        let destPath: string;

        assert.ok(fileParam, 'fileParam is required');

        //lift the path vars from the incoming param
        if (typeof fileParam === 'string') {
            fileParam = this.removePkgPrefix(fileParam);
            srcPath = s`${path.resolve(rootDir, fileParam)}`;
            destPath = s`${util.replaceCaseInsensitive(srcPath, rootDir, '')}`;
        } else {
            let param: any = fileParam;

            if (param.src) {
                srcPath = s`${param.src}`;
            }
            if (param.srcPath) {
                srcPath = s`${param.srcPath}`;
            }
            if (param.dest) {
                destPath = s`${this.removePkgPrefix(param.dest)}`;
            }
            if (param.pkgPath) {
                destPath = s`${this.removePkgPrefix(param.pkgPath)}`;
            }
        }

        //if there's no srcPath, use the destPath to build an absolute srcPath
        if (!srcPath) {
            srcPath = s`${rootDir}/${destPath}`;
        }
        //coerce srcPath to an absolute path
        if (!path.isAbsolute(srcPath)) {
            srcPath = util.standardizePath(srcPath);
        }

        //if destPath isn't set, compute it from the other paths
        if (!destPath) {
            destPath = s`${util.replaceCaseInsensitive(srcPath, rootDir, '')}`;
        }

        assert.ok(srcPath, 'fileEntry.src is required');
        assert.ok(destPath, 'fileEntry.dest is required');

        return {
            srcPath: srcPath,
            //remove leading slash
            destPath: destPath.replace(/^[\/\\]+/, '')
        };
    }

    /**
     * Remove any leading `pkg:/` found in the path
     */
    private removePkgPrefix(path: string) {
        return path.replace(/^pkg:\//i, '');
    }

    /**
     * Is this file a .brs file found somewhere within the `pkg:/source/` folder?
     */
    private isSourceBrsFile(file: File) {
        return !!/^(pkg:\/)?source[\/\\]/.exec(file.destPath);
    }

    /**
     * Is this file a .brs file found somewhere within the `pkg:/source/` folder?
     */
    private isComponentsXmlFile(file: File): file is XmlFile {
        return isXmlFile(file) && !!/^(pkg:\/)?components[\/\\]/.exec(file.destPath);
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
     * @param srcPath the absolute path to the file
     * @deprecated use `getFile` instead, which auto-detects the path type
     */
    public getFileByPathAbsolute<T extends File>(srcPath: string) {
        srcPath = s`${srcPath}`;
        for (let filePath in this.files) {
            if (filePath.toLowerCase() === srcPath.toLowerCase()) {
                return this.files[filePath] as T;
            }
        }
    }

    /**
     * Get a list of files for the given (platform-normalized) destPath array.
     * Missing files are just ignored.
     * @deprecated use `getFiles` instead, which auto-detects the path types
     */
    public getFilesByPkgPaths<T extends File[]>(destPaths: string[]) {
        return destPaths
            .map(destpath => this.getFileByPkgPath(destpath))
            .filter(file => file !== undefined) as T;
    }

    /**
     * Get a file with the specified (platform-normalized) destPath.
     * If not found, return undefined
     * @deprecated use `getFile` instead, which auto-detects the path type
     */
    public getFileByPkgPath<T extends File>(destPath: string) {
        return this.destMap.get(destPath.toLowerCase()) as T;
    }

    /**
     * Remove a set of files from the program
     * @param srcPaths can be an array of srcPath or destPath strings
     * @param normalizePath should this function repair and standardize the filePaths? Passing false should have a performance boost if you can guarantee your paths are already sanitized
     */
    public removeFiles(srcPaths: string[], normalizePath = true) {
        for (let srcPath of srcPaths) {
            this.removeFile(srcPath, normalizePath);
        }
    }

    /**
     * Remove a file from the program
     * @param filePath can be a srcPath, a destPath, or a destPath with leading `pkg:/`
     * @param normalizePath should this function repair and standardize the path? Passing false should have a performance boost if you can guarantee your path is already sanitized
     */
    public removeFile(filePath: string, normalizePath = true) {
        this.logger.debug('Program.removeFile()', filePath);
        const paths = this.getPaths(filePath, this.options.rootDir);

        //there can be one or more File entries for a single srcPath, so get all of them and remove them all
        const files = this.fileClusters.get(paths.srcPath?.toLowerCase()) ?? [this.getFile(filePath, normalizePath)];

        for (const file of files) {
            //if a file has already been removed, nothing more needs to be done here
            if (!file || !this.hasFile(file.srcPath)) {
                continue;
            }
            //deprecated. remove in v1
            this.plugins.emit('beforeFileDispose', file);

            const event: BeforeFileRemoveEvent = { file: file, program: this };
            this.plugins.emit('beforeFileRemove', event);

            //if there is a scope named the same as this file's path, remove it (i.e. xml scopes)
            let scope = this.scopes[file.destPath];
            if (scope) {
                this.plugins.emit('beforeScopeDispose', scope);
                scope.dispose();
                //notify dependencies of this scope that it has been removed
                this.dependencyGraph.remove(scope.dependencyGraphKey);
                delete this.scopes[file.destPath];
                this.plugins.emit('afterScopeDispose', scope);
            }
            //remove the file from the program
            this.unassignFile(file);

            this.dependencyGraph.remove(file.dependencyGraphKey);

            //if this is a pkg:/source file, notify the `source` scope that it has changed
            if (this.isSourceBrsFile(file)) {
                this.dependencyGraph.removeDependency('scope:source', file.dependencyGraphKey);
            }

            //if this is a component, remove it from our components map
            if (isXmlFile(file)) {
                this.unregisterComponent(file);
            }
            //dispose any disposable things on the file
            for (const disposable of file?.disposables ?? []) {
                disposable();
            }
            //dispose file
            file?.dispose?.();

            this.plugins.emit('afterFileRemove', event);

            //deprecated. remove in v1
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
                if (!this.fileIsIncludedInAnyScope(file) && (isBrsFile(file) || isXmlFile(file))) {
                    this.logger.debug('Program.validate(): fileNotReferenced by any scope', () => chalk.green(file?.destPath));
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
                    scope.linkSymbolTable();
                    scope.validate();
                    scope.unlinkSymbolTable();
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
    private fileIsIncludedInAnyScope(file: File) {
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
    public getFiles<T extends File>(filePaths: string[], normalizePath = true) {
        return filePaths
            .map(filePath => this.getFile(filePath, normalizePath))
            .filter(file => file !== undefined) as T[];
    }

    /**
     * Get the file at the given path
     * @param filePath can be a srcPath or a destPath
     * @param normalizePath should this function repair and standardize the path? Passing false should have a performance boost if you can guarantee your path is already sanitized
     */
    public getFile<T extends File>(filePath: string, normalizePath = true) {
        if (typeof filePath !== 'string') {
            return undefined;
            //is the path absolute (or the `virtual:` prefix)
        } else if (/^(?:(?:virtual:[\/\\])|(?:\w:)|(?:[\/\\]))/gmi.exec(filePath)) {
            return this.files[
                (normalizePath ? util.standardizePath(filePath) : filePath).toLowerCase()
            ] as T;
        } else {
            return this.destMap.get(
                (normalizePath ? util.standardizePath(filePath) : filePath).toLowerCase()
            ) as T;
        }
    }

    /**
     * Get a list of all scopes the file is loaded into
     * @param file the file
     */
    public getScopesForFile(file: File | string) {
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
                //skip non-brs files, or files we've already processed
                if (!isBrsFile(file) || filesSearched.has(file)) {
                    continue;
                }
                filesSearched.add(file);

                for (const statement of [...file.parser.references.functionStatements, ...file.parser.references.classStatements.flatMap((cs) => cs.methods)]) {
                    let parentNamespaceName = statement.findAncestor<NamespaceStatement>(isNamespaceStatement)?.getName(originFile.parseMode)?.toLowerCase();
                    if (statement.name.text.toLowerCase() === lowerName && (!lowerNamespaceName || parentNamespaceName === lowerNamespaceName)) {
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
            //skip non-brs files, or files we've already processed
            if (!isBrsFile(file) || filesSearched.has(file)) {
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

        //find the scopes for this file
        let scopes = this.getScopesForFile(file);

        //if there are no scopes, include the global scope so we at least get the built-in functions
        scopes = scopes.length > 0 ? scopes : [this.globalScope];

        const event: ProvideCompletionsEvent = {
            program: this,
            file: file,
            scopes: scopes,
            position: position,
            completions: []
        };

        this.plugins.emit('beforeProvideCompletions', event);

        this.plugins.emit('provideCompletions', event);

        this.plugins.emit('afterProvideCompletions', event);

        return event.completions;
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

    /**
     * Get hover information for a file and position
     */
    public getHover(srcPath: string, position: Position): Hover[] {
        let file = this.getFile(srcPath);
        let result: Hover[];
        if (file) {
            const event = {
                program: this,
                file: file,
                position: position,
                scopes: this.getScopesForFile(file),
                hovers: []
            } as ProvideHoverEvent;
            this.plugins.emit('beforeProvideHover', event);
            this.plugins.emit('provideHover', event);
            this.plugins.emit('afterProvideHover', event);
            result = event.hovers;
        }

        return result ?? [];
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
                .filter(x => util.rangesIntersectOrTouch(x.range, range));

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
        let callExpressionInfo = new CallExpressionInfo(file, position);
        let signatureHelpUtil = new SignatureHelpUtil();
        return signatureHelpUtil.getSignatureHelpItems(callExpressionInfo);
    }

    public getReferences(srcPath: string, position: Position) {
        //find the file
        let file = this.getFile(srcPath);
        if (isBrsFile(file) || isXmlFile(file)) {
            return file.getReferences(position);
        } else {
            return null;
        }
    }

    /**
     * Get a list of all script imports, relative to the specified destPath
     * @param sourceDestPath - the destPath of the source that wants to resolve script imports.
     */

    public getScriptImportCompletions(sourceDestPath: string, scriptImport: FileReference) {
        let lowerSourceDestPath = sourceDestPath.toLowerCase();

        let result = [] as CompletionItem[];
        /**
         * hashtable to prevent duplicate results
         */
        let resultDestPaths = {} as Record<string, boolean>;

        //restrict to only .brs files
        for (let key in this.files) {
            let file = this.files[key];
            const fileExtension = path.extname(file.destPath);
            if (
                //is a BrightScript or BrighterScript file
                (fileExtension === '.bs' || fileExtension === '.brs') &&
                //this file is not the current file
                lowerSourceDestPath !== file.destPath.toLowerCase()
            ) {
                //add the relative path
                const relativePath = util.getRelativePath(sourceDestPath, file.destPath).replace(/\\/g, '/');
                let fileDestPath = util.sanitizePkgPath(file.destPath);
                let fileDestPathLower = fileDestPath.toLowerCase();
                if (!resultDestPaths[fileDestPathLower]) {
                    resultDestPaths[fileDestPathLower] = true;

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
                        label: fileDestPath,
                        detail: file.srcPath,
                        kind: CompletionItemKind.File,
                        textEdit: {
                            newText: fileDestPath,
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
    public async getTranspiledFileContents(filePath: string, stagingDir?: string) { //TODO make this sync in v1
        const { entries, astEditor } = this.beforeProgramTranspile(stagingDir);
        const result = this._getTranspiledFileContents(
            this.getFile(filePath)
        );
        this.afterProgramTranspile(entries, astEditor);
        return Promise.resolve(result);
    }

    /**
     * Internal function used to transpile files.
     * This does not write anything to the file system
     */
    private _getTranspiledFileContents(file: File, outputPath?: string): FileTranspileResult {
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
        const result = (file as BrsFile)?.transpile?.();

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
            destPath: file.destPath,
            pkgPath: file.pkgPath,
            code: event.code,
            map: event.map,
            typedef: event.typedef
        };
    }

    /**
     * Get the absolute output path for a file
     */
    private getOutputPath(file: File, stagingDir = this.stagingDir1) {
        return s`${stagingDir}/${file.pkgPath}`;
    }

    private get stagingDir1() {
        const result = this.options.stagingDir ?? this.options.stagingFolderPath;
        if (result) {
            return result;
        }
        if (!this._stagingDir) {
            this._stagingDir = rokuDeploy.getOptions(this.options as any).stagingDir;
        }
        return this._stagingDir;
    }
    private _stagingDir;

    private beforeProgramTranspile(stagingDir?: string) {

        const entries = Object.values(this.files).map(file => {
            return {
                file: file,
                outputPath: this.getOutputPath(file, stagingDir)
            };
        });

        const astEditor = new AstEditor();

        this.plugins.emit('beforeProgramTranspile', this, entries, astEditor);
        return {
            entries: entries,
            astEditor: astEditor
        };
    }

    /**
     * @deprecated None of these parameters are used anymore
     */
    public async transpile(fileEntries: FileObj[], stagingDir: string);
    /**
     * Transpile the entire program
     */
    public async transpile(options?: { stagingDir?: string });
    public async transpile(...args: any[]) {
        //support for legacy function signature and the object signature
        let stagingDir: string;
        if (Array.isArray(args[0])) {
            stagingDir = args[1] ?? this.stagingDir1;
        } else {
            stagingDir = args[0]?.stagingDir ?? this.stagingDir1;
        }

        const { entries, astEditor } = this.beforeProgramTranspile(stagingDir);

        const processedFiles = new Set<string>();

        const transpileFile = async (srcPath: string, outputPath?: string) => {
            //find the file in the program
            const file = this.getFile(srcPath);
            //mark this file as processed so we don't process it more than once
            processedFiles.add(outputPath?.toLowerCase());

            //skip transpiling typedef files
            if (isBrsFile(file) && file.isTypedef) {
                return;
            }

            const fileTranspileResult = this._getTranspiledFileContents(file, outputPath);

            //make sure the full dir path exists
            await fsExtra.ensureDir(path.dirname(outputPath));

            if (await fsExtra.pathExists(outputPath)) {
                throw new Error(`Error while transpiling "${file.srcPath}".A file already exists at "${outputPath}" and will not be overwritten.`);
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
        if (!this.getFile(bslibAliasedRokuModulesPkgPath) && !this.getFile(s`source / bslib.brs`)) {
            promises.push(util.copyBslibToStaging(stagingDir));
        }
        await Promise.all(promises);

        //transpile any new files that plugins added since the start of this transpile process
        do {
            promises = [];
            for (const key in this.files) {
                const file = this.files[key];
                //this is a new file
                const outputPath = this.getOutputPath(file, stagingDir);
                if (!processedFiles.has(outputPath?.toLowerCase())) {
                    promises.push(
                        transpileFile(file?.srcPath, outputPath)
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
        const files = [] as File[];
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
        const files = [] as File[];
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
        const files = [] as File[];
        const lowerName = name.toLowerCase();
        //find every file with this class defined
        for (const file of Object.values(this.files)) {
            if (isBrsFile(file)) {
                if (file.parser.references.namespaceStatements.find((x) => {
                    const namespaceName = x.name.toLowerCase();
                    return (
                        //the namespace name matches exactly
                        namespaceName === lowerName ||
                        //the full namespace starts with the name (honoring the part boundary)
                        namespaceName.startsWith(lowerName + '.')
                    );
                })) {
                    files.push(file);
                }
            }
        }
        return files;
    }

    public findFilesForEnum(name: string) {
        const files = [] as File[];
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
            this.files[filePath]?.dispose?.();
        }
        for (let name in this.scopes) {
            this.scopes[name]?.dispose?.();
        }
        this.globalScope?.dispose?.();
        this.dependencyGraph?.dispose?.();
    }
}

export interface FileTranspileResult {
    srcPath: string;
    destPath: string;
    pkgPath: string;
    code: string;
    map: SourceMapGenerator;
    typedef: string;
}

export type FileData = string | Buffer | (() => Buffer | string);

class ProvideFileEventInternal<TFile extends File = File> implements ProvideFileEvent<TFile> {
    constructor(
        public program: Program,
        public srcPath: string,
        public destPath: string,
        private initialData: FileData,
        public fileFactory: FileFactory
    ) {
        this.srcExtension = path.extname(srcPath)?.toLowerCase();
    }

    public srcExtension: string;

    public files: TFile[] = [];

    public getFileData() {
        if (!this._fileData) {
            let result: any;
            if (typeof this.initialData === 'string') {
                result = Buffer.from(this.initialData);
            } else if (typeof this.initialData === 'function') {
                result = this.initialData();
                if (typeof result === 'string') {
                    result = Buffer.from(result);
                }
            }
            this._fileData = result;
        }
        return this._fileData;
    }

    public setFileData(fileData: FileData) {
        //override the outer data object, and delete any cache so it'll get re-resolved next time `getFileData` is called
        this.initialData = fileData;
        delete this._fileData;
    }
    private _fileData: Buffer;
}
