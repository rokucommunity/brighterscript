import { EventEmitter } from 'events';
import { CompletionItem, CompletionItemKind, Location, Position, Range } from 'vscode-languageserver';

import { DiagnosticMessages } from './DiagnosticMessages';
import { BrsFile } from './files/BrsFile';
import { XmlFile } from './files/XmlFile';
import { CallableContainer, BsDiagnostic, File } from './interfaces';
import { Program } from './Program';
import util from './util';
import { BsClassValidator } from './validators/ClassValidator';
import { NamespaceStatement, ParseMode, Statement } from './parser';

/**
 * A class to keep track of all declarations within a given scope (like global scope, component scope)
 */
export class Scope {
    constructor(
        public name: string,
        private matcher: (file: File) => boolean | void
    ) {
        //allow unlimited listeners
        this.emitter.setMaxListeners(0);
    }

    /**
     * Indicates whether this scope needs to be validated.
     * Will be true when first constructed, or anytime one of its watched files is added, changed, or removed
     */
    public isValidated = true;

    protected program: Program;

    protected programHandles = [] as Array<() => void>;

    /**
     * The list of diagnostics found specifically for this scope. Individual file diagnostics are stored on the files themselves.
     */
    protected diagnostics = [] as BsDiagnostic[];

    /**
     * Attach the scope to a program. This allows the scope to monitor file adds, changes, and removals, and respond accordingly
     * @param program
     */
    public attachProgram(program: Program) {
        this.program = program;
        this.programHandles = [
            program.on('file-added', (file) => {
                if (this.matcher(file)) {
                    this.addOrReplaceFile(file);
                }
            }),

            program.on('file-removed', (file) => {
                if (this.hasFile(file)) {
                    this.removeFile(file);
                }
            })
        ];

        //add any current matches
        for (let filePath in program.files) {
            let file = program.files[filePath];
            if (this.matcher(file)) {
                this.addOrReplaceFile(file);
            }
        }
    }

    /**
     * Clean up all event handles
     */
    public dispose() {
        for (let disconnect of this.programHandles) {
            disconnect();
        }
        this.detachParent();
    }

    private parentScopeHandles = [] as Array<() => void>;

    public attachParentScope(parent: Scope) {
        this.parentScope = parent;
        this.parentScopeHandles = [
            //whenever the parent is marked dirty, mark ourself as dirty
            parent.on('invalidated', () => {
                this.isValidated = false;
            })
        ];

        //immediately invalidate self if parent is not validated
        if (!this.parentScope.isValidated) {
            this.isValidated = false;
        }
    }

    public detachParent() {
        for (let disconnect of this.parentScopeHandles) {
            disconnect();
        }
        //attach the platform scope as the parent (except when this IS the platform scope)
        if (this.program.platformScope !== this) {
            this.parentScope = this.program.platformScope;
        }
    }

    /**
     * A parent scope that this scope inherits all things from.
     */
    public parentScope: Scope;

    /**
     * Determine if this file should
     * @param filePath
     */
    public shouldIncludeFile(file: File) {
        return this.matcher(file) === true;
    }

    public files = {} as { [filePath: string]: ScopeFile };

    public get fileCount() {
        return Object.keys(this.files).length;
    }
    public getFile(filePath: string) {
        filePath = util.standardizePath(filePath);
        return this.files[filePath];
    }

    /**
     * Get the list of errors for this scope. It's calculated on the fly, so
     * call this sparingly.
     */
    public getDiagnostics() {
        let diagnosticLists = [this.diagnostics] as BsDiagnostic[][];
        //add diagnostics from every referenced file
        for (let filePath in this.files) {
            let ctxFile = this.files[filePath];
            diagnosticLists.push(ctxFile.file.getDiagnostics());
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
        if (this.parentScope) {
            return [...this.getOwnCallables(), ...this.parentScope.getAllCallables()];
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
            if (callable.callable.name.toLowerCase() === lowerName) {
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

        //get callables from own files
        for (let filePath in this.files) {
            let file = this.files[filePath];
            for (let callable of file.file.callables) {
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
    public getNamespaceInfo() {
        let namespaces = this.getNamespaceStatements();
        let byFullName = {} as { [namespaceName: string]: NamespaceContainer };
        for (let namespace of namespaces) {
            //TODO should we handle non-brighterscript?
            let name = namespace.name.getName(ParseMode.BrighterScript);
            let nameParts = name.split('.');

            let loopName = null;
            //ensure each namespace section is represented in the results
            //(so if the namespace name is A.B.C, this will make an entry for "A", an entry for "A.B", and an entry for "A.B.C"
            for (let part of nameParts) {
                loopName = loopName === null ? part : `${loopName}.${part}`;
                byFullName[loopName] = byFullName[loopName] ?? {
                    fullName: name,
                    lastPartName: part,
                    namespaces: {},
                    statements: []
                };
            }
            byFullName[name].statements.push(...namespace.body.statements);
        }

        //associate child namespaces with their parents
        for (let key in byFullName) {
            let ns = byFullName[key];
            let parts = ns.fullName.split('.');

            if (parts.length > 1) {
                //remove the last part
                parts.pop();
                let parentName = parts.join('.');
                byFullName[parentName].namespaces[ns.lastPartName] = ns;
            }
        }
        return byFullName;
    }

    public getNamespaceStatements() {
        let result = [] as NamespaceStatement[];
        for (let filePath in this.files) {
            let file = this.files[filePath];
            result.push(...file.file.namespaceStatements);
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

    /**
     * Add a file to the program.
     * @param filePath
     * @param fileContents
     */
    public addOrReplaceFile(file: BrsFile | XmlFile) {
        this.isValidated = false;

        //if the file is already loaded, remove it first
        if (this.files[file.pathAbsolute]) {
            this.removeFile(file);
        }

        let ctxFile = new ScopeFile(file);

        //keep a reference to this file
        this.files[file.pathAbsolute] = ctxFile;
    }

    /**
     * Remove the file from this scope.
     * If the file doesn't exist, the method exits immediately, but does not throw an error.
     * @param file
     * @param emitRemovedEvent - if false, the 'remove-file' event will not be emitted
     */
    public removeFile(file: File) {
        this.isValidated = false;

        let ctxFile = this.getFile(file.pathAbsolute);
        if (!ctxFile) {
            return;
        }

        //remove the reference to this file
        delete this.files[file.pathAbsolute];
        this.emit('invalidated');
    }

    public validate() {
        //if this scope is already validated, no need to revalidate
        if (this.isValidated === true) {
            return;
        }
        //validate our parent before we validate ourself
        if (this.parentScope && this.parentScope.isValidated === false) {
            this.parentScope.validate();
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
        let callableContainersByLowerName = util.getCallableContainersByLowerName(callables);

        //find all duplicate function declarations
        this.diagnosticFindDuplicateFunctionDeclarations(callableContainersByLowerName);

        //enforce a series of checks on the bodies of class methods
        this.validateClasses();

        //do many per-file checks
        for (let key in this.files) {
            let scopeFile = this.files[key];
            this.diagnosticDetectCallsToUnknownFunctions(scopeFile.file, callableContainersByLowerName);
            this.diagnosticDetectFunctionCallsWithWrongParamCount(scopeFile.file, callableContainersByLowerName);
            this.diagnosticDetectShadowedLocalVars(scopeFile.file, callableContainersByLowerName);
        }

        this.isValidated = false;
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
     * @param callablesByLowerName
     */
    private diagnosticDetectShadowedLocalVars(file: BrsFile | XmlFile, callablesByLowerName: { [lowerName: string]: CallableContainer[] }) {
        //loop through every function scope
        for (let scope of file.functionScopes) {
            //every var declaration in this scope
            for (let varDeclaration of scope.variableDeclarations) {
                let globalCallableContainer = callablesByLowerName[varDeclaration.name.toLowerCase()];
                //if we found a collision
                if (globalCallableContainer && globalCallableContainer.length > 0) {
                    let globalCallable = globalCallableContainer[0];

                    this.diagnostics.push({
                        ...DiagnosticMessages.localVarShadowsGlobalFunction(
                            varDeclaration.name,
                            globalCallable.callable.file.pkgPath
                        ),
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

            let platformCallables = [] as CallableContainer[];
            let nonPlatformCallables = [] as CallableContainer[];
            let ownCallables = [] as CallableContainer[];
            let ancestorNonPlatformCallables = [] as CallableContainer[];

            for (let container of callableContainers) {
                if (container.scope === this.program.platformScope) {
                    platformCallables.push(container);
                } else {
                    nonPlatformCallables.push(container);
                    if (container.scope === this) {
                        ownCallables.push(container);
                    } else {
                        ancestorNonPlatformCallables.push(container);
                    }
                }
            }

            //add info diagnostics about child shadowing parent functions
            if (ownCallables.length > 0 && ancestorNonPlatformCallables.length > 0) {
                for (let container of ownCallables) {
                    //skip the init function (because every component will have one of those){
                    if (lowerName !== 'init') {
                        let shadowedCallable = ancestorNonPlatformCallables[ancestorNonPlatformCallables.length - 1];
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
        for (let key in this.files) {
            if (this.files[key].file.pkgPath.toLowerCase() === relativePath.toLowerCase()) {
                return this.files[key];
            }
        }
    }

    /**
     * Determine if the scope already has this file in its files list
     * @param file
     */
    public hasFile(pathAbsolute: string);
    public hasFile(file: BrsFile | XmlFile);
    public hasFile(file: BrsFile | XmlFile | string) {
        let pathAbsolute: string;
        if (file instanceof BrsFile || file instanceof XmlFile) {
            pathAbsolute = file.pathAbsolute;
        } else {
            pathAbsolute = file;
        }
        if (this.files[pathAbsolute]) {
            return true;
        } else {
            return false;
        }
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
        for (let key in this.files) {
            let file = this.files[key];
            results.push(...file.file.propertyNameCompletions);
        }
        return results;
    }
}

class ScopeFile {
    constructor(
        public file: BrsFile | XmlFile
    ) {
    }
}


interface NamespaceContainer {
    fullName: string;
    lastPartName: string;
    statements: Statement[];
    namespaces: { [name: string]: NamespaceContainer };
}
