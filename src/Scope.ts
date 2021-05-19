import type { CompletionItem, Position, Range } from 'vscode-languageserver';
import { CompletionItemKind, Location } from 'vscode-languageserver';
import chalk from 'chalk';
import type { DiagnosticInfo } from './DiagnosticMessages';
import { DiagnosticMessages } from './DiagnosticMessages';
import type { CallableContainer, BsDiagnostic, FileReference, BscFile, CallableContainerMap, FunctionCall } from './interfaces';
import type { FileLink, Program } from './Program';
import { BsClassValidator } from './validators/ClassValidator';
import type { NamespaceStatement, Statement, NewExpression, FunctionStatement, ClassStatement } from './parser';
import { ParseMode } from './parser';
import { standardizePath as s, util } from './util';
import type { MinMax } from './util';
import { globalCallableMap } from './globalCallables';
import { Cache } from './Cache';
import { URI } from 'vscode-uri';
import { LogLevel } from './Logger';
import { isBrsFile, isClassStatement, isFunctionStatement, isFunctionType, isXmlFile, isCustomType, isClassMethodStatement, isLazyType, isInvalidType, isDynamicType } from './astUtils/reflection';
import type { BrsFile } from './files/BrsFile';
import type { DependencyGraph, DependencyChangedEvent } from './DependencyGraph';
import { SymbolTable } from './SymbolTable';
import type { CustomType } from './types/CustomType';
import { UninitializedType } from './types/UninitializedType';
import { ObjectType } from './types/ObjectType';


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
   * Gets the parent class of the given class
   * @param klass - The class to get the parent of, if possible
   */
    public getParentClass(klass: ClassStatement): ClassStatement {
        if (klass?.hasParentClass()) {
            const lowerParentClassName = klass.parentClassName?.getName(ParseMode.BrighterScript).toLowerCase();
            return this.getClassMap().get(lowerParentClassName)?.item;
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

    public getAncestorTypeList(className: string): CustomType[] {
        const ancestors: CustomType[] = [];
        const classMap = this.getClassMap();
        let currentClass = classMap.get(className?.toLowerCase())?.item;
        ancestors.push(currentClass?.getCustomType());

        while (currentClass?.hasParentClass()) {
            currentClass = classMap.get(currentClass.parentClassName.getName(ParseMode.BrighterScript).toLowerCase())?.item;
            ancestors.push(currentClass?.getCustomType());
        }
        //TODO: this should probably be cached
        return ancestors;
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
    public getAllFiles() {
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
            if (callable.callable.getName(ParseMode.BrighterScript).toLowerCase() === lowerName) {
                return callable.callable;
            }
        }
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
        let namespaceLookup = {} as Record<string, NamespaceContainer>;
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
                    namespaceLookup[lowerLoopName] = namespaceLookup[lowerLoopName] ?? {
                        file: file,
                        fullName: loopName,
                        nameRange: namespace.nameExpression.range,
                        lastPartName: part,
                        namespaces: {},
                        classStatements: {},
                        functionStatements: {},
                        statements: [],
                        symbolTable: new SymbolTable(this.symbolTable)
                    };
                }
                let ns = namespaceLookup[name.toLowerCase()];
                ns.statements.push(...namespace.body.statements);
                for (let statement of namespace.body.statements) {
                    if (isClassStatement(statement) && statement.name) {
                        ns.classStatements[statement.name.text.toLowerCase()] = statement;
                    } else if (isFunctionStatement(statement) && statement.name) {
                        ns.functionStatements[statement.name.text.toLowerCase()] = statement;
                    }
                }
                // Merges all the symbol tables of the namespace statements into the new symbol table created above.
                // Set those symbol tables to have this new merged table as a parent
                ns.symbolTable.mergeSymbolTable(namespace.symbolTable);
            }

            //associate child namespaces with their parents
            for (let key in namespaceLookup) {
                let ns = namespaceLookup[key];
                let parts = ns.fullName.split('.');

                if (parts.length > 1) {
                    //remove the last part
                    parts.pop();
                    let parentName = parts.join('.');
                    namespaceLookup[parentName.toLowerCase()].namespaces[ns.lastPartName.toLowerCase()] = ns;
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

        //enforce a series of checks on the bodies of class methods
        this.validateClasses();

        //do many per-file checks
        this.enumerateBrsFiles((file) => {
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
    }

    public get symbolTable() {
        if (!this._symbolTable) {
            this._symbolTable = new SymbolTable(this.getParentScope()?.symbolTable);
            this._symbolTable.addSymbol('m', null, new ObjectType());

            for (let file of this.getOwnFiles()) {
                if (isBrsFile(file)) {
                    this._symbolTable.mergeSymbolTable(file.parser?.symbolTable);
                }
            }
        }
        return this._symbolTable;
    }
    private _symbolTable: SymbolTable;

    private clearSymbolTable() {
        this._symbolTable = null;
    }

    /**
    * Builds the current symbol table for the scope, by merging the tables for all the files in this scope.
    * Also links all file symbols tables to this new table
    * This will only rebuilt if the symbol table has not been built before
    */
    public linkSymbolTable() {
        for (const file of this.getOwnFiles()) {
            if (isBrsFile(file)) {
                file.parser?.symbolTable.setParent(this.symbolTable);

                for (const namespace of file.parser.references.namespaceStatements) {
                    const namespaceNameLower = namespace.nameExpression.getName(ParseMode.BrighterScript).toLowerCase();
                    const namespaceSymbolTable = this.namespaceLookup[namespaceNameLower].symbolTable;
                    namespace.symbolTable.setParent(namespaceSymbolTable);
                }
            }
        }
        // also link classes
        const classMap = this.getClassMap();
        for (const pair of classMap) {
            const classStmt = pair[1]?.item;
            if (classStmt?.hasParentClass()) {
                const parentClass = this.getParentClass(classStmt);
                // set the parent of the class's symbol table to the symbol table of the class it extends
                classStmt.symbolTable.setParent(parentClass?.symbolTable);
            }
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

        // also unlink classes
        const classMap = this.getClassMap();
        for (const pair of classMap) {
            const fileLink = pair[1];
            fileLink?.item.symbolTable.setParent(null);
        }
    }

    private detectVariableNamespaceCollisions(file: BrsFile) {
        //find all function parameters
        for (let func of file.parser.references.functionExpressions) {
            for (let param of func.parameters) {
                let lowerParamName = param.name.text.toLowerCase();
                let namespace = this.namespaceLookup[lowerParamName];
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
            let namespace = this.namespaceLookup[lowerAssignmentName];
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
            if (isCustomType(func.returnType) && func.returnTypeToken) {
                // check if this custom type is in our class map
                const returnTypeName = func.returnType.name;
                const currentNamespaceName = func.namespaceName?.getName(ParseMode.BrighterScript);
                if (!this.hasClass(returnTypeName, currentNamespaceName)) {
                    this.diagnostics.push({
                        ...DiagnosticMessages.invalidFunctionReturnType(returnTypeName),
                        range: func.returnTypeToken.range,
                        file: file
                    });
                }
            }

            for (let param of func.parameters) {
                if (isCustomType(param.type) && param.typeToken) {
                    const paramTypeName = param.type.name;
                    const currentNamespaceName = func.namespaceName?.getName(ParseMode.BrighterScript);
                    if (!this.hasClass(paramTypeName, currentNamespaceName)) {
                        this.diagnostics.push({
                            ...DiagnosticMessages.functionParameterTypeIsInvalid(param.name.text, paramTypeName),
                            range: param.typeToken.range,
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
                if (!isFunctionType(funcType)) {
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
                    // Check for Argument count mismatch.
                    //get min/max parameter count for callable
                    let paramCount = util.getMinMaxParamCount(funcType.params);
                    if (expCall.args.length > paramCount.max || expCall.args.length < paramCount.min) {
                        this.addMismatchParamCountDiagnostic(paramCount, expCall, file);
                    }

                    // Check for Argument type mismatch.
                    for (let index = 0; index < funcType.params.length; index++) {
                        const param = funcType.params[index];
                        const arg = expCall.args[index];
                        if (!arg) {
                            // not enough args
                            break;
                        }
                        let argType = arg.type ?? new UninitializedType();
                        let assignable = false;
                        if (isLazyType(argType)) {
                            // If this is a lazy type, you have to take into account the possibility that it might be a custom type
                            argType = argType.getTypeFromContext({ file: file, scope: this });
                        }
                        if (isCustomType(argType)) {
                            assignable = argType.isAssignableTo(param.type, this.getAncestorTypeList(argType.name));
                        } else {
                            assignable = argType?.isAssignableTo(param.type);
                        }
                        if (!assignable) {
                            // TODO: perhaps this should be a strict mode setting?
                            assignable = argType?.isConvertibleTo(param.type);
                        }
                        if (!assignable) {
                            this.diagnostics.push({
                                ...DiagnosticMessages.argumentTypeMismatch(argType?.toString(), param.type.toString()),
                                range: arg?.range,
                                file: file
                            });
                        }
                    }
                } else if (isInvalidType(symbolTypeInfo.type)) {
                    // TODO: standard member functions like integer.ToStr() are not detectable yet.
                } else if (isDynamicType(symbolTypeInfo.type)) {
                    // maybe this is a function? who knows
                } else {
                    this.diagnostics.push({
                        ...DiagnosticMessages.callToUnknownFunction(symbolTypeInfo.expandedTokenText, this.name),
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

    private validateClasses() {
        let validator = new BsClassValidator();
        validator.validate(this);
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
            for (let symbol of func.symbolTable.ownSymbols) {
                const symbolNameLower = symbol.name.toLowerCase();
                //if the var is a function
                if (isFunctionType(symbol.type)) {
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
                            kind: isClassMethodStatement(s) ? CompletionItemKind.Method : CompletionItemKind.Field
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
    namespaces: Record<string, NamespaceContainer>;
    symbolTable: SymbolTable;
}

interface AugmentedNewExpression extends NewExpression {
    file: BscFile;
}
