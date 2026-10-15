import { createAssignmentStatement, createBlock, createCall, createDottedSetStatement, createIdentifier, createIfStatement, createIndexedSetStatement, createInvalidLiteral, createToken, createVariableExpression } from '../../astUtils/creators';
import type { Editor } from '../../astUtils/Editor';
import { isDottedGetExpression, isLiteralExpression, isVariableExpression, isUnaryExpression, isAliasStatement, isCallExpression, isCallfuncExpression, isEnumType, isAssignmentStatement, isBlock, isBody, isDottedSetStatement, isGroupingExpression, isIndexedSetStatement, isAugmentedAssignmentStatement, isNamespaceStatement, isSpreadExpression, isArrayLiteralExpression, isAAIndexedMemberExpression, isAAMemberExpression } from '../../astUtils/reflection';
import { createVisitor, InternalWalkMode, WalkMode } from '../../astUtils/visitors';
import type { BrsFile } from '../../files/BrsFile';
import type { ExtraSymbolData, OnPrepareFileEvent } from '../../interfaces';
import type { Identifier, Token } from '../../lexer/Token';
import { TokenKind } from '../../lexer/TokenKind';
import type { AstNode, Expression, Statement } from '../../parser/AstNode';
import type { AALiteralExpression, NullCoalescingExpression, TernaryExpression } from '../../parser/Expression';
import { ArrayLiteralExpression, BinaryExpression, DottedGetExpression, LiteralExpression, VariableExpression } from '../../parser/Expression';
import { ParseMode } from '../../parser/Parser';
import type { Block, Body, ConstStatement, EnumStatement, NamespaceStatement } from '../../parser/Statement';
import { AugmentedAssignmentStatement, ExpressionStatement, type AliasStatement, type IfStatement } from '../../parser/Statement';
import type { Location } from 'vscode-languageserver';
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
        //inactive conditional compile branches still ship in the output, so transpile their ternaries to if statements too
        // eslint-disable-next-line no-bitwise
        const walkMode = WalkMode.visitExpressionsRecursive | InternalWalkMode.visitFalseConditionalCompilationBlocks;
        //`??` rewrites move the operands into new statements, but the walk re-links an expression's children to it after the
        //visitor returns. So collect them during the walk and rewrite them afterwards (outermost first, since the walk is pre-order)
        const nullCoalescingExpressions: NullCoalescingExpression[] = [];
        const visitor = createVisitor({
            TernaryExpression: (ternaryExpression) => {
                this.processTernaryExpression(ternaryExpression, visitor, walkMode);
            },
            NullCoalescingExpression: (expression) => {
                nullCoalescingExpressions.push(expression);
            },
            ArrayLiteralExpression: (literal) => {
                this.processSpreadLiteral(literal, visitor, walkMode);
            },
            AALiteralExpression: (literal) => {
                this.processSpreadLiteral(literal, visitor, walkMode);
            }
        });
        this.event.file.ast.walk(visitor, { walkMode: walkMode });
        //rewriting one can surface nested ones (re-collected by the visitor), so drain until there are none left
        while (nullCoalescingExpressions.length > 0) {
            this.processNullCoalescingExpression(nullCoalescingExpressions.shift(), visitor, walkMode);
        }
    }

    /**
     * Lower a `??` that is the entire value of an assignment into plain statements, instead of the inline function that
     * `NullCoalescingExpression.transpile` would otherwise produce:
     * - `x = a.b ?? c` -> `x = a.b` then `if x = invalid then x = c`
     * - `m.x = a.b ?? c` -> `__bsc_tmp_coalesce = a.b`, `if __bsc_tmp_coalesce = invalid then __bsc_tmp_coalesce = c`, `m.x = __bsc_tmp_coalesce`
     *
     * The temp is used when the target is not a plain local (so the target is written once, and node observers fire once),
     * or when the alternate reads the local being assigned (`x = a.b ?? x`), since assigning first would clobber it.
     */
    private processNullCoalescingExpression(expression: NullCoalescingExpression, visitor: ReturnType<typeof createVisitor>, walkMode: WalkMode) {
        //simple operands already transpile to a one-line `bslib_coalesce()` call, so leave those alone
        if (!expression.hasMutatingExpression(this.event.file)) {
            return;
        }
        //the `??` (ignoring wrapping parens) must be the entire value of an assignment
        let valueNode: AstNode = expression;
        while (isGroupingExpression(valueNode.parent)) {
            valueNode = valueNode.parent;
        }
        const statement = valueNode.parent;
        if (
            !(isAssignmentStatement(statement) || isDottedSetStatement(statement) || isIndexedSetStatement(statement) || isAugmentedAssignmentStatement(statement)) ||
            statement.value !== valueNode
        ) {
            return;
        }
        //the statement must live in a statement list so we have somewhere to insert the new statements
        const block = statement.parent as Block | Body;
        if (!isBlock(block) && !isBody(block)) {
            return;
        }
        const index = block.statements.indexOf(statement);
        if (index < 0) {
            return;
        }
        const editor = this.event.editor;
        const location = expression.tokens.questionQuestion?.location;

        //`if <name> = invalid then <name> = <alternate> end if`
        const createFallback = (name: string) => createIfStatement({
            condition: new BinaryExpression({
                left: createVariableExpression(name, location),
                operator: createToken(TokenKind.Equal, '=', location),
                right: createInvalidLiteral('invalid', location)
            }),
            thenBranch: createBlock({
                statements: [
                    createAssignmentStatement({ name: createIdentifier(name, location), value: expression.alternate })
                ]
            })
        });

        let newStatements: Statement[];
        if (isAssignmentStatement(statement) && !this.expressionReferencesLocal(statement.tokens.name.text, expression.alternate)) {
            //local variable target: assign the consequent directly, then fall back to the alternate
            editor.setProperty(statement, 'value', expression.consequent);
            newStatements = [createFallback(statement.tokens.name.text)];
            editor.arraySplice(block.statements, index + 1, 0, ...newStatements);
        } else {
            const tmpName = '__bsc_tmp_coalesce';
            newStatements = [
                createAssignmentStatement({ name: createIdentifier(tmpName, location), value: expression.consequent }),
                createFallback(tmpName)
            ];
            editor.setProperty(statement, 'value', createVariableExpression(tmpName, location));
            editor.arraySplice(block.statements, index, 0, ...newStatements);
        }

        //link the moved operands into the tree, and walk them for nested rewrites (`??` and ternaries that are now statement-level)
        for (const newStatement of [...newStatements, statement]) {
            newStatement.parent = block;
            newStatement.walk(visitor, { walkMode: walkMode });
        }
    }

    /**
     * Does the expression read the given local variable?
     */
    private expressionReferencesLocal(name: string, expression: Expression) {
        const lowerName = name.toLowerCase();
        return util.getExpressionInfo(expression, this.event.file).uniqueVarNames.some(varName => varName.toLowerCase() === lowerName);
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
            const tmpName = '__bsc_tmp_spread';
            const createTarget = (leadingTrivia?: Token[]) => this.createTargetExpression(tmpName, literal.location, leadingTrivia);
            statements = [
                createAssignmentStatement({ name: createIdentifier(tmpName, literal.location), value: literal }),
                ...this.createSpreadStatements(createTarget, trailing, isArray)
            ];
            editor.setProperty(statement, 'value', createTarget());
            editor.arraySplice(block.statements, index, 0, ...statements);
        } else {
            //local variable target: assign the trimmed literal, then append/push/set the rest directly on it
            const createTarget = (leadingTrivia?: Token[]) => this.createTargetExpression(statement.tokens.name.text, statement.tokens.name.location, leadingTrivia);
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
     * `createTarget` is called once per statement because each needs its own copy of the target node. It receives the
     * comments that preceded the element so they land on their own line above the statement instead of inside it.
     */
    private createSpreadStatements(createTarget: (leadingTrivia?: Token[]) => Expression, trailing: Expression[], isArray: boolean): Statement[] {
        const statements: Statement[] = [];
        let run: Expression[] = [];
        const flushRun = () => {
            if (isArray && run.length >= ARRAY_SPREAD_APPEND_THRESHOLD) {
                //elements keep their own comments here: inside an array literal they transpile fine on their own lines
                const literal = new ArrayLiteralExpression({ elements: run });
                statements.push(this.createMethodCallStatement(createTarget(), 'append', literal, run[0].location));
            } else {
                for (const element of run) {
                    const target = createTarget(this.takeLeadingTrivia(element));
                    statements.push(this.createElementStatement(target, element, isArray));
                }
            }
            run = [];
        };
        for (const element of trailing) {
            if (isSpreadExpression(element)) {
                flushRun();
                const target = createTarget(this.takeLeadingTrivia(element));
                statements.push(this.createMethodCallStatement(target, 'append', element.expression, element.location));
            } else {
                run.push(element);
            }
        }
        flushRun();
        return statements;
    }

    /**
     * A fresh reference to the variable the follow-up statements operate on, optionally carrying the comments
     * that should be emitted above the statement
     */
    private createTargetExpression(name: string, location: Location, leadingTrivia?: Token[]) {
        const target = createVariableExpression(name, location);
        if (leadingTrivia?.length > 0) {
            target.tokens.name.leadingTrivia = leadingTrivia;
        }
        return target;
    }

    /**
     * Detach the trivia (comments, newlines) that precede an element so it can be re-emitted ahead of the statement
     * that replaces it. Left on the element, a comment would transpile inside the generated `push(...)`, dotted set,
     * or indexed set and produce output that does not compile. The removal goes through the editor so the AST is
     * restored after transpile.
     */
    private takeLeadingTrivia(element: Expression): Token[] {
        const trivia = element.leadingTrivia;
        if (!trivia || trivia.length === 0) {
            return [];
        }
        const result = [...trivia];
        this.event.editor.arraySplice(trivia, 0, trivia.length);
        return result;
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
        return trailing.some(element => this.expressionReferencesLocal(name, element));
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
     * Find the const with the given name, as seen from `context` (see `BrsFile.findConstStatement` for the lookup order).
     * @returns the const and the context its value should be resolved in
     */
    private findConst(entityName: string, containingNamespace: string | undefined, context: ResolveContext): { statement: ConstStatement; context: ResolveContext } | undefined {
        const link = context.file.findConstStatement(entityName, containingNamespace, context.scope);
        if (link) {
            return { statement: link.item, context: this.getContextForLinkedFile(link.file, context) };
        }
    }

    /**
     * Find the enum with the given name, as seen from `context` (see `BrsFile.findEnumStatement` for the lookup order)
     */
    private findEnum(entityName: string, containingNamespace: string | undefined, context: ResolveContext): EnumStatement | undefined {
        return context.file.findEnumStatement(entityName, containingNamespace, context.scope)?.item;
    }

    /**
     * Build the context for a const found in `file` while resolving names in `context`: the same scope when `file` is part of it,
     * otherwise (the const came through a type import) the file's own first scope
     */
    private getContextForLinkedFile(file: BrsFile, context: ResolveContext): ResolveContext {
        if (file === context.file) {
            return context;
        }
        if (context.scope?.hasFile(file)) {
            return { file: file, scope: context.scope };
        }
        return this.getContextForFile(file);
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
