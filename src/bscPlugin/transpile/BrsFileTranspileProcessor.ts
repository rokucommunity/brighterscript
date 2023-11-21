import { createToken } from '../../astUtils/creators';
import type { Editor } from '../../astUtils/Editor';
import { isDottedGetExpression, isLiteralExpression, isVariableExpression, isUnaryExpression } from '../../astUtils/reflection';
import { createVisitor, WalkMode } from '../../astUtils/visitors';
import type { BrsFile } from '../../files/BrsFile';
import type { OnPrepareFileEvent } from '../../interfaces';
import { TokenKind } from '../../lexer/TokenKind';
import type { Expression } from '../../parser/AstNode';
import { LiteralExpression } from '../../parser/Expression';
import { ParseMode } from '../../parser/Parser';
import type { Scope } from '../../Scope';
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
                if (!statement.name.text.startsWith('bslib_')) {
                    editor.setProperty(statement.name, 'text', `bslib_${statement.name.text}`);
                }
            }
        }), {
            walkMode: WalkMode.visitAllRecursive
        });
    }

    private iterateExpressions() {
        const scope = this.event.program.getFirstScopeForFile(this.event.file);
        for (let expression of this.event.file.parser.references.expressions) {
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
        if (containingNamespace) {
            parts.unshift(containingNamespace.toLowerCase());
        }
        result = scope?.getEnumMap().get(parts.join('.'));
        if (result) {
            const value = result.item.getMemberValue(memberName);
            return {
                enum: result.item,
                value: new LiteralExpression(createToken(
                    //just use float literal for now...it will transpile properly with any literal value
                    value?.startsWith('"') ? TokenKind.StringLiteral : TokenKind.FloatLiteral,
                    value
                ))
            };
        }
    }

    private processExpression(expression: Expression, scope: Scope) {
        let containingNamespace = this.event.file.getNamespaceStatementForPosition(expression.range.start)?.getName(ParseMode.BrighterScript);

        const parts = util.splitExpression(expression);

        const processedNames: string[] = [];
        for (let part of parts) {
            let entityName: string;
            if (isVariableExpression(part) || isDottedGetExpression(part)) {
                processedNames.push(part?.name?.text?.toLocaleLowerCase());
                entityName = processedNames.join('.');
            } else {
                return;
            }

            let value: Expression;

            //did we find a const? transpile the value
            let constStatement = scope?.getConstFileLink(entityName, containingNamespace)?.item;
            if (constStatement) {
                value = constStatement.value;
            } else {
                //did we find an enum member? transpile that
                let enumInfo = this.getEnumInfo(entityName, containingNamespace, scope);
                if (enumInfo?.value) {
                    value = enumInfo.value;
                }
            }

            if (value) {
                //override the transpile for this item.
                this.event.editor.setProperty(part, 'transpile', (state) => {
                    if (isLiteralExpression(value)) {
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
}
