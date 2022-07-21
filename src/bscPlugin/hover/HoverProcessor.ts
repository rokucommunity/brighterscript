import type { Hover } from 'vscode-languageserver-types';
import { isBrsFile, isFunctionType, isXmlFile } from '../../astUtils/reflection';
import type { BrsFile } from '../../files/BrsFile';
import type { XmlFile } from '../../files/XmlFile';
import type { Callable, ProvideHoverEvent } from '../../interfaces';
import type { Token } from '../../lexer/Token';
import { TokenKind } from '../../lexer/TokenKind';
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

    private getBrsFileHover(file: BrsFile): Hover {
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
                        if (isFunctionType(varDeclaration.type)) {
                            typeText = varDeclaration.type.toString();
                        } else {
                            typeText = `${varDeclaration.name} as ${varDeclaration.type.toString()}`;
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
        for (let scope of this.event.scopes) {
            let callable = scope.getCallableByName(lowerTokenText);
            if (callable) {
                return {
                    range: token.range,
                    contents: this.getCallableDocumentation(callable)
                };
            }
        }
    }

    /**
     * Build a hover documentation for a callable.
     */
    private getCallableDocumentation(callable: Callable) {
        const comments = [] as Token[];
        const tokens = callable.file.parser.tokens as Token[];
        const idx = tokens.indexOf(callable.functionStatement?.func.functionType);
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
        let result = util.mdFence(callable.type.toString(), 'brightscript');
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
