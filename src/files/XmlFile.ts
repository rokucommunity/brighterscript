import * as path from 'path';
import type { CodeWithSourceMap } from 'source-map';
import { SourceNode } from 'source-map';
import type { CompletionItem, Hover, Location, Position, Range } from 'vscode-languageserver';
import { DiagnosticMessages } from '../DiagnosticMessages';
import type { FunctionScope } from '../FunctionScope';
import type { Callable, BsDiagnostic, File, FileReference, FunctionCall } from '../interfaces';
import type { Program } from '../Program';
import util from '../util';
import SGParser from '../parser/SGParser';
import chalk from 'chalk';
import { Cache } from '../Cache';
import * as extname from 'path-complete-extname';
import type { DependencyGraph } from '../DependencyGraph';
import type { SGAst, SGToken } from '../parser/SGTypes';

export class XmlFile {
    constructor(
        public pathAbsolute: string,
        /**
         * The absolute path to the file, relative to the pkg
         */
        public pkgPath: string,
        public program: Program
    ) {
        this.extension = path.extname(pathAbsolute).toLowerCase();

        this.possibleCodebehindPkgPaths = [
            this.pkgPath.replace('.xml', '.bs'),
            this.pkgPath.replace('.xml', '.brs')
        ];
    }

    private cache = new Cache();

    /**
     * The list of possible autoImport codebehind pkg paths.
     */
    private possibleCodebehindPkgPaths: string[];

    /**
     * An unsubscribe function for the dependencyGraph subscription
     */
    private unsubscribeFromDependencyGraph: () => void;

    /**
     * The extension for this file
     */
    public extension: string;

    /**
     * The list of script imports delcared in the XML of this file.
     * This excludes parent imports and auto codebehind imports
     */
    public get scriptTagImports(): FileReference[] {
        return this.parser.references.scriptTagImports
            .map(tag => ({
                ...tag,
                sourceFile: this
            }));
    }

    /**
     * List of all pkgPaths to scripts that this XmlFile depends on directly, regardless of whether they are loaded in the program or not.
     * This does not account for parent component scripts
     * coming from:
     *  - script tags
     *  - implied codebehind file
     *  - import statements from imported scripts or their descendents
     */
    public getAllDependencies() {
        return this.cache.getOrAdd(`allScriptImports`, () => {
            let value = this.program.dependencyGraph.getAllDependencies(this.dependencyGraphKey, [this.parentComponentDependencyGraphKey]);

            return value;
        });
    }

    /**
     * List of all pkgPaths to scripts that this XmlFile depends on that are actually loaded into the program.
     * This does not account for parent component scripts.
     * coming from:
     *  - script tags
     *  - inferred codebehind file
     *  - import statements from imported scripts or their descendants
     */
    public getAvailableScriptImports() {
        return this.cache.getOrAdd('allAvailableScriptImports', () => {

            let allDependencies = this.getAllDependencies()
                //skip typedef files
                .filter(x => extname(x) !== '.d.bs');

            let result = [] as string[];
            let filesInProgram = this.program.getFilesByPkgPaths(allDependencies);
            for (let file of filesInProgram) {
                result.push(file.pkgPath);
            }
            this.logDebug('computed allAvailableScriptImports', () => result);
            return result;
        });
    }

    public getDiagnostics() {
        return [...this.diagnostics];
    }

    public addDiagnostics(diagnostics: BsDiagnostic[]) {
        this.diagnostics.push(...diagnostics);
    }

    /**
     * The range of the entire file
     */
    public fileRange: Range;

    public diagnostics = [] as BsDiagnostic[];

    public parser = new SGParser();

    //TODO implement the xml CDATA parsing, which would populate this list
    public callables = [] as Callable[];

    //TODO implement the xml CDATA parsing, which would populate this list
    public functionCalls = [] as FunctionCall[];

    public functionScopes = [] as FunctionScope[];

    /**
     * The name of the component that this component extends.
     * Available after `parse()`
     */
    public get parentComponentName(): SGToken {
        return this.parser?.references.extends;
    }

    /**
     * The name of the component declared in this xml file
     * Available after `parse()`
     */
    public get componentName(): SGToken {
        return this.parser?.references.name;
    }

    /**
     * Does this file need to be transpiled?
     */
    public needsTranspiled = false;

    /**
     * The AST for this file
     */
    public get ast() {
        return this.parser.ast;
    }

    /**
     * The full file contents
     */
    public fileContents: string;

    /**
     * TODO: do we need this for xml files?
     */
    public propertyNameCompletions = [] as CompletionItem[];

    /**
     * Calculate the AST for this file
     * @param fileContents
     */
    public parse(fileContents: string) {
        this.fileContents = fileContents;

        this.parser.parse(this.pkgPath, fileContents);
        this.diagnostics = this.parser.diagnostics.map(diagnostic => ({
            ...diagnostic,
            file: this
        }));

        if (!this.parser.ast.root) {
            //skip empty XML
            return;
        }

        //notify AST ready
        this.program.plugins.emit('afterFileParse', this);

        //initial validation
        this.validateComponent(this.parser.ast);
    }

    private validateComponent(ast: SGAst) {
        const { root, component } = ast;
        if (!component) {
            //not a SG component
            this.diagnostics.push({
                ...DiagnosticMessages.xmlComponentMissingComponentDeclaration(),
                range: root.range,
                file: this
            });
            return;
        }

        //component name/extends
        if (!component.name) {
            this.diagnostics.push({
                ...DiagnosticMessages.xmlComponentMissingNameAttribute(),
                range: component.tag.range,
                file: this
            });
        }
        if (!component.extends) {
            this.diagnostics.push({
                ...DiagnosticMessages.xmlComponentMissingExtendsAttribute(),
                range: component.tag.range,
                file: this
            });
        }

        //needsTranspiled should be true if an import is brighterscript
        this.needsTranspiled = component.scripts.some(
            script => script.type?.indexOf('brighterscript') > 0 || script.uri?.endsWith('.bs')
        );

        //catch script imports with same path as the auto-imported codebehind file
        const scriptTagImports = this.parser.references.scriptTagImports;
        let explicitCodebehindScriptTag = this.program.options.autoImportComponentScript === true
            ? scriptTagImports.find(x => this.possibleCodebehindPkgPaths.includes(x.pkgPath))
            : undefined;
        if (explicitCodebehindScriptTag) {
            this.diagnostics.push({
                ...DiagnosticMessages.unnecessaryCodebehindScriptImport(),
                file: this,
                range: explicitCodebehindScriptTag.filePathRange
            });
        }
    }

    /**
     * Attach the file to the dependency graph so it can monitor changes.
     * Also notify the dependency graph of our current dependencies so other dependents can be notified.
     */
    public attachDependencyGraph(dependencyGraph: DependencyGraph) {
        if (this.unsubscribeFromDependencyGraph) {
            this.unsubscribeFromDependencyGraph();
        }

        //anytime a dependency changes, clean up some cached values
        this.unsubscribeFromDependencyGraph = this.program.dependencyGraph.onchange(this.dependencyGraphKey, () => {
            this.logDebug('clear cache because dependency graph changed');
            this.cache.clear();
        });

        let dependencies = [
            ...this.scriptTagImports.map(x => x.pkgPath.toLowerCase())
        ];
        //if autoImportComponentScript is enabled, add the .bs and .brs files with the same name
        if (this.program.options.autoImportComponentScript) {
            dependencies.push(
                //add the codebehind file dependencies.
                //These are kind of optional, so it doesn't hurt to just add both extension versions
                this.pkgPath.replace(/\.xml$/i, '.bs').toLowerCase(),
                this.pkgPath.replace(/\.xml$/i, '.brs').toLowerCase()
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
        this.program.dependencyGraph.addOrReplace(this.dependencyGraphKey, dependencies);
    }

    /**
     * The key used in the dependency graph for this file.
     * If we have a component name, we will use that so we can be discoverable by child components.
     * If we don't have a component name, use the pkgPath so at least we can self-validate
     */
    public get dependencyGraphKey() {
        if (this.componentName) {
            return `component:${this.componentName.text}`.toLowerCase();
        } else {
            return this.pkgPath.toLowerCase();
        }
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
     * @param file
     */
    public doesReferenceFile(file: File) {
        return this.cache.getOrAdd(`doesReferenceFile: ${file.pkgPath}`, () => {
            if (file === this) {
                return true;
            }
            let allDependencies = this.getAllDependencies();
            for (let importPkgPath of allDependencies) {
                if (importPkgPath.toLowerCase() === file.pkgPath.toLowerCase()) {
                    return true;
                }
            }

            //if this is an xml file...do we extend the component it defines?
            if (path.extname(file.pkgPath).toLowerCase() === '.xml') {

                //didn't find any script imports for this file
                return false;
            }
            return false;
        });
    }

    /**
     * Get all available completions for the specified position
     * @param lineIndex
     * @param columnIndex
     */
    public getCompletions(position: Position): CompletionItem[] {
        let scriptImport = util.getScriptImportAtPosition(this.scriptTagImports, position);
        if (scriptImport) {
            return this.program.getScriptImportCompletions(this.pkgPath, scriptImport);
        } else {
            return [];
        }
    }

    /**
     * Get the parent component (the component this component extends)
     */
    public get parentComponent() {
        return this.cache.getOrAdd('parent', () => {
            return this.program.getComponent(this.parentComponentName?.text)?.file ?? null;
        });
    }

    public getHover(position: Position): Hover { //eslint-disable-line
        //TODO implement
        // let result = {} as Hover;
        return null;
    }

    public getReferences(position: Position): Promise<Location[]> { //eslint-disable-line
        //TODO implement
        return null;
    }

    public getFunctionScopeAtPosition(position: Position, functionScopes?: FunctionScope[]): FunctionScope { //eslint-disable-line
        //TODO implement
        return null;
    }

    /**
     * Walk up the ancestor chain and aggregate all of the script tag imports
     */
    public getAncestorScriptTagImports() {
        let result = [];
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
    private getMissingImportsForTranspile() {
        let ownImports = this.getAvailableScriptImports();

        let parentImports = this.parentComponent?.getAvailableScriptImports() ?? [];

        let parentMap = parentImports.reduce((map, pkgPath) => {
            map[pkgPath] = true;
            return map;
        }, {});

        //if the XML already has this import, skip this one
        let alreadyThereScriptImportMap = this.scriptTagImports.reduce((map, fileReference) => {
            map[fileReference.pkgPath] = true;
            return map;
        }, {});

        let result = [] as string[];
        for (let ownImport of ownImports) {
            if (
                //if the parent doesn't have this import
                !parentMap[ownImport] &&
                //the XML doesn't already have a script reference for this
                !alreadyThereScriptImportMap[ownImport]
            ) {
                result.push(ownImport);
            }
        }

        result.push('source/bslib.brs');
        return result;
    }

    private logDebug(...args) {
        this.program.logger.debug('XmlFile', chalk.green(this.pkgPath), ...args);
    }

    /**
     * Convert the brightscript/brighterscript source code into valid brightscript
     */
    public transpile(): CodeWithSourceMap {
        const source = this.pathAbsolute;
        const extraImports = this.getMissingImportsForTranspile();
        if (this.needsTranspiled || extraImports.length > 0) {
            //emit an XML document with sourcemaps from the AST
            return this.parser.ast.transpile(source, extraImports);
        } else {
            //emit the XML as-is with a simple map to the original XML location
            return simpleMap(source, this.fileContents);
        }
    }

    public dispose() {
        if (this.unsubscribeFromDependencyGraph) {
            this.unsubscribeFromDependencyGraph();
        }
    }
}

function simpleMap(source: string, src: string) {
    //create a source map from the original source code
    let chunks = [] as (SourceNode | string)[];
    let lines = src.split(/\r?\n/g);
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        let line = lines[lineIndex];
        chunks.push(
            lineIndex > 0 ? '\n' : '',
            new SourceNode(lineIndex + 1, 0, source, line)
        );
    }

    //sourcemap reference
    chunks.push(`<!--//# sourceMappingURL=./${path.basename(source)}.map -->`);

    return new SourceNode(null, null, source, chunks).toStringWithSourceMap();
}
