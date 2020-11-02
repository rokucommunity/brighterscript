import * as path from 'path';
import type { CodeWithSourceMap } from 'source-map';
import { SourceNode } from 'source-map';
import type { CompletionItem, Hover, Location, Position, Range } from 'vscode-languageserver';
import { DiagnosticMessages } from '../DiagnosticMessages';
import type { FunctionScope } from '../FunctionScope';
import type { Callable, BsDiagnostic, File, FileReference, FunctionCall } from '../interfaces';
import type { Program } from '../Program';
import util from '../util';
import XmlParser from '../parser/XmlParser';
import type { XmlAst, XmlAstNode, XmlAstAttribute, XmlAstToken } from '../parser/XmlParser';
import chalk from 'chalk';
import { Cache } from '../Cache';
import * as extname from 'path-complete-extname';
import type { DependencyGraph } from '../DependencyGraph';
import { createXmlAstNode, findXmlAstAttribute } from '../astUtils/xml';

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
     * The range of the component's name value
     */
    public componentNameRange: Range;

    /**
     * The range of the component's parent name (if exist
     */
    public parentNameRange: Range;

    /**
     * The extension for this file
     */
    public extension: string;

    /**
     * The list of script imports delcared in the XML of this file.
     * This excludes parent imports and auto codebehind imports
     */
    public scriptTagImports = [] as FileReference[];

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

    public parser = new XmlParser();

    //TODO implement the xml CDATA parsing, which would populate this list
    public callables = [] as Callable[];

    //TODO implement the xml CDATA parsing, which would populate this list
    public functionCalls = [] as FunctionCall[];

    public functionScopes = [] as FunctionScope[];

    /**
     * The name of the component that this component extends.
     * Available after `parse()`
     */
    public parentComponentName: string;

    /**
     * The name of the component declared in this xml file
     * Available after `parse()`
     */
    public componentName: string;

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

    public parse(fileContents: string) {
        this.fileContents = fileContents;

        this.parser.parse(fileContents);
        this.diagnostics = this.parser.diagnostics.map(diagnostic => ({
            ...diagnostic,
            file: this
        }));

        if (!this.parser.ast.root) {
            //empty XML
            return;
        }

        //notify AST ready
        this.program.plugins.emit('afterFileParse', this);

        //walk AST
        this.walkComponent(this.parser.ast.root);

        //catch script imports with same path as the auto-imported codebehind file
        let explicitCodebehindScriptTag = this.program.options.autoImportComponentScript === true
            ? this.scriptTagImports.find(x => this.possibleCodebehindPkgPaths.includes(x.pkgPath))
            : undefined;
        if (explicitCodebehindScriptTag) {
            this.diagnostics.push({
                ...DiagnosticMessages.unnecessaryCodebehindScriptImport(),
                file: this,
                range: explicitCodebehindScriptTag.filePathRange
            });
        }
    }

    private walkComponent(node: XmlAstNode) {
        if (node.name.text !== 'component') {
            //not a SG component
            this.diagnostics.push({
                ...DiagnosticMessages.xmlComponentMissingComponentDeclaration(),
                range: node.range,
                file: this
            });
            return;
        }

        const nameAttr = findXmlAstAttribute(node, 'name');
        if (!nameAttr) {
            this.diagnostics.push({
                ...DiagnosticMessages.xmlComponentMissingNameAttribute(),
                range: node.name.range,
                file: this
            });
        } else {
            this.componentName = nameAttr.value.text;
            this.componentNameRange = nameAttr.value.range;
        }

        const extendsAttr = findXmlAstAttribute(node, 'extends');
        if (!extendsAttr) {
            this.diagnostics.push({
                ...DiagnosticMessages.xmlComponentMissingExtendsAttribute(),
                range: node.name.range,
                file: this
            });
        } else {
            this.parentComponentName = extendsAttr.value.text;
            this.parentNameRange = extendsAttr.value.range;
        }

        //validate tags and find script
        this.validateChildrenOf(node, {
            'interface': node => {
                //TODO: validate interface
                this.validateChildrenOf(node, {
                    'field': () => {},
                    'function': () => {}
                });
            },
            'script': node => {
                const uriAttr = findXmlAstAttribute(node, 'uri');
                if (uriAttr) {
                    this.scriptTagImports.push({
                        filePathRange: uriAttr.value.range,
                        sourceFile: this,
                        text: uriAttr.value.text,
                        pkgPath: util.getPkgPathFromTarget(this.pkgPath, uriAttr.value.text)
                    });
                }
                //TODO: parse inline script
            },
            'children': () => {
                //TODO: validate children components
            }
        });
    }

    private validateChildrenOf(node: XmlAstNode, validate: Record<string, (node: XmlAstNode) => void>) {
        node.children?.forEach(node => {
            const name = node.name?.text;
            if (!name) {
                return;
            }
            if (validate[name]) {
                validate[name](node);
            } else {
                this.diagnostics.push({
                    ...DiagnosticMessages.xmlUnknownTag(name),
                    range: node.name.range,
                    file: this
                });
            }
        });
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
            return `component:${this.componentName}`.toLowerCase();
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
            return `component:${this.parentComponentName}`.toLowerCase();
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
            return this.program.getComponent(this.parentComponentName)?.file ?? null;
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
        if (extraImports.length > 0 || this.needsTranspiled) {
            //emit an XML document with sourcemaps from the AST
            return transpileAst(source, this.parser.ast, extraImports);
        } else {
            //create a source map from the original source code
            let chunks = [] as (SourceNode | string)[];
            let lines = this.fileContents.split(/\r?\n/g);
            for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
                let line = lines[lineIndex];
                chunks.push(
                    lineIndex > 0 ? '\n' : '',
                    new SourceNode(lineIndex + 1, 0, source, line)
                );
            }
            return new SourceNode(null, null, source, chunks).toStringWithSourceMap();
        }
    }

    public dispose() {
        if (this.unsubscribeFromDependencyGraph) {
            this.unsubscribeFromDependencyGraph();
        }
    }
}

function transpileAst(source: string, ast: XmlAst, extraImports: string[]) {
    const { prolog, root } = ast;
    //create a clone
    let component = {
        ...root,
        children: [
            ...root.children?.map(updateScript)
        ]
    };
    //insert extra imports
    const extraScripts = extraImports
        .map(uri => createXmlAstNode('script', {
            type: 'text/brightscript',
            uri: util.getRokuPkgPath(uri.replace(/\.bs$/, '.brs'))
        }));
    if (extraScripts.length) {
        component.children.push(...extraScripts);
    }

    const chunks = [] as Array<SourceNode | string>;
    //write XML prolog
    if (prolog) {
        const offset = rangeToSourceOffset(prolog.range);
        chunks.push(new SourceNode(offset.line, offset.column, source, [
            '<?xml',
            ...transpileAttributes(source, prolog.attributes),
            ' ?>\n'
        ]));
    }
    //write content
    chunks.push(transpileNode(source, component, ''));

    return new SourceNode(null, null, source, chunks).toStringWithSourceMap();
}

function updateScript(node: XmlAstNode): XmlAstNode {
    if (node.name.text !== 'script') {
        return node;
    }
    //replace type and file extension of brighterscript references
    const typeAttr = findXmlAstAttribute(node, 'type');
    const uriAttr = findXmlAstAttribute(node, 'uri');
    if (typeAttr?.value.text.indexOf('brighterscript') || uriAttr?.value.text.endsWith('.bs')) {
        const temp = createXmlAstNode('script', {
            type: 'text/brightscript',
            uri: uriAttr?.value.text.replace(/\.bs$/, '.brs')
        });
        temp.cdata = node.cdata;
        return temp;
    }
    return node;
}

function rangeToSourceOffset(range: Range) {
    if (!range) {
        return {
            line: null,
            column: null
        };
    }
    return {
        line: range.start.line + 1,
        column: range.start.character
    };
}

function transpileNode(source: string, node: XmlAstNode, indent: string): string | SourceNode {
    return new SourceNode(null, null, source, [
        indent,
        '<',
        transpileToken(source, node.name),
        ...transpileAttributes(source, node.attributes),
        ...transpileNodeBody(source, node, indent)
    ]);
}

function transpileToken(source: string, token: XmlAstToken) {
    const { range, text } = token;
    if (range) {
        const offset = rangeToSourceOffset(range);
        return new SourceNode(offset.line, offset.column, source, text);
    } else {
        return text;
    }
}

function transpileAttributes(source: string, attributes: XmlAstAttribute[]): (string | SourceNode)[] {
    return attributes.map(attr => {
        const offset = rangeToSourceOffset(attr.range);
        return new SourceNode(
            offset.line,
            offset.column,
            source,
            [
                ' ',
                attr.key.text,
                '="',
                attr.value.text,
                '"'
            ]);
    });
}

function transpileNodeBody(source: string, node: XmlAstNode, indent: string): (string | SourceNode)[] {
    if (node.children?.length > 0) {
        const bodyIndent = incIndent(indent);
        return [
            '>\n',
            ...node.children.map(snode => transpileNode(source, snode, bodyIndent)),
            indent,
            '</',
            node.endName ? transpileToken(source, node.endName) : node.name.text,
            '>\n'
        ];
    } else if (node.cdata) {
        return [
            '>',
            transpileToken(source, node.cdata),
            '</',
            transpileToken(source, node.name),
            '>\n'
        ];
    }
    return [' />\n'];
}

function incIndent(indent: string): string {
    return indent + '    ';
}
