import * as path from 'path';
import type { CodeWithSourceMap } from 'source-map';
import { SourceNode } from 'source-map';
import type { Location, Position, Range } from 'vscode-languageserver';
import type { FileReference, CommentFlag, SerializedCodeFile } from '../interfaces';
import type { Program } from '../Program';
import util from '../util';
import { standardizePath as s } from '../util';
import chalk from 'chalk';
import { Cache } from '../Cache';
import type { DependencyChangedEvent, DependencyGraph } from '../DependencyGraph';
import type { IToken, TokenType } from 'chevrotain';
import { TranspileState } from '../parser/TranspileState';
import type { BscFile } from './BscFile';
import type { Editor } from '../astUtils/Editor';
import { XmlCode } from './XmlCode';
import { BrsCode } from './BrsCode';
import { ParseMode } from '../parser/Parser';
import type { SGScript } from '../parser/SGTypes';
import type { BscCode } from './BscCode';
import type { FunctionScope } from '../FunctionScope';


export type { UnresolvedXMLSymbol } from './XmlCode';


export class XmlFile implements BscFile {
    /**
     * Create a new instance of BrsFile
     */
    constructor(options: {
        /**
         * The absolute path to the source file on disk (e.g. '/usr/you/projects/RokuApp/source/main.brs' or 'c:/projects/RokuApp/source/main.brs').
         */
        srcPath: string;
        /**
         * The absolute path to the file on-device (i.e. 'source/main.brs') without the leading `pkg:/`
         */
        destPath: string;
        pkgPath?: string;
        program: Program;
    }) {
        this.code = new XmlCode({
            document: this,
            program: options?.program
        });
        if (options) {
            this.srcPath = s`${options.srcPath}`;
            this.destPath = s`${options.destPath}`;
            this.pkgPath = s`${options.pkgPath ?? options.destPath}`;
            this.program = options.program;

            this.extension = path.extname(this.srcPath).toLowerCase();

            this.possibleCodebehindDestPaths = [
                this.pkgPath.replace(/\.xml$/, '.bs'),
                this.pkgPath.replace(/\.xml$/, '.brs')
            ];
        }
    }

    public type = 'XmlFile';

    /**
     * The absolute path to the source file on disk (e.g. '/usr/you/projects/RokuApp/source/main.brs' or 'c:/projects/RokuApp/source/main.brs').
     */
    public srcPath: string;
    /**
     * The absolute path to the file on-device (i.e. 'source/main.brs') without the leading `pkg:/`
     */
    public destPath: string;
    public pkgPath: string;

    public program: Program;

    /**
     * The SceneGraph component code in this file
     */
    public code: XmlCode;

    /**
     * The BrightScript embedded in this component's `<script>` blocks (`<![CDATA[ ... ]]>`), in the order they appear
     */
    public scriptCodes = [] as BrsCode[];

    /**
     * The `<script>` element each piece of embedded code came from
     */
    private scriptElementsByCode = new Map<BrsCode, SGScript>();

    /**
     * All of the code this file provides: the component itself, then the BrightScript in its `<script>` blocks
     */
    public get codes(): BscCode[] {
        return [this.code, ...this.scriptCodes];
    }

    /**
     * Get the code embedded in a `<script>` element, if it has any
     */
    public getCodeForScript(script: SGScript): BrsCode | undefined {
        for (const [code, scriptElement] of this.scriptElementsByCode) {
            if (scriptElement === script) {
                return code;
            }
        }
    }

    /**
     * Create a piece of BrightScript code for every `<script>` element that has its code inline in a CDATA block
     */
    private createScriptCodes() {
        for (const code of this.scriptCodes) {
            code.dispose();
        }
        this.scriptCodes = [];
        this.scriptElementsByCode.clear();

        const cdataOpen = '<![CDATA[';
        const cdataClose = ']]>';
        for (const script of this.ast.componentElement?.scriptElements ?? []) {
            const cdata = script.cdata;
            const range = cdata?.location?.range;
            if (!range) {
                continue;
            }
            const isBrighterScript = /brighterscript|text\/bs\b/i.test(script.type ?? '') || this.program?.options?.allowBrighterScriptInBrightScript;
            const code = new BrsCode({
                document: this,
                program: this.program,
                parseMode: isBrighterScript ? ParseMode.BrighterScript : ParseMode.BrightScript
            });
            code.isEmbedded = true;
            code.key = `${this.pkgPath}#script-${this.scriptCodes.length}`;
            //the code is everything between `<![CDATA[` and `]]>`
            const hasClose = cdata.text.endsWith(cdataClose);
            const startCharacter = range.start.character + cdataOpen.length;
            code.range = util.createRange(
                range.start.line,
                startCharacter,
                range.end.line,
                hasClose ? range.end.character - cdataClose.length : range.end.character
            );
            code.parse(
                cdata.text.substring(cdataOpen.length, hasClose ? cdata.text.length - cdataClose.length : cdata.text.length),
                { startLine: range.start.line, startCharacter: startCharacter }
            );
            this.scriptCodes.push(code);
            this.scriptElementsByCode.set(code, script);
        }
    }

    /**
     * An editor assigned during the build flow that manages edits that will be undone once the build process is complete.
     */
    public editor?: Editor;

    /**
     * The absolute path to the source location for this file
     * @deprecated use `srcPath` instead
     */
    public get pathAbsolute() {
        return this.srcPath;
    }
    public set pathAbsolute(value) {
        this.srcPath = value;
    }

    private cache = new Cache();

    /**
     * The list of possible autoImport codebehind pkg paths.
     * @deprecated use `possibleCodebehindDestPaths` instead.
     */
    public get possibleCodebehindPkgPaths() {
        return this.possibleCodebehindDestPaths;
    }
    public set possibleCodebehindPkgPaths(value) {
        this.possibleCodebehindDestPaths = value;
    }

    /**
     * The list of possible autoImport codebehind destPath values
     */
    public possibleCodebehindDestPaths: string[];

    /**
     * An unsubscribe function for the dependencyGraph subscription
     */
    private unsubscribeFromDependencyGraph: () => void;

    /**
     * The extension for this file
     */
    public extension: string;

    /**
     * Will this file result in only comment or whitespace output? If so, it can be excluded from the output if that bsconfig setting is enabled.
     */
    readonly canBePruned = false;

    /**
     * List of all `destPath` values pointing to scripts that this XmlFile depends on, regardless of whether they are loaded in the program or not.
     * This includes own dependencies and all parent compoent dependencies
     * coming from:
     *  - script tags
     *  - implied codebehind file
     *  - import statements from imported scripts or their descendents
     */
    public getAllDependencies() {
        return this.cache.getOrAdd(`allScriptImports`, () => {
            const value = this.dependencyGraph.getAllDependencies(this.dependencyGraphKey);
            return value;
        });
    }

    /**
     * List of all destPaths to scripts that this XmlFile depends on directly, regardless of whether they are loaded in the program or not.
     * This does not account for parent component scripts
     * coming from:
     *  - script tags
     *  - implied codebehind file
     *  - import statements from imported scripts or their descendents
     */
    public getOwnDependencies() {
        return this.cache.getOrAdd(`ownScriptImports`, () => {
            const value = this.dependencyGraph.getAllDependencies(this.dependencyGraphKey, [this.parentComponentDependencyGraphKey]);
            return value;
        });
    }

    /**
     * List of all destPaths to scripts that this XmlFile depends on that are actually loaded into the program.
     * This does not account for parent component scripts.
     * coming from:
     *  - script tags
     *  - inferred codebehind file
     *  - import statements from imported scripts or their descendants
     */
    public getAvailableScriptImports() {
        return this.cache.getOrAdd('allAvailableScriptImports', () => {

            let allDependencies = this.getOwnDependencies()
                //skip typedef files
                .filter(x => util.getExtension(x) !== '.d.bs');

            let result = [] as string[];
            let filesInProgram = this.program.getFiles(allDependencies);
            for (let file of filesInProgram) {
                result.push(file.destPath);
            }
            this.logDebug('computed allAvailableScriptImports', () => result);
            return result;
        });
    }


    /**
     * The range of the entire file
     */
    public fileRange: Range;

    /**
     * Does this file need to be transpiled?
     * @deprecated use the `.editor` property to push changes to the file, which will force transpilation
     */
    public get needsTranspiled() {
        if (this._needsTranspiled !== undefined) {
            return this._needsTranspiled;
        }
        return !!(
            this.editor?.hasChanges || this.ast.componentElement?.scriptElements?.some(
                script => script.type?.indexOf('brighterscript') > 0 || script.uri?.endsWith('.bs')
            ) ||
            //embedded code that needs transpiling has to be written back into this file
            this.scriptCodes.some(code => code.needsTranspiled)
        );
    }
    public set needsTranspiled(value) {
        this._needsTranspiled = value;
    }
    public _needsTranspiled: boolean;

    /**
     * The full file contents
     */
    public fileContents: string;

    /**
     * Calculate the AST for this file
     * @param fileContents the xml source code to parse
     */
    public parse(fileContents: string) {
        this.fileContents = fileContents;
        this.code.parse(fileContents);
        this.createScriptCodes();
    }

    /**
     * Generate the code, map, and typedef for this file
     */
    public serialize(): SerializedCodeFile {
        const result = this.transpile();
        return {
            code: result?.code,
            map: result?.map?.toString()
        };
    }


    private dependencyGraph: DependencyGraph;

    public onDependenciesChanged(event: DependencyChangedEvent) {
        this.logDebug('clear cache because dependency graph changed', event?.sourceKey);
        this.cache.clear();
    }

    /**
     * Attach the file to the dependency graph so it can monitor changes.
     * Also notify the dependency graph of our current dependencies so other dependents can be notified.
     * @deprecated this does nothing. This functionality is now handled by the file api and will be deleted in v1
     */
    public attachDependencyGraph(dependencyGraph: DependencyGraph) {
        this.dependencyGraph = dependencyGraph;
    }

    /**
     * The list of files that this file depends on
     */
    public get dependencies() {
        const dependencies = [
            ...this.scriptTagImports.map(x => x.destPath.toLowerCase())
        ];
        //if autoImportComponentScript is enabled, add the .bs and .brs files with the same name
        if (this.program?.options?.autoImportComponentScript) {
            dependencies.push(
                //add the codebehind file dependencies.
                //These are kind of optional, so it doesn't hurt to just add both extension versions
                this.destPath.replace(/\.xml$/i, '.bs').toLowerCase(),
                this.destPath.replace(/\.xml$/i, '.brs').toLowerCase()
            );
        }
        const len = dependencies.length;
        for (let i = 0; i < len; i++) {
            const dep = dependencies[i];

            //add a dependency on `d.bs` file for every `.brs` file
            if (dep.slice(-4).toLowerCase() === '.brs') {
                dependencies.push(util.getTypedefPath(dep));
            }
        }

        if (this.parentComponentName) {
            dependencies.push(this.parentComponentDependencyGraphKey);
        }
        return dependencies;
    }

    /**
     * A slight hack. Gives the Program a way to support multiple components with the same name
     * without causing major issues. A value of 0 will be ignored as part of the dependency graph key.
     * Howver, a nonzero value will be used as part of the dependency graph key so this component doesn't
     * collide with the primary component. For example, if there are three components with the same name, you will
     * have the following dependency graph keys: ["component:CustomGrid", "component:CustomGrid[1]", "component:CustomGrid[2]"]
     */
    public dependencyGraphIndex = -1;

    /**
     * The key used in the dependency graph for this file.
     * If we have a component name, we will use that so we can be discoverable by child components.
     * If we don't have a component name, use the destPath so at least we can self-validate
     */
    public get dependencyGraphKey() {
        let key: string;
        if (this.componentName) {
            key = `component:${this.componentName.text}`.toLowerCase();
        } else {
            key = this.destPath.toLowerCase();
        }
        //if our index is not zero, then we are not the primary component with that name, and need to
        //append our index to the dependency graph key as to prevent collisions in the program.
        if (this.dependencyGraphIndex !== 0) {
            key += '[' + this.dependencyGraphIndex + ']';
        }
        return key;
    }

    public set dependencyGraphKey(value) {
        //do nothing, we override this value in the getter
    }

    /**
     * The key used in the dependency graph for this component's parent.
     * If we have aparent, we will use that. If we don't, this will return undefined
     */
    public get parentComponentDependencyGraphKey() {
        if (this.parentComponentName) {
            return `component:${this.parentComponentName.text}`.toLowerCase();
        } else {
            return undefined;
        }
    }

    /**
     * Determines if this xml file has a reference to the specified file (or if it's itself)
     */
    public doesReferenceFile(file: BscFile) {
        return this.cache.getOrAdd(`doesReferenceFile: ${file.destPath}`, () => {
            if (file === this) {
                return true;
            }
            let allDependencies = this.getOwnDependencies();
            for (let destPath of allDependencies) {
                if (destPath.toLowerCase() === file.destPath.toLowerCase()) {
                    return true;
                }
            }

            //if this is an xml file...do we extend the component it defines?
            if (path.extname(file.destPath).toLowerCase() === '.xml') {

                //didn't find any script imports for this file
                return false;
            }
            return false;
        });
    }


    /**
     * Get the parent component (the component this component extends)
     */
    public get parentComponent() {
        const result = this.cache.getOrAdd('parent', () => {
            return this.program.getComponent(this.parentComponentName?.text)?.file;
        });
        return result;
    }

    public getReferences(position: Position): Promise<Location[]> { //eslint-disable-line
        //TODO implement
        return null;
    }

    /**
     * Walk up the ancestor chain and aggregate all of the script tag imports
     */
    public getAncestorScriptTagImports(): FileReference[] {
        let result = [] as FileReference[];
        let parent = this.parentComponent;
        while (parent) {
            result.push(...parent.scriptTagImports);
            parent = parent.parentComponent;
        }
        return result;
    }

    /**
     * Remove this file from the dependency graph as a node
     */
    public detachDependencyGraph(dependencyGraph: DependencyGraph) {
        dependencyGraph.remove(this.dependencyGraphKey);

    }

    /**
     * Get the list of script imports that this file needs to include.
     * It compares the list of imports on this file to those of its parent,
     * and only includes the ones that are not found on the parent.
     * If no parent is found, all imports are returned
     */
    public getMissingImportsForTranspile() {
        let ownImports = this.getAvailableScriptImports();
        //add the bslib path to ownImports, it'll get filtered down below
        ownImports.push(this.program.bslibPkgPath);

        let parentImports = this.parentComponent?.getAvailableScriptImports() ?? [];

        let parentMap = parentImports.reduce((map, destPath) => {
            map[destPath.toLowerCase()] = true;
            return map;
        }, {});

        //if the XML already has this import, skip this one
        let alreadyThereScriptImportMap = this.scriptTagImports.reduce((map, fileReference) => {
            map[fileReference.destPath.toLowerCase()] = true;
            return map;
        }, {});

        let resultMap = {};
        let result = [] as string[];
        for (let ownImport of ownImports) {
            const ownImportLower = ownImport.toLowerCase();
            if (
                //if the parent doesn't have this import
                !parentMap[ownImportLower] &&
                //the XML doesn't already have a script reference for this
                !alreadyThereScriptImportMap[ownImportLower] &&
                //the result doesn't already have this reference
                !resultMap[ownImportLower]
            ) {
                result.push(ownImport);
                resultMap[ownImportLower] = true;
            }
        }
        return result;
    }

    private logDebug(...args: unknown[]) {
        this.program?.logger?.debug('XmlFile', chalk.green(this.destPath), ...args);
    }

    /**
     * Convert the brightscript/brighterscript source code into valid brightscript
     */
    public transpile(): CodeWithSourceMap {
        const state = new TranspileState(this.srcPath, this.program.options);

        let transpileResult: SourceNode | undefined;

        if (this.needsTranspiled) {
            transpileResult = util.sourceNodeFromTranspileResult(null, null, state.srcPath, this.parser.ast.transpile(state));
        } else if (this.program.options.sourceMap) {
            //emit code as-is with a simple map to the original file location
            transpileResult = util.simpleMap(state.srcPath, this.fileContents);
        } else {
            //simple SourceNode wrapping the entire file to simplify the logic below
            transpileResult = new SourceNode(null, null, state.srcPath, this.fileContents);
        }

        //add the source map comment if configured to emit sourcemaps
        if (this.program.options.sourceMap) {
            util.stripTrailingSourceMappingURLComment(transpileResult);
            return new SourceNode(null, null, state.srcPath, [
                transpileResult,
                //add the sourcemap reference comment
                `<!--//# sourceMappingURL=./${path.basename(state.srcPath)}.map -->`
            ]).toStringWithSourceMap();
        } else {
            return {
                code: transpileResult.toString(),
                map: undefined
            };
        }
    }

    public dispose() {
        //unsubscribe from any DependencyGraph subscriptions
        this.unsubscribeFromDependencyGraph?.();
        for (const code of this.scriptCodes) {
            code.dispose();
        }
    }

    // Everything below forwards to `this.code`. These keep existing callers working while they move to `XmlCode`,
    // and will be removed once they have.

    public get isValidated() {
        return this.code.isValidated;
    }
    public set isValidated(value: boolean) {
        this.code.isValidated = value;
    }

    public get commentFlags() {
        return this.code.commentFlags;
    }
    public set commentFlags(value: CommentFlag[]) {
        this.code.commentFlags = value;
    }

    public get parser() {
        return this.code.parser;
    }

    public get ast() {
        return this.code.ast;
    }

    public get callables() {
        return this.code.callables;
    }

    public get functionScopes() {
        return this.code.functionScopes;
    }

    public get scriptTagImports() {
        return this.code.scriptTagImports;
    }

    public get parentComponentName() {
        return this.code.parentComponentName;
    }

    public get componentName() {
        return this.code.componentName;
    }

    public get requiredSymbols() {
        return this.code.requiredSymbols;
    }

    public getCommentFlags(tokens: Array<IToken & { tokenType: TokenType }>) {
        return this.code.getCommentFlags(tokens);
    }

    public getCompletions(position: Position) {
        return this.code.getCompletions(position);
    }

    public getTokenAt(position: Position) {
        return this.code.getTokenAt(position);
    }

    public getFunctionScopeAtPosition(position: Position, functionScopes?: FunctionScope[]) {
        return this.code.getFunctionScopeAtPosition(position, functionScopes);
    }
}
