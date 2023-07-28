import { SourceNode } from 'source-map';
import { isBrsFile, isClassType, isInterfaceType, isNewExpression, isTypeExpression, isTypedFunctionType, isXmlFile } from '../../astUtils/reflection';
import type { BrsFile } from '../../files/BrsFile';
import type { XmlFile } from '../../files/XmlFile';
import type { Hover, ProvideHoverEvent, TypeChainEntry } from '../../interfaces';
import type { Token } from '../../lexer/Token';
import { TokenKind } from '../../lexer/TokenKind';
import { BrsTranspileState } from '../../parser/BrsTranspileState';
import { ParseMode } from '../../parser/Parser';
import util from '../../util';
import { SymbolTypeFlag } from '../../SymbolTable';
import type { Expression } from '../../parser/AstNode';
import type { Scope } from '../../Scope';
import type { FunctionScope } from '../../FunctionScope';
import type { TypedFunctionType } from '../../types/TypedFunctionType';
import type { ClassType } from '../../types/ClassType';
import type { InterfaceType } from '../../types/InterfaceType';
import { DynamicType } from '../../types';


const fence = (code: string) => util.mdFence(code, 'brightscript');

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

    private isValidTokenForHover(token: Token) {
        let hoverTokenTypes = [
            TokenKind.Identifier,
            TokenKind.Function,
            TokenKind.EndFunction,
            TokenKind.Sub,
            TokenKind.EndSub
        ];

        //throw out invalid tokens and the wrong kind of tokens
        return (token && hoverTokenTypes.includes(token.kind));
    }

    private getConstHover(token: Token, file: BrsFile, scope: Scope, expression: Expression) {
        let containingNamespace = file.getNamespaceStatementForPosition(expression.range.start)?.getName(ParseMode.BrighterScript);
        const fullName = util.getAllDottedGetParts(expression)?.map(x => x.text).join('.');

        //find a constant with this name
        const constant = scope?.getConstFileLink(fullName, containingNamespace);
        if (constant) {
            const constantValue = new SourceNode(null, null, null, constant.item.value.transpile(new BrsTranspileState(file))).toString();
            return this.buildContentsWithDocs(fence(`const ${constant.item.fullName} = ${constantValue}`), constant.item.tokens.const);
        }
    }

    private getLabelHover(token: Token, functionScope: FunctionScope) {
        let lowerTokenText = token.text.toLowerCase();
        for (const labelStatement of functionScope.labelStatements) {
            if (labelStatement.name.toLocaleLowerCase() === lowerTokenText) {
                return fence(`${labelStatement.name}: label`);
            }
        }
    }

    private getFunctionTypeHover(token: Token, expression: Expression, expressionType: TypedFunctionType, scope: Scope) {
        const lowerTokenText = token.text.toLowerCase();
        let result = fence(expressionType.toString());

        // only look for callables when they aren't inside a type expression
        // this was a problem for the function `string()` as it is a type AND a function https://developer.roku.com/en-ca/docs/references/brightscript/language/global-string-functions.md#stringn-as-integer-str-as-string--as-string
        let callable = scope.getCallableByName(lowerTokenText);
        if (callable) {
            // We can find the start token of the function definition, use it to add docs.
            // TODO: Add comment lookups for class methods!
            result = this.buildContentsWithDocs(result, callable.functionStatement?.func?.functionType);
        }
        return result;
    }

    private getCustomTypeHover(expressionType: ClassType | InterfaceType, scope: Scope) {
        let declarationText = '';
        let exprTypeString = expressionType.toString();
        let firstToken: Token;
        if (isClassType(expressionType)) {
            let entityStmt = scope.getClass(exprTypeString.toLowerCase());
            firstToken = entityStmt?.classKeyword;
            declarationText = firstToken?.text ?? TokenKind.Class;

        } else if (isInterfaceType(expressionType)) {
            let entityStmt = scope.getInterface(exprTypeString.toLowerCase());
            firstToken = entityStmt.tokens.interface;
            declarationText = firstToken?.text ?? TokenKind.Interface;

        }
        let result = fence(`${declarationText} ${exprTypeString}`);
        if (firstToken) {
            // We can find the start token of the declaration, use it to add docs.
            result = this.buildContentsWithDocs(result, firstToken);
        }
        return result;
    }

    private getBrsFileHover(file: BrsFile): Hover {
        //get the token at the position
        let token = file.getTokenAt(this.event.position);

        if (!this.isValidTokenForHover(token)) {
            return null;
        }

        const hoverContents: string[] = [];
        for (let scope of this.event.scopes) {
            try {
                scope.linkSymbolTable();

                const expression = file.getClosestExpression(this.event.position);
                const constHover = this.getConstHover(token, file, scope, expression);
                if (constHover) {
                    hoverContents.push(constHover);
                    continue;
                }
                //get the function scope for this position (if exists)
                let functionScope = file.getFunctionScopeAtPosition(this.event.position);
                if (functionScope) {
                    const labelHover = this.getLabelHover(token, functionScope);
                    if (labelHover) {
                        hoverContents.push(labelHover);
                        continue;
                    }
                }
                const isInTypeExpression = expression?.findAncestor(isTypeExpression);
                const typeFlag = isInTypeExpression ? SymbolTypeFlag.typetime : SymbolTypeFlag.runtime;
                const typeChain: TypeChainEntry[] = [];
                const exprType = expression.getType({ flags: typeFlag, typeChain: typeChain });

                const processedTypeChain = util.processTypeChain(typeChain);
                const fullName = processedTypeChain.fullNameOfItem || token.text;
                const useCustomTypeHover = isInTypeExpression || expression?.findAncestor(isNewExpression);

                // if the type chain has dynamic in it, then just say the token text
                const exprNameString = !processedTypeChain.containsDynamic ? fullName : token.text;

                let hoverContent = fence(`${exprNameString} as ${exprType.toString()}`);
                if (isTypedFunctionType(exprType)) {
                    exprType.setName(fullName);
                    hoverContent = this.getFunctionTypeHover(token, expression, exprType, scope);
                } else if (useCustomTypeHover && (isClassType(exprType) || isInterfaceType(exprType))) {
                    hoverContent = this.getCustomTypeHover(exprType, scope);
                }
                hoverContents.push(hoverContent);

            } finally {
                scope?.unlinkSymbolTable();
            }
        }
        return {
            range: token.range,
            contents: hoverContents
        };
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
