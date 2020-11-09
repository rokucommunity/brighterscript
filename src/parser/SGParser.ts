import type { AttributeCstNode, ContentCstNode, DocumentCstNode, ElementCstNode } from '@xml-tools/parser';
import * as parser from '@xml-tools/parser';
import { DiagnosticMessages } from '../DiagnosticMessages';
import type { Diagnostic, Range } from 'vscode-languageserver';
import util from '../util';
import { SGProlog, SGChildren, SGComponent, SGField, SGFunction, SGInterface, SGNode, SGScript } from './SGTypes';
import type { SGAst, SGTag, SGToken, SGAttribute, SGReferences } from './SGTypes';
import { isSGComponent } from '../astUtils/xml';

export default class SGParser {

    /**
     * The AST of the XML document, not including the inline scripts
     */
    public ast: SGAst = {};

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
        this._references = emptySGReferences();

        const { component } = this.ast;
        if (!component) {
            return;
        }

        const nameAttr = component.getSGAttribute('name');
        if (nameAttr?.value) {
            this._references.name = nameAttr.value.text;
            this._references.nameRange = nameAttr.value.range;
        }
        const extendsAttr = component.getSGAttribute('extends');
        if (extendsAttr?.value) {
            this._references.extends = extendsAttr.value.text;
            this._references.extendsRange = extendsAttr.value.range;
        }

        component.scripts.forEach(script => {
            const uriAttr = script.getSGAttribute('uri');
            if (uriAttr) {
                const uri = uriAttr.value.text;
                this._references.scriptTagImports.push({
                    filePathRange: uriAttr.value.range,
                    text: uri,
                    pkgPath: util.getPkgPathFromTarget(this.pkgPath, uri)
                });
            }
        });
    }

    public parse(pkgPath: string, fileContents: string) {
        this.pkgPath = pkgPath;
        this.diagnostics = [];

        const { cst, tokenVector, lexErrors, parseErrors } = parser.parse(fileContents);

        if (lexErrors.length) {
            lexErrors.forEach(err => {
                this.diagnostics.push({
                    ...DiagnosticMessages.xmlGenericParseError(`Syntax error: ${err.message}`),
                    range: util.createRange(
                        err.line - 1,
                        err.column,
                        err.line - 1,
                        err.column + err.length
                    )
                });
            });
        }
        if (parseErrors.length) {
            const err = parseErrors[0];
            const token = err.token;
            this.diagnostics.push({
                ...DiagnosticMessages.xmlGenericParseError(`Syntax error: ${err.message}`),
                range: !isNaN(token.startLine) ? rangeFromTokens(token) : util.createRange(0, 0, 0, Number.MAX_VALUE)
            });
        }

        const { prolog, root } = buildAST(cst as DocumentCstNode, this.diagnostics);
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
                    range: rangeFromTokens(token1)
                });
            }
        }

        if (isSGComponent(root)) {
            this.ast = {
                prolog: prolog,
                component: root,
                root: root
            };
        } else {
            if (root) {
                //error: not a component
                this.diagnostics.push({
                    ...DiagnosticMessages.xmlUnexpectedTag(root.tag.text),
                    range: root.tag.range
                });
            }
            this.ast = {
                prolog: prolog,
                root: root
            };
        }
    }
}

function buildAST(cst: DocumentCstNode, diagnostics: Diagnostic[]) {
    const { prolog: cstProlog, element } = cst.children;

    let prolog: SGProlog;
    if (cstProlog?.[0]) {
        const ctx = cstProlog[0].children;
        prolog = new SGProlog(
            mapToken(ctx.XMLDeclOpen[0]),
            mapAttributes(ctx.attribute),
            rangeFromTokens(ctx.XMLDeclOpen[0], ctx.SPECIAL_CLOSE[0])
        );
    }

    let root: SGTag;
    if (element.length > 0 && element[0]?.children?.Name) {
        root = mapElement(element[0], diagnostics);
    }

    return {
        prolog: prolog,
        root: root
    };
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

function mapElement({ children }: ElementCstNode, diagnostics: Diagnostic[]): SGTag {
    const nameToken = children.Name[0];
    let range: Range;
    const selfClosing = !!children.SLASH_CLOSE;
    if (selfClosing) {
        const scToken = children.SLASH_CLOSE[0];
        range = rangeFromTokens(nameToken, scToken);
    } else {
        const endToken = children.END?.[0];
        range = rangeFromTokens(nameToken, endToken);
    }
    const name = mapToken(nameToken);
    const attributes = mapAttributes(children.attribute);
    const content = children.content?.[0];
    switch (name.text) {
        case 'component':
            const componentContent = mapElements(content, ['interface', 'script', 'children'], diagnostics);
            return new SGComponent(name, attributes, componentContent, range);
        case 'interface':
            const interfaceContent = mapElements(content, ['field', 'function'], diagnostics);
            return new SGInterface(name, interfaceContent, range);
        case 'field':
            if (hasElements(content)) {
                reportUnexpectedChildren(name, diagnostics);
            }
            return new SGField(name, attributes, range);
        case 'function':
            if (hasElements(content)) {
                reportUnexpectedChildren(name, diagnostics);
            }
            return new SGFunction(name, attributes, range);
        case 'script':
            if (hasElements(content)) {
                reportUnexpectedChildren(name, diagnostics);
            }
            const cdata = getCdata(content);
            return new SGScript(name, attributes, cdata, range);
        case 'children':
            const childrenContent = mapNodes(content);
            return new SGChildren(name, childrenContent, range);
        default:
            const nodeContent = mapNodes(content);
            return new SGNode(name, attributes, nodeContent, range);
    }
}

function reportUnexpectedChildren(name: SGToken, diagnostics: Diagnostic[]) {
    diagnostics.push({
        ...DiagnosticMessages.xmlUnexpectedChildren(name.text),
        range: name.range
    });
}

function mapNode({ children }: ElementCstNode): SGNode {
    const nameToken = children.Name[0];
    let range: Range;
    const selfClosing = !!children.SLASH_CLOSE;
    if (selfClosing) {
        const scToken = children.SLASH_CLOSE[0];
        range = rangeFromTokens(nameToken, scToken);
    } else {
        const endToken = children.END?.[0];
        range = rangeFromTokens(nameToken, endToken);
    }
    const name = mapToken(nameToken);
    const attributes = mapAttributes(children.attribute);
    const content = children.content?.[0];
    const nodeContent = mapNodes(content);
    return new SGNode(name, attributes, nodeContent, range);
}

function mapElements(content: ContentCstNode, allow: string[], diagnostics: Diagnostic[]): SGTag[] {
    if (!content) {
        return [];
    }
    const { element } = content.children;
    const tags: SGTag[] = [];
    element?.forEach(element => {
        const name = element.children.Name?.[0];
        if (name && allow.includes(name.image)) {
            tags.push(mapElement(element, diagnostics));
        } else {
            //unexpected tag
            diagnostics.push({
                ...DiagnosticMessages.xmlUnexpectedTag(name.image),
                range: rangeFromTokens(name)
            });
        }
    });
    return tags;
}

function mapNodes(content: ContentCstNode): SGNode[] {
    if (!content) {
        return [];
    }
    const { element } = content.children;
    return element?.map(element => mapNode(element));
}

function hasElements(content: ContentCstNode): boolean {
    return !!content?.children.element?.length;
}

function getCdata(content: ContentCstNode): SGToken {
    if (!content) {
        return undefined;
    }
    const { CData } = content.children;
    return mapToken(CData?.[0]);
}

function mapToken(token: IToken, unquote = false): SGToken {
    if (!token) {
        return undefined;
    }
    return {
        text: unquote ? stripQuotes(token.image) : token.image,
        range: unquote ? rangeFromTokenValue(token) : rangeFromTokens(token)
    };
}

function mapAttributes(attributes: AttributeCstNode[]): SGAttribute[] {
    return attributes?.map(({ children }) => {
        const key = children.Name[0];
        const value = children.STRING?.[0];
        return {
            key: mapToken(key),
            value: mapToken(value, true),
            range: rangeFromTokens(key, value)
        };
    }) || [];
}

//make range from `start` to `end` tokens
function rangeFromTokens(start: IToken, end?: IToken) {
    if (!end) {
        end = start;
    }
    return util.createRange(
        start.startLine - 1,
        start.startColumn - 1,
        end.endLine - 1,
        end.endColumn
    );
}

//make range not including quotes
function rangeFromTokenValue(token: IToken) {
    if (!token) {
        return undefined;
    }
    return util.createRange(
        token.startLine - 1,
        token.startColumn,
        token.endLine - 1,
        token.endColumn - 1
    );
}

function stripQuotes(value: string) {
    if (value?.length > 1) {
        return value.substr(1, value.length - 2);
    }
    return '';
}

function emptySGReferences(): SGReferences {
    return {
        scriptTagImports: []
    };
}
