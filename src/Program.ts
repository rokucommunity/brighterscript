import * as assert from 'assert';
import * as fsExtra from 'fs-extra';
import * as path from 'path';
import type { CodeAction, Position, Range, SignatureInformation, Location, DocumentSymbol } from 'vscode-languageserver';
import type { BsConfig, FinalizedBsConfig } from './BsConfig';
import { Scope } from './Scope';
import { DiagnosticMessages } from './DiagnosticMessages';
import type { FileObj, SemanticToken, FileLink, ProvideHoverEvent, ProvideCompletionsEvent, Hover, ProvideDefinitionEvent, ProvideReferencesEvent, ProvideDocumentSymbolsEvent, ProvideWorkspaceSymbolsEvent, BeforeFileAddEvent, BeforeFileRemoveEvent, PrepareFileEvent, PrepareProgramEvent, ProvideFileEvent, SerializedFile, TranspileObj, SerializeFileEvent } from './interfaces';
import { standardizePath as s, util } from './util';
import { XmlScope } from './XmlScope';
import { DependencyGraph } from './DependencyGraph';
import type { Logger } from './logging';
import { LogLevel, createLogger } from './logging';
import chalk from 'chalk';
import { globalCallables, globalFile } from './globalCallables';
import { parseManifest, getBsConst } from './preprocessor/Manifest';
import { URI } from 'vscode-uri';
import PluginInterface from './PluginInterface';
import { isBrsFile, isXmlFile, isXmlScope, isNamespaceStatement } from './astUtils/reflection';
import type { FunctionStatement, MethodStatement, NamespaceStatement } from './parser/Statement';
import { BscPlugin } from './bscPlugin/BscPlugin';
import { Editor } from './astUtils/Editor';
import type { Statement } from './parser/AstNode';
import { CallExpressionInfo } from './bscPlugin/CallExpressionInfo';
import { SignatureHelpUtil } from './bscPlugin/SignatureHelpUtil';
import { IntegerType } from './types/IntegerType';
import { StringType } from './types/StringType';
import { SymbolTypeFlag } from './SymbolTypeFlag';
import { BooleanType } from './types/BooleanType';
import { DoubleType } from './types/DoubleType';
import { DynamicType } from './types/DynamicType';
import { FloatType } from './types/FloatType';
import { LongIntegerType } from './types/LongIntegerType';
import { ObjectType } from './types/ObjectType';
import { VoidType } from './types/VoidType';
import { FunctionType } from './types/FunctionType';
import { FileFactory } from './files/Factory';
import { ActionPipeline } from './ActionPipeline';
import type { FileData } from './files/LazyFileData';
import { LazyFileData } from './files/LazyFileData';
import { rokuDeploy } from 'roku-deploy';
import type { SGNodeData, BRSComponentData, BRSEventData, BRSInterfaceData } from './roku-types';
import { nodes, components, interfaces, events } from './roku-types';
import { ComponentType } from './types/ComponentType';
import { InterfaceType } from './types/InterfaceType';
import { BuiltInInterfaceAdder } from './types/BuiltInInterfaceAdder';
import type { UnresolvedSymbol } from './AstValidationSegmenter';
import { WalkMode, createVisitor } from './astUtils/visitors';
import type { BscFile } from './files/BscFile';
import { Stopwatch } from './Stopwatch';
import { firstBy } from 'thenby';
import { CrossScopeValidator } from './CrossScopeValidator';
import { DiagnosticManager } from './DiagnosticManager';
import { ProgramValidatorDiagnosticsTag } from './bscPlugin/validation/ProgramValidator';
import type { ProvidedSymbolInfo, BrsFile } from './files/BrsFile';
import type { XmlFile } from './files/XmlFile';

const bslibNonAliasedRokuModulesPkgPath = s`source/roku_modules/rokucommunity_bslib/bslib.brs`;
const bslibAliasedRokuModulesPkgPath = s`source/roku_modules/bslib/bslib.brs`;

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
        options: BsConfig,
        logger?: Logger,
        plugins?: PluginInterface,
        diagnosticsManager?: DiagnosticManager
    ) {
        this.options = util.normalizeConfig(options);
        this.logger = logger ?? createLogger(options);
        this.plugins = plugins || new PluginInterface([], { logger: this.logger });
        this.diagnostics = diagnosticsManager || new DiagnosticManager();

        // initialize the diagnostics Manager
        this.diagnostics.logger = this.logger;
        this.diagnostics.options = this.options;
        this.diagnostics.program = this;

        //inject the bsc plugin as the first plugin in the stack.
        this.plugins.addFirst(new BscPlugin());

        //normalize the root dir path
        this.options.rootDir = util.getRootDir(this.options);

        this.createGlobalScope();

        this.fileFactory = new FileFactory(this);
    }

    public options: FinalizedBsConfig;
    public logger: Logger;

    /**
     * An editor that plugins can use to modify program-level things during the build flow. Don't use this to edit files (they have their own `.editor`)
     */
    public editor = new Editor();

    /**
     * A factory that creates `File` instances
     */
    private fileFactory: FileFactory;

    private createGlobalScope() {
        //create the 'global' scope
        this.globalScope = new Scope('global', this, 'scope:global');
        this.globalScope.attachDependencyGraph(this.dependencyGraph);
        this.scopes.global = this.globalScope;

        this.populateGlobalSymbolTable();

        //hardcode the files list for global scope to only contain the global file
        this.globalScope.getAllFiles = () => [globalFile];
        globalFile.isValidated = true;
        this.globalScope.validate();

        //TODO we might need to fix this because the isValidated clears stuff now
        (this.globalScope as any).isValidated = true;
    }


    private recursivelyAddNodeToSymbolTable(nodeData: SGNodeData) {
        if (!nodeData) {
            return;
        }
        let nodeType: ComponentType;
        const nodeName = util.getSgNodeTypeName(nodeData.name);
        if (!this.globalScope.symbolTable.hasSymbol(nodeName, SymbolTypeFlag.typetime)) {
            let parentNode: ComponentType;
            if (nodeData.extends) {
                const parentNodeData = nodes[nodeData.extends.name.toLowerCase()];
                try {
                    parentNode = this.recursivelyAddNodeToSymbolTable(parentNodeData);
                } catch (error) {
                    this.logger.error(error, nodeData);
                }
            }
            nodeType = new ComponentType(nodeData.name, parentNode);
            nodeType.addBuiltInInterfaces();
            if (nodeData.name === 'Node') {
                // Add `roSGNode` as shorthand for `roSGNodeNode`
                this.globalScope.symbolTable.addSymbol('roSGNode', { description: nodeData.description }, nodeType, SymbolTypeFlag.typetime);
            }
            this.globalScope.symbolTable.addSymbol(nodeName, { description: nodeData.description }, nodeType, SymbolTypeFlag.typetime);
        } else {
            nodeType = this.globalScope.symbolTable.getSymbolType(nodeName, { flags: SymbolTypeFlag.typetime }) as ComponentType;
        }

        return nodeType;
    }
    /**
     * Do all setup required for the global symbol table.
     */
    private populateGlobalSymbolTable() {
        //Setup primitive types in global symbolTable

        this.globalScope.symbolTable.addSymbol('boolean', undefined, BooleanType.instance, SymbolTypeFlag.typetime);
        this.globalScope.symbolTable.addSymbol('double', undefined, DoubleType.instance, SymbolTypeFlag.typetime);
        this.globalScope.symbolTable.addSymbol('dynamic', undefined, DynamicType.instance, SymbolTypeFlag.typetime);
        this.globalScope.symbolTable.addSymbol('float', undefined, FloatType.instance, SymbolTypeFlag.typetime);
        this.globalScope.symbolTable.addSymbol('function', undefined, new FunctionType(), SymbolTypeFlag.typetime);
        this.globalScope.symbolTable.addSymbol('integer', undefined, IntegerType.instance, SymbolTypeFlag.typetime);
        this.globalScope.symbolTable.addSymbol('longinteger', undefined, LongIntegerType.instance, SymbolTypeFlag.typetime);
        this.globalScope.symbolTable.addSymbol('object', undefined, new ObjectType(), SymbolTypeFlag.typetime);
        this.globalScope.symbolTable.addSymbol('string', undefined, StringType.instance, SymbolTypeFlag.typetime);
        this.globalScope.symbolTable.addSymbol('void', undefined, VoidType.instance, SymbolTypeFlag.typetime);

        BuiltInInterfaceAdder.getLookupTable = () => this.globalScope.symbolTable;

        for (const callable of globalCallables) {
            this.globalScope.symbolTable.addSymbol(callable.name, { description: callable.shortDescription }, callable.type, SymbolTypeFlag.runtime);
        }

        for (const ifaceData of Object.values(interfaces) as BRSInterfaceData[]) {
            const nodeType = new InterfaceType(ifaceData.name);
            nodeType.addBuiltInInterfaces();
            this.globalScope.symbolTable.addSymbol(ifaceData.name, { description: ifaceData.description }, nodeType, SymbolTypeFlag.typetime);
        }

        for (const componentData of Object.values(components) as BRSComponentData[]) {
            const nodeType = new InterfaceType(componentData.name);
            nodeType.addBuiltInInterfaces();
            if (componentData.name !== 'roSGNode') {
                // we will add `roSGNode` as shorthand for `roSGNodeNode`, since all roSgNode components are SceneGraph nodes
                this.globalScope.symbolTable.addSymbol(componentData.name, { description: componentData.description }, nodeType, SymbolTypeFlag.typetime);
            }
        }

        for (const nodeData of Object.values(nodes) as SGNodeData[]) {
            this.recursivelyAddNodeToSymbolTable(nodeData);
        }

        for (const eventData of Object.values(events) as BRSEventData[]) {
            const nodeType = new InterfaceType(eventData.name);
            nodeType.addBuiltInInterfaces();
            this.globalScope.symbolTable.addSymbol(eventData.name, { description: eventData.description }, nodeType, SymbolTypeFlag.typetime);
        }

    }

    /**
     * A graph of all files and their dependencies.
     * For example:
     *      File.xml -> [lib1.brs, lib2.brs]
     *      lib2.brs -> [lib3.brs] //via an import statement
     */
    private dependencyGraph = new DependencyGraph();

    public diagnostics: DiagnosticManager;

    /**
     * A scope that contains all built-in global functions.
     * All scopes should directly or indirectly inherit from this scope
     */
    public globalScope: Scope = undefined as any;

    /**
     * Plugins which can provide extra diagnostics or transform AST
     */
    public plugins: PluginInterface;

    private fileSymbolInformation = new Map<string, { provides: ProvidedSymbolInfo; requires: UnresolvedSymbol[] }>();

    public addFileSymbolInfo(file: BrsFile) {
        this.fileSymbolInformation.set(file.pkgPath, {
            provides: file.providedSymbols,
            requires: file.requiredSymbols
        });
    }

    public getFileSymbolInfo(file: BrsFile) {
        return this.fileSymbolInformation.get(file.pkgPath);
    }

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
            return `${this.options.bslibDestinationDir}${path.sep}bslib.brs`;
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
    /**
     * A map of every file loaded into this program, indexed by its destPath
     */
    private destMap = new Map<string, BscFile>();
    /**
     * Plugins can contribute multiple virtual files for a single physical file.
     * This collection links the virtual files back to the physical file that produced them.
     * The key is the standardized and lower-cased srcPath
     */
    private fileClusters = new Map<string, BscFile[]>();

    private scopes = {} as Record<string, Scope>;

    protected addScope(scope: Scope) {
        this.scopes[scope.name] = scope;
        delete this.sortedScopeNames;
    }

    protected removeScope(scope: Scope) {
        if (this.scopes[scope.name]) {
            delete this.scopes[scope.name];
            delete this.sortedScopeNames;
        }
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
     * Get the sorted names of custom components
     */
    public getSortedComponentNames() {
        const componentNames = Object.keys(this.components);
        componentNames.sort((a, b) => {
            if (a < b) {
                return -1;
            } else if (b < a) {
                return 1;
            }
            return 0;
        });
        return componentNames;
    }

    /**
     * Keeps a set of all the components that need to have their types updated during the current validation cycle
     */
    private componentSymbolsToUpdate = new Set<{ componentKey: string; componentName: string }>();

    /**
     * Register (or replace) the reference to a component in the component map
     */
    private registerComponent(xmlFile: XmlFile, scope: XmlScope) {
        const key = this.getComponentKey(xmlFile);
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
        this.addDeferredComponentTypeSymbolCreation(xmlFile);
    }

    /**
     * Remove the specified component from the components map
     */
    private unregisterComponent(xmlFile: XmlFile) {
        const key = this.getComponentKey(xmlFile);
        const arr = this.components[key] || [];
        for (let i = 0; i < arr.length; i++) {
            if (arr[i].file === xmlFile) {
                arr.splice(i, 1);
                break;
            }
        }

        this.syncComponentDependencyGraph(arr);
        this.addDeferredComponentTypeSymbolCreation(xmlFile);
    }

    /**
     * Adds a component described in an XML to the set of components that needs to be updated this validation cycle.
     * @param xmlFile XML file with <component> tag
     */
    private addDeferredComponentTypeSymbolCreation(xmlFile: XmlFile) {
        this.componentSymbolsToUpdate.add({ componentKey: this.getComponentKey(xmlFile), componentName: xmlFile.componentName?.text });

    }

    private getComponentKey(xmlFile: XmlFile) {
        return (xmlFile.componentName?.text ?? xmlFile.pkgPath).toLowerCase();
    }

    /**
     * Updates the global symbol table with the first component in this.components to have the same name as the component in the file
     * @param componentKey key getting a component from `this.components`
     * @param componentName the unprefixed name of the component that will be added (e.g. 'MyLabel' NOT 'roSgNodeMyLabel')
     */
    private updateComponentSymbolInGlobalScope(componentKey: string, componentName: string) {
        const symbolName = componentName ? util.getSgNodeTypeName(componentName) : undefined;
        if (!symbolName) {
            return;
        }
        const components = this.components[componentKey] || [];
        // Remove any existing symbols that match
        this.globalScope.symbolTable.removeSymbol(symbolName);
        // There is a component that can be added - use it.
        if (components.length > 0) {
            const componentScope = components[0].scope;
            // TODO: May need to link symbol tables to get correct types for callfuncs
            // componentScope.linkSymbolTable();
            const componentType = componentScope.getComponentType();
            if (componentType) {
                this.globalScope.symbolTable.addSymbol(symbolName, {}, componentType, SymbolTypeFlag.typetime);
            }
            // TODO: Remember to unlink! componentScope.unlinkSymbolTable();
        }
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
        let result = [] as BscFile[];
        for (let filePath in this.files) {
            let file = this.files[filePath];
            //is this file part of a scope
            if (!this.getFirstScopeForFile(file)) {
                //no scopes reference this file. add it to the list
                result.push(file);
            }
        }
        return result;
    }

    /**
     * Get the list of errors for the entire program.
     */
    public getDiagnostics() {
        return this.diagnostics.getDiagnostics();
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
    public getScopeByName(scopeName: string): Scope | undefined {
        if (!scopeName) {
            return undefined;
        }
        //most scopes are xml file pkg paths. however, the ones that are not are single names like "global" and "scope",
        //so it's safe to run the standardizePkgPath method
        scopeName = s`${scopeName}`;
        let key = Object.keys(this.scopes).find(x => x.toLowerCase() === scopeName.toLowerCase());
        return this.scopes[key!];
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
    private unassignFile<T extends BscFile = BscFile>(file: T) {
        delete this.files[file.srcPath.toLowerCase()];
        this.destMap.delete(file.destPath.toLowerCase());
        return file;
    }

    /**
     * Load a file into the program. If that file already exists, it is replaced.
     * If file contents are provided, those are used, Otherwise, the file is loaded from the file system
     * @param srcDestOrPkgPath the absolute path, the pkg path (i.e. `pkg:/path/to/file.brs`), or the destPath (i.e. `path/to/file.brs` relative to `pkg:/`)
     * @param fileData the file contents. omit or pass `undefined` to prevent loading the data at this time
     */
    public setFile<T extends BscFile>(srcDestOrPkgPath: string, fileData?: FileData): T;
    /**
     * Load a file into the program. If that file already exists, it is replaced.
     * @param fileEntry an object that specifies src and dest for the file.
     * @param fileData the file contents. omit or pass `undefined` to prevent loading the data at this time
     */
    public setFile<T extends BscFile>(fileEntry: FileObj, fileData: FileData): T;
    public setFile<T extends BscFile>(fileParam: FileObj | string, fileData: FileData): T {
        //normalize the file paths
        const { srcPath, destPath } = this.getPaths(fileParam, this.options.rootDir);

        let file = this.logger.time(LogLevel.debug, ['Program.setFile()', chalk.green(srcPath)], () => {
            //if the file is already loaded, remove it
            if (this.hasFile(srcPath)) {
                this.removeFile(srcPath, true, true);
            }

            const data = new LazyFileData(fileData);

            const event = new ProvideFileEventInternal(this, srcPath, destPath, data, this.fileFactory);

            this.plugins.emit('beforeProvideFile', event);
            this.plugins.emit('provideFile', event);
            this.plugins.emit('afterProvideFile', event);

            //if no files were provided, create a AssetFile to represent it.
            if (event.files.length === 0) {
                event.files.push(
                    this.fileFactory.AssetFile({
                        srcPath: event.srcPath,
                        destPath: event.destPath,
                        pkgPath: event.destPath,
                        data: data
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

                    //notify plugins that the scope is created and the component is registered
                    this.plugins.emit('afterScopeCreate', {
                        program: this,
                        scope: scope
                    });
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
    private getPaths(fileParam: string | FileObj | { srcPath?: string; pkgPath?: string }, rootDir: string) {
        let srcPath: string | undefined;
        let destPath: string | undefined;

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
    private isSourceBrsFile(file: BscFile) {
        return !!/^(pkg:\/)?source[\/\\]/.exec(file.destPath);
    }

    /**
     * Is this file a .brs file found somewhere within the `pkg:/source/` folder?
     */
    private isComponentsXmlFile(file: BscFile): file is XmlFile {
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
            this.plugins.emit('afterScopeCreate', {
                program: this,
                scope: sourceScope
            });
        }
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
    public removeFile(filePath: string, normalizePath = true, keepSymbolInformation = false) {
        this.logger.debug('Program.removeFile()', filePath);
        const paths = this.getPaths(filePath, this.options.rootDir);

        //there can be one or more File entries for a single srcPath, so get all of them and remove them all
        const files = this.fileClusters.get(paths.srcPath?.toLowerCase()) ?? [this.getFile(filePath, normalizePath)];

        for (const file of files) {
            //if a file has already been removed, nothing more needs to be done here
            if (!file || !this.hasFile(file.srcPath)) {
                continue;
            }
            this.diagnostics.clearForFile(file.srcPath);

            const event: BeforeFileRemoveEvent = { file: file, program: this };
            this.plugins.emit('beforeFileRemove', event);

            //if there is a scope named the same as this file's path, remove it (i.e. xml scopes)
            let scope = this.scopes[file.destPath];
            if (scope) {
                const scopeDisposeEvent = {
                    program: this,
                    scope: scope
                };
                this.plugins.emit('beforeScopeDispose', scopeDisposeEvent);
                this.plugins.emit('onScopeDispose', scopeDisposeEvent);
                scope.dispose();
                //notify dependencies of this scope that it has been removed
                this.dependencyGraph.remove(scope.dependencyGraphKey!);
                this.removeScope(this.scopes[file.destPath]);
                this.plugins.emit('afterScopeDispose', scopeDisposeEvent);
            }
            //remove the file from the program
            this.unassignFile(file);

            this.dependencyGraph.remove(file.dependencyGraphKey);

            //if this is a pkg:/source file, notify the `source` scope that it has changed
            if (this.isSourceBrsFile(file)) {
                this.dependencyGraph.removeDependency('scope:source', file.dependencyGraphKey);
            }
            if (isBrsFile(file)) {
                if (!keepSymbolInformation) {
                    this.fileSymbolInformation.delete(file.pkgPath);
                }
                this.crossScopeValidation.clearResolutionsForFile(file);
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
        }
    }

    public crossScopeValidation = new CrossScopeValidator(this);

    private isFirstValidation = true;

    /**
     * Traverse the entire project, and validate all scopes
     */
    public validate() {
        this.logger.time(LogLevel.log, ['Validating project'], () => {
            this.diagnostics.clearForTag(ProgramValidatorDiagnosticsTag);
            const programValidateEvent = {
                program: this
            };
            this.plugins.emit('beforeProgramValidate', programValidateEvent);
            this.plugins.emit('onProgramValidate', programValidateEvent);

            const metrics = {
                filesChanged: 0,
                filesValidated: 0,
                fileValidationTime: '',
                crossScopeValidationTime: '',
                scopesValidated: 0,
                totalLinkTime: '',
                totalScopeValidationTime: '',
                componentValidationTime: ''
            };

            const validationStopwatch = new Stopwatch();
            //validate every file
            const brsFilesValidated: BrsFile[] = [];
            const afterValidateFiles: BscFile[] = [];

            metrics.fileValidationTime = validationStopwatch.getDurationTextFor(() => {
                //sort files by path so we get consistent results
                const files = Object.values(this.files).sort(firstBy(x => x.srcPath));
                for (const file of files) {
                    //for every unvalidated file, validate it
                    if (!file.isValidated) {
                        const validateFileEvent = {
                            program: this,
                            file: file
                        };
                        this.plugins.emit('beforeFileValidate', validateFileEvent);
                        //emit an event to allow plugins to contribute to the file validation process
                        this.plugins.emit('onFileValidate', validateFileEvent);
                        file.isValidated = true;
                        if (isBrsFile(file)) {
                            brsFilesValidated.push(file);
                        }
                        afterValidateFiles.push(file);
                    }
                }
                // AfterFileValidate is after all files have been validated
                for (const file of afterValidateFiles) {
                    const validateFileEvent = {
                        program: this,
                        file: file
                    };
                    this.plugins.emit('afterFileValidate', validateFileEvent);
                }
            }).durationText;

            metrics.filesChanged = afterValidateFiles.length;

            // Build component types for any component that changes
            this.logger.time(LogLevel.info, ['Build component types'], () => {
                for (let { componentKey, componentName } of this.componentSymbolsToUpdate) {
                    this.updateComponentSymbolInGlobalScope(componentKey, componentName);
                }
                this.componentSymbolsToUpdate.clear();
            });


            const changedSymbolsMapArr = brsFilesValidated?.map(f => {
                if (isBrsFile(f)) {
                    return f.providedSymbols.changes;
                }
                return null;
            }).filter(x => x);

            const changedSymbols = new Map<SymbolTypeFlag, Set<string>>();
            for (const flag of [SymbolTypeFlag.runtime, SymbolTypeFlag.typetime]) {
                const changedSymbolsSetArr = changedSymbolsMapArr.map(symMap => symMap.get(flag));
                changedSymbols.set(flag, new Set(...changedSymbolsSetArr));
            }

            const filesToBeValidatedInScopeContext = new Set<BscFile>(afterValidateFiles);

            metrics.crossScopeValidationTime = validationStopwatch.getDurationTextFor(() => {
                const scopesToCheck = this.getScopesForCrossScopeValidation();
                this.crossScopeValidation.buildComponentsMap();
                this.crossScopeValidation.addDiagnosticsForScopes(scopesToCheck);
                const filesToRevalidate = this.crossScopeValidation.getFilesRequiringChangedSymbol(scopesToCheck, changedSymbols);
                for (const file of filesToRevalidate) {
                    filesToBeValidatedInScopeContext.add(file);
                }
            }).durationText;

            metrics.filesValidated = filesToBeValidatedInScopeContext.size;

            let linkTime = 0;
            let validationTime = 0;
            let scopesValidated = 0;
            let changedFiles = new Set<BscFile>(afterValidateFiles);
            this.logger.time(LogLevel.info, ['Validate all scopes'], () => {
                //sort the scope names so we get consistent results
                const scopeNames = this.getSortedScopeNames();
                for (const file of filesToBeValidatedInScopeContext) {
                    if (isBrsFile(file)) {
                        file.validationSegmenter.unValidateAllSegments();
                    }
                }
                for (let scopeName of scopeNames) {
                    let scope = this.scopes[scopeName];
                    const scopeValidated = scope.validate({
                        filesToBeValidatedInScopeContext: filesToBeValidatedInScopeContext,
                        changedSymbols: changedSymbols,
                        changedFiles: changedFiles,
                        initialValidation: this.isFirstValidation
                    });
                    if (scopeValidated) {
                        scopesValidated++;
                    }
                    linkTime += scope.validationMetrics.linkTime;
                    validationTime += scope.validationMetrics.validationTime;
                }
            });
            metrics.scopesValidated = scopesValidated;
            validationStopwatch.totalMilliseconds = linkTime;
            metrics.totalLinkTime = validationStopwatch.getDurationText();

            validationStopwatch.totalMilliseconds = validationTime;
            metrics.totalScopeValidationTime = validationStopwatch.getDurationText();

            metrics.componentValidationTime = validationStopwatch.getDurationTextFor(() => {
                this.detectDuplicateComponentNames();
            }).durationText;

            this.logValidationMetrics(metrics);

            this.isFirstValidation = false;

            this.plugins.emit('afterProgramValidate', programValidateEvent);
        });
    }

    // eslint-disable-next-line @typescript-eslint/consistent-indexed-object-style
    private logValidationMetrics(metrics: { [key: string]: number | string }) {
        let logs = [] as string[];
        for (const key in metrics) {
            logs.push(`${key}=${chalk.yellow(metrics[key].toString())}`);
        }
        this.logger.info(`Validation Metrics: ${logs.join(', ')}`);
    }

    private getScopesForCrossScopeValidation() {
        const scopesForCrossScopeValidation = [];
        for (let scopeName of this.getSortedScopeNames()) {
            let scope = this.scopes[scopeName];
            if (this.globalScope !== scope && !scope.isValidated) {
                scopesForCrossScopeValidation.push(scope);
            }
        }
        return scopesForCrossScopeValidation;
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
                    this.diagnostics.register({
                        ...DiagnosticMessages.duplicateComponentName(componentName.text),
                        location: xmlFile.componentName.location,
                        relatedInformation: xmlFiles.filter(x => x !== xmlFile).map(x => {
                            return {
                                location: x.componentName.location,
                                message: 'Also defined here'
                            };
                        })
                    }, { tags: [ProgramValidatorDiagnosticsTag] });
                }
            }
        }
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
            //is the path absolute (or the `virtual:` prefix)
        } else if (/^(?:(?:virtual:[\/\\])|(?:\w:)|(?:[\/\\]))/gmi.exec(filePath)) {
            return this.files[
                (normalizePath ? util.standardizePath(filePath) : filePath).toLowerCase()
            ] as T;
        } else if (util.isUriLike(filePath)) {
            const path = URI.parse(filePath).fsPath;
            return this.files[
                (normalizePath ? util.standardizePath(path) : path).toLowerCase()
            ] as T;
        } else {
            return this.destMap.get(
                (normalizePath ? util.standardizePath(filePath) : filePath).toLowerCase()
            ) as T;
        }
    }

    private sortedScopeNames: string[] = undefined;

    /**
     * Gets a sorted list of all scopeNames, always beginning with "global", "source", then any others in alphabetical order
     */
    private getSortedScopeNames() {
        if (!this.sortedScopeNames) {
            this.sortedScopeNames = Object.keys(this.scopes).sort((a, b) => {
                if (a === 'global') {
                    return -1;
                } else if (b === 'global') {
                    return 1;
                }
                if (a === 'source') {
                    return -1;
                } else if (b === 'source') {
                    return 1;
                }
                if (a < b) {
                    return -1;
                } else if (b < a) {
                    return 1;
                }
                return 0;
            });
        }
        return this.sortedScopeNames;
    }

    /**
     * Get a list of all scopes the file is loaded into
     * @param file the file
     */
    public getScopesForFile(file: BscFile | string) {
        const resolvedFile = typeof file === 'string' ? this.getFile(file) : file;

        let result = [] as Scope[];
        if (resolvedFile) {
            const scopeKeys = this.getSortedScopeNames();
            for (let key of scopeKeys) {
                let scope = this.scopes[key];

                if (scope.hasFile(resolvedFile)) {
                    result.push(scope);
                }
            }
        }
        return result;
    }

    /**
     * Get the first found scope for a file.
     */
    public getFirstScopeForFile(file: BscFile): Scope | undefined {
        const scopeKeys = this.getSortedScopeNames();
        for (let key of scopeKeys) {
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

        function addToResults(statement: FunctionStatement | MethodStatement, file: BrsFile) {
            let parentNamespaceName = statement.findAncestor<NamespaceStatement>(isNamespaceStatement)?.getName(originFile.parseMode)?.toLowerCase();
            if (statement.tokens.name.text.toLowerCase() === lowerName && (!lowerNamespaceName || parentNamespaceName === lowerNamespaceName)) {
                if (!results.has(statement)) {
                    results.set(statement, { item: statement, file: file as BrsFile });
                }
            }
        }

        //look through all files in scope for matches
        for (const scope of this.getScopesForFile(originFile)) {
            for (const file of scope.getAllFiles()) {
                //skip non-brs files, or files we've already processed
                if (!isBrsFile(file) || filesSearched.has(file)) {
                    continue;
                }
                filesSearched.add(file);

                file.ast.walk(createVisitor({
                    FunctionStatement: (statement: FunctionStatement) => {
                        addToResults(statement, file);
                    },
                    MethodStatement: (statement: MethodStatement) => {
                        addToResults(statement, file);
                    }
                }), {
                    walkMode: WalkMode.visitStatements
                });
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
            for (let name of currentScope.xmlFile.ast.componentElement.interfaceElement?.functions.map((f) => f.name) ?? []) {
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

            file.ast.walk(createVisitor({
                FunctionStatement: (statement: FunctionStatement) => {
                    if (funcNames.has(statement.tokens.name.text)) {
                        if (!results.has(statement)) {
                            results.set(statement, { item: statement, file: file });
                        }
                    }
                }
            }), {
                walkMode: WalkMode.visitStatements
            });
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
        const event: ProvideWorkspaceSymbolsEvent = {
            program: this,
            workspaceSymbols: []
        };
        this.plugins.emit('beforeProvideWorkspaceSymbols', event);
        this.plugins.emit('provideWorkspaceSymbols', event);
        this.plugins.emit('afterProvideWorkspaceSymbols', event);
        return event.workspaceSymbols;
    }

    /**
     * Given a position in a file, if the position is sitting on some type of identifier,
     * go to the definition of that identifier (where this thing was first defined)
     */
    public getDefinition(srcPath: string, position: Position): Location[] {
        let file = this.getFile(srcPath);
        if (!file) {
            return [];
        }

        const event: ProvideDefinitionEvent = {
            program: this,
            file: file,
            position: position,
            definitions: []
        };

        this.plugins.emit('beforeProvideDefinition', event);
        this.plugins.emit('provideDefinition', event);
        this.plugins.emit('afterProvideDefinition', event);
        return event.definitions;
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
     * Get full list of document symbols for a file
     * @param srcPath path to the file
     */
    public getDocumentSymbols(srcPath: string): DocumentSymbol[] | undefined {
        let file = this.getFile(srcPath);
        if (file) {
            const event: ProvideDocumentSymbolsEvent = {
                program: this,
                file: file,
                documentSymbols: []
            };
            this.plugins.emit('beforeProvideDocumentSymbols', event);
            this.plugins.emit('provideDocumentSymbols', event);
            this.plugins.emit('afterProvideDocumentSymbols', event);
            return event.documentSymbols;
        } else {
            return undefined;
        }
    }

    /**
     * Compute code actions for the given file and range
     */
    public getCodeActions(srcPath: string, range: Range) {
        const codeActions = [] as CodeAction[];
        const file = this.getFile(srcPath);
        if (file) {
            const fileUri = util.pathToUri(file?.srcPath);
            const diagnostics = this
                //get all current diagnostics (filtered by diagnostic filters)
                .getDiagnostics()
                //only keep diagnostics related to this file
                .filter(x => x.location?.uri === fileUri)
                //only keep diagnostics that touch this range
                .filter(x => util.rangesIntersectOrTouch(x.location.range, range));

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
    public getSemanticTokens(srcPath: string): SemanticToken[] | undefined {
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

    public getReferences(srcPath: string, position: Position): Location[] {
        //find the file
        let file = this.getFile(srcPath);

        const event: ProvideReferencesEvent = {
            program: this,
            file: file,
            position: position,
            references: []
        };

        this.plugins.emit('beforeProvideReferences', event);
        this.plugins.emit('provideReferences', event);
        this.plugins.emit('afterProvideReferences', event);

        return event.references;
    }

    /**
     * Transpile a single file and get the result as a string.
     * This does not write anything to the file system.
     *
     * This should only be called by `LanguageServer`.
     * Internal usage should call `_getTranspiledFileContents` instead.
     * @param filePath can be a srcPath or a destPath
     */
    public async getTranspiledFileContents(filePath: string): Promise<FileTranspileResult> {
        const file = this.getFile(filePath);

        return this.getTranspiledFileContentsPipeline.run(async () => {

            const result = {
                destPath: file.destPath,
                pkgPath: file.pkgPath,
                srcPath: file.srcPath
            } as FileTranspileResult;

            const expectedPkgPath = file.pkgPath.toLowerCase();
            const expectedMapPath = `${expectedPkgPath}.map`;
            const expectedTypedefPkgPath = expectedPkgPath.replace(/\.brs$/i, '.d.bs');

            //add a temporary plugin to tap into the file writing process
            const plugin = this.plugins.addFirst({
                name: 'getTranspiledFileContents',
                beforeWriteFile: (event) => {
                    const pkgPath = event.file.pkgPath.toLowerCase();
                    switch (pkgPath) {
                        //this is the actual transpiled file
                        case expectedPkgPath:
                            result.code = event.file.data.toString();
                            break;
                        //this is the sourcemap
                        case expectedMapPath:
                            result.map = event.file.data.toString();
                            break;
                        //this is the typedef
                        case expectedTypedefPkgPath:
                            result.typedef = event.file.data.toString();
                            break;
                        default:
                        //no idea what this file is. just ignore it
                    }
                    //mark every file as processed so it they don't get written to the output directory
                    event.processedFiles.add(event.file);
                }
            });

            try {
                //now that the plugin has been registered, run the build with just this file
                await this.build({
                    files: [file]
                });
            } finally {
                this.plugins.remove(plugin);
            }
            return result;
        });
    }
    private getTranspiledFileContentsPipeline = new ActionPipeline();

    /**
     * Get the absolute output path for a file
     */
    private getOutputPath(file: { pkgPath?: string }, stagingDir = this.getStagingDir()) {
        return s`${stagingDir}/${file.pkgPath}`;
    }

    private getStagingDir(stagingDir?: string) {
        let result = stagingDir ?? this.options.stagingDir ?? this.options.stagingDir;
        if (!result) {
            result = rokuDeploy.getOptions(this.options as any).stagingDir;
        }
        result = s`${path.resolve(this.options.cwd ?? process.cwd(), result ?? '/')}`;
        return result;
    }

    /**
     * Prepare the program for building
     * @param files the list of files that should be prepared
     */
    private async prepare(files: BscFile[]) {
        const programEvent: PrepareProgramEvent = {
            program: this,
            editor: this.editor,
            files: files
        };

        //assign an editor to every file
        for (const file of programEvent.files) {
            //if the file doesn't have an editor yet, assign one now
            if (!file.editor) {
                file.editor = new Editor();
            }
        }

        //sort the entries to make transpiling more deterministic
        programEvent.files.sort((a, b) => {
            if (a.pkgPath < b.pkgPath) {
                return -1;
            } else if (a.pkgPath > b.pkgPath) {
                return 1;
            } else {
                return 1;
            }
        });

        await this.plugins.emitAsync('beforePrepareProgram', programEvent);
        await this.plugins.emitAsync('prepareProgram', programEvent);

        const stagingDir = this.getStagingDir();

        const entries: TranspileObj[] = [];

        for (const file of files) {
            const scope = this.getFirstScopeForFile(file);
            //link the symbol table for all the files in this scope
            scope?.linkSymbolTable();

            //if the file doesn't have an editor yet, assign one now
            if (!file.editor) {
                file.editor = new Editor();
            }
            const event = {
                program: this,
                file: file,
                editor: file.editor,
                scope: scope,
                outputPath: this.getOutputPath(file, stagingDir)
            } as PrepareFileEvent & { outputPath: string };

            await this.plugins.emitAsync('beforePrepareFile', event);
            await this.plugins.emitAsync('prepareFile', event);
            await this.plugins.emitAsync('afterPrepareFile', event);

            //TODO remove this in v1
            entries.push(event);

            //unlink the symbolTable so the next loop iteration can link theirs
            scope?.unlinkSymbolTable();
        }

        await this.plugins.emitAsync('afterPrepareProgram', programEvent);
        return files;
    }

    /**
     * Generate the contents of every file
     */
    private async serialize(files: BscFile[]) {

        const allFiles = new Map<BscFile, SerializedFile[]>();

        //exclude prunable files if that option is enabled
        if (this.options.pruneEmptyCodeFiles === true) {
            files = files.filter(x => x.canBePruned !== true);
        }

        const serializeProgramEvent = await this.plugins.emitAsync('beforeSerializeProgram', {
            program: this,
            files: files,
            result: allFiles
        });
        await this.plugins.emitAsync('onSerializeProgram', serializeProgramEvent);

        // serialize each file
        for (const file of files) {
            let scope = this.getFirstScopeForFile(file);

            //if the file doesn't have a scope, create a temporary scope for the file so it can depend on scope-level items
            if (!scope) {
                scope = new Scope(`temporary-for-${file.pkgPath}`, this);
                scope.getAllFiles = () => [file];
                scope.getOwnFiles = scope.getAllFiles;
            }

            //link the symbol table for all the files in this scope
            scope?.linkSymbolTable();
            const event: SerializeFileEvent = {
                program: this,
                file: file,
                scope: scope,
                result: allFiles
            };
            await this.plugins.emitAsync('beforeSerializeFile', event);
            await this.plugins.emitAsync('serializeFile', event);
            await this.plugins.emitAsync('afterSerializeFile', event);
            //unlink the symbolTable so the next loop iteration can link theirs
            scope?.unlinkSymbolTable();
        }

        this.plugins.emit('afterSerializeProgram', serializeProgramEvent);

        return allFiles;
    }

    /**
     * Write the entire project to disk
     */
    private async write(stagingDir: string, files: Map<BscFile, SerializedFile[]>) {
        const programEvent = await this.plugins.emitAsync('beforeWriteProgram', {
            program: this,
            files: files,
            stagingDir: stagingDir
        });
        //empty the staging directory
        await fsExtra.emptyDir(stagingDir);

        const serializedFiles = [...files]
            .map(([, serializedFiles]) => serializedFiles)
            .flat();

        //write all the files to disk (asynchronously)
        await Promise.all(
            serializedFiles.map(async (file) => {
                const event = await this.plugins.emitAsync('beforeWriteFile', {
                    program: this,
                    file: file,
                    outputPath: this.getOutputPath(file, stagingDir),
                    processedFiles: new Set<SerializedFile>()
                });

                await this.plugins.emitAsync('writeFile', event);

                await this.plugins.emitAsync('afterWriteFile', event);
            })
        );

        await this.plugins.emitAsync('afterWriteProgram', programEvent);
    }

    private buildPipeline = new ActionPipeline();

    /**
     * Build the project. This transpiles/transforms/copies all files and moves them to the staging directory
     * @param options the list of options used to build the program
     */
    public async build(options?: ProgramBuildOptions) {
        //run a single build at a time
        await this.buildPipeline.run(async () => {
            const stagingDir = this.getStagingDir(options?.stagingDir);

            const event = await this.plugins.emitAsync('beforeBuildProgram', {
                program: this,
                editor: this.editor,
                files: options?.files ?? Object.values(this.files)
            });

            //prepare the program (and files) for building
            event.files = await this.prepare(event.files);

            //stage the entire program
            const serializedFilesByFile = await this.serialize(event.files);

            await this.write(stagingDir, serializedFilesByFile);

            await this.plugins.emitAsync('afterBuildProgram', event);

            //undo all edits for the program
            this.editor.undoAll();
            //undo all edits for each file
            for (const file of event.files) {
                file.editor.undoAll();
            }
        });
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
                // eslint-disable-next-line @typescript-eslint/dot-notation
                if (file['_cachedLookups'].functionStatementMap.get(lowerFunctionName)) {
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

                // eslint-disable-next-line @typescript-eslint/dot-notation
                if (file['_cachedLookups'].classStatementMap.get(lowerClassName) !== undefined) {
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

                // eslint-disable-next-line @typescript-eslint/dot-notation
                if (file['_cachedLookups'].namespaceStatements.find((x) => {
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
        const files = [] as BscFile[];
        const lowerName = name.toLowerCase();
        //find every file with this enum defined
        for (const file of Object.values(this.files)) {
            if (isBrsFile(file)) {
                // eslint-disable-next-line @typescript-eslint/dot-notation
                if (file['_cachedLookups'].enumStatementMap.get(lowerName)) {
                    files.push(file);
                }
            }
        }
        return files;
    }

    private _manifest: Map<string, string>;

    /**
     * Modify a parsed manifest map by reading `bs_const` and injecting values from `options.manifest.bs_const`
     * @param parsedManifest The manifest map to read from and modify
     */
    private buildBsConstsIntoParsedManifest(parsedManifest: Map<string, string>) {
        // Lift the bs_consts defined in the manifest
        let bsConsts = getBsConst(parsedManifest, false);

        // Override or delete any bs_consts defined in the bs config
        for (const key in this.options?.manifest?.bs_const) {
            const value = this.options.manifest.bs_const[key];
            if (value === null) {
                bsConsts.delete(key);
            } else {
                bsConsts.set(key, value);
            }
        }

        // convert the new list of bs consts back into a string for the rest of the down stream systems to use
        let constString = '';
        for (const [key, value] of bsConsts) {
            constString += `${constString !== '' ? ';' : ''}${key}=${value.toString()}`;
        }

        // Set the updated bs_const value
        parsedManifest.set('bs_const', constString);
    }

    /**
     * Try to find and load the manifest into memory
     * @param manifestFileObj A pointer to a potential manifest file object found during loading
     * @param replaceIfAlreadyLoaded should we overwrite the internal `_manifest` if it already exists
     */
    public loadManifest(manifestFileObj?: FileObj, replaceIfAlreadyLoaded = true) {
        //if we already have a manifest instance, and should not replace...then don't replace
        if (!replaceIfAlreadyLoaded && this._manifest) {
            return;
        }
        let manifestPath = manifestFileObj
            ? manifestFileObj.src
            : path.join(this.options.rootDir, 'manifest');

        try {
            // we only load this manifest once, so do it sync to improve speed downstream
            const contents = fsExtra.readFileSync(manifestPath, 'utf-8');
            const parsedManifest = parseManifest(contents);
            this.buildBsConstsIntoParsedManifest(parsedManifest);
            this._manifest = parsedManifest;
        } catch (e) {
            this._manifest = new Map();
        }
    }

    /**
     * Get a map of the manifest information
     */
    public getManifest() {
        if (!this._manifest) {
            this.loadManifest();
        }
        return this._manifest;
    }

    public dispose() {
        this.plugins.emit('beforeProgramDispose', { program: this });

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
    map: string;
    typedef: string;
}


class ProvideFileEventInternal<TFile extends BscFile = BscFile> implements ProvideFileEvent<TFile> {
    constructor(
        public program: Program,
        public srcPath: string,
        public destPath: string,
        public data: LazyFileData,
        public fileFactory: FileFactory
    ) {
        this.srcExtension = path.extname(srcPath)?.toLowerCase();
    }

    public srcExtension: string;

    public files: TFile[] = [];
}

export interface ProgramBuildOptions {
    /**
     * The directory where the final built files should be placed. This directory will be cleared before running
     */
    stagingDir?: string;
    /**
     * An array of files to build. If omitted, the entire list of files from the program will be used instead.
     * Typically you will want to leave this blank
     */
    files?: BscFile[];
}
