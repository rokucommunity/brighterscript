import type { Hover } from 'vscode-languageserver-types';
import { isBrsFile, isFunctionType, isXmlFile } from '../../astUtils';
import type { BrsFile } from '../../files/BrsFile';
import type { XmlFile } from '../../files/XmlFile';
import type { OnGetHoverEvent } from '../../interfaces';
import { TokenKind } from '../../lexer/TokenKind';

export class HoverProcessor {
    public constructor(
        public event: OnGetHoverEvent
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
            this.event.hover = hover;
            //return false to short-circuit the event
            return false;
        }
    }

    private getBrsFileHover(file: BrsFile): Hover {
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
                            contents: {
                                language: 'brightscript',
                                value: typeText
                            }
                        };
                    }
                }
                for (const labelStatement of functionScope.labelStatements) {
                    if (labelStatement.name.toLocaleLowerCase() === lowerTokenText) {
                        return {
                            range: token.range,
                            contents: {
                                language: 'brightscript',
                                value: `${labelStatement.name}: label`
                            }
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
                    contents: {
                        language: 'brightscript',
                        value: callable.type.toString()
                    }
                };
            }
        }
    }

    private getXmlFileHover(file: XmlFile) {
        //TODO add xml hovers
        return undefined;
    }
}
