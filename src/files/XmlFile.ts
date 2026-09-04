import * as path from 'path';
import type { CodeWithSourceMap } from 'source-map';
import { SourceNode } from 'source-map';
import type { CompletionItem, Location, Position, Range } from 'vscode-languageserver';
import { CompletionItemKind, InsertTextFormat } from 'vscode-languageserver';
import { diagnosticCodes } from '../DiagnosticMessages';
import type { FunctionScope } from '../FunctionScope';
import type { Callable, BsDiagnostic, File, FileReference, FunctionCall, CommentFlag } from '../interfaces';
import type { Program } from '../Program';
import util from '../util';
import SGParser, { rangeFromTokenValue } from '../parser/SGParser';
import chalk from 'chalk';
import { Cache } from '../Cache';
import type { DependencyGraph } from '../DependencyGraph';
import type { SGToken } from '../parser/SGTypes';
import { SGScript } from '../parser/SGTypes';
import { CommentFlagProcessor } from '../CommentFlagProcessor';
import type { IToken, TokenType } from 'chevrotain';
import { TranspileState } from '../parser/TranspileState';

/**
 * Names of the `@xml-tools` lexer token types we inspect for completions and hover
 */
const XmlTokenName = {
    open: 'OPEN',
    slashOpen: 'SLASH_OPEN',
    close: 'CLOSE',
    slashClose: 'SLASH_CLOSE',
    name: 'Name',
    equals: 'EQUALS',
    string: 'STRING'
} as const;

/**
 * Attributes available on the interface elements, keyed by (lower-case) tag name, in the order they
 * should be offered
 */
const interfaceElementAttributes: Record<string, string[]> = {
    field: ['id', 'type', 'value', 'onChange', 'alwaysNotify', 'alias'],
    function: ['name']
};

export class XmlFile {
    constructor(
        public srcPath: string,
        /**
         * The absolute path to the file, relative to the pkg
         */
        public pkgPath: string,
        public program: Program
    ) {
        this.extension = path.extname(this.srcPath).toLowerCase();

        this.possibleCodebehindPkgPaths = [
            this.pkgPath.replace('.xml', '.bs'),
            this.pkgPath.replace('.xml', '.brs')
        ];
    }

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
     */
    public possibleCodebehindPkgPaths: string[];

    /**
     * An unsubscribe function for the dependencyGraph subscription
     */
    private unsubscribeFromDependencyGraph: () => void;

    /**
     * Indicates whether this file needs to be validated.
     * Files are only ever validated a single time
     */
    public isValidated = false;

    /**
     * The extension for this file
     */
    public extension: string;

    public commentFlags = [] as CommentFlag[];

    /**
     * Will this file result in only comment or whitespace output? If so, it can be excluded from the output if that bsconfig setting is enabled.
     */
    readonly canBePruned = false;

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
     * List of all pkgPaths to scripts that this XmlFile depends, regardless of whether they are loaded in the program or not.
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
     * List of all pkgPaths to scripts that this XmlFile depends on directly, regardless of whether they are loaded in the program or not.
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
     * List of all pkgPaths to scripts that this XmlFile depends on that are actually loaded into the program.
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

    /**
     * A collection of diagnostics related to this file
     */
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
     * Calculate the AST for this file
     * @param fileContents the xml source code to parse
     */
    public parse(fileContents: string) {
        this.fileContents = fileContents;

        this.parser.parse(this.pkgPath, fileContents);
        this.diagnostics = this.parser.diagnostics.map(diagnostic => ({
            ...diagnostic,
            file: this
        }));

        this.getCommentFlags(this.parser.tokens as Array<IToken & { tokenType: TokenType }>);

        //needsTranspiled should be true if an import is brighterscript
        this.needsTranspiled = this.needsTranspiled || this.ast.component?.scripts?.some(
            script => script.type?.indexOf('brighterscript') > 0 || script.uri?.endsWith('.bs')
        );
    }

    /**
     * @deprecated logic has moved into XmlFileValidator, this is now an empty function
     */
    public validate() {

    }

    /**
     * Collect all bs: comment flags
     */
    public getCommentFlags(tokens: Array<IToken & { tokenType: TokenType }>) {
        const processor = new CommentFlagProcessor(this, ['<!--'], diagnosticCodes);

        this.commentFlags = [];
        for (let token of tokens) {
            if (token.tokenType.name === 'Comment') {
                processor.tryAdd(
                    //remove the close comment symbol
                    token.image.replace(/\-\-\>$/, ''),
                    rangeFromTokenValue(token)
                );
            }
        }
        processor.finalize();
        this.commentFlags.push(...processor.commentFlags);
        this.diagnostics.push(...processor.diagnostics);
    }

    private dependencyGraph: DependencyGraph;

    /**
     * Attach the file to the dependency graph so it can monitor changes.
     * Also notify the dependency graph of our current dependencies so other dependents can be notified.
     */
    public attachDependencyGraph(dependencyGraph: DependencyGraph) {
        this.dependencyGraph = dependencyGraph;
        if (this.unsubscribeFromDependencyGraph) {
            this.unsubscribeFromDependencyGraph();
        }

        //anytime a dependency changes, clean up some cached values
        this.unsubscribeFromDependencyGraph = dependencyGraph.onchange(this.dependencyGraphKey, () => {
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
        this.dependencyGraph.addOrReplace(this.dependencyGraphKey, dependencies);
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
     * If we don't have a component name, use the pkgPath so at least we can self-validate
     */
    public get dependencyGraphKey() {
        let key: string;
        if (this.componentName) {
            key = `component:${this.componentName.text}`.toLowerCase();
        } else {
            key = this.pkgPath.toLowerCase();
        }
        //if our index is not zero, then we are not the primary component with that name, and need to
        //append our index to the dependency graph key as to prevent collisions in the program.
        if (this.dependencyGraphIndex !== 0) {
            key += '[' + this.dependencyGraphIndex + ']';
        }
        return key;
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
    public doesReferenceFile(file: File) {
        return this.cache.getOrAdd(`doesReferenceFile: ${file.pkgPath}`, () => {
            if (file === this) {
                return true;
            }
            let allDependencies = this.getOwnDependencies();
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
     */
    public getCompletions(position: Position): CompletionItem[] {
        //handle script import path completions (e.g. `<script uri="|" />`)
        const scriptImport = util.getScriptImportAtPosition(this.scriptTagImports, position);
        if (scriptImport) {
            return this.program.getScriptImportCompletions(this.pkgPath, scriptImport);
        }

        //don't provide completions inside an attribute value string (e.g. `text="|"`); reserved for future work
        if (this.getTokenAt(position)?.tokenType.name === XmlTokenName.string) {
            return [];
        }

        const tokens = (this.parser.tokens ?? []) as unknown as IToken[];
        //find the most recent tag boundary (`<`, `</`, `>`, `/>`) the cursor has moved past. A boundary the
        //cursor merely sits at the start of (e.g. the `>` the caret is right before) doesn't count, so a
        //caret inside `<Label |>` still resolves to the opening `<Label` rather than the trailing `>`.
        let boundaryIndex = -1;
        for (let i = 0; i < tokens.length; i++) {
            const startLine = (tokens[i].startLine ?? 1) - 1;
            const startCharacter = (tokens[i].startColumn ?? 1) - 1;
            //tokens are ordered, so stop once one starts at or after the cursor
            if (position.line < startLine || (position.line === startLine && position.character <= startCharacter)) {
                break;
            }
            const tokenName = tokens[i].tokenType.name;
            if (tokenName === XmlTokenName.open || tokenName === XmlTokenName.slashOpen || tokenName === XmlTokenName.close || tokenName === XmlTokenName.slashClose) {
                boundaryIndex = i;
            }
        }
        const boundary = boundaryIndex >= 0 ? tokens[boundaryIndex] : undefined;

        //cursor is inside an open start tag: `<` tagName [attributes...]
        if (boundary?.tokenType.name === XmlTokenName.open) {
            const tagNameToken = tokens[boundaryIndex + 1];
            //no tag name yet, or the cursor is still on/within the tag name -> complete element names
            if (tagNameToken?.tokenType.name !== XmlTokenName.name || util.comparePositionToRange(position, this.getTokenRange(tagNameToken)) <= 0) {
                return this.getElementCompletions(position, false);
            }
            //otherwise complete attribute (field) names for the enclosing node
            return this.getAttributeCompletions(tagNameToken.image, this.getExistingAttributeNames(boundaryIndex + 2));
        }

        //cursor is in element content (right after a `>` / `/>`) -> complete child element names
        if (boundary?.tokenType.name === XmlTokenName.close || boundary?.tokenType.name === XmlTokenName.slashClose) {
            return this.getElementCompletions(position, true);
        }

        //inside a closing tag (`</...`), before any tag, or any other position -> no completions
        return [];
    }

    /**
     * Get element (tag name) completions valid at this position, based on the enclosing element:
     * `<interface>` offers `<field>`/`<function>`; `<children>` (or a nested node) offers node/component
     * instances. Other locations (the component root, etc.) offer nothing.
     * @param position the cursor position, used to determine the enclosing element
     * @param includeOpenBracket whether to prefix the inserted snippet with `<` (true when the cursor is
     * not already immediately after an `<`)
     */
    private getElementCompletions(position: Position, includeOpenBracket: boolean): CompletionItem[] {
        const container = this.getEnclosingElementName(position)?.toLowerCase();
        if (container === 'interface') {
            return this.getInterfaceElementCompletions(includeOpenBracket);
        }
        //node/component instances are only valid inside <children> or nested inside another node
        if (container === 'children' || (container && this.program.hasSceneGraphNode(container))) {
            return this.getNodeElementCompletions(includeOpenBracket);
        }
        return [];
    }

    /**
     * Get element completions for the node/component instances valid inside a `<children>` block
     * @param includeOpenBracket whether to prefix the inserted snippet with `<`
     */
    private getNodeElementCompletions(includeOpenBracket: boolean): CompletionItem[] {
        const ownComponentName = this.componentName?.text?.toLowerCase();
        const openBracket = includeOpenBracket ? '<' : '';
        return this.program.getSceneGraphNodeNames()
            //a component can't contain itself
            .filter(name => !ownComponentName || name.toLowerCase() !== ownComponentName)
            .map(name => ({
                label: name,
                kind: CompletionItemKind.Class,
                insertTextFormat: InsertTextFormat.Snippet,
                insertText: `${openBracket}${name} $0></${name}>`,
                //sort project components ahead of built-in nodes
                sortText: (this.program.getComponent(name) ? '0' : '1') + name
            }));
    }

    /**
     * Get the `<field>`/`<function>` element completions valid inside an `<interface>` block
     * @param includeOpenBracket whether to prefix the inserted snippet with `<`
     */
    private getInterfaceElementCompletions(includeOpenBracket: boolean): CompletionItem[] {
        const openBracket = includeOpenBracket ? '<' : '';
        return [
            {
                label: 'field',
                kind: CompletionItemKind.Field,
                insertTextFormat: InsertTextFormat.Snippet,
                insertText: `${openBracket}field id="$1" type="$2" />`,
                detail: 'Interface field'
            },
            {
                label: 'function',
                kind: CompletionItemKind.Function,
                insertTextFormat: InsertTextFormat.Snippet,
                insertText: `${openBracket}function name="$1" />`,
                detail: 'Interface function'
            }
        ];
    }

    /**
     * Get attribute name completions for a start tag, excluding attributes already present. Interface
     * `<field>`/`<function>` elements offer their fixed attribute set; any other tag is treated as a node
     * and offers its (inherited) writable fields.
     */
    private getAttributeCompletions(tagName: string, existingAttributeNames: string[]): CompletionItem[] {
        const existing = new Set(existingAttributeNames.map(name => name.toLowerCase()));

        //interface <field>/<function> have a fixed set of attributes
        const structuralAttributes = interfaceElementAttributes[tagName.toLowerCase()];
        if (structuralAttributes) {
            return structuralAttributes
                .map((name, index) => ({ name: name, index: index }))
                .filter(attribute => !existing.has(attribute.name.toLowerCase()))
                .map(attribute => ({
                    label: attribute.name,
                    kind: CompletionItemKind.Field,
                    insertTextFormat: InsertTextFormat.Snippet,
                    insertText: `${attribute.name}="$1"`,
                    //preserve the declared order (id/type first)
                    sortText: String(attribute.index).padStart(2, '0')
                }));
        }

        //otherwise treat the tag as a node and offer its fields
        return this.program.getSceneGraphNodeFields(tagName)
            .filter(field => !existing.has(field.name.toLowerCase()))
            //built-in read-only fields can't be set in xml; project fields (no accessPermission) are always writable
            .filter(field => !field.accessPermission || /write/i.test(field.accessPermission))
            .map(field => ({
                label: field.name,
                kind: CompletionItemKind.Field,
                insertTextFormat: InsertTextFormat.Snippet,
                insertText: `${field.name}="$1"`,
                detail: field.type,
                documentation: field.description,
                //sort a node's own fields ahead of inherited ones
                sortText: (field.origin === 'own' ? '0' : '1') + field.name
            }));
    }

    /**
     * Collect the names of attributes already written on a start tag, scanning forward from the given
     * token index until the tag closes. Used to avoid suggesting attributes that are already present.
     */
    private getExistingAttributeNames(startIndex: number): string[] {
        const names: string[] = [];
        const tokens = (this.parser.tokens ?? []) as unknown as IToken[];
        for (let i = startIndex; i < tokens.length; i++) {
            const tokenName = tokens[i].tokenType.name;
            //inside a start tag the only token kinds are attribute names, `=`, and values; anything else ends the tag
            if (tokenName !== XmlTokenName.name && tokenName !== XmlTokenName.equals && tokenName !== XmlTokenName.string) {
                break;
            }
            if (tokenName === XmlTokenName.name && tokens[i + 1]?.tokenType.name === XmlTokenName.equals) {
                names.push(tokens[i].image);
            }
        }
        return names;
    }

    /**
     * Determine the name of the element that directly encloses the given position, by walking the tokens
     * and tracking a stack of open (content-bearing) elements. Self-closing tags and closed tags are not
     * on the stack, so the result is the nearest ancestor whose start tag closed before the cursor.
     * Returns undefined at the top level of the document.
     */
    private getEnclosingElementName(position: Position): string | undefined {
        const tokens = (this.parser.tokens ?? []) as unknown as IToken[];
        const stack: string[] = [];
        let expectingTagName = false;
        let isCloseTag = false;
        let currentTag: string | undefined;
        for (const token of tokens) {
            const startLine = (token.startLine ?? 1) - 1;
            const startCharacter = (token.startColumn ?? 1) - 1;
            //tokens are ordered, so stop once one starts at or after the cursor
            if (position.line < startLine || (position.line === startLine && position.character <= startCharacter)) {
                break;
            }
            switch (token.tokenType.name) {
                case XmlTokenName.open:
                    expectingTagName = true;
                    isCloseTag = false;
                    currentTag = undefined;
                    break;
                case XmlTokenName.slashOpen:
                    expectingTagName = true;
                    isCloseTag = true;
                    currentTag = undefined;
                    break;
                case XmlTokenName.name:
                    //the first Name after an opener is the tag name; later Names are attributes
                    if (expectingTagName) {
                        currentTag = token.image;
                        expectingTagName = false;
                    }
                    break;
                case XmlTokenName.close:
                    if (isCloseTag) {
                        stack.pop();
                    } else if (currentTag) {
                        stack.push(currentTag);
                    }
                    currentTag = undefined;
                    isCloseTag = false;
                    expectingTagName = false;
                    break;
                case XmlTokenName.slashClose:
                    //self-closing start tag; nothing is pushed
                    currentTag = undefined;
                    isCloseTag = false;
                    expectingTagName = false;
                    break;
            }
        }
        return stack[stack.length - 1];
    }

    /**
     * Get the xml token whose range contains the given position (used by completions and hover)
     */
    public getTokenAt(position: Position): IToken | undefined {
        for (const token of (this.parser.tokens ?? []) as unknown as IToken[]) {
            if (util.rangeContains(this.getTokenRange(token), position)) {
                return token;
            }
        }
    }

    /**
     * Build a brighterscript (0-based) range from an `@xml-tools` (1-based) token
     */
    private getTokenRange(token: IToken): Range {
        return util.createRange(
            token.startLine - 1,
            token.startColumn - 1,
            token.endLine - 1,
            token.endColumn
        );
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

    public getFunctionScopeAtPosition(position: Position, functionScopes?: FunctionScope[]): FunctionScope { //eslint-disable-line
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
    private getMissingImportsForTranspile() {
        let ownImports = this.getAvailableScriptImports();
        //add the bslib path to ownImports, it'll get filtered down below
        ownImports.push(this.program.bslibPkgPath);

        let parentImports = this.parentComponent?.getAvailableScriptImports() ?? [];

        let parentMap = parentImports.reduce((map, pkgPath) => {
            map[pkgPath.toLowerCase()] = true;
            return map;
        }, {});

        //if the XML already has this import, skip this one
        let alreadyThereScriptImportMap = this.scriptTagImports.reduce((map, fileReference) => {
            map[fileReference.pkgPath.toLowerCase()] = true;
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

    private logDebug(...args: any[]) {
        //`args` is intentionally untyped passthrough for the logger, so there's no tighter type to spread than `any[]`
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        this.program.logger.debug('XmlFile', chalk.green(this.pkgPath), ...args);
    }

    private checkScriptsForPublishableImports(scripts: SGScript[]): [boolean, SGScript[]] {
        if (!this.program.options.pruneEmptyCodeFiles) {
            return [false, scripts];
        }
        const publishableScripts = scripts.filter(script => {
            const uriAttributeValue = script.attributes.find((v) => v.key.text === 'uri')?.value.text || '';
            const pkgMapPath = util.getPkgPathFromTarget(this.pkgPath, uriAttributeValue);
            let file = this.program.getFile(pkgMapPath);
            if (!file && pkgMapPath.endsWith(this.program.bslibPkgPath)) {
                return true;
            }
            if (!file && pkgMapPath.endsWith('.brs')) {
                file = this.program.getFile(pkgMapPath.replace(/\.brs$/, '.bs'));
            }
            return !(file?.canBePruned);
        });
        return [publishableScripts.length !== scripts.length, publishableScripts];
    }

    /**
     * Convert the brightscript/brighterscript source code into valid brightscript
     */
    public transpile(): CodeWithSourceMap {
        const state = new TranspileState(this.srcPath, this.program.options);

        const originalScripts = this.ast.component?.scripts ?? [];
        const extraImportScripts = this.getMissingImportsForTranspile().map(uri => {
            const script = new SGScript();
            script.uri = util.getRokuPkgPath(uri.replace(/\.bs$/, '.brs'));
            return script;
        });

        const [scriptsHaveChanged, publishableScripts] = this.checkScriptsForPublishableImports([
            ...originalScripts,
            ...extraImportScripts
        ]);

        let transpileResult: SourceNode | undefined;
        if (this.needsTranspiled || extraImportScripts.length > 0 || scriptsHaveChanged) {
            //temporarily add the missing imports as script tags
            this.ast.component.scripts = publishableScripts;


            transpileResult = util.sourceNodeFromTranspileResult(null, null, state.srcPath, this.parser.ast.transpile(state));

            //restore the original scripts array
            this.ast.component.scripts = originalScripts;

        } else if (this.program.options.sourceMap) {
            //emit code as-is with a simple map to the original file location
            transpileResult = util.simpleMap(state.srcPath, this.fileContents);
        } else {
            //simple SourceNode wrapping the entire file to simplify the logic below
            transpileResult = new SourceNode(null, null, state.srcPath, this.fileContents);
        }

        //add the source map comment if configured to emit sourcemaps
        if (this.program.options.sourceMap) {
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
    }
}
