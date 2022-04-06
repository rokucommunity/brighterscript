import type { CompletionItem, Position, Range } from 'vscode-languageserver';
import * as path from 'path';
import { CompletionItemKind, Location } from 'vscode-languageserver';
import chalk from 'chalk';
import type { DiagnosticInfo } from './DiagnosticMessages';
import { DiagnosticMessages } from './DiagnosticMessages';
import type { CallableContainer, BsDiagnostic, FileReference, BscFile, CallableContainerMap, FileLink } from './interfaces';
import type { Program } from './Program';
import { BsClassValidator } from './validators/ClassValidator';
import type { NamespaceStatement, Statement, FunctionStatement, ClassStatement, EnumStatement } from './parser/Statement';
import type { NewExpression } from './parser/Expression';
import { ParseMode } from './parser/Parser';
import { standardizePath as s, util } from './util';
import { globalCallableMap } from './globalCallables';
import { Cache } from './Cache';
import { URI } from 'vscode-uri';
import { LogLevel } from './Logger';
import type { BrsFile } from './files/BrsFile';
import type { DependencyGraph, DependencyChangedEvent } from './DependencyGraph';
import { isBrsFile, isClassMethodStatement, isClassStatement, isCustomType, isEnumStatement, isFunctionStatement, isFunctionType, isLiteralExpression, isXmlFile } from './astUtils/reflection';
import { nodes, components } from './roku-types';
import type { Token } from './lexer/Token';

/**
 * The lower-case names of all platform-included scenegraph nodes
 */
const platformNodeNames = new Set(Object.values(nodes).map(x => x.name.toLowerCase()));
const platformComponentNames = new Set(Object.values(components).map(x => x.name.toLowerCase()));

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
    * Tests if a class exists with the specified name
    * @param className - the all-lower-case namespace-included class name
    * @param containingNamespace - The namespace used to resolve relative class names. (i.e. the namespace around the current statement trying to find a class)
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
     * Get the file with the specified pkgPath
     */
    public getFile(pathAbsolute: string) {
        pathAbsolute = s`${pathAbsolute}`;
        let files = this.getAllFiles();
        for (let file of files) {
            if (file.pathAbsolute === pathAbsolute) {
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
                    let file = this.program.getFileByPkgPath(dependency);
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
                            statements: [],
                            enumStatements: new Map<string, EnumStatement>()
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
            callables = callables.sort((a, b) => {
                return (
                    //sort by path
                    a.callable.file.pathAbsolute.localeCompare(b.callable.file.pathAbsolute) ||
                    //then sort by method name
                    a.callable.name.localeCompare(b.callable.name)
                );
            });

            //get a list of all callables, indexed by their lower case names
            let callableContainerMap = util.getCallableContainersByLowerName(callables);
            let files = this.getOwnFiles();

            this.program.plugins.emit('beforeScopeValidate', this, files, callableContainerMap);

            this.program.plugins.emit('onScopeValidate', {
                program: this.program,
                scope: this
            });
            this._validate(callableContainerMap);

            this.program.plugins.emit('afterScopeValidate', this, files, callableContainerMap);

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
            this.diagnosticDetectCallsToUnknownFunctions(file, callableContainerMap);
            this.diagnosticDetectFunctionCallsWithWrongParamCount(file, callableContainerMap);
            this.diagnosticDetectShadowedLocalVars(file, callableContainerMap);
            this.diagnosticDetectFunctionCollisions(file);
            this.detectVariableNamespaceCollisions(file);
            this.diagnosticDetectInvalidFunctionExpressionTypes(file);
            this.validateCreateObjectCalls(file);
        });
    }

    /**
     * Validate every function call to `CreateObject`.
     * Ideally we would create better type checking/handling for this, but in the mean time, we know exactly
     * what these calls are supposed to look like, and this is a very common thing for brs devs to do, so just
     * do this manually for now.
     */
    protected validateCreateObjectCalls(file: BrsFile) {
        for (const call of file.functionCalls) {
            if (call.name?.toLowerCase() === 'createobject' && isLiteralExpression(call?.args[0]?.expression)) {
                const firstParamToken = (call?.args[0]?.expression as any)?.token;
                const firstParamStringValue = firstParamToken?.text?.replace(/"/g, '');
                //if this is a `createObject('roSGNode'` call, only support known sg node types
                if (firstParamStringValue?.toLowerCase() === 'rosgnode' && isLiteralExpression(call?.args[1]?.expression)) {
                    const componentName: Token = (call?.args[1]?.expression as any)?.token;
                    //add diagnostic for unknown components
                    const unquotedComponentName = componentName?.text?.replace(/"/g, '');
                    if (unquotedComponentName && !platformNodeNames.has(unquotedComponentName.toLowerCase()) && !this.program.getComponent(unquotedComponentName)) {
                        this.diagnostics.push({
                            file: file as BscFile,
                            ...DiagnosticMessages.unknownRoSGNode(unquotedComponentName),
                            range: componentName.range
                        });
                    }
                } else if (!platformComponentNames.has(firstParamStringValue.toLowerCase())) {
                    this.diagnostics.push({
                        file: file as BscFile,
                        ...DiagnosticMessages.unknownBrightScriptComponent(firstParamStringValue),
                        range: firstParamToken.range
                    });
                } else {
                    // This is valid brightscript component
                    // TODO: validate additional arguments in createObject() to match one the constructors
                    //const brightScriptComponent = components[firstParamStringValue.toLowerCase()];
                    //const restOfArgs = call?.args.slice(1);

                }
            }
        }
    }

    /**
     * Mark this scope as invalid, which means its `validate()` function needs to be called again before use.
     */
    public invalidate() {
        (this as any).isValidated = false;
        //clear out various lookups (they'll get regenerated on demand the next time they're requested)
        this.cache.clear();
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
                                URI.file(namespace.file.pathAbsolute).toString(),
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
                            URI.file(namespace.file.pathAbsolute).toString(),
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
     * @param file
     * @param callableContainersByLowerName
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
     * @param file
     * @param callableContainerMap
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
                if (isFunctionType(varDeclaration.type)) {
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
     * Detect calls to functions that are not defined in this scope
     * @param file
     * @param callablesByLowerName
     */
    private diagnosticDetectCallsToUnknownFunctions(file: BscFile, callablesByLowerName: CallableContainerMap) {
        //validate all expression calls
        for (let expCall of file.functionCalls) {
            const lowerName = expCall.name.toLowerCase();
            //for now, skip validation on any method named "super" within `.bs` contexts.
            //TODO revise this logic so we know if this function call resides within a class constructor function
            if (file.extension === '.bs' && lowerName === 'super') {
                continue;
            }

            //get the local scope for this expression
            let scope = file.getFunctionScopeAtPosition(expCall.nameRange.start);

            //if we don't already have a variable with this name.
            if (!scope?.getVariableByName(lowerName)) {
                let callablesWithThisName: CallableContainer[];

                if (expCall.functionScope.func.namespaceName) {
                    // prefer namespaced function
                    const potentialNamespacedCallable = expCall.functionScope.func.namespaceName.getName(ParseMode.BrightScript).toLowerCase() + '_' + lowerName;
                    callablesWithThisName = callablesByLowerName.get(potentialNamespacedCallable.toLowerCase());
                }
                if (!callablesWithThisName) {
                    // just try it as is
                    callablesWithThisName = callablesByLowerName.get(lowerName);
                }

                //use the first item from callablesByLowerName, because if there are more, that's a separate error
                let knownCallable = callablesWithThisName ? callablesWithThisName[0] : undefined;

                //detect calls to unknown functions
                if (!knownCallable) {
                    this.diagnostics.push({
                        ...DiagnosticMessages.callToUnknownFunction(expCall.name, this.name),
                        range: expCall.nameRange,
                        file: file
                    });
                }
            } else {
                //if we found a variable with the same name as the function, assume the call is "known".
                //If the variable is a different type, some other check should add a diagnostic for that.
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

interface NamespaceContainer {
    file: BscFile;
    fullName: string;
    nameRange: Range;
    lastPartName: string;
    statements: Statement[];
    classStatements: Record<string, ClassStatement>;
    functionStatements: Record<string, FunctionStatement>;
    enumStatements: Map<string, EnumStatement>;
    namespaces: Map<string, NamespaceContainer>;
}

interface AugmentedNewExpression extends NewExpression {
    file: BscFile;
}
