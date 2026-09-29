import { createAssignmentStatement, createBlock, createDottedSetStatement, createIfStatement, createIndexedSetStatement, createToken } from '../../astUtils/creators';
import type { Editor } from '../../astUtils/Editor';
import { isDottedGetExpression, isLiteralExpression, isVariableExpression, isUnaryExpression, isAliasStatement, isCallExpression, isCallfuncExpression, isEnumType, isAssignmentStatement, isBlock, isBody, isDottedSetStatement, isGroupingExpression, isIndexedSetStatement, isAugmentedAssignmentStatement, isNamespaceStatement, isBrsFile } from '../../astUtils/reflection';
import { createVisitor, WalkMode } from '../../astUtils/visitors';
import type { BrsFile } from '../../files/BrsFile';
import type { ExtraSymbolData, OnPrepareFileEvent } from '../../interfaces';
import { TokenKind } from '../../lexer/TokenKind';
import type { Expression, Statement } from '../../parser/AstNode';
import type { TernaryExpression } from '../../parser/Expression';
import { LiteralExpression, VariableExpression } from '../../parser/Expression';
import { ParseMode } from '../../parser/Parser';
import type { ConstStatement, EnumStatement, NamespaceStatement } from '../../parser/Statement';
import { AugmentedAssignmentStatement, type AliasStatement, type IfStatement } from '../../parser/Statement';
import type { Scope } from '../../Scope';
import { SymbolTypeFlag } from '../../SymbolTypeFlag';
import util from '../../util';
import { BslibManager } from '../serialize/BslibManager';

/**
 * The context a const or enum reference is resolved in: the file the reference was authored in (whose named type imports apply)
 * and that file's scope, if it has one
 */
interface ResolveContext {
    file: BrsFile;
    scope: Scope | undefined;
}

interface ResolvedValue {
    value: Expression;
    /**
     * The context `value` was authored in
     */
    context: ResolveContext;
    /**
     * The const that owns `value`, if it came from a const
     */
    constStatement?: ConstStatement;
    isCircular: boolean;
}

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
        const context = this.getContextForFile(this.event.file);
        //TODO move away from this loop and use a visitor instead
        // eslint-disable-next-line @typescript-eslint/dot-notation
        for (let expression of this.event.file['_cachedLookups'].expressions) {
            if (expression) {
                if (isUnaryExpression(expression)) {
                    this.processExpression(expression.right, context);
                } else {
                    this.processExpression(expression, context);
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
     * (as seen from `context`)
     */
    private getEnumInfo(name: string, containingNamespace: string, context: ResolveContext) {
        //look for the enum directly
        let enumStatement = this.findEnum(name, containingNamespace, context);

        if (enumStatement) {
            return {
                enum: enumStatement
            };
        }
        //assume we've been given the enum.member syntax, so pop the member and try again
        const parts = name.toLowerCase().split('.');
        const memberName = parts.pop();

        enumStatement = this.findEnum(parts.join('.'), containingNamespace, context);
        if (enumStatement) {
            const value = enumStatement.getMemberValue(memberName);
            return {
                enum: enumStatement,
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
     * Build the context that references authored in `file` are resolved in
     */
    private getContextForFile(file: BrsFile): ResolveContext {
        return {
            file: file,
            scope: this.event.program.getFirstScopeForFile(file)
        };
    }

    /**
     * If the first part of `entityName` is a named type import in the context's file (`import type { Alpha as Beta } from "..."`),
     * find the file it points at and the name to look for in that file (i.e. `beta.member` becomes `alpha.member`).
     * @returns undefined when the name is not a type import. `file` is undefined when the imported file is not in the program
     */
    private getTypeImportTarget(entityName: string, context: ResolveContext): { file: BrsFile | undefined; fullNameLower: string } | undefined {
        const parts = entityName.toLowerCase().split('.');
        const typeImport = context.file.typeImports.get(parts[0]);
        if (!typeImport) {
            return undefined;
        }
        const targetFile = this.event.program.getFile<BrsFile>(typeImport.destPath);
        parts[0] = typeImport.specifier.name.toLowerCase();
        return {
            file: isBrsFile(targetFile) && targetFile !== context.file ? targetFile : undefined,
            fullNameLower: parts.join('.')
        };
    }

    /**
     * Look up a name in one file's cached statement map, first as a member of `containingNamespace` and then as a global name
     */
    private getFromFileMap<T>(map: Map<string, T>, entityName: string, containingNamespace: string | undefined): T | undefined {
        const lowerName = entityName.toLowerCase();
        const fullNameLower = util.getFullyQualifiedClassName(lowerName, containingNamespace)?.toLowerCase();
        let result = map.get(fullNameLower);
        if (!result && lowerName !== fullNameLower) {
            result = map.get(lowerName);
        }
        return result;
    }

    /**
     * Find the const with the given name, as seen from `context`. Named type imports in the context's file take precedence,
     * then the context's scope. A file that is not in any scope (i.e. it is only ever `import type`d) falls back to its own consts.
     * @returns the const and the context its value should be resolved in
     */
    private findConst(entityName: string, containingNamespace: string | undefined, context: ResolveContext): { statement: ConstStatement; context: ResolveContext } | undefined {
        const typeImportTarget = this.getTypeImportTarget(entityName, context);
        if (typeImportTarget) {
            // eslint-disable-next-line @typescript-eslint/dot-notation
            const statement = typeImportTarget.file?.['_cachedLookups'].constStatementMap.get(typeImportTarget.fullNameLower);
            //a type import shadows anything else with the same name, so don't look any further
            return statement ? { statement: statement, context: this.getContextForFile(typeImportTarget.file) } : undefined;
        }
        const link = context.scope?.getConstFileLink(entityName, containingNamespace);
        if (link) {
            return { statement: link.item, context: { file: link.file, scope: context.scope } };
        }
        if (!context.scope) {
            // eslint-disable-next-line @typescript-eslint/dot-notation
            const statement = this.getFromFileMap(context.file['_cachedLookups'].constStatementMap, entityName, containingNamespace);
            if (statement) {
                return { statement: statement, context: context };
            }
        }
    }

    /**
     * Find the enum with the given name, as seen from `context` (see `findConst` for the lookup order)
     */
    private findEnum(entityName: string, containingNamespace: string | undefined, context: ResolveContext): EnumStatement | undefined {
        const typeImportTarget = this.getTypeImportTarget(entityName, context);
        if (typeImportTarget) {
            // eslint-disable-next-line @typescript-eslint/dot-notation
            return typeImportTarget.file?.['_cachedLookups'].enumStatementMap.get(typeImportTarget.fullNameLower);
        }
        const link = context.scope?.getEnumFileLink(entityName, containingNamespace);
        if (link) {
            return link.item;
        }
        if (!context.scope) {
            // eslint-disable-next-line @typescript-eslint/dot-notation
            return this.getFromFileMap(context.file['_cachedLookups'].enumStatementMap, entityName, containingNamespace);
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
     * Recursively resolve a const or enum value until we get to the final resolved expression.
     * @param value the expression to resolve
     * @param context the context the expression was authored in (the file of the const it belongs to, and that file's scope)
     * @param containingNamespace the namespace the expression was authored in
     * @returns the resolved value, the context it was authored in, the const that owns it (if any) and whether a circular reference was detected
     */
    private resolveConstValue(value: Expression, context: ResolveContext, containingNamespace: string | undefined, visited = new Set<ConstStatement>()): ResolvedValue {
        // If it's already a literal, return it as-is
        if (isLiteralExpression(value)) {
            return { value: value, context: context, isCircular: false };
        }

        let entityName: string;
        if (isVariableExpression(value)) {
            entityName = value.tokens.name.text.toLowerCase();
        } else if (isDottedGetExpression(value)) {
            //(e.g., namespace.const or namespace.enum.member)
            const parts = util.splitExpression(value);
            const processedNames: string[] = [];
            for (let part of parts) {
                if (isVariableExpression(part) || isDottedGetExpression(part)) {
                    processedNames.push(part?.tokens.name?.text?.toLowerCase());
                } else {
                    // Can't resolve further
                    return { value: value, context: context, isCircular: false };
                }
            }
            entityName = processedNames.join('.');
        } else {
            // Return the value as-is if we can't resolve it further
            return { value: value, context: context, isCircular: false };
        }

        // Try to resolve as const first
        const found = this.findConst(entityName, containingNamespace, context);
        if (found) {
            // Prevent infinite recursion by tracking visited constants
            if (visited.has(found.statement)) {
                return { value: value, context: context, isCircular: true }; // Return the original value to avoid infinite loop
            }
            return this.resolveFoundConst(found, visited);
        }

        // Try to resolve as enum member
        const enumInfo = this.getEnumInfo(entityName, containingNamespace, context);
        if (enumInfo?.value) {
            // Enum values are already resolved to literals by getEnumInfo
            return { value: enumInfo.value, context: context, isCircular: false };
        }

        // Return the value as-is if we can't resolve it further
        return { value: value, context: context, isCircular: false };
    }

    /**
     * Resolve the value of a const found by `findConst` to its final form, in the namespace and file it was authored in
     */
    private resolveFoundConst(found: { statement: ConstStatement; context: ResolveContext }, visited = new Set<ConstStatement>()): ResolvedValue {
        visited.add(found.statement);
        const innerNamespace = found.statement.findAncestor<NamespaceStatement>(isNamespaceStatement)?.getName(ParseMode.BrighterScript);
        const resolved = this.resolveConstValue(found.statement.value, found.context, innerNamespace, visited);
        //report the const that owns the final value (the deepest const in the chain)
        return { ...resolved, constStatement: resolved.constStatement ?? found.statement };
    }

    private processExpression(expression: Expression, context: ResolveContext, visitedConsts: Set<ConstStatement> = new Set()) {
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

            let resolved: ResolvedValue;
            let value: Expression;

            let foundConst = this.findConst(entityName, containingNamespace, context);
            let enumInfo = this.getEnumInfo(entityName, containingNamespace, context);
            let namespaceInfo = isAlias && this.getNamespaceInfo(entityName, context.scope);
            if (foundConst) {
                // Recursively resolve the const value to its final form
                resolved = this.resolveFoundConst(foundConst);
                value = resolved.value;
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

            if (value && !resolved?.isCircular) {
                //If the const's value is a complex expression (e.g. an aa literal containing
                //enum refs), recursively process inner refs so they're inlined too. Without
                //this step, cross-file const usage leaves nested enum/const refs unresolved
                //because the consumer file's pre-transpile pass never visits the inlined
                //value's children (they live in the const's defining file).
                if (resolved?.constStatement && !isLiteralExpression(value)) {
                    if (visitedConsts.has(resolved.constStatement)) {
                        return;
                    }
                    this.processInlinedConstValue(value, resolved.context, resolved.constStatement, visitedConsts);
                }

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

    /**
     * Inline the const and enum references found inside an inlined const value
     * @param value the (non-literal) value being inlined
     * @param context the context `value` was authored in
     * @param constStatement the const that owns `value`
     */
    private processInlinedConstValue(value: Expression, context: ResolveContext, constStatement: ConstStatement, visitedConsts: Set<ConstStatement>) {
        //skip if we've already walked this const's value during the current outer
        //inline. Guards against unbounded recursion for circular aggregate references
        //(const A = { x: B }; const B = { y: A }) and avoids redundant work for
        //diamond reference graphs.
        if (visitedConsts.has(constStatement)) {
            return;
        }
        visitedConsts.add(constStatement);
        const innerNamespace = constStatement.findAncestor<NamespaceStatement>(isNamespaceStatement)?.getName(ParseMode.BrighterScript);
        value.walk(createVisitor({
            VariableExpression: (varExpr) => {
                if (isDottedGetExpression(varExpr.parent)) {
                    return;
                }
                this.processExpressionForInlinedValue(varExpr, context, innerNamespace, visitedConsts);
            },
            DottedGetExpression: (dottedExpr) => {
                if (isDottedGetExpression(dottedExpr.parent)) {
                    return;
                }
                this.processExpressionForInlinedValue(dottedExpr, context, innerNamespace, visitedConsts);
            }
        }), { walkMode: WalkMode.visitExpressionsRecursive });
    }

    /**
     * Mirrors processExpression but treats `context` and `containingNamespace` as those of the
     * const that produced this inlined value (not the consumer file's), since
     * the expression we're rewriting was authored in the const's file.
     */
    private processExpressionForInlinedValue(expression: Expression, context: ResolveContext, containingNamespace: string | undefined, visitedConsts: Set<ConstStatement>) {
        const parts = util.splitExpression(expression);
        const processedNames: string[] = [];
        for (let part of parts) {
            let entityName: string;
            if (isVariableExpression(part) || isDottedGetExpression(part)) {
                processedNames.push(part?.tokens.name?.text?.toLowerCase());
                entityName = processedNames.join('.');
            } else {
                return;
            }

            let resolved: ResolvedValue;
            let value: Expression;
            const foundConst = this.findConst(entityName, containingNamespace, context);
            if (foundConst) {
                resolved = this.resolveFoundConst(foundConst);
                value = resolved.value;
            } else {
                const enumInfo = this.getEnumInfo(entityName, containingNamespace, context);
                if (enumInfo?.value) {
                    value = enumInfo.value;
                }
            }

            if (value && !resolved?.isCircular) {
                if (resolved?.constStatement && !isLiteralExpression(value)) {
                    if (visitedConsts.has(resolved.constStatement)) {
                        return;
                    }
                    this.processInlinedConstValue(value, resolved.context, resolved.constStatement, visitedConsts);
                }
                this.event.editor.setProperty(part, 'transpile', (state) => {
                    if (isLiteralExpression(value)) {
                        return value.transpile(state);
                    }
                    return ['(', ...value.transpile(state), ')'];
                });
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
