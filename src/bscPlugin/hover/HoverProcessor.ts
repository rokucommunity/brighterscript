import { SourceNode } from 'source-map';
import { isBrsFile, isFunctionType, isTypeExpression, isXmlFile } from '../../astUtils/reflection';
import type { BrsFile } from '../../files/BrsFile';
import type { XmlFile } from '../../files/XmlFile';
import type { Hover, ProvideHoverEvent } from '../../interfaces';
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
        try {
            scope.linkSymbolTable();
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
                const constant = scope?.getConstFileLink(fullName, containingNamespace);
                if (constant) {
                    const constantValue = new SourceNode(null, null, null, constant.item.value.transpile(new BrsTranspileState(file))).toString();
                    return {
                        contents: this.buildContentsWithDocs(fence(`const ${constant.item.fullName} = ${constantValue}`), constant.item.tokens.const),
                        range: token.range
                    };
                }
            }

            let lowerTokenText = token.text.toLowerCase();

            //look through local variables first
            {
                //get the function scope for this position (if exists)
                let functionScope = file.getFunctionScopeAtPosition(this.event.position);
                if (functionScope) {
                    //find any variable with this name
                    for (const varDeclaration of functionScope.variableDeclarations) {
                        //we found a variable declaration with this token text!
                        if (varDeclaration.name.toLowerCase() === lowerTokenText) {
                            let typeText: string;
                            const varDeclarationType = varDeclaration.getType();
                            if (isFunctionType(varDeclarationType)) {
                                varDeclarationType.setName(varDeclaration.name);
                                typeText = varDeclarationType.toString();
                            } else {
                                typeText = `${varDeclaration.name} as ${varDeclarationType.toString()}`;
                            }
                            return {
                                range: token.range,
                                //append the variable name to the front for scope
                                contents: fence(typeText)
                            };
                        }
                    }
                    for (const labelStatement of functionScope.labelStatements) {
                        if (labelStatement.name.toLocaleLowerCase() === lowerTokenText) {
                            return {
                                range: token.range,
                                contents: fence(`${labelStatement.name}: label`)
                            };
                        }
                    }
                }
            }

            //look through all callables in relevant scopes
            if (!expression?.findAncestor(isTypeExpression)) {
                // only look for callables when they aren't inside a type expression
                // this was a problem for the function `string()` as it is a type AND a function https://developer.roku.com/en-ca/docs/references/brightscript/language/global-string-functions.md#stringn-as-integer-str-as-string--as-string
                for (let scope of this.event.scopes) {
                    let callable = scope.getCallableByName(lowerTokenText);
                    if (callable) {
                        return {
                            range: token.range,
                            contents: this.buildContentsWithDocs(fence(callable.type.toString()), callable.functionStatement?.func?.functionType)
                        };
                    }
                }
            }
        } finally {
            scope?.unlinkSymbolTable();
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

    private getXmlFileHover(file: XmlFile) {
        //TODO add xml hovers
        return undefined;
    }
}
