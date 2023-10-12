import { SourceNode } from 'source-map';
import { isBrsFile, isCallfuncExpression, isClassStatement, isEnumStatement, isEnumType, isInheritableType, isInterfaceStatement, isNamespaceStatement, isNamespaceType, isNewExpression, isTypeExpression, isTypedFunctionType, isXmlFile } from '../../astUtils/reflection';
import type { BrsFile } from '../../files/BrsFile';
import type { XmlFile } from '../../files/XmlFile';
import type { ExtraSymbolData, Hover, ProvideHoverEvent, TypeChainEntry } from '../../interfaces';
import type { Token } from '../../lexer/Token';
import { TokenKind } from '../../lexer/TokenKind';
import { BrsTranspileState } from '../../parser/BrsTranspileState';
import { ParseMode } from '../../parser/Parser';
import util from '../../util';
import { SymbolTypeFlag } from '../../SymbolTable';
import type { AstNode, Expression } from '../../parser/AstNode';
import type { Scope } from '../../Scope';
import type { FunctionScope } from '../../FunctionScope';
import type { BscType } from '../../types';

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

    private buildContentsWithDocsFromDescription(text: string, docs: string) {
        const parts = [text];
        if (docs) {
            parts.push('***', docs);
        }
        return parts.join('\n');
    }

    private buildContentsWithDocsFromExpression(text: string, expression: AstNode) {
        const parts = [text];
        const docs = util.getNodeDocumentation(expression);
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
            return this.buildContentsWithDocsFromExpression(fence(`const ${constant.item.fullName} = ${constantValue}`), constant.item);
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

    private getCustomTypeHover(expressionType: BscType, extraData: ExtraSymbolData) {
        let declarationText = '';
        let exprTypeString = expressionType.toString();
        let firstToken: Token;
        if (extraData?.definingNode) {
            if (isClassStatement(extraData.definingNode)) {
                firstToken = extraData.definingNode.classKeyword;
                declarationText = firstToken?.text ?? TokenKind.Class;
            } else if (isInterfaceStatement(extraData.definingNode)) {
                firstToken = extraData.definingNode.tokens.interface;
                declarationText = firstToken?.text ?? TokenKind.Interface;
            } else if (isNamespaceStatement(extraData.definingNode)) {
                firstToken = extraData.definingNode.keyword;
                exprTypeString = extraData.definingNode.getName(ParseMode.BrighterScript);
                declarationText = firstToken?.text ?? TokenKind.Namespace;
            } else if (isEnumStatement(extraData.definingNode)) {
                firstToken = extraData.definingNode.tokens.enum;
                exprTypeString = extraData.definingNode.fullName;
                declarationText = firstToken?.text ?? TokenKind.Enum;
            }
        }
        const innerText = `${declarationText} ${exprTypeString}`.trim();
        let result = fence(innerText);
        return result;
    }

    private getBrsFileHover(file: BrsFile): Hover {
        //get the token at the position
        let token = file.getTokenAt(this.event.position);

        if (!this.isValidTokenForHover(token)) {
            return null;
        }
        const expression = file.getClosestExpression(this.event.position);
        const hoverContents: string[] = [];
        for (let scope of this.event.scopes) {
            try {
                scope.linkSymbolTable();
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
                const extraData = {} as ExtraSymbolData;
                const exprType = expression.getType({ flags: typeFlag, typeChain: typeChain, data: extraData, ignoreCall: isCallfuncExpression(expression) });

                const processedTypeChain = util.processTypeChain(typeChain);
                const fullName = processedTypeChain.fullNameOfItem || token.text;
                // if the type chain has dynamic in it, then just say the token text
                const exprNameString = !processedTypeChain.containsDynamic ? fullName : token.text;
                const useCustomTypeHover = isInTypeExpression || expression?.findAncestor(isNewExpression);
                let hoverContent = '';
                if (useCustomTypeHover && isInheritableType(exprType)) {
                    hoverContent = this.getCustomTypeHover(exprType, extraData);
                } else if (isNamespaceType(exprType) ||
                    isEnumType(expression.getType({ flags: SymbolTypeFlag.typetime }))) {
                    hoverContent = this.getCustomTypeHover(exprType, extraData);
                } else {
                    const variableName = !isTypedFunctionType(exprType) ? `${exprNameString} as ` : '';
                    if (isTypedFunctionType(exprType)) {
                        exprType.setName(exprNameString);
                    }
                    hoverContent = fence(`${variableName}${exprType.toString()}`);
                }


                if (extraData.description) {
                    hoverContent = this.buildContentsWithDocsFromDescription(hoverContent, extraData.description);
                } else if (extraData.definingNode) {
                    hoverContent = this.buildContentsWithDocsFromExpression(hoverContent, extraData.definingNode);
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
     * @param file the file
     */
    private getXmlFileHover(file: XmlFile) {
        //TODO add xml hovers
        return undefined;
    }
}
