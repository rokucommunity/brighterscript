import type { AttributeCstNode, ContentCstNode, DocumentCstNode, ElementCstNode } from '@xml-tools/parser';
import * as parser from '@xml-tools/parser';
import { DiagnosticMessages } from '../DiagnosticMessages';
import type { Range, Diagnostic } from 'vscode-languageserver';
import util from '../util';

export function parse(fileContents: string) {
    const diagnostics: Diagnostic[] = [];

    const { cst, tokenVector, lexErrors, parseErrors } = parser.parse(fileContents);

    if (lexErrors.length) {
        lexErrors.forEach(err => {
            diagnostics.push({
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
        diagnostics.push({
            ...DiagnosticMessages.xmlGenericParseError(`Syntax error: ${err.message}`),
            range: !isNaN(token.startLine) ? rangeFromTokens(token) : util.createRange(0, 0, 0, Number.MAX_VALUE)
        });
    }

    const ast = new XmlAst(cst as DocumentCstNode, diagnostics);

    if (!ast.root) {
        const token1 = tokenVector[0];
        const token2 = tokenVector[1];
        //whitespace before the prolog isn't allowed by the parser
        if (
            token1?.image.trim().length === 0 &&
            token2?.image.trim() === '<?xml'
        ) {
            diagnostics.push({
                ...DiagnosticMessages.xmlGenericParseError('Syntax error: whitespace found before the XML prolog'),
                range: rangeFromTokens(token1)
            });
        }
    }

    return ast;
}

export interface XmlAstToken {
    text: string;
    range?: Range;
}

export interface XmlAstAttribute {
    key: XmlAstToken;
    value: XmlAstToken;
    range?: Range;
}

export interface XmlAstProlog {
    attributes: XmlAstAttribute[];
    range?: Range;
}

export interface XmlAstNode {
    name: XmlAstToken;
    endName?: XmlAstToken;
    attributes: XmlAstAttribute[];
    cdata?: XmlAstToken;
    children?: XmlAstNode[];
    range?: Range;
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

export class XmlAst {
    prolog: XmlAstProlog;
    root: XmlAstNode;

    constructor(cst: DocumentCstNode, public diagnostics: Diagnostic[]) {
        const { prolog, element } = cst.children;
        if (prolog?.[0]) {
            const ctx = prolog[0].children;
            this.prolog = {
                attributes: mapAttributes(ctx.attribute),
                range: rangeFromTokens(ctx.XMLDeclOpen[0], ctx.SPECIAL_CLOSE[0])
            };
        }
        if (element.length > 1) {
            // TODO: error - extra nodes
        }
        if (element.length === 0 || !element[0]?.children?.Name) {
            // empty XML
            return;
        }
        this.root = mapElement(element[0]);
        if (!this.root.children) {
            this.root.children = [];
        }
    }
}

function mapElement({ children }: ElementCstNode): XmlAstNode {
    const name = children.Name[0];
    const selfClosing = !!children.SLASH_CLOSE;
    if (selfClosing) {
        const slashClose = children.SLASH_CLOSE[0];
        return {
            name: mapToken(name),
            attributes: mapAttributes(children.attribute),
            range: rangeFromTokens(name, slashClose)
        };
    }
    const endName = children.END_NAME?.[0];
    const end = children.END?.[0];
    return {
        name: mapToken(name),
        endName: mapToken(endName),
        attributes: mapAttributes(children.attribute),
        ...mapContent(children.content?.[0]),
        range: rangeFromTokens(name, end)
    };
}

function mapContent(content: ContentCstNode): { cdata?: XmlAstToken; children?: XmlAstNode[] } {
    if (!content) {
        return {};
    }
    const { CData, element } = content.children;
    return {
        cdata: mapToken(CData?.[0]),
        children: element?.map(element => mapElement(element))
    };
}

function mapToken(token: IToken, unquote = false): XmlAstToken {
    if (!token) {
        return undefined;
    }
    return {
        text: unquote ? stripQuotes(token.image) : token.image,
        range: unquote ? rangeFromTokenValue(token) : rangeFromTokens(token)
    };
}

function mapAttributes(attributes: AttributeCstNode[]): XmlAstAttribute[] {
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
