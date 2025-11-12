import { createAssignmentStatement, createBlock, createDottedSetStatement, createIfStatement, createIndexedSetStatement, createToken } from '../../astUtils/creators';
import type { Editor } from '../../astUtils/Editor';
import { isDottedGetExpression, isLiteralExpression, isVariableExpression, isUnaryExpression, isAliasStatement, isCallExpression, isCallfuncExpression, isEnumType, isAssignmentStatement, isBlock, isBody, isDottedSetStatement, isGroupingExpression, isIndexedSetStatement, isAugmentedAssignmentStatement } from '../../astUtils/reflection';
import { createVisitor, WalkMode } from '../../astUtils/visitors';
import type { BrsFile } from '../../files/BrsFile';
import type { ExtraSymbolData, OnPrepareFileEvent } from '../../interfaces';
import { TokenKind } from '../../lexer/TokenKind';
import type { Expression, Statement } from '../../parser/AstNode';
import type { TernaryExpression } from '../../parser/Expression';
import { LiteralExpression, VariableExpression } from '../../parser/Expression';
import { ParseMode } from '../../parser/Parser';
import { AugmentedAssignmentStatement, type AliasStatement, type IfStatement } from '../../parser/Statement';
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
            this.applyBslibPrefixesIfMissing(this.event.file, this.event.editor);
        }
    }

    public applyBslibPrefixesIfMissing(file: BrsFile, editor: Editor) {
        file.ast.walk(createVisitor({
            FunctionStatement: (statement) => {
                BslibManager.applyPrefixIfMissing(statement, editor, this.event.program.bslibPrefix);
            }
        }), {
            walkMode: WalkMode.visitAllRecursive
        });
    }

    private iterateExpressions() {
        const scope = this.event.program.getFirstScopeForFile(this.event.file);
        //TODO move away from this loop and use a visitor instead
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
            if (isBlock(parent) || isBody(parent)) {
                let idx = parent.statements.indexOf(statement);
                if (idx > -1) {
                    return { owner: parent.statements, key: idx };
                }
            }
        }

        //if the ternary expression is part of a simple assignment, rewrite it as an `IfStatement`
        let parent = ternaryExpression.findAncestor(x => !isGroupingExpression(x));
        let ifStatement: IfStatement;

        if (isAssignmentStatement(parent)) {
            ifStatement = createIfStatement({
                if: createToken(TokenKind.If, 'if', ternaryExpression.tokens.questionMark.location),
                condition: ternaryExpression.test,
                then: createToken(TokenKind.Then, 'then', ternaryExpression.tokens.questionMark.location),
                thenBranch: createBlock({
                    statements: [
                        createAssignmentStatement({
                            name: parent.tokens.name,
                            equals: parent.tokens.equals,
                            value: ternaryExpression.consequent
                        })
                    ]
                }),
                else: createToken(TokenKind.Else, 'else', ternaryExpression.tokens.questionMark.location),
                elseBranch: createBlock({
                    statements: [
                        createAssignmentStatement({
                            name: util.cloneToken(parent.tokens.name),
                            equals: util.cloneToken(parent.tokens.equals),
                            value: ternaryExpression.alternate
                        })
                    ]
                }),
                endIf: createToken(TokenKind.EndIf, 'end if', ternaryExpression.tokens.questionMark.location)
            });
        } else if (isDottedSetStatement(parent)) {
            ifStatement = createIfStatement({
                if: createToken(TokenKind.If, 'if', ternaryExpression.tokens.questionMark.location),
                condition: ternaryExpression.test,
                then: createToken(TokenKind.Then, 'then', ternaryExpression.tokens.questionMark.location),
                thenBranch: createBlock({
                    statements: [
                        createDottedSetStatement({
                            obj: parent.obj,
                            name: parent.tokens.name,
                            equals: parent.tokens.equals,
                            value: ternaryExpression.consequent
                        })
                    ]
                }),
                else: createToken(TokenKind.Else, 'else', ternaryExpression.tokens.questionMark.location),
                elseBranch: createBlock({
                    statements: [
                        createDottedSetStatement({
                            obj: parent.obj.clone(),
                            name: util.cloneToken(parent.tokens.name),
                            equals: util.cloneToken(parent.tokens.equals),
                            value: ternaryExpression.alternate
                        })
                    ]
                }),
                endIf: createToken(TokenKind.EndIf, 'end if', ternaryExpression.tokens.questionMark.location)
            });

            //if this is an indexedSetStatement, and the ternary expression is NOT an index
        } else if (isIndexedSetStatement(parent) && !parent.indexes?.includes(ternaryExpression)) {
            ifStatement = createIfStatement({
                if: createToken(TokenKind.If, 'if', ternaryExpression.tokens.questionMark.location),
                condition: ternaryExpression.test,
                then: createToken(TokenKind.Then, 'then', ternaryExpression.tokens.questionMark.location),
                thenBranch: createBlock({
                    statements: [
                        createIndexedSetStatement({
                            obj: parent.obj,
                            openingSquare: parent.tokens.openingSquare,
                            indexes: parent.indexes,
                            closingSquare: parent.tokens.closingSquare,
                            equals: parent.tokens.equals,
                            value: ternaryExpression.consequent
                        })
                    ]
                }),
                else: createToken(TokenKind.Else, 'else', ternaryExpression.tokens.questionMark.location),
                elseBranch: createBlock({
                    statements: [
                        createIndexedSetStatement({
                            obj: parent.obj,
                            openingSquare: util.cloneToken(parent.tokens.openingSquare),
                            indexes: parent.indexes?.map(x => x.clone()),
                            closingSquare: util.cloneToken(parent.tokens.closingSquare),
                            equals: util.cloneToken(parent.tokens.equals),
                            value: ternaryExpression.alternate
                        })
                    ]
                }),
                endIf: createToken(TokenKind.EndIf, 'end if', ternaryExpression.tokens.questionMark.location)
            });
        } else if (isAugmentedAssignmentStatement(parent)) {
            ifStatement = createIfStatement({
                if: createToken(TokenKind.If, 'if', ternaryExpression.tokens.questionMark.location),
                condition: ternaryExpression.test,
                then: createToken(TokenKind.Then, 'then', ternaryExpression.tokens.questionMark.location),
                thenBranch: createBlock({
                    statements: [
                        new AugmentedAssignmentStatement({
                            item: parent.item,
                            operator: parent.tokens.operator,
                            value: ternaryExpression.consequent
                        })
                    ]
                }),
                else: createToken(TokenKind.Else, 'else', ternaryExpression.tokens.questionMark.location),
                elseBranch: createBlock({
                    statements: [
                        new AugmentedAssignmentStatement({
                            item: parent.item.clone(),
                            operator: parent.tokens.operator,
                            value: ternaryExpression.alternate
                        })
                    ]
                }),
                endIf: createToken(TokenKind.EndIf, 'end if', ternaryExpression.tokens.questionMark.location)
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

    /**
     * Recursively resolve a const or enum value until we get to the final resolved expression
     * Returns an object with the resolved value and a flag indicating if a circular reference was detected
     */
    private resolveConstValue(value: Expression, scope: Scope | undefined, containingNamespace: string | undefined, visited = new Set<string>()): { value: Expression; isCircular: boolean } {
        // If it's already a literal, return it as-is
        if (isLiteralExpression(value)) {
            return { value: value, isCircular: false };
        }

        // If it's a variable expression, try to resolve it as a const or enum
        if (isVariableExpression(value)) {
            const entityName = value.tokens.name.text.toLowerCase();

            // Prevent infinite recursion by tracking visited constants
            if (visited.has(entityName)) {
                return { value: value, isCircular: true }; // Return the original value to avoid infinite loop
            }
            visited.add(entityName);

            // Try to resolve as const first
            const constStatement = scope?.getConstFileLink(entityName, containingNamespace)?.item;
            if (constStatement) {
                // Recursively resolve the const value
                return this.resolveConstValue(constStatement.value, scope, containingNamespace, visited);
            }

            // Try to resolve as enum member
            const enumInfo = this.getEnumInfo(entityName, containingNamespace, scope);
            if (enumInfo?.value) {
                // Enum values are already resolved to literals by getEnumInfo
                return { value: enumInfo.value, isCircular: false };
            }
        }

        // If it's a dotted get expression (e.g., namespace.const or namespace.enum.member), try to resolve it
        if (isDottedGetExpression(value)) {
            const parts = util.splitExpression(value);
            const processedNames: string[] = [];

            for (let part of parts) {
                if (isVariableExpression(part) || isDottedGetExpression(part)) {
                    processedNames.push(part?.tokens.name?.text?.toLowerCase());
                } else {
                    return { value: value, isCircular: false }; // Can't resolve further
                }
            }

            const entityName = processedNames.join('.');

            // Prevent infinite recursion
            if (visited.has(entityName)) {
                return { value: value, isCircular: true };
            }
            visited.add(entityName);

            // Try to resolve as const first
            const constStatement = scope?.getConstFileLink(entityName, containingNamespace)?.item;
            if (constStatement) {
                // Recursively resolve the const value
                return this.resolveConstValue(constStatement.value, scope, containingNamespace, visited);
            }

            // Try to resolve as enum member
            const enumInfo = this.getEnumInfo(entityName, containingNamespace, scope);
            if (enumInfo?.value) {
                // Enum values are already resolved to literals by getEnumInfo
                return { value: enumInfo.value, isCircular: false };
            }
        }

        // Return the value as-is if we can't resolve it further
        return { value: value, isCircular: false };
    }

    private processExpression(expression: Expression, scope: Scope | undefined) {
        if (expression.findAncestor(isAliasStatement)) {
            // skip any changes in an Alias Statement
            return;
        }
        let containingNamespaceStmt = this.event.file.getNamespaceStatementForPosition(expression.location?.range.start);
        let containingNamespace = containingNamespaceStmt?.getName(ParseMode.BrighterScript);

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

            if (!currentPartIsAlias && firstPart && util.isVariableShadowingSomething(entityName, part)) {
                // this expression starts with a variable that has been redefined, so skip it
                return;
            }

            let value: Expression;
            let isCircular = false;

            let constStatement = scope?.getConstFileLink(entityName, containingNamespace)?.item;
            let enumInfo = this.getEnumInfo(entityName, containingNamespace, scope);
            let namespaceInfo = isAlias && this.getNamespaceInfo(entityName, scope);
            if (constStatement) {
                // Recursively resolve the const value to its final form
                const resolved = this.resolveConstValue(constStatement.value, scope, containingNamespace);
                value = resolved.value;
                isCircular = resolved.isCircular;
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

            if (value && !isCircular) {
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
