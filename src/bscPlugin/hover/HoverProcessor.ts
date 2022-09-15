import { SourceNode } from 'source-map';
import { isBrsFile, isTypedFunctionType, isXmlFile } from '../../astUtils/reflection';
import type { BrsFile } from '../../files/BrsFile';
import type { XmlFile } from '../../files/XmlFile';
import type { Callable, Hover, ProvideHoverEvent } from '../../interfaces';
import type { Token } from '../../lexer/Token';
import { TokenKind } from '../../lexer/TokenKind';
import { BrsTranspileState } from '../../parser/BrsTranspileState';
import { ParseMode } from '../../parser/Parser';
import util from '../../util';

export class HoverProcessor {
    public constructor(
        public event: ProvideHoverEvent
    ) {

    }

    public process() {
        let hover: Hover;
        if (isBrsFile(this.event.file)) {
            hover = this.getBrsFileHover(this.event.file);
        } else if (isXmlFile(this.event.file)) {
            hover = this.getXmlFileHover(this.event.file);
        }

        //if we got a result, "return" it
        if (hover) {
            //assign the hover to the event
            this.event.hovers.push(hover);
        }
    }

    private buildContentsWithDocs(text: string, startingToken: Token) {
        const parts = [text];
        const docs = this.getTokenDocumentation((this.event.file as BrsFile).parser.tokens, startingToken);
        if (docs) {
            parts.push('***', docs);
        }
        return parts.join('\n');
    }

    private getBrsFileHover(file: BrsFile): Hover {
        const scope = this.event.scopes[0];
        const fence = (code: string) => util.mdFence(code, 'brightscript');
        //get the token at the position
        let token = file.getTokenAt(this.event.position);

        let hoverTokenTypes = [
            TokenKind.Identifier,
            TokenKind.Function,
            TokenKind.EndFunction,
            TokenKind.Sub,
            TokenKind.EndSub
        ];

        //throw out invalid tokens and the wrong kind of tokens
        if (!token || !hoverTokenTypes.includes(token.kind)) {
            return null;
        }

        const expression = file.getClosestExpression(this.event.position);
        if (expression) {
            let containingNamespace = file.getNamespaceStatementForPosition(expression.range.start)?.getName(ParseMode.BrighterScript);
            const fullName = util.getAllDottedGetParts(expression)?.map(x => x.text).join('.');

            //find a constant with this name
            const constant = scope.getConstFileLink(fullName, containingNamespace);
            if (constant) {
                const constantValue = new SourceNode(null, null, null, constant.item.value.transpile(new BrsTranspileState(file))).toString();
                return {
                    contents: this.buildContentsWithDocs(fence(`const ${constant.item.fullName} = ${constantValue}`), constant.item.tokens.const),
                    range: token.range
                };
            }
        }

        let lowerTokenText = token.text.toLowerCase();

        //get the function scope for this position (if exists)
        let func = file.getFunctionExpressionAtPosition(this.event.position);
        if (func) {
            for (const labelStatement of func.labelStatements) {
                if (labelStatement.tokens.identifier.text.toLocaleLowerCase() === lowerTokenText) {
                    return {
                        range: token.range,
                        contents: fence(`${labelStatement.tokens.identifier.text}: label`)
                    };
                }
            }
        }

        const typeTexts = new Set<string>();
        const fileScopes = this.event.program.getScopesForFile(file).sort((a, b) => a.dependencyGraphKey?.localeCompare(b.dependencyGraphKey));
        const callables = [] as Callable[];
        for (const scope of fileScopes) {
            scope.linkSymbolTable();
            const typeContext = { file: file, scope: scope, position: this.event.position };
            const typeTextPair = file.getSymbolTypeFromToken(token, func, scope);
            if (typeTextPair) {
                let scopeTypeText = '';

                if (isTypedFunctionType(typeTextPair.type)) {
                    scopeTypeText = typeTextPair.type?.toString(typeContext);
                    //keep unique references to the callables for this function
                    if (!typeTexts.has(scopeTypeText)) {
                        callables.push(
                            scope.getCallableByName(lowerTokenText)
                        );
                    }
                } else if (typeTextPair.useExpandedTextOnly) {
                    scopeTypeText = typeTextPair.expandedTokenText;
                } else {
                    scopeTypeText = `${typeTextPair.expandedTokenText} as ${typeTextPair.type?.toString(typeContext)}`;
                }

                if (scopeTypeText) {
                    typeTexts.add(scopeTypeText);
                }
            }
            scope.unlinkSymbolTable();
        }

        if (callables.length === typeTexts.size) {
            //this is a function in all scopes, so build the function hover
            return {
                range: token.range,
                contents: this.getCallableDocumentation([...typeTexts], callables)
            };
        } else if (typeTexts?.size > 0) {
            const typeText = [...typeTexts].join(' | ');
            return {
                range: token.range,
                contents: fence(typeText)
            };
        }
    }

    /**
     * Combine all the documentation found before a token (i.e. comment tokens)
     */
    private getTokenDocumentation(tokens: Token[], token?: Token) {
        const comments = [] as Token[];
        const idx = tokens?.indexOf(token);
        if (!idx || idx === -1) {
            return undefined;
        }
        for (let i = idx - 1; i >= 0; i--) {
            const token = tokens[i];
            //skip whitespace and newline chars
            if (token.kind === TokenKind.Comment) {
                comments.push(token);
            } else if (token.kind === TokenKind.Newline || token.kind === TokenKind.Whitespace) {
                //skip these tokens
                continue;

                //any other token means there are no more comments
            } else {
                break;
            }
        }
        if (comments.length > 0) {
            return comments.reverse().map(x => x.text.replace(/^('|rem)/i, '')).join('\n');
        }
    }

    /**
     * Build a hover documentation for a callable.
     */
    private getCallableDocumentation(typeTexts: string[], callables: Callable[]) {
        const callable = callables[0];
        const typeText = typeTexts[0];

        const comments = [] as Token[];
        const tokens = callable?.file.parser.tokens as Token[];
        const idx = tokens?.indexOf(callable.functionStatement?.func.functionType);
        for (let i = idx - 1; i >= 0; i--) {
            const token = tokens[i];
            //skip whitespace and newline chars
            if (token.kind === TokenKind.Comment) {
                comments.push(token);
            } else if (token.kind === TokenKind.Newline || token.kind === TokenKind.Whitespace) {
                //skip these tokens
                continue;

                //any other token means there are no more comments
            } else {
                break;
            }
        }
        //message indicating if there are variations. example: (+3 variations) if there are 4 unique function signatures
        const multiText = callables.length > 1 ? ` (+${callables.length - 1} variations)` : '';
        let result = util.mdFence(typeText + multiText, 'brightscript');
        if (comments.length > 0) {
            result += '\n***\n' + comments.reverse().map(x => x.text.replace(/^('|rem)/i, '')).join('\n');
        }
        return result;
    }

    private getXmlFileHover(file: XmlFile) {
        //TODO add xml hovers
        return undefined;
    }
}
