import { createToken } from '../../astUtils/creators';
import type { Editor } from '../../astUtils/Editor';
import { isDottedGetExpression, isLiteralExpression, isVariableExpression, isUnaryExpression, isAliasStatement, isCallExpression, isCallfuncExpression, isEnumType } from '../../astUtils/reflection';
import { createVisitor, WalkMode } from '../../astUtils/visitors';
import type { BrsFile } from '../../files/BrsFile';
import type { ExtraSymbolData, OnPrepareFileEvent } from '../../interfaces';
import { TokenKind } from '../../lexer/TokenKind';
import type { Expression } from '../../parser/AstNode';
import { LiteralExpression, VariableExpression } from '../../parser/Expression';
import { ParseMode } from '../../parser/Parser';
import type { AliasStatement } from '../../parser/Statement';
import type { Scope } from '../../Scope';
import { SymbolTypeFlag } from '../../SymbolTypeFlag';
import util from '../../util';
import { BslibManager } from '../serialize/BslibManager';

export class BrsFilePreTranspileProcessor {
    public constructor(
        private event: OnPrepareFileEvent<BrsFile>
    ) {
    }

    public process() {
        this.iterateExpressions();
        //apply prefixes to bslib
        if (BslibManager.isBslibPkgPath(this.event.file.pkgPath)) {
            this.applyPrefixesIfMissing(this.event.file, this.event.editor);
        }
    }

    public applyPrefixesIfMissing(file: BrsFile, editor: Editor) {
        file.ast.walk(createVisitor({
            FunctionStatement: (statement) => {
                //add the bslib prefix
                if (!statement.tokens.name.text.startsWith('bslib_')) {
                    editor.setProperty(statement.tokens.name, 'text', `bslib_${statement.tokens.name.text}`);
                }
            }
        }), {
            walkMode: WalkMode.visitAllRecursive
        });
    }

    private iterateExpressions() {
        const scope = this.event.program.getFirstScopeForFile(this.event.file);
        // eslint-disable-next-line @typescript-eslint/dot-notation
        for (let expression of this.event.file['_cachedLookups'].expressions) {
            if (expression) {
                if (isUnaryExpression(expression)) {
                    this.processExpression(expression.right, scope);
                } else {
                    this.processExpression(expression, scope);
                }
            }
        }
    }

    /**
     * Given a string optionally separated by dots, find an enum related to it.
     * For example, all of these would return the enum: `SomeNamespace.SomeEnum.SomeMember`, SomeEnum.SomeMember, `SomeEnum`
     */
    private getEnumInfo(name: string, containingNamespace: string, scope: Scope) {
        //look for the enum directly
        let result = scope?.getEnumFileLink(name, containingNamespace);

        if (result) {
            return {
                enum: result.item
            };
        }
        //assume we've been given the enum.member syntax, so pop the member and try again
        const parts = name.toLowerCase().split('.');
        const memberName = parts.pop();

        result = scope?.getEnumFileLink(parts.join('.'), containingNamespace);
        if (result) {
            const value = result.item.getMemberValue(memberName);
            return {
                enum: result.item,
                value: new LiteralExpression({
                    value: createToken(
                        //just use float literal for now...it will transpile properly with any literal value
                        value?.startsWith('"') ? TokenKind.StringLiteral : TokenKind.FloatLiteral,
                        value
                    )
                })
            };
        }
    }

    /**
     * Given a string optionally separated by dots, find an namespace Member related to it.
     */
    private getNamespaceInfo(name: string, scope: Scope) {
        //look for the namespace directly
        let result = scope?.getNamespace(name);

        if (result) {
            return {
                namespace: result
            };
        }
        //assume we've been given the namespace.member syntax, so pop the member and try again
        const parts = name.toLowerCase().split('.');
        const memberName = parts.pop();

        result = scope?.getNamespace(parts.join('.'));
        if (result) {
            const memberType = result.symbolTable?.getSymbolType(memberName, { flags: SymbolTypeFlag.runtime });
            if (memberType && !isEnumType(memberType)) {
                return {
                    namespace: result,
                    value: new VariableExpression({
                        name: createToken(TokenKind.Identifier, parts.join('_') + '_' + memberName)
                    })
                };
            }
        }
    }

    private processExpression(expression: Expression, scope: Scope | undefined) {
        if (expression.findAncestor(isAliasStatement)) {
            // skip any changes in an Alias Statement
            return;
        }

        let containingNamespace = this.event.file.getNamespaceStatementForPosition(expression.range.start)?.getName(ParseMode.BrighterScript);

        const parts = util.splitExpression(expression);
        const processedNames: string[] = [];
        let isAlias = false;
        let isCall = isCallExpression(expression) || isCallfuncExpression(expression);
        for (let part of parts) {
            let entityName: string;

            let firstPart = part === parts[0];
            let actualNameExpression = firstPart ? this.replaceAlias(part) : part;
            let currentPartIsAlias = actualNameExpression !== part;
            isAlias = isAlias || currentPartIsAlias;

            if (currentPartIsAlias) {
                entityName = util.getAllDottedGetPartsAsString(actualNameExpression);
                processedNames.push(entityName);
                containingNamespace = '';
            } else if (isVariableExpression(part) || isDottedGetExpression(part)) {
                processedNames.push(part?.tokens.name?.text?.toLowerCase());
                entityName = processedNames.join('.');
            } else {
                return;
            }

            let value: Expression;

            let constStatement = scope?.getConstFileLink(entityName, containingNamespace)?.item;
            let enumInfo = this.getEnumInfo(entityName, containingNamespace, scope);
            let namespaceInfo = isAlias && this.getNamespaceInfo(entityName, scope);
            if (constStatement) {
                //did we find a const? transpile the value
                value = constStatement.value;
            } else if (enumInfo?.value) {
                //did we find an enum member? transpile that
                value = enumInfo.value;

            } else if (namespaceInfo?.value) {
                // use the transpiled namespace member
                value = namespaceInfo.value;

            } else if (currentPartIsAlias && !(enumInfo || namespaceInfo)) {
                // this was an aliased expression that is NOT am enum  or namespace
                value = actualNameExpression;
            }

            if (value) {
                //override the transpile for this item.
                this.event.editor.setProperty(part, 'transpile', (state) => {

                    if (isLiteralExpression(value) || isCall) {
                        return value.transpile(state);
                    } else {
                        //wrap non-literals with parens to prevent on-device compile errors
                        return ['(', ...value.transpile(state), ')'];
                    }
                });
                //we are finished handling this expression
                return;
            }
        }
    }


    private replaceAlias(expression: Expression) {
        let alias: AliasStatement;
        let potentiallyAliased = expression;
        // eslint-disable-next-line @typescript-eslint/dot-notation
        const fileAliasStatements = this.event.file['_cachedLookups'].aliasStatements;

        if (fileAliasStatements.length === 0) {
            return expression;
        }
        // eslint-disable-next-line @typescript-eslint/dot-notation
        let potentialAliasedTextsLower = fileAliasStatements.map(stmt => stmt.tokens.name.text.toLowerCase());

        if (isVariableExpression(potentiallyAliased) && potentialAliasedTextsLower.includes(potentiallyAliased.getName().toLowerCase())) {
            //check if it is an alias
            let data = {} as ExtraSymbolData;

            potentiallyAliased.getSymbolTable().getSymbolType(potentiallyAliased.getName(), {
                data: data,
                // eslint-disable-next-line no-bitwise
                flags: SymbolTypeFlag.runtime | SymbolTypeFlag.typetime
            });

            if (data.isAlias && isAliasStatement(data.definingNode)) {
                alias = data.definingNode;

            }
        }

        if (alias && isVariableExpression(potentiallyAliased)) {
            return alias.value;
        }
        return expression;
    }
}
