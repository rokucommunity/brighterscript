import { createAssignmentStatement, createBlock, createDottedSetStatement, createIfStatement, createIndexedSetStatement, createToken } from '../../astUtils/creators';
import { isAssignmentStatement, isBinaryExpression, isBlock, isBrsFile, isDottedGetExpression, isDottedSetStatement, isGroupingExpression, isIndexedGetExpression, isIndexedSetStatement, isLiteralExpression, isUnaryExpression, isVariableExpression } from '../../astUtils/reflection';
import { createVisitor, WalkMode } from '../../astUtils/visitors';
import type { BrsFile } from '../../files/BrsFile';
import type { BeforeFileTranspileEvent } from '../../interfaces';
import type { Token } from '../../lexer/Token';
import { TokenKind } from '../../lexer/TokenKind';
import type { Expression, Statement } from '../../parser/AstNode';
import type { TernaryExpression } from '../../parser/Expression';
import { LiteralExpression } from '../../parser/Expression';
import { ParseMode } from '../../parser/Parser';
import type { IfStatement } from '../../parser/Statement';
import type { Scope } from '../../Scope';
import util from '../../util';

export class BrsFilePreTranspileProcessor {
    public constructor(
        private event: BeforeFileTranspileEvent<BrsFile>
    ) {
    }

    public process() {
        if (isBrsFile(this.event.file)) {
            this.iterateExpressions();
        }
    }

    private iterateExpressions() {
        const scope = this.event.program.getFirstScopeForFile(this.event.file);
        //TODO move away from this loop and use a visitor instead
        for (let expression of this.event.file.parser.references.expressions) {
            if (expression) {
                if (isUnaryExpression(expression)) {
                    this.processExpression(expression.right, scope);
                } else {
                    this.processExpression(expression, scope);
                }
            }
        }
        const walkMode = WalkMode.visitExpressionsRecursive;
        const visitor = createVisitor({
            TernaryExpression: (ternaryExpression) => {
                this.processTernaryExpression(ternaryExpression, visitor, walkMode);
            }
        });
        this.event.file.ast.walk(visitor, { walkMode: walkMode });
    }

    private processTernaryExpression(ternaryExpression: TernaryExpression, visitor: ReturnType<typeof createVisitor>, walkMode: WalkMode) {
        function getOwnerAndKey(statement: Statement) {
            const parent = statement.parent;
            if (isBlock(parent)) {
                let idx = parent.statements.indexOf(statement);
                if (idx > -1) {
                    return { owner: parent.statements, key: idx };
                }
            }
        }

        //if the ternary expression is part of a simple assignment, rewrite it as an `IfStatement`
        let parent = ternaryExpression.findAncestor(x => !isGroupingExpression(x));
        let operator: Token;
        //operators like `+=` will cause the RHS to be a BinaryExpression  due to how the parser handles this. let's do a little magic to detect this situation
        if (
            //parent is a binary expression
            isBinaryExpression(parent) &&
            (
                (isAssignmentStatement(parent.parent) && isVariableExpression(parent.left) && parent.left.name === parent.parent.name) ||
                (isDottedSetStatement(parent.parent) && isDottedGetExpression(parent.left) && parent.left.name === parent.parent.name) ||
                (isIndexedSetStatement(parent.parent) && isIndexedGetExpression(parent.left) && parent.left.index === parent.parent.index)
            )
        ) {
            //keep the correct operator (i.e. `+=`)
            operator = parent.operator;
            //use the outer parent and skip this BinaryExpression
            parent = parent.parent;
        }
        let ifStatement: IfStatement;

        if (isAssignmentStatement(parent)) {
            ifStatement = createIfStatement({
                if: createToken(TokenKind.If, 'if', ternaryExpression.questionMarkToken.range),
                condition: ternaryExpression.test,
                then: createToken(TokenKind.Then, 'then', ternaryExpression.questionMarkToken.range),
                thenBranch: createBlock({
                    statements: [
                        createAssignmentStatement({
                            name: parent.name,
                            equals: operator ?? parent.equals,
                            value: ternaryExpression.consequent
                        })
                    ]
                }),
                else: createToken(TokenKind.Else, 'else', ternaryExpression.questionMarkToken.range),
                elseBranch: createBlock({
                    statements: [
                        createAssignmentStatement({
                            name: parent.name,
                            equals: operator ?? parent.equals,
                            value: ternaryExpression.alternate
                        })
                    ]
                }),
                endIf: createToken(TokenKind.EndIf, 'end if', ternaryExpression.questionMarkToken.range)
            });
        } else if (isDottedSetStatement(parent)) {
            ifStatement = createIfStatement({
                if: createToken(TokenKind.If, 'if', ternaryExpression.questionMarkToken.range),
                condition: ternaryExpression.test,
                then: createToken(TokenKind.Then, 'then', ternaryExpression.questionMarkToken.range),
                thenBranch: createBlock({
                    statements: [
                        createDottedSetStatement({
                            obj: parent.obj,
                            name: parent.name,
                            equals: operator ?? parent.equals,
                            value: ternaryExpression.consequent
                        })
                    ]
                }),
                else: createToken(TokenKind.Else, 'else', ternaryExpression.questionMarkToken.range),
                elseBranch: createBlock({
                    statements: [
                        createDottedSetStatement({
                            obj: parent.obj,
                            name: parent.name,
                            equals: operator ?? parent.equals,
                            value: ternaryExpression.alternate
                        })
                    ]
                }),
                endIf: createToken(TokenKind.EndIf, 'end if', ternaryExpression.questionMarkToken.range)
            });
        } else if (isIndexedSetStatement(parent)) {
            ifStatement = createIfStatement({
                if: createToken(TokenKind.If, 'if', ternaryExpression.questionMarkToken.range),
                condition: ternaryExpression.test,
                then: createToken(TokenKind.Then, 'then', ternaryExpression.questionMarkToken.range),
                thenBranch: createBlock({
                    statements: [
                        createIndexedSetStatement({
                            obj: parent.obj,
                            openingSquare: parent.openingSquare,
                            index: parent.index,
                            closingSquare: parent.closingSquare,
                            equals: operator ?? parent.equals,
                            value: ternaryExpression.consequent,
                            additionalIndexes: parent.additionalIndexes
                        })
                    ]
                }),
                else: createToken(TokenKind.Else, 'else', ternaryExpression.questionMarkToken.range),
                elseBranch: createBlock({
                    statements: [
                        createIndexedSetStatement({
                            obj: parent.obj,
                            openingSquare: parent.openingSquare,
                            index: parent.index,
                            closingSquare: parent.closingSquare,
                            equals: operator ?? parent.equals,
                            value: ternaryExpression.alternate,
                            additionalIndexes: parent.additionalIndexes
                        })
                    ]
                }),
                endIf: createToken(TokenKind.EndIf, 'end if', ternaryExpression.questionMarkToken.range)
            });
        }

        if (ifStatement) {
            let { owner, key } = getOwnerAndKey(parent as Statement) ?? {};
            if (owner && key !== undefined) {
                this.event.editor.setProperty(owner, key, ifStatement);
            }
            //we've injected an ifStatement, so now we need to trigger a walk to handle any nested ternary expressions
            ifStatement.walk(visitor, { walkMode: walkMode });
        }
    }

    /**
     * Given a string optionally separated by dots, find an enum related to it.
     * For example, all of these would return the enum: `SomeNamespace.SomeEnum.SomeMember`, SomeEnum.SomeMember, `SomeEnum`
     */
    private getEnumInfo(name: string, containingNamespace: string, scope: Scope | undefined) {

        //do we have an enum MEMBER reference? (i.e. SomeEnum.someMember or SomeNamespace.SomeEnum.SomeMember)
        let memberLink = scope?.getEnumMemberFileLink(name, containingNamespace);
        if (memberLink) {
            const value = memberLink.item.getValue();
            return {
                enum: memberLink.item.parent,
                value: new LiteralExpression(createToken(
                    //just use float literal for now...it will transpile properly with any literal value
                    value.startsWith('"') ? TokenKind.StringLiteral : TokenKind.FloatLiteral,
                    value
                ))
            };
        }

        //do we have an enum reference? (i.e. SomeEnum or SomeNamespace.SomeEnum)
        let enumLink = scope?.getEnumFileLink(name, containingNamespace);

        if (enumLink) {
            return {
                enum: enumLink.item
            };
        }

    }

    private processExpression(ternaryExpression: Expression, scope: Scope | undefined) {
        let containingNamespace = this.event.file.getNamespaceStatementForPosition(ternaryExpression.range.start)?.getName(ParseMode.BrighterScript);

        const parts = util.splitExpression(ternaryExpression);

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
