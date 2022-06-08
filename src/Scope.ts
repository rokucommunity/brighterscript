import type { CompletionItem, Position, Range } from 'vscode-languageserver';
import { CompletionItemKind, Location } from 'vscode-languageserver';
import chalk from 'chalk';
import type { DiagnosticInfo } from './DiagnosticMessages';
import { DiagnosticMessages } from './DiagnosticMessages';
import type { CallableContainer, BsDiagnostic, FileReference, BscFile, CallableContainerMap, FileLink, FunctionCall, InheritableStatement, InheritableType, NamedTypeStatement } from './interfaces';
import type { Program } from './Program';
import { BsClassValidator } from './validators/ClassValidator';
import type { NamespaceStatement, Statement, FunctionStatement, ClassStatement, EnumStatement, InterfaceStatement } from './parser/Statement';
import type { FunctionExpression, NewExpression } from './parser/Expression';
import { ParseMode } from './parser/Parser';
import { standardizePath as s, util } from './util';
import type { MinMax } from './util';
import { globalCallableMap } from './globalCallables';
import { Cache } from './Cache';
import { URI } from 'vscode-uri';
import { LogLevel } from './Logger';
import type { BrsFile, TokenSymbolLookup } from './files/BrsFile';
import type { DependencyGraph, DependencyChangedEvent } from './DependencyGraph';
import { isBrsFile, isMethodStatement, isClassStatement, isCustomType, isDynamicType, isEnumStatement, isFunctionStatement, isTypedFunctionType, isInvalidType, isFunctionType, isVariableExpression, isXmlFile, isArrayType, isInterfaceType, isInterfaceStatement } from './astUtils/reflection';
import { SymbolTable } from './SymbolTable';
import type { BscType, TypeContext } from './types/BscType';
import { getTypeFromContext } from './types/BscType';
import { DynamicType } from './types/DynamicType';
import { ObjectType } from './types/ObjectType';
import { UninitializedType } from './types/UninitializedType';
import type { Token } from './lexer/Token';

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
    public isValidated: boolean;

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
     * Get either the class or interface, etc. with a given name
     * @param name - The name, including the namespace of the interface if possible
     * @param containingNamespace - The namespace used to resolve relative names. (i.e. the namespace around the current statement trying to find the interface or class)
     */
    public getNamedTypeStatement(name: string, containingNamespace?: string): NamedTypeStatement {
        return this.getNamedTypeFileLink(name, containingNamespace)?.item;
    }

    /**
     * A cache of a map of tokens -> TokenSymbolLookups, which are the result of getSymbolTypeFromToken()
     * Sometimes the lookup of symbols may take a while if there are lazyTypes or multiple tokens in a chain
     * By caching the result of this lookup, subsequent lookups of the same tokens are quicker
     */
    public get symbolCache() {
        return this.cache.getOrAdd('symbolCache', () => new Map<Token, TokenSymbolLookup>());
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
   * Get a Named Type (e.g. Class, Interface, Enum) and its containing file by the name
   * @param name - The name of the type, including the namespace of the class/interface/enum, etc. if possible
   * @param containingNamespace - The namespace used to resolve relative names. (i.e. the namespace around the current statement trying to find a class)
   */
    public getNamedTypeFileLink(name: string, containingNamespace?: string): FileLink<NamedTypeStatement> {
        return this.getInheritableFileLink(name, containingNamespace) || this.getEnumFileLink(name, containingNamespace);
    }

    /**
     * Get a InheritableStatement and its containing file by the name of the interface or class
     * @param name - The name of the interface or class, including the namespace of the class if possible
     * @param containingNamespace - The namespace used to resolve relative names. (i.e. the namespace around the current statement trying to find a class)
     */
    public getInheritableFileLink(name: string, containingNamespace?: string): FileLink<InheritableStatement> {
        return this.getClassFileLink(name, containingNamespace) || this.getInterfaceFileLink(name, containingNamespace);
    }

    /**
     * Gets the parent class of the given class
     * @param klass - The class to get the parent of, if possible
     */
    public getParentClass(klass: ClassStatement): ClassStatement {
        if (klass?.hasParent()) {
            const lowerParentClassNames = klass.getPossibleFullParentNames().map(name => name.toLowerCase());
            for (const lowerParentClassName of lowerParentClassNames) {
                const foundParent = this.getClassMap().get(lowerParentClassName);
                if (foundParent) {
                    return foundParent.item;
                }
            }
        }
    }

    /**
     * Gets the parent interface of the given interface
     * @param iface - The interface to get the parent of, if possible
     */
    public getParentInterface(iface: InterfaceStatement): InterfaceStatement {
        if (iface?.hasParent()) {
            const lowerParentClassNames = iface.getPossibleFullParentNames().map(name => name.toLowerCase());
            for (const lowerParentClassName of lowerParentClassNames) {
                const foundParent = this.getInterfaceMap().get(lowerParentClassName);
                if (foundParent) {
                    return foundParent.item;
                }
            }
        }
    }

    /**
    * Gets the parent of an Interface or Class
    * @param stmt - The class or interface to get the parent of, if possible
    */
    public getParentStatement(stmt: InheritableStatement): InheritableStatement {
        if (isInterfaceStatement(stmt)) {
            return this.getParentInterface(stmt);
        } else if (isClassStatement(stmt)) {
            return this.getParentClass(stmt);
        }
    }

    /**
    * Tests if a class exists with the specified name
    * @param className - the all-lower-case namespace-included class name
    * @param namespaceName - the current namespace name
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
     * Tests if a class OR an interface, etc. exists with the specified name
     * @param name - the all-lower-case namespace-included class or interface name
     * @param namespaceName - the current namespace name
     */
    public hasNamedType(name: string, namespaceName?: string): boolean {
        return !!this.getNamedTypeStatement(name, namespaceName);
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


    public getAncestorTypeListByContext(thisType: BscType, context?: TypeContext): InheritableType[] {
        const funcExpr = context?.file?.getFunctionExpressionAtPosition(context?.position);
        if (isCustomType(thisType) || isInterfaceType(thisType)) {
            return this.getAncestorTypeList(thisType.name, funcExpr);
        }
        return [];
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

    public getAncestorTypeList(className: string, functionExpression?: FunctionExpression): InheritableType[] {
        const lowerNamespaceName = functionExpression.namespaceName?.getName().toLowerCase();
        const ancestors: InheritableType[] = [];
        let currentClassOrIFace = this.getInheritableFileLink(className, lowerNamespaceName)?.item;
        if (currentClassOrIFace) {
            ancestors.push(currentClassOrIFace?.getThisBscType());
        }
        while (currentClassOrIFace?.hasParent()) {
            currentClassOrIFace = this.getParentStatement(currentClassOrIFace);
            ancestors.push(currentClassOrIFace?.getThisBscType());
        }
        // TODO TYPES: this should probably be cached
        return ancestors;
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
        //use the global scope if we didn't find a scope and this is not the global scope
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
     * Get the file with the specified pkgPath
     * @param filePath can be a srcPath, a pkgPath, or a destPath (same as pkgPath but without `pkg:/`)
     * @param normalizePath should this function repair and standardize the path? Passing false should have a performance boost if you can guarantee your path is already sanitized
     */
    public getFile(srcPath: string, normalizePath = true) {
        if (normalizePath) {
            srcPath = s`${srcPath}`;
        }
        let files = this.getAllFiles();
        for (let file of files) {
            if (file.srcPath === srcPath) {
                return file;
            }
        }
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
                    let file = this.program.getFile(dependency, false);
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
     * @param name
     */
    public getCallableByName(name: string) {
        let lowerName = name.toLowerCase();
        let callables = this.getAllCallables();
        for (let callable of callables) {
            const callableName = callable.callable.getName(ParseMode.BrighterScript);
            // Split by `.` and check the last term to consider namespaces.
            if (callableName.toLowerCase() === lowerName || callableName.split('.').pop()?.toLowerCase() === lowerName) {
                return callable.callable;
            }
        }
    }

    /**
     * Get the global callable with the specified name.
     * If there are overridden callables with the same name, the closest callable to this scope is returned
     * @param name
     */
    public getGlobalCallableByName(name: string) {
        return globalCallableMap.get(name.toLowerCase());
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
            for (let namespace of file.parser.references.namespaceStatements) {
                //TODO should we handle non-brighterscript?
                let name = namespace.nameExpression.getName(ParseMode.BrighterScript);
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
                            nameRange: namespace.nameExpression.range,
                            lastPartName: part,
                            namespaces: new Map<string, NamespaceContainer>(),
                            classStatements: {},
                            functionStatements: {},
                            enumStatements: new Map<string, EnumStatement>(),
                            statements: [],
                            symbolTable: new SymbolTable(this.symbolTable)
                        });
                    }
                }
                let ns = namespaceLookup.get(name.toLowerCase());
                ns.statements.push(...namespace.body.statements);
                for (let statement of namespace.body.statements) {
                    if (isClassStatement(statement) && statement.name) {
                        ns.classStatements[statement.name.text.toLowerCase()] = statement;
                    } else if (isFunctionStatement(statement) && statement.name) {
                        ns.functionStatements[statement.name.text.toLowerCase()] = statement;
                    } else if (isEnumStatement(statement) && statement.fullName) {
                        ns.enumStatements.set(statement.fullName.toLowerCase(), statement);
                    }
                }
                // Merges all the symbol tables of the namespace statements into the new symbol table created above.
                // Set those symbol tables to have this new merged table as a parent
                ns.symbolTable.mergeSymbolTable(namespace.symbolTable);
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

    public validate() {
        this.program.logger.time(LogLevel.debug, [this._debugLogComponentName, 'validate()'], () => {

            let parentScope = this.getParentScope();

            //validate our parent before we validate ourself
            if (parentScope?.isValidated === false) {
                this.logDebug('validate(): validating parent first');
                parentScope.validate();
            }
            //clear the scope's errors list (we will populate them from this method)
            this.diagnostics = [];

            // link the symbol table
            this.linkSymbolTable();

            let callables = this.getAllCallables();

            //sort the callables by filepath and then method name, so the errors will be consistent
            callables = callables.sort((a, b) => {
                return (
                    //sort by path
                    a.callable.file.srcPath.localeCompare(b.callable.file.srcPath) ||
                    //then sort by method name
                    a.callable.name.localeCompare(b.callable.name)
                );
            });

            //get a list of all callables, indexed by their lower case names
            let callableContainerMap = util.getCallableContainersByLowerName(callables);

            this.program.plugins.emit('onScopeValidate', {
                program: this.program,
                scope: this
            });
            this._validate(callableContainerMap);

            // unlink the symbol table so it can't be accessed from the wrong scope
            this.unlinkSymbolTable();
        });
    }

    protected _validate(callableContainerMap: CallableContainerMap) {
        //find all duplicate function declarations
        this.diagnosticFindDuplicateFunctionDeclarations(callableContainerMap);

        //detect missing and incorrect-case script imports
        this.diagnosticValidateScriptImportPaths();


        //do many per-file checks
        this.enumerateBrsFiles((file) => {
            //enforce a series of checks on the bodies of class methods
            this.validateClasses(file);
            this.diagnosticDetectShadowedLocalVars(file, callableContainerMap);
            this.diagnosticDetectFunctionCollisions(file);
            this.detectVariableNamespaceCollisions(file);
            this.diagnosticDetectInvalidFunctionExpressionTypes(file);
            this.diagnosticDetectInvalidFunctionCalls(file, callableContainerMap);
        });
    }

    /**
     * Mark this scope as invalid, which means its `validate()` function needs to be called again before use.
     */
    public invalidate() {
        (this as any).isValidated = false;
        //clear out various lookups (they'll get regenerated on demand the next time they're requested)
        this.cache.clear();
        this.clearSymbolTable();
        this.symbolCache.clear();
    }


    public get symbolTable() {
        if (!this._symbolTable) {
            this._symbolTable = new SymbolTable(this.getParentScope()?.symbolTable);
            this._symbolTable.addSymbol('m', null, new ObjectType('object', this.memberTable));
            for (let file of this.getOwnFiles()) {
                if (isBrsFile(file)) {
                    this._symbolTable.mergeSymbolTable(file.parser?.symbolTable);
                }
            }
        }
        return this._symbolTable;
    }
    private _symbolTable: SymbolTable;
    protected _memberTable: SymbolTable;

    public get memberTable() {
        if (!this._memberTable) {
            this._memberTable = new SymbolTable(this.getParentScope()?.memberTable);
            if (!this.getParentScope()) {
                this._memberTable.addSymbol('global', null, new ObjectType());
            }
        }
        return this._memberTable;
    }

    protected clearSymbolTable() {
        this._symbolTable = null;
        this._memberTable = null;
    }

    /**
    * Builds the current symbol table for the scope, by merging the tables for all the files in this scope.
    * Also links all file symbols tables to this new table
    * This will only rebuilt if the symbol table has not been built before
    */
    public linkSymbolTable() {
        for (const file of this.getAllFiles()) {
            if (isBrsFile(file)) {
                file.parser.symbolTable.setParent(this.symbolTable);

                for (const namespace of file.parser.references.namespaceStatements) {
                    const namespaceNameLower = namespace.nameExpression.getName(ParseMode.BrighterScript).toLowerCase();
                    const namespaceSymbolTable = this.namespaceLookup.get(namespaceNameLower).symbolTable;
                    namespace.symbolTable.setParent(namespaceSymbolTable);
                }
                //TODO TYPES: build symbol tables for dotted set assignments using actual values
                // Currently this is prone to call-stack issues.
                // eg. m.key = "value"

                for (const dotSetStmt of file.parser.references.dottedSetStatements) {
                    if (isVariableExpression(dotSetStmt.obj)) {
                        if (dotSetStmt.obj.getName(ParseMode.BrighterScript).toLowerCase() === 'm') {
                            this.memberTable.addSymbol(dotSetStmt.name.text, dotSetStmt.range, new DynamicType());
                            // TODO TYPES: get actual types: getBscTypeFromExpression(dotSetStmt.value, file.parser.references.getContainingFunctionExpression(dotSetStmt.name)));
                        }
                    } else {
                        // TODO TYPES: What other types of expressions could these be?
                    }
                }
            }
        }
        // also link classes
        const classMap = this.getClassMap();
        for (const pair of classMap) {
            const classStmt = pair[1]?.item;
            classStmt?.buildSymbolTable(this.getParentClass(classStmt));
        }

        // also link interfaces
        const ifaceMap = this.getInterfaceMap();
        for (const pair of ifaceMap) {
            const ifaceStmt = pair[1]?.item;
            ifaceStmt?.buildSymbolTable(this.getParentInterface(ifaceStmt));
        }

        //also link enums
        const enumMap = this.getEnumMap();
        for (const pair of enumMap) {
            const enumStmt = pair[1]?.item;
            enumStmt?.buildSymbolTable();
        }
    }

    public unlinkSymbolTable() {
        for (let file of this.getOwnFiles()) {
            if (isBrsFile(file)) {
                file.parser?.symbolTable.setParent(null);

                for (const namespace of file.parser.references.namespaceStatements) {
                    namespace.symbolTable.setParent(null);
                }
            }
        }

    }

    private detectVariableNamespaceCollisions(file: BrsFile) {
        //find all function parameters
        for (let func of file.parser.references.functionExpressions) {
            for (let param of func.parameters) {
                let lowerParamName = param.name.text.toLowerCase();
                let namespace = this.namespaceLookup.get(lowerParamName);
                //see if the param matches any starting namespace part
                if (namespace) {
                    this.diagnostics.push({
                        file: file,
                        ...DiagnosticMessages.parameterMayNotHaveSameNameAsNamespace(param.name.text),
                        range: param.name.range,
                        relatedInformation: [{
                            message: 'Namespace declared here',
                            location: Location.create(
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
            let namespace = this.namespaceLookup.get(lowerAssignmentName);
            //see if the param matches any starting namespace part
            if (namespace) {
                this.diagnostics.push({
                    file: file,
                    ...DiagnosticMessages.variableMayNotHaveSameNameAsNamespace(assignment.name.text),
                    range: assignment.name.range,
                    relatedInformation: [{
                        message: 'Namespace declared here',
                        location: Location.create(
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

    /**
    * Find function parameters and function return types that are neither built-in types or known Class references
    */
    private diagnosticDetectInvalidFunctionExpressionTypes(file: BrsFile) {
        for (let func of file.parser.references.functionExpressions) {
            const returnType = getTypeFromContext(func.getReturnType(), { file: file, scope: this, position: func.range?.start });
            if (!returnType && func.returnType) {
                // check if this custom type is in our class map
                const returnTypeName = func.returnType.getText();
                const currentNamespaceName = func.namespaceName?.getName(ParseMode.BrighterScript);
                if (!this.hasClass(returnTypeName, currentNamespaceName) && !this.hasInterface(returnTypeName) && !this.hasEnum(returnTypeName)) {
                    this.diagnostics.push({
                        ...DiagnosticMessages.invalidFunctionReturnType(returnTypeName),
                        range: func.returnType.range,
                        file: file
                    });
                }
            }

            for (let param of func.parameters) {
                const typeContext = { file: file, scope: this, position: param.range?.start };
                let paramType = getTypeFromContext(param.getType(), typeContext);
                while (isArrayType(paramType)) {
                    paramType = getTypeFromContext(paramType.getDefaultType(typeContext), typeContext);
                }

                if (!paramType && param.type) {
                    const paramTypeName = param.type.getText();
                    const currentNamespaceName = func.namespaceName?.getName(ParseMode.BrighterScript);
                    if (!this.hasClass(paramTypeName, currentNamespaceName) && !this.hasInterface(paramTypeName) && !this.hasEnum(paramTypeName)) {
                        this.diagnostics.push({
                            ...DiagnosticMessages.functionParameterTypeIsInvalid(param.name.text, paramTypeName),
                            range: param.type.range,
                            file: file
                        });

                    }
                }
            }
        }
    }

    /**
    * Find functions with either the wrong type of parameters, or the wrong number of parameters
    */
    private diagnosticDetectInvalidFunctionCalls(file: BscFile, callableContainersByLowerName: CallableContainerMap) {
        if (isBrsFile(file)) {
            for (let expCall of file.functionCalls) {
                const symbolTypeInfo = file.getSymbolTypeFromToken(expCall.name, expCall.functionExpression, this);
                let funcType = symbolTypeInfo.type;
                if (!isTypedFunctionType(funcType) && !isDynamicType(funcType)) {
                    // We don't know if this is a function. Try seeing if it is a global
                    const callableContainer = util.getCallableContainerByFunctionCall(callableContainersByLowerName, expCall);
                    if (callableContainer) {
                        // We found a global callable with correct number of params - use that
                        funcType = callableContainer.callable?.type;
                    } else {
                        const allowedParamCount = util.getMinMaxParamCountByFunctionCall(callableContainersByLowerName, expCall);
                        if (allowedParamCount) {
                            // We found a global callable, but it needs a different number of args
                            this.addMismatchParamCountDiagnostic(allowedParamCount, expCall, file);
                            continue;
                        }
                    }
                }

                if (isFunctionType(funcType)) {
                    // This is a generic function, and it is callable
                } else if (isTypedFunctionType(funcType)) {
                    // Check for Argument count mismatch.
                    //get min/max parameter count for callable
                    let paramCount = util.getMinMaxParamCount(funcType.params);
                    if (expCall.args.length > paramCount.max || expCall.args.length < paramCount.min) {
                        this.addMismatchParamCountDiagnostic(paramCount, expCall, file);
                    }

                    // Check for Argument type mismatch.
                    const paramTypeContext = { file: file, scope: this, position: expCall.functionExpression.range?.start };
                    const argTypeContext = { file: file, scope: this, position: expCall.range?.start };
                    for (let index = 0; index < funcType.params.length; index++) {
                        const param = funcType.params[index];
                        const arg = expCall.args[index];
                        if (!arg) {
                            // not enough args
                            break;
                        }
                        let argType = arg.type ?? new UninitializedType();
                        const paramType = getTypeFromContext(param.type, paramTypeContext);
                        if (!paramType) {
                            // other error - can not determine what type this parameter should be
                            continue;
                        }
                        argType = getTypeFromContext(argType, argTypeContext);
                        let assignable = argType?.isAssignableTo(paramType, argTypeContext);
                        if (!assignable) {
                            // TODO TYPES: perhaps this should be a strict mode setting?
                            assignable = argType?.isConvertibleTo(paramType, argTypeContext);
                        }
                        if (!assignable) {
                            this.diagnostics.push({
                                ...DiagnosticMessages.argumentTypeMismatch(argType?.toString(argTypeContext), paramType.toString(paramTypeContext)),
                                range: arg?.range,
                                file: file
                            });
                        }
                    }
                } else if (isInvalidType(symbolTypeInfo.type)) {
                    // TODO TYPES: standard member functions like integer.ToStr() are not detectable yet.
                } else if (isDynamicType(symbolTypeInfo.type)) {
                    // maybe this is a function? who knows
                } else {
                    const functionNameText = symbolTypeInfo.expandedTokenText;
                    this.diagnostics.push({
                        ...DiagnosticMessages.callToUnknownFunction(functionNameText, this.name),
                        range: expCall.nameRange,
                        //TODO detect end of expression call
                        file: file
                    });
                }
            }
        }
    }

    private addMismatchParamCountDiagnostic(paramCount: MinMax, expCall: FunctionCall, file: BscFile) {
        const minMaxParamsText = paramCount.min === paramCount.max ? paramCount.max : `${paramCount.min}-${paramCount.max}`;
        const expCallArgCount = expCall.args.length;
        this.diagnostics.push({
            ...DiagnosticMessages.mismatchArgumentCount(minMaxParamsText, expCallArgCount),
            range: expCall.nameRange,
            file: file
        });
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

    private validateClasses(file: BrsFile) {
        let validator = new BsClassValidator();
        validator.validate(this, file);
        this.diagnostics.push(...validator.diagnostics);
    }

    /**
     * Detect local variables (vars declared within a function expression) that have the same name as scope calls
     * @param file
     * @param callableContainerMap
     */
    private diagnosticDetectShadowedLocalVars(file: BrsFile, callableContainerMap: CallableContainerMap) {
        const classMap = this.getClassMap();

        for (let func of file.parser.references.functionExpressions) {
            //every var declaration in this function expression
            for (let symbol of func.symbolTable.getOwnSymbols()) {
                const symbolNameLower = symbol.name.toLowerCase();
                //if the var is a function
                if (isTypedFunctionType(symbol.type)) {
                    //local var function with same name as stdlib function
                    if (
                        //has same name as stdlib
                        globalCallableMap.has(symbolNameLower)
                    ) {
                        this.diagnostics.push({
                            ...DiagnosticMessages.localVarFunctionShadowsParentFunction('stdlib'),
                            range: symbol.range,
                            file: file
                        });

                        //this check needs to come after the stdlib one, because the stdlib functions are included
                        //in the scope function list
                    } else if (
                        //has same name as scope function
                        callableContainerMap.has(symbolNameLower)
                    ) {
                        this.diagnostics.push({
                            ...DiagnosticMessages.localVarFunctionShadowsParentFunction('scope'),
                            range: symbol.range,
                            file: file
                        });
                    }

                    //var is not a function
                } else if (
                    //is NOT a callable from stdlib (because non-function local vars can have same name as stdlib names)
                    !globalCallableMap.has(symbolNameLower)
                ) {

                    //is same name as a callable
                    if (callableContainerMap.has(symbolNameLower)) {
                        this.diagnostics.push({
                            ...DiagnosticMessages.localVarShadowedByScopedFunction(),
                            range: symbol.range,
                            file: file
                        });
                        //has the same name as an in-scope class
                    } else if (classMap.has(symbolNameLower)) {
                        this.diagnostics.push({
                            ...DiagnosticMessages.localVarSameNameAsClass(classMap.get(symbolNameLower).item.getName(ParseMode.BrighterScript)),
                            range: symbol.range,
                            file: file
                        });
                    }
                }
            }
        }
    }

    /**
     * Create diagnostics for any duplicate function declarations
     * @param callablesByLowerName
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
                if (scriptImport.pkgPath === `pkg:/source/bslib.brs`) {
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
     * @param relativePath
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
     * @param file
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
     *                            This is used to help resolve non-namespaced class names that reside in the same namespace as the call site.
     */
    public getClassHierarchy(className: string, callsiteNamespace?: string) {
        let items = [] as FileLink<ClassStatement>[];
        let link = this.getClassFileLink(className, callsiteNamespace);
        while (link) {
            items.push(link);
            link = this.getClassFileLink(link.item.parentClassName?.getName(ParseMode.BrighterScript)?.toLowerCase(), callsiteNamespace);
        }
        return items;
    }
}

export interface NamespaceContainer {
    file: BscFile;
    fullName: string;
    nameRange: Range;
    lastPartName: string;
    statements: Statement[];
    classStatements: Record<string, ClassStatement>;
    functionStatements: Record<string, FunctionStatement>;
    enumStatements: Map<string, EnumStatement>;
    namespaces: Map<string, NamespaceContainer>;
    symbolTable: SymbolTable;
}

interface AugmentedNewExpression extends NewExpression {
    file: BscFile;
}
