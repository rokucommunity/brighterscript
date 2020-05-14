import { EventEmitter } from 'eventemitter3';
import { CompletionItem, CompletionItemKind, Location, Position, Range } from 'vscode-languageserver';
import chalk from 'chalk';
import { DiagnosticMessages } from './DiagnosticMessages';
import { BrsFile } from './files/BrsFile';
import { XmlFile } from './files/XmlFile';
import { CallableContainer, BsDiagnostic } from './interfaces';
import { Program } from './Program';
import { BsClassValidator } from './validators/ClassValidator';
import { NamespaceStatement, ParseMode, Statement, NewExpression, FunctionStatement } from './parser';
import { ClassStatement } from './parser/ClassStatement';
import { standardizePath as s, util } from './util';
import { globalCallableMap } from './globalCallables';
import { FunctionType } from './types/FunctionType';
import { logger } from './Logger';
import { Cache } from './Cache';

/**
 * A class to keep track of all declarations within a given scope (like source scope, component scope)
 */
export class Scope {
    constructor(
        public name: string,
        public dependencyGraphKey: string,
        public program: Program
    ) {
        this.isValidated = false;
        //used for improved logging performance
        this._debugLogComponentName = `'${chalk.redBright(this.name)}'`;

        //anytime a dependency for this scope changes, we need to be revalidated
        this.programHandles.push(
            this.program.dependencyGraph.onchange(this.dependencyGraphKey, this.onDependenciesChanged.bind(this), true)
        );
    }

    /**
     * Indicates whether this scope needs to be validated.
     * Will be true when first constructed, or anytime one of its dependencies changes
     */
    public readonly isValidated: boolean;

    protected programHandles = [] as Array<() => void>;

    protected cache = new Cache();

    /**
     * A dictionary of namespaces, indexed by the lower case full name of each namespace.
     * If a namespace is declared as "NameA.NameB.NameC", there will be 3 entries in this dictionary,
     * "namea", "namea.nameb", "namea.nameb.namec"
     */
    public get namespaceLookup() {
        return this.cache.getOrAdd('namespaceLookup', () => this.buildNamespaceLookup());
    }

    /**
     * A dictionary of all classes in this scope. This includes namespaced classes always with their full name.
     * The key is stored in lower case
     */
    public get classLookup() {
        return this.cache.getOrAdd('classLookup', () => this.buildClassLookup());
    }

    /**
     * The list of diagnostics found specifically for this scope. Individual file diagnostics are stored on the files themselves.
     */
    protected diagnostics = [] as BsDiagnostic[];

    protected onDependenciesChanged(key: string) {
        this.logDebug('invalidated because dependency graph said [', key, '] changed');
        this.invalidate();
    }

    /**
     * Clean up all event handles
     */
    public dispose() {
        for (let disconnect of this.programHandles) {
            disconnect();
        }
    }

    /**
     * Does this scope know about the given namespace name?
     * @param namespaceName - the name of the namespace (i.e. "NameA", or "NameA.NameB", etc...)
     */
    public isKnownNamespace(namespaceName: string) {
        let namespaceNameLower = namespaceName.toLowerCase();
        let files = this.getFiles();
        for (let file of files) {
            for (let namespace of file.parser.namespaceStatements) {
                let loopNamespaceNameLower = namespace.name.toLowerCase();
                if (loopNamespaceNameLower === namespaceNameLower || loopNamespaceNameLower.startsWith(namespaceNameLower + '.')) {
                    return true;
                }
            }
        }
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

    /**
     * Get the file with the specified pkgPath
     */
    public getFile(pathAbsolute: string) {
        pathAbsolute = s`${pathAbsolute}`;
        let files = this.getFiles();
        for (let file of files) {
            if (file.pathAbsolute === pathAbsolute) {
                return file;
            }
        }
    }

    public getFiles() {
        return this.cache.getOrAdd('files', () => {
            let result = [] as Array<BrsFile | XmlFile>;
            let dependencies = this.program.dependencyGraph.getAllDependencies(this.dependencyGraphKey);
            for (let dependency of dependencies) {
                //skip scopes and components
                if (dependency.startsWith('component:')) {
                    continue;
                }
                let file = this.program.getFileByPkgPath(dependency);
                if (file) {
                    result.push(file);
                }
            }
            return result;
        });
    }

    public get fileCount() {
        return Object.keys(this.getFiles()).length;
    }

    /**
     * Get the list of errors for this scope. It's calculated on the fly, so
     * call this sparingly.
     */
    public getDiagnostics() {
        let diagnosticLists = [this.diagnostics] as BsDiagnostic[][];

        let files = this.getFiles();
        //add diagnostics from every referenced file
        for (let file of files) {
            diagnosticLists.push(file.getDiagnostics());
        }
        let allDiagnostics = Array.prototype.concat.apply([], diagnosticLists) as BsDiagnostic[];

        let filteredDiagnostics = allDiagnostics.filter((x) => {
            return !util.diagnosticIsSuppressed(x);
        });

        //filter out diangostics that match any of the comment flags

        return filteredDiagnostics;
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
     * Get the list of callables explicitly defined in files in this scope.
     * This excludes ancestor callables
     */
    public getOwnCallables(): CallableContainer[] {
        let result = [] as CallableContainer[];
        let files = this.getFiles();

        this.logDebug('getOwnCallables() files: ', () => this.getFiles().map(x => x.pkgPath));

        //get callables from own files
        for (let file of files) {
            for (let callable of file.callables) {
                result.push({
                    callable: callable,
                    scope: this
                });
            }
        }
        return result;
    }

    /**
     * Builds a tree of namespace objects
     */
    public buildNamespaceLookup() {
        let namespaces = this.getNamespaceStatements();
        let namespaceLookup = {} as { [namespaceName: string]: NamespaceContainer };
        for (let namespace of namespaces) {
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
                    fullName: loopName,
                    lastPartName: part,
                    namespaces: {},
                    classStatements: {},
                    functionStatements: {},
                    statements: []
                };
            }
            let ns = namespaceLookup[name.toLowerCase()];
            ns.statements.push(...namespace.body.statements);
            for (let statement of namespace.body.statements) {
                if (statement instanceof ClassStatement) {
                    ns.classStatements[statement.name.text.toLowerCase()] = statement;
                } else if (statement instanceof FunctionStatement) {
                    ns.functionStatements[statement.name.text.toLowerCase()] = statement;
                }
            }
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
        return namespaceLookup;
    }

    private buildClassLookup() {
        let lookup = {} as { [lowerName: string]: ClassStatement };
        let files = this.getFiles();
        for (let file of files) {
            for (let cls of file.parser.classStatements) {
                lookup[cls.getName(ParseMode.BrighterScript).toLowerCase()] = cls;
            }
        }
        return lookup;
    }

    public getNamespaceStatements() {
        let result = [] as NamespaceStatement[];
        let files = this.getFiles();
        for (let file of files) {
            result.push(...file.parser.namespaceStatements);
        }
        return result;
    }

    public emitter = new EventEmitter();

    public on(eventName: 'invalidated', callback: () => void);
    public on(eventName: string, callback: (data: any) => void) {
        this.emitter.on(eventName, callback);
        return () => {
            this.emitter.removeListener(eventName, callback);
        };
    }

    protected emit(name: 'invalidated');
    protected emit(name: string, data?: any) {
        this.emitter.emit(name, data);
    }

    protected logDebug(...args) {
        logger.debug('Scope', this._debugLogComponentName, ...args);
    }
    private _debugLogComponentName: string;

    public validate(force = false) {
        //if this scope is already validated, no need to revalidate
        if (this.isValidated === true && !force) {
            this.logDebug('validate(): already validated');
            return;
        }
        this.logDebug('validate(): not validated');

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

        //find all duplicate function declarations
        this.diagnosticFindDuplicateFunctionDeclarations(callableContainerMap);

        //enforce a series of checks on the bodies of class methods
        this.validateClasses();

        let files = this.getFiles();
        //do many per-file checks
        for (let file of files) {
            this.diagnosticDetectCallsToUnknownFunctions(file, callableContainerMap);
            this.diagnosticDetectFunctionCallsWithWrongParamCount(file, callableContainerMap);
            this.diagnosticDetectShadowedLocalVars(file, callableContainerMap);
            this.diagnosticDetectFunctionCollisions(file);
        }

        (this as any).isValidated = true;
    }

    /**
     * Mark this scope as invalid, which means its `validate()` function needs to be called again before use.
     */
    public invalidate() {
        (this as any).isValidated = false;
        //clear out various lookups (they'll get regenerated on demand the next time they're requested)
        this.cache.clear();
    }

    /**
     * Find function declarations with the same name as a stdlib function
     */
    private diagnosticDetectFunctionCollisions(file: BrsFile | XmlFile) {
        for (let func of file.callables) {
            if (globalCallableMap[func.getName(ParseMode.BrighterScript).toLowerCase()]) {
                this.diagnostics.push({
                    ...DiagnosticMessages.scopeFunctionShadowedByBuiltInFunction(),
                    range: func.nameRange,
                    file: file
                });
            }
        }
    }

    public getNewExpressions() {
        let result = [] as AugmentedNewExpression[];
        let files = this.getFiles();
        for (let file of files) {
            let expressions = file.parser.newExpressions as AugmentedNewExpression[];
            for (let expression of expressions) {
                expression.file = file;
                result.push(expression);
            }
        }
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
    private diagnosticDetectFunctionCallsWithWrongParamCount(file: BrsFile | XmlFile, callableContainersByLowerName: { [lowerName: string]: CallableContainer[] }) {
        //validate all function calls
        for (let expCall of file.functionCalls) {
            let callableContainersWithThisName = callableContainersByLowerName[expCall.name.toLowerCase()];

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
                    if (param.isOptional === false) {
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
    private diagnosticDetectShadowedLocalVars(file: BrsFile | XmlFile, callableContainerMap: { [lowerName: string]: CallableContainer[] }) {
        //loop through every function scope
        for (let scope of file.functionScopes) {
            //every var declaration in this scope
            for (let varDeclaration of scope.variableDeclarations) {
                let lowerVarName = varDeclaration.name.toLowerCase();

                //if the var is a function
                if (varDeclaration.type instanceof FunctionType) {
                    //local var function with same name as stdlib function
                    if (
                        //has same name as stdlib
                        globalCallableMap[lowerVarName]
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
                        callableContainerMap[lowerVarName]
                    ) {
                        this.diagnostics.push({
                            ...DiagnosticMessages.localVarFunctionShadowsParentFunction('scope'),
                            range: varDeclaration.nameRange,
                            file: file
                        });
                    }

                    //var is not a function
                } else if (
                    //is same name as a callable
                    callableContainerMap[lowerVarName] &&
                    //is NOT a callable from stdlib (because non-function local vars can have same name as stdlib names)
                    !globalCallableMap[lowerVarName]
                ) {
                    this.diagnostics.push({
                        ...DiagnosticMessages.localVarShadowedByScopedFunction(),
                        range: varDeclaration.nameRange,
                        file: file
                    });
                }
            }
        }
    }

    /**
     * Detect calls to functions that are not defined in this scope
     * @param file
     * @param callablesByLowerName
     */
    private diagnosticDetectCallsToUnknownFunctions(file: BrsFile | XmlFile, callablesByLowerName: { [lowerName: string]: CallableContainer[] }) {
        //validate all expression calls
        for (let expCall of file.functionCalls) {
            let lowerName = expCall.name.toLowerCase();

            //get the local scope for this expression
            let scope = file.getFunctionScopeAtPosition(expCall.nameRange.start);

            //if we don't already have a variable with this name.
            if (!scope?.getVariableByName(lowerName)) {
                let callablesWithThisName = callablesByLowerName[lowerName];

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
    private diagnosticFindDuplicateFunctionDeclarations(callableContainersByLowerName: { [lowerName: string]: CallableContainer[] }) {
        //for each list of callables with the same name
        for (let lowerName in callableContainersByLowerName) {
            let callableContainers = callableContainersByLowerName[lowerName];

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
                        range: Range.create(
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
     * Find the file with the specified relative path
     * @param relativePath
     */
    protected getFileByRelativePath(relativePath: string) {
        let files = this.getFiles();
        for (let file of files) {
            if (file.pkgPath.toLowerCase() === relativePath.toLowerCase()) {
                return file;
            }
        }
    }

    /**
     * Determine if this scope is referenced and known by the file.
     * @param file
     */
    public hasFile(file: BrsFile | XmlFile) {
        let files = this.getFiles();
        let hasFile = files.includes(file);
        this.logDebug('hasFile =', hasFile, 'for', () => chalk.green(file.pkgPath), 'in files', () => files.map(x => x.pkgPath));
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
            completions.push({
                label: callableContainer.callable.getName(parseMode),
                kind: CompletionItemKind.Function,
                detail: callableContainer.callable.shortDescription,
                documentation: callableContainer.callable.documentation ? { kind: 'markdown', value: callableContainer.callable.documentation } : undefined
            });
        }
        return completions;
    }

    /**
     * Get the definition (where was this thing first defined) of the symbol under the position
     */
    public getDefinition(file: BrsFile | XmlFile, position: Position): Location[] { //eslint-disable-line
        //TODO implement for brs files
        return [];
    }

    /**
     * Scan all files for property names, and return them as completions
     */
    public getPropertyNameCompletions() {
        let results = [] as CompletionItem[];
        let files = this.getFiles();
        for (let file of files) {
            results.push(...file.propertyNameCompletions);
        }
        return results;
    }
}

interface NamespaceContainer {
    fullName: string;
    lastPartName: string;
    statements: Statement[];
    classStatements: { [lowerClassName: string]: ClassStatement };
    functionStatements: { [lowerFunctionName: string]: FunctionStatement };
    namespaces: { [name: string]: NamespaceContainer };
}

interface AugmentedNewExpression extends NewExpression {
    file: BrsFile | XmlFile;
}
