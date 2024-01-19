/* eslint-disable @typescript-eslint/dot-notation */
import type { Position, Location } from 'vscode-languageserver';
import * as path from 'path';
import chalk from 'chalk';
import type { DiagnosticInfo } from './DiagnosticMessages';
import { DiagnosticMessages } from './DiagnosticMessages';
import { type CallableContainer, type BsDiagnosticWithOrigin, type FileReference, type CallableContainerMap, type FileLink, type Callable, type NamespaceContainer, type ScopeValidationOptions, type BsDiagnostic, DiagnosticOrigin } from './interfaces';
import type { Program } from './Program';
import { BsClassValidator } from './validators/ClassValidator';
import type { NamespaceStatement, ClassStatement, EnumStatement, InterfaceStatement, EnumMemberStatement, ConstStatement } from './parser/Statement';
import { type NewExpression } from './parser/Expression';
import { ParseMode } from './parser/Parser';
import { util } from './util';
import { globalCallableMap } from './globalCallables';
import { Cache } from './Cache';
import { URI } from 'vscode-uri';
import { LogLevel } from './Logger';
import type { BrsFile } from './files/BrsFile';
import type { DependencyGraph, DependencyChangedEvent } from './DependencyGraph';
import { isBrsFile, isXmlFile, isEnumMemberStatement, isNamespaceStatement, isNamespaceType, isReferenceType, isCallableType } from './astUtils/reflection';
import { SymbolTable, SymbolTypeFlag } from './SymbolTable';
import type { BscFile } from './files/BscFile';
import type { BscType } from './types/BscType';
import { NamespaceType } from './types/NamespaceType';
import { referenceTypeFactory } from './types/ReferenceType';
import { unionTypeFactory } from './types/UnionType';
import { AssociativeArrayType } from './types/AssociativeArrayType';
import { AstNodeKind, type AstNode, type Statement } from './parser/AstNode';
import { WalkMode, createVisitor } from './astUtils/visitors';
import type { Token } from './lexer/Token';

/**
 * Assign some few factories to the SymbolTable to prevent cyclical imports. This file seems like the most intuitive place to do the linking
 * since Scope will be used by pretty much everything
 */
SymbolTable.referenceTypeFactory = referenceTypeFactory;
SymbolTable.unionTypeFactory = unionTypeFactory;

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
        let allFilesValidated = true;
        for (const file of this.getAllFiles()) {
            if (isBrsFile(file) && !file.hasTypedef) {
                allFilesValidated = allFilesValidated && file.isValidated;
                if (!allFilesValidated) {
                    break;
                }
            }
        }
        if (!allFilesValidated) {
            // This is not fit to cache
            // Since the files have not been validated, all namespace info might not have been available
            return this.buildNamespaceLookup();
        }

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
     * Get a NamespaceContainer by its name, looking for a fully qualified version first, then global version next if not found
     */
    public getNamespacesWithRoot(rootName: string, containingNamespace?: string) {
        const nameLower = rootName?.toLowerCase();
        const lookup = this.namespaceLookup;
        const lookupKeys = [...lookup.keys()];
        let lookupName = nameLower;
        if (containingNamespace) {
            lookupName = `${containingNamespace?.toLowerCase()}.${nameLower}`;
        }
        const nsList = lookupKeys.filter(key => key === lookupName).map(key => lookup.get(key));
        return nsList;
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
    public getEnumMemberFileLink(enumMemberName: string, containingNamespace?: string): FileLink<EnumMemberStatement> {
        let lowerNameParts = enumMemberName?.toLowerCase()?.split('.');
        let memberName = lowerNameParts?.splice(lowerNameParts.length - 1, 1)?.[0];
        let lowerName = lowerNameParts?.join('.');
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


    public getAllFileLinks(name: string, containingNamespace?: string): FileLink<Statement>[] {
        let links: FileLink<Statement>[] = [];

        links.push(this.getClassFileLink(name) ?? this.getClassFileLink(name, containingNamespace),
            this.getInterfaceFileLink(name) ?? this.getInterfaceFileLink(name, containingNamespace),
            this.getConstFileLink(name) ?? this.getConstFileLink(name, containingNamespace),
            this.getEnumFileLink(name) ?? this.getEnumFileLink(name, containingNamespace));


        const nameSpaces = this.getNamespacesWithRoot(name, containingNamespace);
        if (nameSpaces?.length > 0) {
            const nsContainersWithStatement = nameSpaces.filter(nsContainer => nsContainer?.namespaceStatements?.length > 0)?.[0];
            if (nsContainersWithStatement) {
                links.push({ item: nsContainersWithStatement?.namespaceStatements?.[0], file: nsContainersWithStatement?.file as BrsFile });
            }
        }
        const fullNameLower = (containingNamespace ? `${containingNamespace}.${name}` : name).toLowerCase();
        const callable = this.getCallableByName(name);
        if (callable) {
            if (!callable.hasNamespace || callable.getName(ParseMode.BrighterScript).toLowerCase() === fullNameLower) {
                // this callable has no namespace, or has same namespace
                links.push({ item: callable.functionStatement, file: callable.file as BrsFile });
            }
        }
        // remove empty links
        return links.filter(link => link);
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
                        const className = cls.getName(ParseMode.BrighterScript);
                        //only track classes with a defined name (i.e. exclude nameless malformed classes)
                        if (className) {
                            map.set(className.toLowerCase(), { item: cls, file: file });
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
                        const ifaceName = iface.getName(ParseMode.BrighterScript);
                        //only track classes with a defined name (i.e. exclude nameless malformed classes)
                        if (ifaceName) {
                            map.set(ifaceName.toLowerCase(), { item: iface, file: file });
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
                    //only track enums with a defined name (i.e. exclude nameless malformed enums)
                    if (enumStmt.fullName) {
                        map.set(enumStmt.fullName.toLowerCase(), { item: enumStmt, file: file });
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
                    //only track enums with a defined name (i.e. exclude nameless malformed enums)
                    if (stmt.fullName) {
                        map.set(stmt.fullName.toLowerCase(), { item: stmt, file: file });
                    }
                }
            });
            return map;
        });
    }

    /**
     * The list of diagnostics found specifically for this scope. Individual file diagnostics are stored on the files themselves.
     */
    protected diagnostics = [] as BsDiagnosticWithOrigin[];

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
     * @param filePath can be a srcPath or destPath
     * @param normalizePath should this function repair and standardize the path? Passing false should have a performance boost if you can guarantee your path is already sanitized
     */
    public getFile<TFile extends BscFile>(filePath: string, normalizePath = true) {
        if (typeof filePath !== 'string') {
            return undefined;
        }

        const key: keyof Pick<BscFile, 'srcPath' | 'destPath'> = path.isAbsolute(filePath) ? 'srcPath' : 'destPath';
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
            this.logDebug('getAllFiles', () => result.map(x => x.destPath));
            return result;
        });
    }

    /**
     * Get the list of errors for this scope. It's calculated on the fly, so call this sparingly.
     */
    public getDiagnostics() {
        //add diagnostics from every referenced file
        const diagnostics: BsDiagnostic[] = [
            //diagnostics raised on this scope
            ...this.diagnostics,
            //get diagnostics from all files
            ...this.getOwnFiles().map(x => x.diagnostics ?? []).flat()
        ]
            //exclude diagnostics that match any of the comment flags
            .filter((x) => {
                return !util.diagnosticIsSuppressed(x);
            });
        return diagnostics;
    }

    public addDiagnostics(diagnostics: BsDiagnosticWithOrigin[]) {
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
            if (isXmlFile(file) || (isBrsFile(file) && !file.hasTypedef)) {
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
        this.logDebug('getOwnCallables() files: ', () => this.getOwnFiles().map(x => x.destPath));

        //get callables from own files
        this.enumerateOwnFiles((file) => {
            if (isBrsFile(file)) {
                for (let callable of file.callables) {
                    result.push({
                        callable: callable,
                        scope: this
                    });
                }
            }
        });
        return result;
    }

    /**
     * Builds a tree of namespace objects
     */
    public buildNamespaceLookup(options: { okToCache?: boolean } = { okToCache: true }) {
        let namespaceLookup = new Map<string, NamespaceContainer>();
        options.okToCache = true;
        this.enumerateBrsFiles((file) => {
            options.okToCache = options.okToCache && file.isValidated;
            const fileNamespaceLookup = file.getNamespaceLookupObject();

            for (const [lowerNamespaceName, nsContainer] of fileNamespaceLookup) {
                if (!namespaceLookup.has(lowerNamespaceName)) {
                    const clonedNsContainer = {
                        ...nsContainer,
                        namespaceStatements: [...nsContainer.namespaceStatements],
                        symbolTable: new SymbolTable(`Namespace Aggregate: '${nsContainer.fullName}'`)
                    };

                    clonedNsContainer.symbolTable.mergeSymbolTable(nsContainer.symbolTable);
                    namespaceLookup.set(lowerNamespaceName, clonedNsContainer);
                } else {
                    const existingContainer = namespaceLookup.get(lowerNamespaceName);
                    existingContainer.classStatements = new Map([...existingContainer.classStatements, ...nsContainer.classStatements]);
                    existingContainer.constStatements = new Map([...existingContainer.constStatements, ...nsContainer.constStatements]);
                    existingContainer.enumStatements = new Map([...existingContainer.enumStatements, ...nsContainer.enumStatements]);
                    existingContainer.functionStatements = new Map([...existingContainer.functionStatements, ...nsContainer.functionStatements]);
                    existingContainer.namespaces = new Map([...existingContainer.namespaces, ...nsContainer.namespaces]);
                    existingContainer.namespaceStatements.push(...nsContainer.namespaceStatements);
                    existingContainer.symbolTable.mergeSymbolTable(nsContainer.symbolTable);
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

    public validate(validationOptions: ScopeValidationOptions = { force: false }) {
        //if this scope is already validated, no need to revalidate
        if (this.isValidated === true && !validationOptions.force) {
            this.logDebug('validate(): already validated');
            return;
        }

        this.program.logger.time(LogLevel.debug, [this._debugLogComponentName, 'validate()'], () => {

            let parentScope = this.getParentScope();

            //validate our parent before we validate ourself
            if (parentScope && parentScope.isValidated === false) {
                this.logDebug('validate(): validating parent first');
                parentScope.validate(validationOptions);
            }
            //clear the scope's errors list (we will populate them from this method)
            this.clearScopeLevelDiagnostics();

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
            //Since statements from files are shared across multiple scopes, we need to link those statements to the current scope
            this.linkSymbolTable();
            const scopeValidateEvent = {
                program: this.program,
                scope: this,
                changedFiles: validationOptions?.changedFiles,
                changedSymbols: validationOptions?.changedSymbols
            };
            this.program.plugins.emit('beforeScopeValidate', scopeValidateEvent);
            this.program.plugins.emit('onScopeValidate', scopeValidateEvent);
            this._validate(callableContainerMap);
            this.program.plugins.emit('afterScopeValidate', scopeValidateEvent);
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
            this.diagnosticDetectShadowedLocalVars(file, callableContainerMap);
            this.diagnosticDetectFunctionCollisions(file);
            this.detectVariableNamespaceCollisions(file);
            this.detectNameCollisions(file);
        });
    }

    clearAstSegmentDiagnostics(astSegment: AstNode) {
        this.diagnostics = this.diagnostics.filter(diag => !(diag.origin === DiagnosticOrigin.ASTSegment && diag.astSegment === astSegment));
    }

    clearAstSegmentDiagnosticsByFile(file: BscFile) {
        const lowerSrcPath = file.srcPath.toLowerCase();
        this.diagnostics = this.diagnostics.filter(diag => !(diag.origin === DiagnosticOrigin.ASTSegment && diag.file.srcPath.toLowerCase() === lowerSrcPath));
    }

    clearScopeLevelDiagnostics() {
        this.diagnostics = this.diagnostics.filter(diag => diag.origin !== DiagnosticOrigin.Scope);
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
            result.addSymbol('m', undefined, new AssociativeArrayType(), SymbolTypeFlag.runtime);
            for (let file of this.getOwnFiles()) {
                if (isBrsFile(file)) {
                    result.mergeSymbolTable(file.parser?.symbolTable);
                }
            }
            return result;
        });
    }

    /**
     * A list of functions that will be called whenever `unlinkSymbolTable` is called
     */
    private linkSymbolTableDisposables = [];

    private symbolsAddedDuringLinking: { symbolTable: SymbolTable; name: string; flags: number }[] = [];

    /**
     * Builds the current symbol table for the scope, by merging the tables for all the files in this scope.
     * Also links all file symbols tables to this new table
     * This will only rebuilt if the symbol table has not been built before
     *
     *  Tree of symbol tables:
     *  ```
     *  Global Scope Symbol Table
     *      -  Source Scope Symbol Table :: Aggregate Namespaces Symbol Table (Siblings)
     *          - File 1 Symbol Table
     *          - File 2 Symbol Table
     *      -  Component A Scope Symbol Table :: Aggregate Namespaces Symbol Table (Siblings)
     *          - File 1 Symbol Table
     *          - File 2 Symbol Table
     *      -  Component B Scope Symbol Table :: Aggregate Namespaces Symbol Table (Siblings)
     *          - File 1 Symbol Table
     *          - File 2 Symbol Table
     * ```
     */
    public linkSymbolTable() {
        SymbolTable.cacheVerifier.generateToken();
        for (const file of this.getAllFiles()) {
            if (isBrsFile(file)) {
                this.linkSymbolTableDisposables.push(
                    file.parser.symbolTable.pushParentProvider(() => this.symbolTable)
                );
            }
        }
        //Add namespace aggregates to namespace member tables
        const namespaceTypesKnown = new Map<string, BscType>();

        // eslint-disable-next-line no-bitwise
        let getTypeOptions = { flags: SymbolTypeFlag.runtime | SymbolTypeFlag.typetime };

        for (const [nsName, nsContainer] of this.namespaceLookup) {
            let currentNSType: BscType = null;
            let parentNSType: BscType = null;
            const existingNsStmt = nsContainer.namespaceStatements?.[0];

            if (!nsContainer.isTopLevel) {
                parentNSType = namespaceTypesKnown.get(nsContainer.parentNameLower);
                if (!parentNSType) {
                    // we don't know about the parent namespace... uh, oh!
                    break;
                }
                currentNSType = parentNSType.getMemberType(nsContainer.fullNameLower, getTypeOptions);
            } else {
                currentNSType = this.symbolTable.getSymbolType(nsContainer.fullNameLower, getTypeOptions);
            }
            if (!isNamespaceType(currentNSType)) {
                if (!currentNSType || isReferenceType(currentNSType)) {
                    currentNSType = existingNsStmt
                        ? existingNsStmt.getType(getTypeOptions)
                        : new NamespaceType(nsName);
                    if (parentNSType) {
                        // adding as a member of existing NS
                        parentNSType.addMember(nsContainer.lastPartName, { definingNode: existingNsStmt }, currentNSType, getTypeOptions.flags);
                        this.symbolsAddedDuringLinking.push({ symbolTable: parentNSType.getMemberTable(), name: nsContainer.lastPartName, flags: getTypeOptions.flags });
                    } else {
                        this.symbolTable.addSymbol(nsContainer.lastPartName, { definingNode: existingNsStmt }, currentNSType, getTypeOptions.flags);
                        this.symbolsAddedDuringLinking.push({ symbolTable: this.symbolTable, name: nsContainer.lastPartName, flags: getTypeOptions.flags });
                    }
                } else {
                    break;
                }
            } else {
                // Existing known namespace
            }
            if (!namespaceTypesKnown.has(nsName)) {
                namespaceTypesKnown.set(nsName, currentNSType);
            }

            for (let nsStmt of nsContainer.namespaceStatements) {
                this.linkSymbolTableDisposables.push(
                    nsStmt?.getSymbolTable().addSibling(nsContainer.symbolTable)
                );
            }

            this.linkSymbolTableDisposables.push(
                currentNSType.memberTable.addSibling(nsContainer.symbolTable)
            );
        }
    }

    public unlinkSymbolTable() {
        for (const symbolToRemove of this.symbolsAddedDuringLinking) {
            this.symbolTable.removeSymbol(symbolToRemove.name);
        }
        this.symbolsAddedDuringLinking = [];
        for (const dispose of this.linkSymbolTableDisposables) {
            dispose();
        }
        this.linkSymbolTableDisposables = [];
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
                        origin: DiagnosticOrigin.Scope,
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
                    origin: DiagnosticOrigin.Scope,
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
    private diagnosticDetectFunctionCollisions(file: BrsFile) {
        for (let func of file.callables) {
            const funcName = func.getName(ParseMode.BrighterScript);
            const lowerFuncName = funcName?.toLowerCase();
            if (lowerFuncName) {

                //find function declarations with the same name as a stdlib function
                if (globalCallableMap.has(lowerFuncName)) {
                    this.diagnostics.push({
                        ...DiagnosticMessages.scopeFunctionShadowedByBuiltInFunction(),
                        range: func.nameRange,
                        file: file,
                        origin: DiagnosticOrigin.Scope

                    });
                }

                //find any functions that have the same name as a class
                const klassLink = this.getClassFileLink(lowerFuncName);
                if (klassLink) {
                    this.diagnostics.push({
                        ...DiagnosticMessages.functionCannotHaveSameNameAsClass(funcName),
                        range: func.nameRange,
                        file: file,
                        origin: DiagnosticOrigin.Scope,
                        relatedInformation: [{
                            location: util.createLocation(
                                URI.file(klassLink.file.srcPath).toString(),
                                klassLink.item.name.range
                            ),
                            message: 'Original class declared here'
                        }]
                    });
                }
            }
        }
    }

    private detectNameCollisions(file: BrsFile) {
        file.ast.walk(createVisitor({
            NamespaceStatement: (nsStmt) => {
                this.validateNameCollision(file, nsStmt, nsStmt.getNameParts()?.[0]);
            },
            ClassStatement: (classStmt) => {
                this.validateNameCollision(file, classStmt, classStmt.name);
            },
            InterfaceStatement: (ifaceStmt) => {
                this.validateNameCollision(file, ifaceStmt, ifaceStmt.tokens.name);
            },
            ConstStatement: (constStmt) => {
                this.validateNameCollision(file, constStmt, constStmt.tokens.name);
            },
            EnumStatement: (enumStmt) => {
                this.validateNameCollision(file, enumStmt, enumStmt.tokens.name);
            }
        }), {
            walkMode: WalkMode.visitStatements
        });
    }


    validateNameCollision(file: BrsFile, node: AstNode, nameIdentifier: Token) {
        const name = nameIdentifier?.text;
        if (!name || !node) {
            return;
        }
        const nameRange = nameIdentifier.range;

        const containingNamespace = node.findAncestor<NamespaceStatement>(isNamespaceStatement)?.getName(ParseMode.BrighterScript);
        const links = this.getAllFileLinks(name, containingNamespace);
        for (let link of links) {
            if (!link || link.item === node) {
                // refers to same node
                continue;
            }
            if (isNamespaceStatement(link.item) && isNamespaceStatement(node)) {
                // namespace can be declared multiple times
                continue;
            }

            const thisNodeKindName = util.getAstNodeFriendlyName(node);
            const thatNodeKindName = link.file.srcPath === 'global' ? 'Global Function' : util.getAstNodeFriendlyName(link.item) ?? '';

            let thatNameRange = (link.item as any)?.tokens?.name?.range ?? link.item?.range;

            // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check
            switch (link.item?.kind) {
                case AstNodeKind.ClassStatement: {
                    thatNameRange = (link.item as ClassStatement).name?.range;
                    break;
                }
                case AstNodeKind.NamespaceStatement: {
                    thatNameRange = (link.item as NamespaceStatement).getNameParts()?.[0]?.range;
                    break;
                }
            }

            const relatedInformation = thatNameRange ? [{
                message: `${thatNodeKindName} declared here`,
                location: util.createLocation(
                    URI.file(link.file?.srcPath).toString(),
                    thatNameRange
                )
            }] : undefined;

            this.diagnostics.push({
                file: file,
                ...DiagnosticMessages.nameCollision(thisNodeKindName, thatNodeKindName, name),
                origin: DiagnosticOrigin.Scope,
                range: nameRange,
                relatedInformation: relatedInformation
            });
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
        let validator = new BsClassValidator(this);
        validator.validate();
        this.diagnostics.push(...validator.diagnostics.map(diag => {
            return { ...diag, origin: DiagnosticOrigin.Scope };
        }));
    }

    /**
     * Detect local variables (function scope) that have the same name as scope calls
     */
    private diagnosticDetectShadowedLocalVars(file: BrsFile, callableContainerMap: CallableContainerMap) {
        const classMap = this.getClassMap();
        //loop through every function scope
        for (let funcScope of file.functionScopes) {
            //every var declaration in this function scope
            for (let varDeclaration of funcScope.variableDeclarations) {
                const varName = varDeclaration.name;
                const lowerVarName = varName.toLowerCase();

                const varIsFunction = () => {
                    return isCallableType(varDeclaration.getType());
                };

                if (
                    //has same name as stdlib
                    globalCallableMap.has(lowerVarName)
                ) {
                    //local var function with same name as stdlib function
                    if (varIsFunction()) {
                        this.diagnostics.push({
                            ...DiagnosticMessages.localVarFunctionShadowsParentFunction('stdlib'),
                            range: varDeclaration.nameRange,
                            file: file,
                            origin: DiagnosticOrigin.Scope
                        });
                    }
                } else if (callableContainerMap.has(lowerVarName)) {
                    //is same name as a callable
                    if (varIsFunction()) {
                        this.diagnostics.push({
                            ...DiagnosticMessages.localVarFunctionShadowsParentFunction('scope'),
                            range: varDeclaration.nameRange,
                            file: file,
                            origin: DiagnosticOrigin.Scope
                        });
                    } else {
                        this.diagnostics.push({
                            ...DiagnosticMessages.localVarShadowedByScopedFunction(),
                            range: varDeclaration.nameRange,
                            file: file,
                            origin: DiagnosticOrigin.Scope
                        });
                    }
                    //has the same name as an in-scope class
                } else if (classMap.has(lowerVarName)) {
                    this.diagnostics.push({
                        ...DiagnosticMessages.localVarSameNameAsClass(classMap.get(lowerVarName)?.item.getName(ParseMode.BrighterScript)),
                        range: varDeclaration.nameRange,
                        file: file,
                        origin: DiagnosticOrigin.Scope
                    });
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
                                shadowedCallable.callable.file.destPath,
                                //grab the last item in the list, which should be the closest ancestor's version
                                shadowedCallable.scope.name
                            ),
                            range: container.callable.nameRange,
                            file: container.callable.file,
                            origin: DiagnosticOrigin.Scope
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
                        file: callable.file,
                        origin: DiagnosticOrigin.Scope
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
            let referencedFile = this.getFileByRelativePath(scriptImport.destPath);
            //if we can't find the file
            if (!referencedFile) {
                //skip the default bslib file, it will exist at transpile time but should not show up in the program during validation cycle
                if (scriptImport.destPath === this.program.bslibPkgPath) {
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
                    file: scriptImport.sourceFile,
                    origin: DiagnosticOrigin.Scope
                });
                //if the character casing of the script import path does not match that of the actual path
            } else if (scriptImport.destPath !== referencedFile.destPath) {
                this.diagnostics.push({
                    ...DiagnosticMessages.scriptImportCaseMismatch(referencedFile.destPath),
                    range: scriptImport.filePathRange,
                    file: scriptImport.sourceFile,
                    origin: DiagnosticOrigin.Scope
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
            if (file.destPath.toLowerCase() === relativePath.toLowerCase()) {
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
     * Get the definition (where was this thing first defined) of the symbol under the position
     */
    public getDefinition(file: BscFile, position: Position): Location[] {
        // Overridden in XMLScope. Brs files use implementation in BrsFile
        return [];
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

interface AugmentedNewExpression extends NewExpression {
    file: BscFile;
}
