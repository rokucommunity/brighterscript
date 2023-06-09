import type { CompletionItem, Position, Range, Location } from 'vscode-languageserver';
import * as path from 'path';
import { CompletionItemKind } from 'vscode-languageserver';
import chalk from 'chalk';
import type { DiagnosticInfo } from './DiagnosticMessages';
import { DiagnosticMessages } from './DiagnosticMessages';
import type { CallableContainer, BsDiagnostic, FileReference, BscFile, CallableContainerMap, FileLink, Callable } from './interfaces';
import type { Program } from './Program';
import { BsClassValidator } from './validators/ClassValidator';
import type { NamespaceStatement, FunctionStatement, ClassStatement, EnumStatement, InterfaceStatement, EnumMemberStatement, ConstStatement } from './parser/Statement';
import type { NewExpression } from './parser/Expression';
import { ParseMode } from './parser/Parser';
import { util } from './util';
import { globalCallableMap } from './globalCallables';
import { Cache } from './Cache';
import { URI } from 'vscode-uri';
import { LogLevel } from './Logger';
import type { BrsFile } from './files/BrsFile';
import type { DependencyGraph, DependencyChangedEvent } from './DependencyGraph';
import { isBrsFile, isMethodStatement, isClassStatement, isConstStatement, isEnumStatement, isFunctionStatement, isFunctionType, isXmlFile, isEnumMemberStatement, isNamespaceStatement, isNamespaceType, isReferenceType } from './astUtils/reflection';
import { SymbolTable, SymbolTypeFlag } from './SymbolTable';
import type { Statement } from './parser/AstNode';
import type { BscType } from './types/BscType';
import { NamespaceType } from './types/NamespaceType';

/**
 * A class to keep track of all declarations within a given scope (like source scope, component scope)
 */
export class Scope {
    constructor(
        public name: string,
        public program: Program,
        private _dependencyGraphKey?: string
    ) {
        this.isValidated = false;
        //used for improved logging performance
        this._debugLogComponentName = `Scope '${chalk.redBright(this.name)}'`;
    }

    /**
     * Indicates whether this scope needs to be validated.
     * Will be true when first constructed, or anytime one of its dependencies changes
     */
    public readonly isValidated: boolean;

    protected cache = new Cache();

    public get dependencyGraphKey() {
        return this._dependencyGraphKey;
    }

    /**
     * A dictionary of namespaces, indexed by the lower case full name of each namespace.
     * If a namespace is declared as "NameA.NameB.NameC", there will be 3 entries in this dictionary,
     * "namea", "namea.nameb", "namea.nameb.namec"
     */
    public get namespaceLookup() {
        return this.cache.getOrAdd('namespaceLookup', () => this.buildNamespaceLookup());
    }

    /**
     * Get a NamespaceContainer by its name, looking for a fully qualified version first, then global version next if not found
     */
    public getNamespace(name: string, containingNamespace?: string) {
        const nameLower = name?.toLowerCase();
        const lookup = this.namespaceLookup;

        let ns: NamespaceContainer;
        if (containingNamespace) {
            ns = lookup.get(`${containingNamespace?.toLowerCase()}.${nameLower}`);
        }
        //if we couldn't find the namespace by its full namespaced name, look for a global version
        if (!ns) {
            ns = lookup.get(nameLower);
        }
        return ns;
    }

    /**
     * Get the class with the specified name.
     * @param className - The class name, including the namespace of the class if possible
     * @param containingNamespace - The namespace used to resolve relative class names. (i.e. the namespace around the current statement trying to find a class)
     */
    public getClass(className: string, containingNamespace?: string): ClassStatement {
        return this.getClassFileLink(className, containingNamespace)?.item;
    }

    /**
     * Get the interface with the specified name.
     * @param ifaceName - The interface name, including the namespace of the interface if possible
     * @param containingNamespace - The namespace used to resolve relative interface names. (i.e. the namespace around the current statement trying to find a interface)
     */
    public getInterface(ifaceName: string, containingNamespace?: string): InterfaceStatement {
        return this.getInterfaceFileLink(ifaceName, containingNamespace)?.item;
    }

    /**
     * Get the enum with the specified name.
     * @param enumName - The enum name, including the namespace if possible
     * @param containingNamespace - The namespace used to resolve relative enum names. (i.e. the namespace around the current statement trying to find an enum)
     */
    public getEnum(enumName: string, containingNamespace?: string): EnumStatement {
        return this.getEnumFileLink(enumName, containingNamespace)?.item;
    }

    /**
     * Get a class and its containing file by the class name
     * @param className - The class name, including the namespace of the class if possible
     * @param containingNamespace - The namespace used to resolve relative class names. (i.e. the namespace around the current statement trying to find a class)
     */
    public getClassFileLink(className: string, containingNamespace?: string): FileLink<ClassStatement> {
        const lowerClassName = className?.toLowerCase();
        const classMap = this.getClassMap();

        let cls = classMap.get(
            util.getFullyQualifiedClassName(lowerClassName, containingNamespace?.toLowerCase())
        );
        //if we couldn't find the class by its full namespaced name, look for a global class with that name
        if (!cls) {
            cls = classMap.get(lowerClassName);
        }
        return cls;
    }


    /**
     * Get an interface and its containing file by the interface name
     * @param ifaceName - The interface name, including the namespace of the interface if possible
     * @param containingNamespace - The namespace used to resolve relative interface names. (i.e. the namespace around the current statement trying to find a interface)
     */
    public getInterfaceFileLink(ifaceName: string, containingNamespace?: string): FileLink<InterfaceStatement> {
        const lowerName = ifaceName?.toLowerCase();
        const ifaceMap = this.getInterfaceMap();

        let iface = ifaceMap.get(
            util.getFullyQualifiedClassName(lowerName, containingNamespace?.toLowerCase())
        );
        //if we couldn't find the iface by its full namespaced name, look for a global class with that name
        if (!iface) {
            iface = ifaceMap.get(lowerName);
        }
        return iface;
    }

    /**
     * Get an Enum and its containing file by the Enum name
     * @param enumName - The Enum name, including the namespace of the enum if possible
     * @param containingNamespace - The namespace used to resolve relative enum names. (i.e. the namespace around the current statement trying to find a enum)
     */
    public getEnumFileLink(enumName: string, containingNamespace?: string): FileLink<EnumStatement> {
        const lowerName = enumName?.toLowerCase();
        const enumMap = this.getEnumMap();

        let enumeration = enumMap.get(
            util.getFullyQualifiedClassName(lowerName, containingNamespace?.toLowerCase())
        );
        //if we couldn't find the enum by its full namespaced name, look for a global enum with that name
        if (!enumeration) {
            enumeration = enumMap.get(lowerName);
        }
        return enumeration;
    }

    /**
     * Get an Enum and its containing file by the Enum name
     * @param enumMemberName - The Enum name, including the namespace of the enum if possible
     * @param containingNamespace - The namespace used to resolve relative enum names. (i.e. the namespace around the current statement trying to find a enum)
     */
    public getEnumMemberFileLink(enumMemberName: string, containingNamespace?: string): FileLink<EnumStatement | EnumMemberStatement> {
        let lowerNameParts = enumMemberName?.toLowerCase()?.split('.');
        let memberName = lowerNameParts?.splice(lowerNameParts.length - 1, 1)?.[0];
        let lowerName = lowerNameParts?.join('.').toLowerCase();
        const enumMap = this.getEnumMap();

        let enumeration = enumMap.get(
            util.getFullyQualifiedClassName(lowerName, containingNamespace?.toLowerCase())
        );
        //if we couldn't find the enum by its full namespaced name, look for a global enum with that name
        if (!enumeration) {
            enumeration = enumMap.get(lowerName);
        }
        if (enumeration) {
            let member = enumeration.item.findChild<EnumMemberStatement>((child) => isEnumMemberStatement(child) && child.name?.toLowerCase() === memberName);
            return member ? { item: member, file: enumeration.file } : undefined;
        }
        return enumeration;
    }

    /**
     * Get a constant and its containing file by the constant name
     * @param constName - The constant name, including the namespace of the constant if possible
     * @param containingNamespace - The namespace used to resolve relative constant names. (i.e. the namespace around the current statement trying to find a constant)
     */
    public getConstFileLink(constName: string, containingNamespace?: string): FileLink<ConstStatement> {
        const lowerName = constName?.toLowerCase();
        const constMap = this.getConstMap();

        let result = constMap.get(
            util.getFullyQualifiedClassName(lowerName, containingNamespace?.toLowerCase())
        );
        //if we couldn't find the constant by its full namespaced name, look for a global constant with that name
        if (!result) {
            result = constMap.get(lowerName);
        }
        return result;
    }

    /**
     * Get a map of all enums by their member name.
     * The keys are lower-case fully-qualified paths to the enum and its member. For example:
     * namespace.enum.value
     */
    public getEnumMemberMap() {
        return this.cache.getOrAdd('enumMemberMap', () => {
            const result = new Map<string, EnumMemberStatement>();
            for (const [key, eenum] of this.getEnumMap()) {
                for (const member of eenum.item.getMembers()) {
                    result.set(`${key}.${member.name.toLowerCase()}`, member);
                }
            }
            return result;
        });
    }

    /**
     * Tests if a class exists with the specified name
     * @param className - the all-lower-case namespace-included class name
     * @param namespaceName - The namespace used to resolve relative class names. (i.e. the namespace around the current statement trying to find a class)
     */
    public hasClass(className: string, namespaceName?: string): boolean {
        return !!this.getClass(className, namespaceName);
    }

    /**
     * Tests if an interface exists with the specified name
     * @param ifaceName - the all-lower-case namespace-included interface name
     * @param namespaceName - the current namespace name
     */
    public hasInterface(ifaceName: string, namespaceName?: string): boolean {
        return !!this.getInterface(ifaceName, namespaceName);
    }

    /**
     * Tests if an enum exists with the specified name
     * @param enumName - the all-lower-case namespace-included enum name
     * @param namespaceName - the current namespace name
     */
    public hasEnum(enumName: string, namespaceName?: string): boolean {
        return !!this.getEnum(enumName, namespaceName);
    }

    /**
     * A dictionary of all classes in this scope. This includes namespaced classes always with their full name.
     * The key is stored in lower case
     */
    public getClassMap(): Map<string, FileLink<ClassStatement>> {
        return this.cache.getOrAdd('classMap', () => {
            const map = new Map<string, FileLink<ClassStatement>>();
            this.enumerateBrsFiles((file) => {
                if (isBrsFile(file)) {
                    for (let cls of file.parser.references.classStatements) {
                        const lowerClassName = cls.getName(ParseMode.BrighterScript)?.toLowerCase();
                        //only track classes with a defined name (i.e. exclude nameless malformed classes)
                        if (lowerClassName) {
                            map.set(lowerClassName, { item: cls, file: file });
                        }
                    }
                }
            });
            return map;
        });
    }

    /**
     * A dictionary of all Interfaces in this scope. This includes namespaced Interfaces always with their full name.
     * The key is stored in lower case
     */
    public getInterfaceMap(): Map<string, FileLink<InterfaceStatement>> {
        return this.cache.getOrAdd('interfaceMap', () => {
            const map = new Map<string, FileLink<InterfaceStatement>>();
            this.enumerateBrsFiles((file) => {
                if (isBrsFile(file)) {
                    for (let iface of file.parser.references.interfaceStatements) {
                        const lowerIfaceName = iface.getName(ParseMode.BrighterScript)?.toLowerCase();
                        //only track classes with a defined name (i.e. exclude nameless malformed classes)
                        if (lowerIfaceName) {
                            map.set(lowerIfaceName, { item: iface, file: file });
                        }
                    }
                }
            });
            return map;
        });
    }

    /**
     * A dictionary of all enums in this scope. This includes namespaced enums always with their full name.
     * The key is stored in lower case
     */
    public getEnumMap(): Map<string, FileLink<EnumStatement>> {
        return this.cache.getOrAdd('enumMap', () => {
            const map = new Map<string, FileLink<EnumStatement>>();
            this.enumerateBrsFiles((file) => {
                for (let enumStmt of file.parser.references.enumStatements) {
                    const lowerEnumName = enumStmt.fullName.toLowerCase();
                    //only track enums with a defined name (i.e. exclude nameless malformed enums)
                    if (lowerEnumName) {
                        map.set(lowerEnumName, { item: enumStmt, file: file });
                    }
                }
            });
            return map;
        });
    }

    /**
     * A dictionary of all constants in this scope. This includes namespaced constants always with their full name.
     * The key is stored in lower case
     */
    public getConstMap(): Map<string, FileLink<ConstStatement>> {
        return this.cache.getOrAdd('constMap', () => {
            const map = new Map<string, FileLink<ConstStatement>>();
            this.enumerateBrsFiles((file) => {
                for (let stmt of file.parser.references.constStatements) {
                    const lowerEnumName = stmt.fullName.toLowerCase();
                    //only track enums with a defined name (i.e. exclude nameless malformed enums)
                    if (lowerEnumName) {
                        map.set(lowerEnumName, { item: stmt, file: file });
                    }
                }
            });
            return map;
        });
    }

    /**
     * The list of diagnostics found specifically for this scope. Individual file diagnostics are stored on the files themselves.
     */
    protected diagnostics = [] as BsDiagnostic[];

    protected onDependenciesChanged(event: DependencyChangedEvent) {
        this.logDebug('invalidated because dependency graph said [', event.sourceKey, '] changed');
        this.invalidate();
    }

    /**
     * Clean up all event handles
     */
    public dispose() {
        this.unsubscribeFromDependencyGraph?.();
    }

    /**
     * Does this scope know about the given namespace name?
     * @param namespaceName - the name of the namespace (i.e. "NameA", or "NameA.NameB", etc...)
     */
    public isKnownNamespace(namespaceName: string) {
        let namespaceNameLower = namespaceName.toLowerCase();
        this.enumerateBrsFiles((file) => {
            for (let namespace of file.parser.references.namespaceStatements) {
                let loopNamespaceNameLower = namespace.name.toLowerCase();
                if (loopNamespaceNameLower === namespaceNameLower || loopNamespaceNameLower.startsWith(namespaceNameLower + '.')) {
                    return true;
                }
            }
        });
        return false;
    }

    /**
     * Get the parent scope for this scope (for source scope this will always be the globalScope).
     * XmlScope overrides this to return the parent xml scope if available.
     * For globalScope this will return null.
     */
    public getParentScope() {
        let scope: Scope;
        //use the global scope if we didn't find a sope and this is not the global scope
        if (this.program.globalScope !== this) {
            scope = this.program.globalScope;
        }
        if (scope) {
            return scope;
        } else {
            //passing null to the cache allows it to skip the factory function in the future
            return null;
        }
    }

    private dependencyGraph: DependencyGraph;
    /**
     * An unsubscribe function for the dependencyGraph subscription
     */
    private unsubscribeFromDependencyGraph: () => void;

    public attachDependencyGraph(dependencyGraph: DependencyGraph) {
        this.dependencyGraph = dependencyGraph;
        if (this.unsubscribeFromDependencyGraph) {
            this.unsubscribeFromDependencyGraph();
        }

        //anytime a dependency for this scope changes, we need to be revalidated
        this.unsubscribeFromDependencyGraph = this.dependencyGraph.onchange(this.dependencyGraphKey, this.onDependenciesChanged.bind(this));

        //invalidate immediately since this is a new scope
        this.invalidate();
    }

    /**
     * Get the file from this scope with the given path.
     * @param filePath can be a srcPath or pkgPath
     * @param normalizePath should this function repair and standardize the path? Passing false should have a performance boost if you can guarantee your path is already sanitized
     */
    public getFile<TFile extends BscFile>(filePath: string, normalizePath = true) {
        if (typeof filePath !== 'string') {
            return undefined;
        }

        const key = path.isAbsolute(filePath) ? 'srcPath' : 'pkgPath';
        let map = this.cache.getOrAdd('fileMaps-srcPath', () => {
            const result = new Map<string, BscFile>();
            for (const file of this.getAllFiles()) {
                result.set(file[key].toLowerCase(), file);
            }
            return result;
        });
        return map.get(
            (normalizePath ? util.standardizePath(filePath) : filePath).toLowerCase()
        ) as TFile;
    }

    /**
     * Get the list of files referenced by this scope that are actually loaded in the program.
     * Excludes files from ancestor scopes
     */
    public getOwnFiles() {
        //source scope only inherits files from global, so just return all files. This function mostly exists to assist XmlScope
        return this.getAllFiles();
    }

    /**
     * Get the list of files referenced by this scope that are actually loaded in the program.
     * Includes files from this scope and all ancestor scopes
     */
    public getAllFiles(): BscFile[] {
        return this.cache.getOrAdd('getAllFiles', () => {
            let result = [] as BscFile[];
            let dependencies = this.dependencyGraph.getAllDependencies(this.dependencyGraphKey);
            for (let dependency of dependencies) {
                //load components by their name
                if (dependency.startsWith('component:')) {
                    let comp = this.program.getComponent(dependency.replace(/$component:/, ''));
                    if (comp) {
                        result.push(comp.file);
                    }
                } else {
                    let file = this.program.getFile(dependency);
                    if (file) {
                        result.push(file);
                    }
                }
            }
            this.logDebug('getAllFiles', () => result.map(x => x.pkgPath));
            return result;
        });
    }

    /**
     * Get the list of errors for this scope. It's calculated on the fly, so
     * call this sparingly.
     */
    public getDiagnostics() {
        let diagnosticLists = [this.diagnostics] as BsDiagnostic[][];

        //add diagnostics from every referenced file
        this.enumerateOwnFiles((file) => {
            diagnosticLists.push(file.getDiagnostics());
        });
        let allDiagnostics = Array.prototype.concat.apply([], diagnosticLists) as BsDiagnostic[];

        let filteredDiagnostics = allDiagnostics.filter((x) => {
            return !util.diagnosticIsSuppressed(x);
        });

        //filter out diangostics that match any of the comment flags

        return filteredDiagnostics;
    }

    public addDiagnostics(diagnostics: BsDiagnostic[]) {
        this.diagnostics.push(...diagnostics);
    }

    /**
     * Get the list of callables available in this scope (either declared in this scope or in a parent scope)
     */
    public getAllCallables(): CallableContainer[] {
        //get callables from parent scopes
        let parentScope = this.getParentScope();
        if (parentScope) {
            return [...this.getOwnCallables(), ...parentScope.getAllCallables()];
        } else {
            return [...this.getOwnCallables()];
        }
    }

    /**
     * Get the callable with the specified name.
     * If there are overridden callables with the same name, the closest callable to this scope is returned
     */
    public getCallableByName(name: string) {
        return this.getCallableMap().get(
            name.toLowerCase()
        );
    }

    public getCallableMap() {
        return this.cache.getOrAdd('callableMap', () => {
            const result = new Map<string, Callable>();
            for (let callable of this.getAllCallables()) {
                const callableName = callable.callable.getName(ParseMode.BrighterScript)?.toLowerCase();
                result.set(callableName, callable.callable);
                result.set(
                    // Split by `.` and check the last term to consider namespaces.
                    callableName.split('.').pop()?.toLowerCase(),
                    callable.callable
                );
            }
            return result;
        });
    }

    /**
     * Iterate over Brs files not shadowed by typedefs
     */
    public enumerateBrsFiles(callback: (file: BrsFile) => void) {
        const files = this.getAllFiles();
        for (const file of files) {
            //only brs files without a typedef
            if (isBrsFile(file) && !file.hasTypedef) {
                callback(file);
            }
        }
    }

    /**
     * Call a function for each file directly included in this scope (excluding files found only in parent scopes).
     */
    public enumerateOwnFiles(callback: (file: BscFile) => void) {
        const files = this.getOwnFiles();
        for (const file of files) {
            //either XML components or files without a typedef
            if (isXmlFile(file) || !file.hasTypedef) {
                callback(file);
            }
        }
    }

    /**
     * Get the list of callables explicitly defined in files in this scope.
     * This excludes ancestor callables
     */
    public getOwnCallables(): CallableContainer[] {
        let result = [] as CallableContainer[];
        this.logDebug('getOwnCallables() files: ', () => this.getOwnFiles().map(x => x.pkgPath));

        //get callables from own files
        this.enumerateOwnFiles((file) => {
            for (let callable of file.callables) {
                result.push({
                    callable: callable,
                    scope: this
                });
            }
        });
        return result;
    }

    /**
     * Builds a tree of namespace objects
     */
    public buildNamespaceLookup() {
        let namespaceLookup = new Map<string, NamespaceContainer>();
        this.enumerateBrsFiles((file) => {
            for (let namespaceStatement of file.parser.references.namespaceStatements) {
                //TODO should we handle non-brighterscript?
                let name = namespaceStatement.getName(ParseMode.BrighterScript);
                let nameParts = name.split('.');

                let loopName = null;
                //ensure each namespace section is represented in the results
                //(so if the namespace name is A.B.C, this will make an entry for "A", an entry for "A.B", and an entry for "A.B.C"
                for (let part of nameParts) {
                    loopName = loopName === null ? part : `${loopName}.${part}`;
                    let lowerLoopName = loopName.toLowerCase();
                    if (!namespaceLookup.has(lowerLoopName)) {
                        namespaceLookup.set(lowerLoopName, {
                            file: file,
                            fullName: loopName,
                            nameRange: namespaceStatement.nameExpression.range,
                            lastPartName: part,
                            namespaces: new Map(),
                            classStatements: {},
                            functionStatements: {},
                            enumStatements: new Map(),
                            constStatements: new Map(),
                            statements: [],
                            symbolTable: new SymbolTable(`Namespace Aggregate: '${loopName}'`, () => this.symbolTable)
                        });
                    }
                }
                let ns = namespaceLookup.get(name.toLowerCase());
                ns.statements.push(...namespaceStatement.body.statements);
                for (let statement of namespaceStatement.body.statements) {
                    if (isClassStatement(statement) && statement.name) {
                        ns.classStatements[statement.name.text.toLowerCase()] = statement;
                    } else if (isFunctionStatement(statement) && statement.name) {
                        ns.functionStatements[statement.name.text.toLowerCase()] = statement;
                    } else if (isEnumStatement(statement) && statement.fullName) {
                        ns.enumStatements.set(statement.fullName.toLowerCase(), statement);
                    } else if (isConstStatement(statement) && statement.fullName) {
                        ns.constStatements.set(statement.fullName.toLowerCase(), statement);
                    }
                }
                // Merges all the symbol tables of the namespace statements into the new symbol table created above.
                // Set those symbol tables to have this new merged table as a parent
                ns.symbolTable.mergeSymbolTable(namespaceStatement.body.getSymbolTable());
            }

            //associate child namespaces with their parents
            for (let [, ns] of namespaceLookup) {
                let parts = ns.fullName.split('.');

                if (parts.length > 1) {
                    //remove the last part
                    parts.pop();
                    let parentName = parts.join('.');
                    const parent = namespaceLookup.get(parentName.toLowerCase());
                    parent.namespaces.set(ns.lastPartName.toLowerCase(), ns);
                }
            }
        });
        return namespaceLookup;
    }

    public getAllNamespaceStatements() {
        let result = [] as NamespaceStatement[];
        this.enumerateBrsFiles((file) => {
            result.push(...file.parser.references.namespaceStatements);
        });
        return result;
    }

    protected logDebug(...args: any[]) {
        this.program.logger.debug(this._debugLogComponentName, ...args);
    }
    private _debugLogComponentName: string;

    public validate(force = false) {
        //if this scope is already validated, no need to revalidate
        if (this.isValidated === true && !force) {
            this.logDebug('validate(): already validated');
            return;
        }

        this.program.logger.time(LogLevel.debug, [this._debugLogComponentName, 'validate()'], () => {

            let parentScope = this.getParentScope();

            //validate our parent before we validate ourself
            if (parentScope && parentScope.isValidated === false) {
                this.logDebug('validate(): validating parent first');
                parentScope.validate(force);
            }
            //clear the scope's errors list (we will populate them from this method)
            this.diagnostics = [];

            let callables = this.getAllCallables();

            //sort the callables by filepath and then method name, so the errors will be consistent
            // eslint-disable-next-line prefer-arrow-callback
            callables = callables.sort((a, b) => {
                const pathA = a.callable.file.srcPath;
                const pathB = b.callable.file.srcPath;
                //sort by path
                if (pathA < pathB) {
                    return -1;
                } else if (pathA > pathB) {
                    return 1;
                }
                //sort by function name
                const funcA = b.callable.name;
                const funcB = b.callable.name;
                if (funcA < funcB) {
                    return -1;
                } else if (funcA > funcB) {
                    return 1;
                }
                return 0;
            });

            //get a list of all callables, indexed by their lower case names
            let callableContainerMap = util.getCallableContainersByLowerName(callables);
            let files = this.getOwnFiles();

            //Since statements from files are shared across multiple scopes, we need to link those statements to the current scope
            this.linkSymbolTable();
            this.program.plugins.emit('beforeScopeValidate', this, files, callableContainerMap);

            this.program.plugins.emit('onScopeValidate', {
                program: this.program,
                scope: this
            });
            this._validate(callableContainerMap);

            this.program.plugins.emit('afterScopeValidate', this, files, callableContainerMap);
            //unlink all symbol tables from this scope (so they don't accidentally stick around)
            this.unlinkSymbolTable();

            (this as any).isValidated = true;
        });
    }

    protected _validate(callableContainerMap: CallableContainerMap) {
        //find all duplicate function declarations
        this.diagnosticFindDuplicateFunctionDeclarations(callableContainerMap);

        //detect missing and incorrect-case script imports
        this.diagnosticValidateScriptImportPaths();

        //enforce a series of checks on the bodies of class methods
        this.validateClasses();

        //do many per-file checks
        this.enumerateBrsFiles((file) => {
            this.diagnosticDetectFunctionCallsWithWrongParamCount(file, callableContainerMap);
            this.diagnosticDetectShadowedLocalVars(file, callableContainerMap);
            this.diagnosticDetectFunctionCollisions(file);
            this.detectVariableNamespaceCollisions(file);
        });
    }

    /**
     * Mark this scope as invalid, which means its `validate()` function needs to be called again before use.
     */
    public invalidate() {
        (this as any).isValidated = false;
        //clear out various lookups (they'll get regenerated on demand the next time they're requested)
        this.cache.clear();
    }

    public get symbolTable(): SymbolTable {
        return this.cache.getOrAdd('symbolTable', () => {
            const result = new SymbolTable(`Scope: '${this.name}'`, () => this.getParentScope()?.symbolTable);
            for (let file of this.getOwnFiles()) {
                if (isBrsFile(file)) {
                    result.mergeSymbolTable(file.parser?.symbolTable);
                }
            }
            return result;
        });
    }

    /**
     * Builds the current symbol table for the scope, by merging the tables for all the files in this scope.
     * Also links all file symbols tables to this new table
     * This will only rebuilt if the symbol table has not been built before
     */
    public linkSymbolTable() {
        const allNameSpaces: NamespaceStatement[] = [];
        for (const file of this.getAllFiles()) {
            if (isBrsFile(file)) {
                file.parser.symbolTable.pushParentProvider(() => this.symbolTable);
                allNameSpaces.push(...file.parser.references.namespaceStatements);
            }
        }

        //Add namespace aggregates to namespace member tables
        for (const namespace of allNameSpaces) {
            //link each NamespaceType member table with the aggregate NamespaceLookup SymbolTable
            let fullNamespaceName = namespace.getName(ParseMode.BrighterScript);
            let namespaceParts = fullNamespaceName.split('.');

            // eslint-disable-next-line no-bitwise
            let getSymbolFlags = { flags: SymbolTypeFlag.runtime | SymbolTypeFlag.typetime };
            let currentNSType: BscType = null;
            let nameSoFar = '';

            for (const nsNamePart of namespaceParts) {
                // for each section of the namespace name, add it as either a top level symbol (if it is the first part)
                // or as a member to the containing namespace.
                let previousNSType = currentNSType;
                currentNSType = currentNSType === null
                    ? this.symbolTable.getSymbolType(nsNamePart, getSymbolFlags)
                    : currentNSType.getMemberType(nsNamePart, getSymbolFlags);
                nameSoFar = nameSoFar === '' ? nsNamePart : `${nameSoFar}.${nsNamePart}`;
                let isFinalNamespace = nameSoFar.toLowerCase() === fullNamespaceName.toLowerCase();
                if (!isNamespaceType(currentNSType)) {
                    if (!currentNSType || isReferenceType(currentNSType)) {
                        currentNSType = isFinalNamespace
                            ? namespace.getType(getSymbolFlags)
                            : new NamespaceType(nameSoFar);
                        if (previousNSType) {
                            // adding as a member of existing NS
                            previousNSType.addMember(nsNamePart, namespace.range, currentNSType, getSymbolFlags.flags);
                        } else {
                            this.symbolTable.addSymbol(nsNamePart, namespace.range, currentNSType, getSymbolFlags.flags);
                        }
                    } else {
                        break;
                    }
                }
                // Now the namespace type is built, add the aggregate as a sibling
                let aggregateNSSymbolTable = this.namespaceLookup.get(nameSoFar.toLowerCase()).symbolTable;
                currentNSType.memberTable.addSibling(aggregateNSSymbolTable);
                if (isFinalNamespace) {
                    namespace.body.getSymbolTable().addSibling(aggregateNSSymbolTable);
                }
            }
        }

        this.program.typeCacheVerifier.generateToken();
    }

    public unlinkSymbolTable() {
        for (let file of this.getOwnFiles()) {
            if (isBrsFile(file)) {
                file.parser?.symbolTable.popParentProvider();

                for (const namespace of file.parser.references.namespaceStatements) {
                    const namespaceNameLower = namespace.getName(ParseMode.BrighterScript).toLowerCase();
                    namespace.getSymbolTable().removeSibling(
                        this.namespaceLookup.get(namespaceNameLower).symbolTable
                    );
                }
            }
        }
    }

    private detectVariableNamespaceCollisions(file: BrsFile) {
        //find all function parameters
        for (let func of file.parser.references.functionExpressions) {
            for (let param of func.parameters) {
                let lowerParamName = param.name.text.toLowerCase();
                let namespace = this.getNamespace(lowerParamName, param.findAncestor<NamespaceStatement>(isNamespaceStatement)?.getName(ParseMode.BrighterScript).toLowerCase());
                //see if the param matches any starting namespace part
                if (namespace) {
                    this.diagnostics.push({
                        file: file,
                        ...DiagnosticMessages.parameterMayNotHaveSameNameAsNamespace(param.name.text),
                        range: param.name.range,
                        relatedInformation: [{
                            message: 'Namespace declared here',
                            location: util.createLocation(
                                URI.file(namespace.file.srcPath).toString(),
                                namespace.nameRange
                            )
                        }]
                    });
                }
            }
        }

        for (let assignment of file.parser.references.assignmentStatements) {
            let lowerAssignmentName = assignment.name.text.toLowerCase();
            let namespace = this.getNamespace(lowerAssignmentName, assignment.findAncestor<NamespaceStatement>(isNamespaceStatement)?.getName(ParseMode.BrighterScript).toLowerCase());
            //see if the param matches any starting namespace part
            if (namespace) {
                this.diagnostics.push({
                    file: file,
                    ...DiagnosticMessages.variableMayNotHaveSameNameAsNamespace(assignment.name.text),
                    range: assignment.name.range,
                    relatedInformation: [{
                        message: 'Namespace declared here',
                        location: util.createLocation(
                            URI.file(namespace.file.srcPath).toString(),
                            namespace.nameRange
                        )
                    }]
                });
            }
        }
    }

    /**
     * Find various function collisions
     */
    private diagnosticDetectFunctionCollisions(file: BscFile) {
        for (let func of file.callables) {
            const funcName = func.getName(ParseMode.BrighterScript);
            const lowerFuncName = funcName?.toLowerCase();
            if (lowerFuncName) {

                //find function declarations with the same name as a stdlib function
                if (globalCallableMap.has(lowerFuncName)) {
                    this.diagnostics.push({
                        ...DiagnosticMessages.scopeFunctionShadowedByBuiltInFunction(),
                        range: func.nameRange,
                        file: file
                    });
                }

                //find any functions that have the same name as a class
                if (this.hasClass(lowerFuncName)) {
                    this.diagnostics.push({
                        ...DiagnosticMessages.functionCannotHaveSameNameAsClass(funcName),
                        range: func.nameRange,
                        file: file
                    });
                }
            }
        }
    }


    public getNewExpressions() {
        let result = [] as AugmentedNewExpression[];
        this.enumerateBrsFiles((file) => {
            let expressions = file.parser.references.newExpressions as AugmentedNewExpression[];
            for (let expression of expressions) {
                expression.file = file;
                result.push(expression);
            }
        });
        return result;
    }

    private validateClasses() {
        let validator = new BsClassValidator();
        validator.validate(this);
        this.diagnostics.push(...validator.diagnostics);
    }

    /**
     * Detect calls to functions with the incorrect number of parameters
     */
    private diagnosticDetectFunctionCallsWithWrongParamCount(file: BscFile, callableContainersByLowerName: CallableContainerMap) {
        //validate all function calls
        for (let expCall of file.functionCalls) {
            let callableContainersWithThisName = callableContainersByLowerName.get(expCall.name.toLowerCase());

            //use the first item from callablesByLowerName, because if there are more, that's a separate error
            let knownCallableContainer = callableContainersWithThisName ? callableContainersWithThisName[0] : undefined;

            if (knownCallableContainer) {
                //get min/max parameter count for callable
                let minParams = 0;
                let maxParams = 0;
                for (let param of knownCallableContainer.callable.params) {
                    maxParams++;
                    //optional parameters must come last, so we can assume that minParams won't increase once we hit
                    //the first isOptional
                    if (param.isOptional !== true) {
                        minParams++;
                    }
                }
                let expCallArgCount = expCall.args.length;
                if (expCall.args.length > maxParams || expCall.args.length < minParams) {
                    let minMaxParamsText = minParams === maxParams ? maxParams : `${minParams}-${maxParams}`;
                    this.diagnostics.push({
                        ...DiagnosticMessages.mismatchArgumentCount(minMaxParamsText, expCallArgCount),
                        range: expCall.nameRange,
                        //TODO detect end of expression call
                        file: file
                    });
                }
            }
        }
    }

    /**
     * Detect local variables (function scope) that have the same name as scope calls
     */
    private diagnosticDetectShadowedLocalVars(file: BscFile, callableContainerMap: CallableContainerMap) {
        const classMap = this.getClassMap();
        //loop through every function scope
        for (let scope of file.functionScopes) {
            //every var declaration in this function scope
            for (let varDeclaration of scope.variableDeclarations) {
                const varName = varDeclaration.name;
                const lowerVarName = varName.toLowerCase();

                //if the var is a function
                if (isFunctionType(varDeclaration.getType())) {
                    //local var function with same name as stdlib function
                    if (
                        //has same name as stdlib
                        globalCallableMap.has(lowerVarName)
                    ) {
                        this.diagnostics.push({
                            ...DiagnosticMessages.localVarFunctionShadowsParentFunction('stdlib'),
                            range: varDeclaration.nameRange,
                            file: file
                        });

                        //this check needs to come after the stdlib one, because the stdlib functions are included
                        //in the scope function list
                    } else if (
                        //has same name as scope function
                        callableContainerMap.has(lowerVarName)
                    ) {
                        this.diagnostics.push({
                            ...DiagnosticMessages.localVarFunctionShadowsParentFunction('scope'),
                            range: varDeclaration.nameRange,
                            file: file
                        });
                    }

                    //var is not a function
                } else if (
                    //is NOT a callable from stdlib (because non-function local vars can have same name as stdlib names)
                    !globalCallableMap.has(lowerVarName)
                ) {

                    //is same name as a callable
                    if (callableContainerMap.has(lowerVarName)) {
                        this.diagnostics.push({
                            ...DiagnosticMessages.localVarShadowedByScopedFunction(),
                            range: varDeclaration.nameRange,
                            file: file
                        });
                        //has the same name as an in-scope class
                    } else if (classMap.has(lowerVarName)) {
                        this.diagnostics.push({
                            ...DiagnosticMessages.localVarSameNameAsClass(classMap.get(lowerVarName)?.item.getName(ParseMode.BrighterScript)),
                            range: varDeclaration.nameRange,
                            file: file
                        });
                    }
                }
            }
        }
    }

    /**
     * Create diagnostics for any duplicate function declarations
     */
    private diagnosticFindDuplicateFunctionDeclarations(callableContainersByLowerName: CallableContainerMap) {
        //for each list of callables with the same name
        for (let [lowerName, callableContainers] of callableContainersByLowerName) {

            let globalCallables = [] as CallableContainer[];
            let nonGlobalCallables = [] as CallableContainer[];
            let ownCallables = [] as CallableContainer[];
            let ancestorNonGlobalCallables = [] as CallableContainer[];

            for (let container of callableContainers) {
                if (container.scope === this.program.globalScope) {
                    globalCallables.push(container);
                } else {
                    nonGlobalCallables.push(container);
                    if (container.scope === this) {
                        ownCallables.push(container);
                    } else {
                        ancestorNonGlobalCallables.push(container);
                    }
                }
            }

            //add info diagnostics about child shadowing parent functions
            if (ownCallables.length > 0 && ancestorNonGlobalCallables.length > 0) {
                for (let container of ownCallables) {
                    //skip the init function (because every component will have one of those){
                    if (lowerName !== 'init') {
                        let shadowedCallable = ancestorNonGlobalCallables[ancestorNonGlobalCallables.length - 1];
                        if (!!shadowedCallable && shadowedCallable.callable.file === container.callable.file) {
                            //same file: skip redundant imports
                            continue;
                        }
                        this.diagnostics.push({
                            ...DiagnosticMessages.overridesAncestorFunction(
                                container.callable.name,
                                container.scope.name,
                                shadowedCallable.callable.file.pkgPath,
                                //grab the last item in the list, which should be the closest ancestor's version
                                shadowedCallable.scope.name
                            ),
                            range: container.callable.nameRange,
                            file: container.callable.file
                        });
                    }
                }
            }

            //add error diagnostics about duplicate functions in the same scope
            if (ownCallables.length > 1) {

                for (let callableContainer of ownCallables) {
                    let callable = callableContainer.callable;

                    this.diagnostics.push({
                        ...DiagnosticMessages.duplicateFunctionImplementation(callable.name, callableContainer.scope.name),
                        range: util.createRange(
                            callable.nameRange.start.line,
                            callable.nameRange.start.character,
                            callable.nameRange.start.line,
                            callable.nameRange.end.character
                        ),
                        file: callable.file
                    });
                }
            }
        }
    }

    /**
     * Get the list of all script imports for this scope
     */
    private getOwnScriptImports() {
        let result = [] as FileReference[];
        this.enumerateOwnFiles((file) => {
            if (isBrsFile(file)) {
                result.push(...file.ownScriptImports);
            } else if (isXmlFile(file)) {
                result.push(...file.scriptTagImports);
            }
        });
        return result;
    }

    /**
     * Verify that all of the scripts imported by each file in this scope actually exist
     */
    private diagnosticValidateScriptImportPaths() {
        let scriptImports = this.getOwnScriptImports();
        //verify every script import
        for (let scriptImport of scriptImports) {
            let referencedFile = this.getFileByRelativePath(scriptImport.pkgPath);
            //if we can't find the file
            if (!referencedFile) {
                //skip the default bslib file, it will exist at transpile time but should not show up in the program during validation cycle
                if (scriptImport.pkgPath === `source${path.sep}bslib.brs`) {
                    continue;
                }
                let dInfo: DiagnosticInfo;
                if (scriptImport.text.trim().length === 0) {
                    dInfo = DiagnosticMessages.scriptSrcCannotBeEmpty();
                } else {
                    dInfo = DiagnosticMessages.referencedFileDoesNotExist();
                }

                this.diagnostics.push({
                    ...dInfo,
                    range: scriptImport.filePathRange,
                    file: scriptImport.sourceFile
                });
                //if the character casing of the script import path does not match that of the actual path
            } else if (scriptImport.pkgPath !== referencedFile.pkgPath) {
                this.diagnostics.push({
                    ...DiagnosticMessages.scriptImportCaseMismatch(referencedFile.pkgPath),
                    range: scriptImport.filePathRange,
                    file: scriptImport.sourceFile
                });
            }
        }
    }

    /**
     * Find the file with the specified relative path
     */
    protected getFileByRelativePath(relativePath: string) {
        if (!relativePath) {
            return;
        }
        let files = this.getAllFiles();
        for (let file of files) {
            if (file.pkgPath.toLowerCase() === relativePath.toLowerCase()) {
                return file;
            }
        }
    }

    /**
     * Determine if this file is included in this scope (excluding parent scopes)
     */
    public hasFile(file: BscFile) {
        let files = this.getOwnFiles();
        let hasFile = files.includes(file);
        return hasFile;
    }

    /**
     * Get all callables as completionItems
     */
    public getCallablesAsCompletions(parseMode: ParseMode) {
        let completions = [] as CompletionItem[];
        let callables = this.getAllCallables();

        if (parseMode === ParseMode.BrighterScript) {
            //throw out the namespaced callables (they will be handled by another method)
            callables = callables.filter(x => x.callable.hasNamespace === false);
        }

        for (let callableContainer of callables) {
            completions.push(this.createCompletionFromCallable(callableContainer));
        }
        return completions;
    }

    public createCompletionFromCallable(callableContainer: CallableContainer): CompletionItem {
        return {
            label: callableContainer.callable.getName(ParseMode.BrighterScript),
            kind: CompletionItemKind.Function,
            detail: callableContainer.callable.shortDescription,
            documentation: callableContainer.callable.documentation ? { kind: 'markdown', value: callableContainer.callable.documentation } : undefined
        };
    }

    public createCompletionFromFunctionStatement(statement: FunctionStatement): CompletionItem {
        return {
            label: statement.getName(ParseMode.BrighterScript),
            kind: CompletionItemKind.Function
        };
    }

    /**
     * Get the definition (where was this thing first defined) of the symbol under the position
     */
    public getDefinition(file: BscFile, position: Position): Location[] {
        // Overridden in XMLScope. Brs files use implementation in BrsFile
        return [];
    }

    /**
     * Scan all files for property names, and return them as completions
     */
    public getPropertyNameCompletions() {
        let results = [] as CompletionItem[];
        this.enumerateBrsFiles((file) => {
            results.push(...file.propertyNameCompletions);
        });
        return results;
    }

    public getAllClassMemberCompletions() {
        let results = new Map<string, CompletionItem>();
        let filesSearched = new Set<BscFile>();
        for (const file of this.getAllFiles()) {
            if (isXmlFile(file) || filesSearched.has(file)) {
                continue;
            }
            filesSearched.add(file);
            for (let cs of file.parser.references.classStatements) {
                for (let s of [...cs.methods, ...cs.fields]) {
                    if (!results.has(s.name.text) && s.name.text.toLowerCase() !== 'new') {
                        results.set(s.name.text, {
                            label: s.name.text,
                            kind: isMethodStatement(s) ? CompletionItemKind.Method : CompletionItemKind.Field
                        });
                    }
                }
            }
        }
        return results;
    }

    /**
     * @param className - The name of the class (including namespace if possible)
     * @param callsiteNamespace - the name of the namespace where the call site resides (this is NOT the known namespace of the class).
     *                            This is used to help resolve non-namespaced class names that reside in the same namespac as the call site.
     */
    public getClassHierarchy(className: string, callsiteNamespace?: string) {
        let items = [] as FileLink<ClassStatement>[];
        let link = this.getClassFileLink(className, callsiteNamespace);
        while (link) {
            items.push(link);
            link = this.getClassFileLink(link.item.parentClassName?.getName()?.toLowerCase(), callsiteNamespace);
        }
        return items;
    }
}

interface NamespaceContainer {
    file: BscFile;
    fullName: string;
    nameRange: Range;
    lastPartName: string;
    statements: Statement[];
    classStatements: Record<string, ClassStatement>;
    functionStatements: Record<string, FunctionStatement>;
    enumStatements: Map<string, EnumStatement>;
    constStatements: Map<string, ConstStatement>;
    namespaces: Map<string, NamespaceContainer>;
    symbolTable: SymbolTable;
}

interface AugmentedNewExpression extends NewExpression {
    file: BscFile;
}
