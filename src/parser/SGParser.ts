import type { AttributeCstNode, ContentCstNode, DocumentCstNode, ElementCstNode } from '@xml-tools/parser';
import * as parser from '@xml-tools/parser';
import { DiagnosticMessages } from '../DiagnosticMessages';
import type { Diagnostic } from 'vscode-languageserver';
import util from '../util';
import { SGAst, SGProlog, SGChildren, SGComponent, SGInterfaceField, SGInterfaceFunction, SGInterface, SGNode, SGScript, SGAttribute } from './SGTypes';
import type { SGTag, SGToken, SGReferences } from './SGTypes';
import { isSGComponent } from '../astUtils/xml';

export default class SGParser {

    /**
     * The AST of the XML document, not including the inline scripts
     */
    public ast: SGAst = new SGAst();

    public tokens: IToken[];

    /**
     * The list of diagnostics found during the parse process
     */
    public diagnostics = [] as Diagnostic[];

    private pkgPath: string;

    private _references: SGReferences;

    /**
     * These are initially extracted during parse-time, but will also be dynamically regenerated if need be.
     *
     * If a plugin modifies the AST, then the plugin should call SGAst#invalidateReferences() to force this object to refresh
     */
    get references(): SGReferences {
        if (this._references === undefined) {
            this.findReferences();
        }
        return this._references;
    }


    /**
     * Invalidates (clears) the references collection. This should be called anytime the AST has been manipulated.
     */
    invalidateReferences() {
        this._references = undefined;
    }

    /**
     * Walk the AST to extract references to useful bits of information
     */
    private findReferences() {
        this._references = this.emptySGReferences();

        const { component } = this.ast;
        if (!component) {
            return;
        }

        const nameAttr = component.getAttribute('name');
        if (nameAttr?.value) {
            this._references.name = nameAttr.value;
        }
        const extendsAttr = component.getAttribute('extends');
        if (extendsAttr?.value) {
            this._references.extends = extendsAttr.value;
        }

        for (const script of component.getScripts()) {
            const uriAttr = script.getAttribute('uri');
            if (uriAttr?.value) {
                const uri = uriAttr.value.text;
                this._references.scriptTagImports.push({
                    filePathRange: uriAttr.value.range,
                    text: uri,
                    pkgPath: util.getPkgPathFromTarget(this.pkgPath, uri)
                });
            }
        }
    }

    public parse(pkgPath: string, fileContents: string) {
        this.pkgPath = pkgPath;
        this.diagnostics = [];

        const { cst, tokenVector, lexErrors, parseErrors } = parser.parse(fileContents);
        this.tokens = tokenVector;

        if (lexErrors.length) {
            for (const err of lexErrors) {
                this.diagnostics.push({
                    ...DiagnosticMessages.xmlGenericParseError(`Syntax error: ${err.message}`),
                    range: util.createRange(
                        err.line - 1,
                        err.column,
                        err.line - 1,
                        err.column + err.length
                    )
                });
            }
        }
        if (parseErrors.length) {
            const err = parseErrors[0];
            const token = err.token;
            this.diagnostics.push({
                ...DiagnosticMessages.xmlGenericParseError(`Syntax error: ${err.message}`),
                range: !isNaN(token.startLine) ? this.rangeFromToken(token) : util.createRange(0, 0, 0, Number.MAX_VALUE)
            });
        }

        const { prolog, root } = this.buildAST(cst as any);
        if (!root) {
            const token1 = tokenVector[0];
            const token2 = tokenVector[1];
            //whitespace before the prolog isn't allowed by the parser
            if (
                token1?.image.trim().length === 0 &&
                token2?.image.trim() === '<?xml'
            ) {
                this.diagnostics.push({
                    ...DiagnosticMessages.xmlGenericParseError('Syntax error: whitespace found before the XML prolog'),
                    range: this.rangeFromToken(token1)
                });
            }
        }

        if (isSGComponent(root)) {
            this.ast = new SGAst(prolog, root, root);
        } else {
            if (root) {
                //error: not a component
                this.diagnostics.push({
                    ...DiagnosticMessages.xmlUnexpectedTag(root.startTagName.text),
                    range: root.startTagName.range
                });
            }
            this.ast = new SGAst(prolog, root);
        }
    }

    buildAST(cst: DocumentCstNode) {
        const { prolog: cstProlog, element } = cst.children;

        let prolog: SGProlog;
        if (cstProlog?.[0]) {
            const ctx = cstProlog[0].children;
            prolog = new SGProlog(
                // <?
                this.createPartialToken(ctx.XMLDeclOpen[0], 0, 2),
                // xml
                this.createPartialToken(ctx.XMLDeclOpen[0], 2, 3),
                this.mapAttributes(ctx.attribute),
                // ?>
                this.mapToken(ctx.SPECIAL_CLOSE[0])
            );
        }

        let root: SGTag;
        if (element.length > 0 && element[0]?.children?.Name) {
            root = this.mapElement(element[0]);
        }

        return {
            prolog: prolog,
            root: root
        };
    }

    mapElement({ children }: ElementCstNode): SGTag {
        const startTagOpen = this.mapToken(children.OPEN[0]);
        const startTagName = this.mapToken(children.Name[0]);
        const attributes = this.mapAttributes(children.attribute);
        const startTagClose = this.mapToken((children.SLASH_CLOSE ?? children.START_CLOSE)?.[0]);
        const endTagOpen = this.mapToken(children.SLASH_OPEN?.[0]);
        const endTagName = this.mapToken(children.END_NAME?.[0]);
        const endTagClose = this.mapToken(children.END?.[0]);

        const content = children.content?.[0];

        let childrenContent: SGTag[];

        switch (startTagName.text) {
            case 'component':
                childrenContent = this.mapElements(content, ['interface', 'script', 'children']);
                return new SGComponent(startTagOpen, startTagName, attributes, startTagClose, childrenContent, endTagOpen, endTagName, endTagClose);
            case 'interface':
                childrenContent = this.mapElements(content, ['field', 'function']);
                return new SGInterface(startTagOpen, startTagName, attributes, startTagClose, childrenContent, endTagOpen, endTagName, endTagClose);
            case 'field':
                if (this.hasElements(content)) {
                    this.diagnostics.push({
                        range: startTagName.range,
                        ...DiagnosticMessages.xmlUnexpectedChildren(startTagName.text)
                    });
                }
                return new SGInterfaceField(startTagOpen, startTagName, attributes, startTagClose, childrenContent, endTagOpen, endTagName, endTagClose);
            case 'function':
                if (this.hasElements(content)) {
                    this.diagnostics.push({
                        range: startTagName.range,
                        ...DiagnosticMessages.xmlUnexpectedChildren(startTagName.text)
                    });
                }
                return new SGInterfaceFunction(startTagOpen, startTagName, attributes, startTagClose, childrenContent, endTagOpen, endTagName, endTagClose);
            case 'script':
                if (this.hasElements(content)) {
                    this.diagnostics.push({
                        range: startTagName.range,
                        ...DiagnosticMessages.xmlUnexpectedChildren(startTagName.text)
                    });
                }
                const script = new SGScript(startTagOpen, startTagName, attributes, startTagClose, childrenContent, endTagOpen, endTagName, endTagClose);
                script.cdata = this.getCdata(content);
                return script;
            case 'children':
                childrenContent = this.mapNodes(content);
                return new SGChildren(startTagOpen, startTagName, attributes, startTagClose, childrenContent, endTagOpen, endTagName, endTagClose);
            default:
                childrenContent = this.mapNodes(content);
                return new SGNode(startTagOpen, startTagName, attributes, startTagClose, childrenContent, endTagOpen, endTagName, endTagClose);
        }
    }

    mapNode({ children }: ElementCstNode): SGNode {
        return new SGNode(
            //<
            this.mapToken(children.OPEN[0]),
            // TagName
            this.mapToken(children.Name[0]),
            this.mapAttributes(children.attribute),
            // > or />
            this.mapToken((children.SLASH_CLOSE ?? children.START_CLOSE)[0]),
            this.mapNodes(children.content?.[0]),
            // </
            this.mapToken(children.SLASH_OPEN?.[0]),
            // TagName
            this.mapToken(children.END_NAME?.[0]),
            // >
            this.mapToken(children.END?.[0])
        );
    }

    mapElements(content: ContentCstNode, allow: string[]): SGTag[] {
        if (!content) {
            return [];
        }
        const { element } = content.children;
        const tags: SGTag[] = [];
        if (element) {
            for (const entry of element) {
                const name = entry.children.Name?.[0];
                if (name?.image) {
                    if (!allow.includes(name.image)) {
                        //unexpected tag
                        this.diagnostics.push({
                            ...DiagnosticMessages.xmlUnexpectedTag(name.image),
                            range: this.rangeFromToken(name)
                        });
                    }
                    tags.push(this.mapElement(entry));
                } else {
                    //bad xml syntax...
                }
            }
        }
        return tags;
    }

    mapNodes(content: ContentCstNode): SGNode[] {
        if (!content) {
            return [];
        }
        const { element } = content.children;
        return element?.map(element => this.mapNode(element));
    }

    hasElements(content: ContentCstNode): boolean {
        return !!content?.children.element?.length;
    }

    getCdata(content: ContentCstNode): SGToken {
        if (!content) {
            return undefined;
        }
        const { CData } = content.children;
        return this.mapToken(CData?.[0]);
    }

    private mapToken(token: IToken): SGToken {
        if (token) {
            return {
                text: token.image,
                range: this.rangeFromToken(token)
            };
        } else {
            return undefined;
        }
    }

    /**
     * Build SGAttributes from the underlying XML parser attributes array
     */
    mapAttributes(attributes: AttributeCstNode[]) {
        // this is a hot function and has been optimized, so don't refactor unless you know what you're doing...
        const result = [] as SGAttribute[];
        if (attributes) {
            for (let i = 0; i < attributes.length; i++) {
                const children = attributes[i].children;
                let equals: SGToken;
                if (children.EQUALS) {
                    equals = this.mapToken(children.EQUALS[0]);
                }
                let leadingQuote: SGToken;
                let value: SGToken;
                let trailingQuote: SGToken;
                if (children.STRING) {
                    const valueToken = children.STRING[0];
                    leadingQuote = this.createPartialToken(valueToken, 0, 1);
                    value = this.createPartialToken(valueToken, 1, -2);
                    trailingQuote = this.createPartialToken(valueToken, -1, 1);
                }
                result.push(
                    new SGAttribute(
                        this.mapToken(children.Name[0]),
                        equals,
                        leadingQuote,
                        value,
                        trailingQuote
                    )
                );
            }
        }
        return result;
    }

    /**
     * Create a partial token from the given token. This only supports single-line tokens.
     * @param startOffset the offset to start the new token. If negative, subtracts from token.length
     * @param length the length of the text to keep. If negative, subtracts from token.length
     */
    public createPartialToken(token: IToken, startOffset: number, length?: number) {
        if (startOffset < 0) {
            startOffset = token.image.length + startOffset;
        }
        if (length === undefined) {
            length = token.image.length - startOffset;
        }
        if (length < 0) {
            length = token.image.length + length;
        }
        return {
            text: token.image.substring(startOffset, startOffset + length),
            //xmltools startLine is 1-based, we need 0-based which is why we subtract 1 below
            range: util.createRange(
                token.startLine - 1,
                token.startColumn - 1 + startOffset,
                token.endLine - 1,
                token.startColumn - 1 + (startOffset + length)
            )
        };
    }

    /**
     * Create a range based on the xmltools token
     */
    public rangeFromToken(token: IToken) {
        return util.createRange(
            token.startLine - 1,
            token.startColumn - 1,
            token.endLine - 1,
            token.endColumn
        );
    }

    private emptySGReferences(): SGReferences {
        return {
            scriptTagImports: []
        };
    }
}

//not exposed by @xml-tools/parser
interface IToken {
    image: string;
    startOffset: number;
    startLine?: number;
    startColumn?: number;
    endOffset?: number;
    endLine?: number;
    endColumn?: number;
}

export interface CstNodeLocation {
    startOffset: number;
    startLine: number;
    startColumn?: number;
    endOffset?: number;
    endLine?: number;
    endColumn?: number;
}
