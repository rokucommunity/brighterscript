import type { CompletionItem, Position, Range } from 'vscode-languageserver';
import { CompletionItemKind, InsertTextFormat } from 'vscode-languageserver';
import type { IToken, TokenType } from 'chevrotain';
import { diagnosticCodes } from '../DiagnosticMessages';
import type { Callable, FileReference, CommentFlag } from '../interfaces';
import type { Program } from '../Program';
import util from '../util';
import SGParser from '../parser/SGParser';
import { Cache } from '../Cache';
import type { SGInterfaceField, SGInterfaceFunction, SGToken } from '../parser/SGTypes';
import { CommentFlagProcessor } from '../CommentFlagProcessor';
import type { FunctionScope } from '../FunctionScope';
import { SymbolTypeFlag } from '../SymbolTypeFlag';
import type { BscFile } from './BscFile';
import type { BscCode } from './BscCode';
import type { XmlFile } from './XmlFile';

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

export interface UnresolvedXMLSymbol {
    flags: SymbolTypeFlag;
    name: string;
    file: XmlFile;
}

/**
 * A SceneGraph component. This holds everything about the component's xml itself (tokens, AST, comment flags, etc.),
 * while the file it lives in (its `document`) holds the paths, contents, dependencies and output.
 */
export class XmlCode implements BscCode {
    constructor(options: {
        /**
         * The file this code lives in
         */
        document: BscFile;
        program: Program;
    }) {
        this.document = options.document;
        this.program = options.program;
    }

    public type = 'XmlCode';

    /**
     * The file this code lives in
     */
    public document: BscFile;

    public program: Program;

    /**
     * The region of the document this code covers. Undefined means this code covers the whole document.
     */
    public range?: Range;

    /**
     * The document as an `XmlFile`. Many things outside of this class still identify code by its file
     * (script imports, required symbols, etc.), so this is what gets handed to them until they move to `XmlCode`.
     */
    private get file() {
        return this.document as XmlFile;
    }

    public get srcPath() {
        return this.document.srcPath;
    }

    public get destPath() {
        return this.document.destPath;
    }

    /**
     * A key that identifies this code in the program. Defaults to the file's `pkgPath`, which is right for code that covers the whole file.
     */
    public get key() {
        return this._key ?? this.document.pkgPath;
    }
    public set key(value: string) {
        this._key = value;
    }
    private _key: string;

    public get pkgPath() {
        return this.document.pkgPath;
    }

    private cache = new Cache();

    /**
     * Indicates whether this code has been validated
     */
    public isValidated = false;

    public commentFlags = [] as CommentFlag[];

    public parser = new SGParser();

    /**
     * The AST for this code
     */
    public get ast() {
        return this.parser.ast;
    }

    //TODO implement the xml CDATA parsing, which would populate this list
    public callables = [] as Callable[];

    public functionScopes = [] as FunctionScope[];

    /**
     * Tokenize and parse this code
     * @param text the xml source code to parse
     */
    public parse(text: string) {
        this.cache.clear();

        this.parser.parse(text, {
            srcPath: this.srcPath,
            destPath: this.destPath
        });

        this.program?.diagnostics.register(this.parser.diagnostics);
        //SGParser's `IToken` comes from @xml-tools/parser, which is structurally the same as chevrotain's
        //but a distinct nominal type; the same cast is used elsewhere in this file for the same reason
        this.getCommentFlags(this.parser.tokens as unknown as Array<IToken & { tokenType: TokenType }>);
    }

    /**
     * Collect all bs: comment flags
     */
    public getCommentFlags(tokens: Array<IToken & { tokenType: TokenType }>) {
        const processor = new CommentFlagProcessor(this.document, ['<!--'], diagnosticCodes);

        this.commentFlags = [];
        for (let token of tokens) {
            if (token.tokenType.name === 'Comment') {
                processor.tryAdd(
                    //remove the close comment symbol
                    token.image.replace(/\-\-\>$/, ''),
                    //technically this range is 3 characters longer due to the removed `-->`, but that probably doesn't matter
                    this.parser.rangeFromToken(token)
                );
            }
        }
        processor.finalize();
        this.commentFlags.push(...processor.commentFlags);
        this.program?.diagnostics.register(processor.diagnostics);
    }

    /**
     * The list of script imports delcared in the XML of this component.
     * This excludes parent imports and auto codebehind imports
     */
    public get scriptTagImports(): FileReference[] {
        return this.parser.references.scriptTagImports
            .map(tag => ({
                ...tag,
                sourceFile: this.file
            }));
    }

    /**
     * The name of the component that this component extends.
     * Available after `parse()`
     */
    public get parentComponentName(): SGToken {
        return this.parser?.references.extends;
    }

    /**
     * The name of the component declared in this xml
     * Available after `parse()`
     */
    public get componentName(): SGToken {
        return this.parser?.references.name;
    }

    public get requiredSymbols() {
        return this.cache.getOrAdd(`requiredSymbols`, () => {
            this.program.logger.debug('Getting required symbols', this.srcPath);


            const requiredSymbols: UnresolvedXMLSymbol[] = [];

            const allInterfaceFunctions = this.parser.ast.componentElement?.interfaceElement?.getElementsByTagName<SGInterfaceFunction>('function') ?? [];

            for (const node of allInterfaceFunctions) {
                if (node.name) {
                    requiredSymbols.push({
                        flags: SymbolTypeFlag.runtime,
                        file: this.file,
                        name: node.name.toLowerCase()
                    });
                }
            }

            const allInterfaceFields = this.parser.ast.componentElement?.interfaceElement?.getElementsByTagName<SGInterfaceField>('field') ?? [];

            for (const node of allInterfaceFields) {
                if (node.onChange) {
                    requiredSymbols.push({
                        flags: SymbolTypeFlag.runtime,
                        file: this.file,
                        name: node.onChange.toLowerCase()
                    });
                }
                // TODO: when we can specify proper types in fields, add those types too:
                //if (node.type && isCustomXmlType(node.type)) {
                //    requiredSymbols.push({
                //        flags: SymbolTypeFlag.typetime,
                //        file: this.file,
                //        name: node.type.toLowerCase()
                //    });
                //}
            }
            return requiredSymbols;
        });
    }

    /**
     * Get the xml element/attribute completions for the specified position. Script import path
     * completions (e.g. `<script uri="|" />`) are handled by `CompletionsProcessor` before this is called.
     */
    public getCompletions(position: Position): CompletionItem[] {
        //don't provide completions inside an attribute value string (e.g. `text="|"`); reserved for future work
        if (this.getTokenAt(position)?.tokenType?.name === XmlTokenName.string) {
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
            const tokenName = tokens[i].tokenType?.name;
            if (tokenName === XmlTokenName.open || tokenName === XmlTokenName.slashOpen || tokenName === XmlTokenName.close || tokenName === XmlTokenName.slashClose) {
                boundaryIndex = i;
            }
        }
        const boundary = boundaryIndex >= 0 ? tokens[boundaryIndex] : undefined;

        //cursor is inside an open start tag: `<` tagName [attributes...]
        if (boundary?.tokenType?.name === XmlTokenName.open) {
            const tagNameToken = tokens[boundaryIndex + 1];
            //no tag name yet, or the cursor is still on/within the tag name -> complete element names
            if (tagNameToken?.tokenType?.name !== XmlTokenName.name || util.comparePositionToRange(position, this.getTokenRange(tagNameToken)) <= 0) {
                return this.getElementCompletions(position, false);
            }
            //otherwise complete attribute (field) names for the enclosing node
            return this.getAttributeCompletions(tagNameToken.image, this.getExistingAttributeNames(boundaryIndex + 2));
        }

        //cursor is in element content (right after a `>` / `/>`) -> complete child element names
        if (boundary?.tokenType?.name === XmlTokenName.close || boundary?.tokenType?.name === XmlTokenName.slashClose) {
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
            const tokenName = tokens[i].tokenType?.name;
            //inside a start tag the only token kinds are attribute names, `=`, and values; anything else ends the tag
            if (tokenName !== XmlTokenName.name && tokenName !== XmlTokenName.equals && tokenName !== XmlTokenName.string) {
                break;
            }
            if (tokenName === XmlTokenName.name && tokens[i + 1]?.tokenType?.name === XmlTokenName.equals) {
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
            switch (token.tokenType?.name) {
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

    public getFunctionScopeAtPosition(position: Position, functionScopes?: FunctionScope[]): FunctionScope { //eslint-disable-line
        //TODO implement
        return null;
    }
}
