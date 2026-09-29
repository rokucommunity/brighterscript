import { createAssignmentStatement, createBlock, createCall, createDottedSetStatement, createIdentifier, createIfStatement, createIndexedSetStatement, createToken, createVariableExpression } from '../../astUtils/creators';
import type { Editor } from '../../astUtils/Editor';
import { isDottedGetExpression, isLiteralExpression, isVariableExpression, isUnaryExpression, isAliasStatement, isCallExpression, isCallfuncExpression, isEnumType, isAssignmentStatement, isBlock, isBody, isDottedSetStatement, isGroupingExpression, isIndexedSetStatement, isAugmentedAssignmentStatement, isNamespaceStatement, isSpreadExpression, isArrayLiteralExpression, isAAIndexedMemberExpression, isAAMemberExpression } from '../../astUtils/reflection';
import { createVisitor, WalkMode } from '../../astUtils/visitors';
import type { BrsFile } from '../../files/BrsFile';
import type { ExtraSymbolData, OnPrepareFileEvent } from '../../interfaces';
import type { Identifier } from '../../lexer/Token';
import { TokenKind } from '../../lexer/TokenKind';
import type { Expression, Statement } from '../../parser/AstNode';
import type { AALiteralExpression, TernaryExpression } from '../../parser/Expression';
import { ArrayLiteralExpression, DottedGetExpression, LiteralExpression, VariableExpression } from '../../parser/Expression';
import { ParseMode } from '../../parser/Parser';
import type { AssignmentStatement, Block, Body, ConstStatement, DottedSetStatement, IndexedSetStatement, NamespaceStatement } from '../../parser/Statement';
import { AugmentedAssignmentStatement, ExpressionStatement, type AliasStatement, type IfStatement } from '../../parser/Statement';
import type { Location } from 'vscode-languageserver';
import type { Scope } from '../../Scope';
import { SymbolTypeFlag } from '../../SymbolTypeFlag';
import util from '../../util';
import { BslibManager } from '../serialize/BslibManager';

/**
 * When at least this many plain array elements follow a spread, they are appended as one literal
 * (`x.append([1, 2, 3])`) instead of one `x.push(n)` each. Measured with bsbench (`SpreadTrailing*` suites,
 * Roku Express 4K): `push` wins up to 6 elements, the two tie at 8, and `append` pulls ahead from 12 (+6%)
 * to 32 (+44%). AA members are never grouped: `x.a = 1` statements beat `x.append({a: 1, ...})` by 35-70%
 * at every size, target, key kind and value kind tested.
 */
const ARRAY_SPREAD_APPEND_THRESHOLD = 8;

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
            },
            ArrayLiteralExpression: (literal) => {
                this.processSpreadLiteral(literal, visitor, walkMode);
            },
            AALiteralExpression: (literal) => {
                this.processSpreadLiteral(literal, visitor, walkMode);
            }
        });
        this.event.file.ast.walk(visitor, { walkMode: walkMode });
    }

    /**
     * Name for the local temp a spread literal is built in, derived from the assignment target so the transpiled
     * code stays readable: `list = [...]` -> `__bsc_tmp_list`, `m.items = [...]` -> `__bsc_tmp_items`,
     * `store["items"] = [...]` -> `__bsc_tmp_items`, `store[key] = [...]` -> `__bsc_tmp_key`
     */
    private getSpreadTempName(statement: AssignmentStatement | DottedSetStatement | IndexedSetStatement) {
        let name: string;
        if (isAssignmentStatement(statement) || isDottedSetStatement(statement)) {
            name = statement.tokens.name?.text;
        } else if (isIndexedSetStatement(statement)) {
            const lastIndex = statement.indexes[statement.indexes.length - 1];
            if (isLiteralExpression(lastIndex)) {
                name = lastIndex.tokens.value?.text?.replace(/^"|"$/g, '');
            } else if (isVariableExpression(lastIndex) || isDottedGetExpression(lastIndex)) {
                name = lastIndex.tokens.name?.text;
            }
        }
        //keep only identifier-safe characters (eg. a string key like "first name")
        name = (name ?? 'value').replace(/[^a-z0-9_]/gi, '_');
        return `__bsc_tmp_${name}`;
    }

    /**
     * Lower `x = [a, ...b, c]` into `x = [a]` followed by `x.append(b)` and `x.push(c)` (and the AA equivalents).
     * The literal is built in a local temp first (then assigned to the real target) when the target is not a
     * plain local variable, or when the trailing elements read from the target itself.
     */
    private processSpreadLiteral(literal: ArrayLiteralExpression | AALiteralExpression, visitor: ReturnType<typeof createVisitor>, walkMode: WalkMode) {
        const elements = literal.elements as Expression[];
        const firstSpreadIndex = elements.findIndex(e => isSpreadExpression(e));
        if (firstSpreadIndex < 0) {
            return;
        }
        const statement = util.getSpreadLiteralOwnerStatement(literal);
        if (!statement) {
            //validation already flagged this spread as unsupported
            return;
        }
        //the statement must live in a statement list so we have somewhere to insert the follow-up statements
        const block = statement.parent as Block | Body;
        const index = block.statements.indexOf(statement);
        if (index < 0) {
            return;
        }
        const editor = this.event.editor;
        const isArray = isArrayLiteralExpression(literal);

        //everything from the first spread onward leaves the literal and becomes statements
        const trailing = elements.slice(firstSpreadIndex);
        editor.arraySplice(elements, firstSpreadIndex, trailing.length);

        let statements: Statement[];
        if (!isAssignmentStatement(statement) || this.spreadReferencesLocal(statement.tokens.name.text, trailing)) {
            //Build into a local temp and assign it to the real target at the end. Two reasons:
            // - `m.list = [...]`: every follow-up statement would re-evaluate `m.list`; a local is 10-40% faster (bsbench)
            // - `list = [...list, 4]`: assigning the trimmed literal first would clobber `list` before we read it
            const tmpName = this.getSpreadTempName(statement);
            const createTarget = () => createVariableExpression(tmpName, literal.location);
            statements = [
                createAssignmentStatement({ name: createIdentifier(tmpName, literal.location), value: literal }),
                ...this.createSpreadStatements(createTarget, trailing, isArray)
            ];
            editor.setProperty(statement, 'value', createTarget());
            editor.arraySplice(block.statements, index, 0, ...statements);
        } else {
            //local variable target: assign the trimmed literal, then append/push/set the rest directly on it
            const createTarget = () => createVariableExpression(statement.tokens.name.text, statement.tokens.name.location);
            statements = this.createSpreadStatements(createTarget, trailing, isArray);
            editor.arraySplice(block.statements, index + 1, 0, ...statements);
        }

        //new statements were built outside the walk, so link them into the tree and walk them for nested rewrites (e.g. ternaries)
        for (const newStatement of statements) {
            newStatement.parent = block;
            newStatement.walk(visitor, { walkMode: walkMode });
        }
    }

    /**
     * Turn the elements that followed the first spread into statements against the target, in order.
     * Spreads become `target.append(source)`. Plain elements become one statement each, except a long run of
     * array elements, which is cheaper as a single `target.append([...])` (see ARRAY_SPREAD_APPEND_THRESHOLD).
     * `createTarget` is called once per statement because each needs its own copy of the target node.
     */
    private createSpreadStatements(createTarget: () => Expression, trailing: Expression[], isArray: boolean): Statement[] {
        const statements: Statement[] = [];
        let run: Expression[] = [];
        const flushRun = () => {
            if (isArray && run.length >= ARRAY_SPREAD_APPEND_THRESHOLD) {
                const literal = new ArrayLiteralExpression({ elements: run });
                statements.push(this.createMethodCallStatement(createTarget(), 'append', literal, run[0].location));
            } else {
                for (const element of run) {
                    statements.push(this.createElementStatement(createTarget(), element, isArray));
                }
            }
            run = [];
        };
        for (const element of trailing) {
            if (isSpreadExpression(element)) {
                flushRun();
                statements.push(this.createMethodCallStatement(createTarget(), 'append', element.expression, element.location));
            } else {
                run.push(element);
            }
        }
        flushRun();
        return statements;
    }

    /**
     * Statement that adds a single plain (non-spread) element to the target
     */
    private createElementStatement(target: Expression, element: Expression, isArray: boolean): Statement {
        if (isArray) {
            //`target.push(value)`
            return this.createMethodCallStatement(target, 'push', element, element.location);
        }
        if (isAAIndexedMemberExpression(element)) {
            //`[key]: value` -> `target[key] = value`
            return createIndexedSetStatement({ obj: target, indexes: [element.key], value: element.value });
        }
        if (isAAMemberExpression(element)) {
            if (element.tokens.key.kind === TokenKind.StringLiteral) {
                //`"my-key": value` -> `target["my-key"] = value` (the key may not be a valid identifier)
                return createIndexedSetStatement({
                    obj: target,
                    indexes: [new LiteralExpression({ value: element.tokens.key })],
                    value: element.value
                });
            }
            //`key: value` -> `target.key = value`
            return createDottedSetStatement({ obj: target, name: element.tokens.key as Identifier, value: element.value });
        }
    }

    /**
     * `obj.methodName(arg)` as a standalone statement
     */
    private createMethodCallStatement(obj: Expression, methodName: string, arg: Expression, location: Location) {
        return new ExpressionStatement({
            expression: createCall(
                new DottedGetExpression({
                    obj: obj,
                    name: createIdentifier(methodName, location),
                    dot: createToken(TokenKind.Dot, '.', location)
                }),
                [arg]
            )
        });
    }

    /**
     * Does any trailing element read the local variable being assigned (e.g. `list = [...list, 1]`)?
     */
    private spreadReferencesLocal(name: string, trailing: Expression[]) {
        const lowerName = name.toLowerCase();
        return trailing.some(element => {
            return util.getExpressionInfo(element, this.event.file).uniqueVarNames.some(varName => varName.toLowerCase() === lowerName);
        });
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

    private processExpression(expression: Expression, scope: Scope | undefined, visitedConsts: Set<ConstStatement> = new Set()) {
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
                //If the const's value is a complex expression (e.g. an aa literal containing
                //enum refs), recursively process inner refs so they're inlined too. Without
                //this step, cross-file const usage leaves nested enum/const refs unresolved
                //because the consumer file's pre-transpile pass never visits the inlined
                //value's children (they live in the const's defining file).
                if (constStatement && !isLiteralExpression(value)) {
                    if (visitedConsts.has(constStatement)) {
                        return;
                    }
                    this.processInlinedConstValue(value, scope, constStatement, visitedConsts);
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

    private processInlinedConstValue(value: Expression, scope: Scope | undefined, constStatement: ConstStatement, visitedConsts: Set<ConstStatement>) {
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
                this.processExpressionForInlinedValue(varExpr, scope, innerNamespace, visitedConsts);
            },
            DottedGetExpression: (dottedExpr) => {
                if (isDottedGetExpression(dottedExpr.parent)) {
                    return;
                }
                this.processExpressionForInlinedValue(dottedExpr, scope, innerNamespace, visitedConsts);
            }
        }), { walkMode: WalkMode.visitExpressionsRecursive });
    }

    /**
     * Mirrors processExpression but treats `containingNamespace` as the namespace of the
     * const that produced this inlined value (not the consumer file's namespace), since
     * the expression we're rewriting was authored in the const's file.
     */
    private processExpressionForInlinedValue(expression: Expression, scope: Scope | undefined, containingNamespace: string | undefined, visitedConsts: Set<ConstStatement>) {
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

            let value: Expression;
            let isCircular = false;
            const constStatement = scope?.getConstFileLink(entityName, containingNamespace)?.item;
            if (constStatement) {
                const resolved = this.resolveConstValue(constStatement.value, scope, containingNamespace);
                value = resolved.value;
                isCircular = resolved.isCircular;
            } else {
                const enumInfo = this.getEnumInfo(entityName, containingNamespace, scope);
                if (enumInfo?.value) {
                    value = enumInfo.value;
                }
            }

            if (value && !isCircular) {
                if (constStatement && !isLiteralExpression(value)) {
                    if (visitedConsts.has(constStatement)) {
                        return;
                    }
                    this.processInlinedConstValue(value, scope, constStatement, visitedConsts);
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
