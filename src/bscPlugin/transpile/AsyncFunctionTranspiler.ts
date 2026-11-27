import type { Editor } from '../../astUtils/Editor';
import { createAssignmentStatement, createBooleanLiteral, createCall, createDottedSetStatement, createIdentifier, createIfStatement, createInvalidLiteral, createToken, createVariableExpression } from '../../astUtils/creators';
import { isAssignmentStatement, isAwaitedExpression, isClassStatement, isDimStatement, isDottedSetStatement, isExpressionStatement, isForEachStatement, isForStatement, isIndexedSetStatement, isMethodStatement, isReturnStatement, isTryCatchStatement, isTypecastExpression, isVariableExpression } from '../../astUtils/reflection';
import { createVisitor, WalkMode } from '../../astUtils/visitors';
import type { BrsFile } from '../../files/BrsFile';
import type { Token } from '../../lexer/Token';
import { TokenKind } from '../../lexer/TokenKind';
import type { AstNode, Expression, Statement } from '../../parser/AstNode';
import type { BrsTranspileState } from '../../parser/BrsTranspileState';
import { AALiteralExpression, AAMemberExpression, ArrayLiteralExpression, DottedGetExpression, FunctionExpression, FunctionParameterExpression } from '../../parser/Expression';
import type { AwaitedExpression, VariableExpression } from '../../parser/Expression';
import { Block, ReturnStatement } from '../../parser/Statement';
import type { AssignmentStatement, CatchStatement, ClassStatement, DottedSetStatement, IndexedSetStatement, TryCatchStatement } from '../../parser/Statement';
import util from '../../util';

/**
 * A run of statements in an async function that executes without waiting. Each segment becomes its own callback in the promise chain
 */
interface Segment {
    /**
     * The statement that receives the value awaited at the end of the previous segment (i.e. `user = await getUser()`).
     * Its value is replaced with the awaited result.
     */
    resume?: AssignmentStatement | DottedSetStatement | IndexedSetStatement;
    statements: Statement[];
    /**
     * The value this segment waits on before the next segment runs
     */
    tail?: {
        expression: Expression;
        /**
         * The statement the await came from
         */
        source: Statement;
        /**
         * Set when the await was the value of a `return` (i.e. `return await getUser()`)
         */
        returnStatement?: ReturnStatement;
    };
    /**
     * A `try` whose try block awaits. It becomes a nested promise chain (with a `.catch()`) that this segment waits on
     */
    tailTry?: {
        plan: ChainPlan;
        tryCatch: TryCatchStatement;
    };
}

/**
 * The segments of a statement list, and the catch handler for that list if it's the body of a `try`
 */
interface ChainPlan {
    segments: Segment[];
    catchStatement?: CatchStatement;
}

/**
 * Lowers async functions into plain BrightScript functions that build a promise chain with the `@rokucommunity/promises` library.
 *
 * ```brighterscript
 * async function getToken(prefix)
 *     username = await getUsername()
 *     return await requestToken(prefix + username)
 * end function
 * ```
 * becomes
 * ```brightscript
 * function getToken(prefix)
 *     __bsc_scope = { prefix: prefix }
 *     return promises_chain(promises_try(function(__bsc_value, __bsc_scope)
 *         return getUsername()
 *     end function, [invalid, __bsc_scope]), __bsc_scope).then(function(__bsc_value, __bsc_scope)
 *         username = __bsc_value
 *         return requestToken(__bsc_scope.prefix + username)
 *     end function).toPromise()
 * end function
 * ```
 *
 * - The code before the first `await` runs right away (through `promises_try`, which turns a crash into a rejected promise)
 * - BrightScript functions can't see their parent's variables, so the chain passes `__bsc_scope` to every callback. Any variable
 *   used in more than one callback (and any parameter) lives there. `m` is captured there too, since callbacks run with the global `m`.
 * - A `return` that can be followed by more callbacks sets `__bsc_scope.__bsc_returned`, and every later callback passes the value along
 */
export class AsyncFunctionTranspiler {
    constructor(
        private file: BrsFile,
        private editor: Editor,
        /**
         * The prefix of the promises library functions (i.e. `promises` for `promises_chain`)
         */
        private prefix: string
    ) { }

    public static readonly scopeName = '__bsc_scope';
    public static readonly valueName = '__bsc_value';
    public static readonly returnedKey = '__bsc_returned';

    /**
     * The callbacks generated for the function being lowered, and whether each is a catch handler
     */
    private callbacks: Array<{ func: FunctionExpression; isCatch: boolean }> = [];

    /**
     * Nodes created by this class that must not be rewritten when locals move to the scope (i.e. the `i` in `__bsc_scope.i = i`)
     */
    private skipNodes = new Set<AstNode>();

    public process(func: FunctionExpression) {
        this.callbacks = [];
        this.skipNodes = new Set();

        //every `return` inside the function (not counting nested functions)
        const returnStatements = this.findAll<ReturnStatement>(func.body, isReturnStatement);
        for (const returnStatement of returnStatements) {
            //every callback is a `function`, so an empty `return` (valid in an async sub) needs a value
            if (!returnStatement.value) {
                this.editor.setProperty(returnStatement, 'value', createInvalidLiteral('invalid', returnStatement));
            }
        }

        let plan = this.createPlan(func.body.statements);
        const tracksReturns = this.hasReturnFollowedByMoreCallbacks(plan, true);
        if (tracksReturns) {
            for (const returnStatement of returnStatements) {
                this.flagReturn(returnStatement);
            }
            //the flags were added to the statement lists, so plan again to pick them up
            plan = this.createPlan(func.body.statements);
        }

        const chain = this.createChainExpression(plan, tracksReturns);

        this.rewriteSuperCalls(func);
        const hoistedNames = this.getHoistedNames(func);
        let usesM = false;
        for (const callback of this.callbacks) {
            usesM = this.rewriteLocals(callback.func, hoistedNames, callback.isCatch) || usesM;
        }

        //the scope that's handed to every callback
        const scopeMembers: AAMemberExpression[] = [];
        if (usesM) {
            scopeMembers.push(this.createAAMember('m', createVariableExpression('m')));
        }
        for (const param of func.parameters) {
            if (hoistedNames.has(param.tokens.name.text.toLowerCase())) {
                scopeMembers.push(this.createAAMember(param.tokens.name.text, createVariableExpression(param.tokens.name.text)));
            }
        }
        if (tracksReturns) {
            scopeMembers.push(this.createAAMember(AsyncFunctionTranspiler.returnedKey, createBooleanLiteral('false')));
        }

        this.editor.setProperty(func, 'body', new Block({
            statements: [
                createAssignmentStatement({
                    name: AsyncFunctionTranspiler.scopeName,
                    value: new AALiteralExpression({
                        elements: scopeMembers,
                        open: createToken(TokenKind.LeftCurlyBrace, '{'),
                        close: createToken(TokenKind.RightCurlyBrace, '}')
                    })
                }),
                new ReturnStatement({ return: createToken(TokenKind.Return, 'return'), value: chain })
            ]
        }));

        //the signature itself (`function`, with no return type) is handled by `FunctionExpression.transpile`, since typedefs still need the original
    }

    /**
     * Split a statement list into segments at each `await`
     */
    private createPlan(statements: Statement[]): ChainPlan {
        const segments: Segment[] = [];
        let current: Segment = { statements: [] };
        for (const statement of statements) {
            const awaited = this.getStatementAwait(statement);
            if (awaited) {
                if (isReturnStatement(statement)) {
                    current.tail = { expression: awaited.expression, source: statement, returnStatement: statement };
                    segments.push(current);
                    current = { statements: [] };
                } else {
                    current.tail = { expression: awaited.expression, source: statement };
                    segments.push(current);
                    current = {
                        statements: [],
                        //a standalone `await` discards the value
                        resume: isExpressionStatement(statement) ? undefined : statement as AssignmentStatement
                    };
                }
            } else if (isTryCatchStatement(statement) && this.tryBlockAwaits(statement)) {
                current.tailTry = {
                    plan: {
                        ...this.createPlan(statement.tryBranch.statements),
                        catchStatement: statement.catchStatement
                    },
                    tryCatch: statement
                };
                segments.push(current);
                current = { statements: [] };
            } else {
                current.statements.push(statement);
            }
        }
        //skip a trailing segment with nothing in it (i.e. when the function ends with an `await`)
        if (segments.length === 0 || current.resume || current.statements.length > 0) {
            segments.push(current);
        }
        return { segments: segments };
    }

    /**
     * Get the await of a statement that awaits (the only placements that validation allows):
     * `await x`, `a = await x`, `a.b = await x`, `a[b] = await x`, `return await x`
     */
    private getStatementAwait(statement: Statement): AwaitedExpression | undefined {
        let value: Expression;
        if (isExpressionStatement(statement)) {
            value = statement.expression;
        } else if (isAssignmentStatement(statement) || isDottedSetStatement(statement) || isIndexedSetStatement(statement) || isReturnStatement(statement)) {
            value = statement.value;
        }
        return isAwaitedExpression(value) ? value : undefined;
    }

    /**
     * Does this `try` block await (directly, or in a nested `try` that does)?
     */
    private tryBlockAwaits(tryCatch: TryCatchStatement): boolean {
        return tryCatch.tryBranch?.statements.some(statement => {
            return !!this.getStatementAwait(statement) || (isTryCatchStatement(statement) && this.tryBlockAwaits(statement));
        }) ?? false;
    }

    /**
     * Is there a `return` somewhere that more callbacks would run after? Those callbacks need to know to skip their work.
     * @param plan the segments to check
     * @param isLastChain is this plan the last thing that runs in the function
     */
    private hasReturnFollowedByMoreCallbacks(plan: ChainPlan, isLastChain: boolean): boolean {
        for (let i = 0; i < plan.segments.length; i++) {
            const segment = plan.segments[i];
            const isLastSegment = isLastChain && i === plan.segments.length - 1;
            const statements = [...segment.statements];
            if (segment.tail?.returnStatement) {
                statements.push(segment.tail.returnStatement);
            }
            if (!isLastSegment && statements.some(statement => isReturnStatement(statement) || this.findAll(statement, isReturnStatement).length > 0)) {
                return true;
            }
            if (segment.tailTry) {
                if (this.hasReturnFollowedByMoreCallbacks(segment.tailTry.plan, isLastSegment)) {
                    return true;
                }
                const catchStatements = segment.tailTry.plan.catchStatement?.catchBranch?.statements ?? [];
                if (!isLastSegment && catchStatements.some(statement => isReturnStatement(statement) || this.findAll(statement, isReturnStatement).length > 0)) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Set `__bsc_scope.__bsc_returned = true` right before a `return`
     */
    private flagReturn(returnStatement: ReturnStatement) {
        const block = returnStatement.parent;
        if (!(block instanceof Block)) {
            return;
        }
        const index = block.statements.indexOf(returnStatement);
        if (index < 0) {
            return;
        }
        const flag = createDottedSetStatement({
            obj: createVariableExpression(AsyncFunctionTranspiler.scopeName),
            name: AsyncFunctionTranspiler.returnedKey,
            value: createBooleanLiteral('true'),
            dot: createToken(TokenKind.Dot, '.')
        });
        //keep the return's comments above the flag
        this.moveLeadingTrivia(returnStatement, flag.obj as VariableExpression);
        this.editor.arraySplice(block.statements, index, 0, flag);
    }

    /**
     * `promises_chain(promises_try(callback0, [invalid, __bsc_scope]), __bsc_scope).then(callback1)...catch(handler).toPromise()`
     */
    private createChainExpression(plan: ChainPlan, tracksReturns: boolean): Expression {
        //a body that is nothing but a `try` that awaits is just that try's chain (building a chain never crashes, so there's nothing to catch)
        const onlySegment = plan.segments[0];
        if (plan.segments.length === 1 && !plan.catchStatement && onlySegment.tailTry && !onlySegment.resume && onlySegment.statements.length === 0) {
            return this.createChainExpression(onlySegment.tailTry.plan, tracksReturns);
        }
        const callbacks = plan.segments.map((segment, i) => this.createSegmentCallback(segment, i > 0, tracksReturns));
        //the arguments for the first callback, `[invalid, __bsc_scope]`
        const args = new ArrayLiteralExpression({
            elements: [createInvalidLiteral('invalid'), createVariableExpression(AsyncFunctionTranspiler.scopeName)],
            open: createToken(TokenKind.LeftSquareBracket, '['),
            close: createToken(TokenKind.RightSquareBracket, ']')
        });
        //array literals always transpile one element per line, which is a lot of noise for two generated values
        this.editor.overrideTranspileResult(args, `[invalid, ${AsyncFunctionTranspiler.scopeName}]`);
        const tryCall = createCall(createVariableExpression(`${this.prefix}_try`), [callbacks[0], args]);
        if (callbacks.length === 1 && !plan.catchStatement) {
            return tryCall;
        }
        let chain: Expression = createCall(createVariableExpression(`${this.prefix}_chain`), [
            tryCall,
            createVariableExpression(AsyncFunctionTranspiler.scopeName)
        ]);
        for (const callback of callbacks.slice(1)) {
            chain = createCall(this.createDottedGet(chain, 'then'), [callback]);
        }
        if (plan.catchStatement) {
            chain = createCall(this.createDottedGet(chain, 'catch'), [this.createCatchCallback(plan.catchStatement)]);
        }
        return createCall(this.createDottedGet(chain, 'toPromise'), []);
    }

    private createSegmentCallback(segment: Segment, isContinuation: boolean, tracksReturns: boolean) {
        const statements: Statement[] = [];
        //if an earlier callback returned, pass its value along without doing anything else
        if (isContinuation && tracksReturns) {
            statements.push(createIfStatement({
                condition: this.createDottedGet(createVariableExpression(AsyncFunctionTranspiler.scopeName), AsyncFunctionTranspiler.returnedKey),
                thenBranch: new Block({
                    statements: [
                        new ReturnStatement({ return: createToken(TokenKind.Return, 'return'), value: createVariableExpression(AsyncFunctionTranspiler.valueName) })
                    ]
                })
            }));
        }
        if (segment.resume) {
            this.editor.setProperty(segment.resume, 'value', createVariableExpression(AsyncFunctionTranspiler.valueName));
            statements.push(segment.resume);
        }
        statements.push(...segment.statements);
        if (segment.tail?.returnStatement) {
            this.editor.setProperty(segment.tail.returnStatement, 'value', segment.tail.expression);
            statements.push(segment.tail.returnStatement);
        } else if (segment.tail) {
            //the comments above `x = await getUser()` belong with the await, not with the assignment in the next callback
            statements.push(
                new ReturnStatement({ return: this.createReturnToken(segment.tail.source), value: segment.tail.expression })
            );
        } else if (segment.tailTry) {
            statements.push(
                new ReturnStatement({ return: this.createReturnToken(segment.tailTry.tryCatch), value: this.createChainExpression(segment.tailTry.plan, tracksReturns) })
            );
        }
        return this.createCallback([AsyncFunctionTranspiler.valueName, AsyncFunctionTranspiler.scopeName], statements, false);
    }

    private createCatchCallback(catchStatement: CatchStatement) {
        let exceptionVariable = catchStatement.exceptionVariableExpression;
        if (isTypecastExpression(exceptionVariable)) {
            exceptionVariable = exceptionVariable.obj;
        }
        const errorName = isVariableExpression(exceptionVariable) ? exceptionVariable.tokens.name.text : '__bsc_error';
        return this.createCallback([errorName, AsyncFunctionTranspiler.scopeName], catchStatement.catchBranch?.statements ?? [], true);
    }

    private createCallback(paramNames: string[], statements: Statement[], isCatch: boolean) {
        const func = new FunctionExpression({
            functionType: createToken(TokenKind.Function, 'function'),
            endFunctionType: createToken(TokenKind.EndFunction, 'end function'),
            leftParen: createToken(TokenKind.LeftParen, '('),
            rightParen: createToken(TokenKind.RightParen, ')'),
            parameters: paramNames.map(name => new FunctionParameterExpression({ name: createIdentifier(name) })),
            body: new Block({ statements: statements })
        });
        this.callbacks.push({ func: func, isCatch: isCatch });
        return func;
    }

    /**
     * `super.method()` is normally converted by the class when the method transpiles, but by then the call lives in a callback
     * that the class does not look into. So convert it here (to `m.super0_method()`, and `m` is then moved to the scope)
     */
    private rewriteSuperCalls(func: FunctionExpression) {
        if (!isMethodStatement(func.parent)) {
            return;
        }
        const classStatement = func.parent.findAncestor<ClassStatement>(isClassStatement);
        const parentClassIndex = classStatement?.getParentClassIndex({ file: this.file } as BrsTranspileState);
        if (parentClassIndex === null || parentClassIndex === undefined) {
            return;
        }
        for (const callback of this.callbacks) {
            callback.func.body.walk(createVisitor({
                DottedGetExpression: (expression) => {
                    const beginningVariable = util.findBeginningVariableExpression(expression);
                    if (beginningVariable?.tokens.name.text.toLowerCase() === 'super' && expression.obj === beginningVariable) {
                        this.editor.setProperty(beginningVariable.tokens.name, 'text', 'm');
                        this.editor.setProperty(expression.tokens.name, 'text', `super${parentClassIndex}_${expression.tokens.name.text}`);
                    }
                }
            }), { walkMode: WalkMode.visitExpressions });
        }
    }

    /**
     * Find the local variables that must live on the scope: every parameter that is used, and every variable used in more than one callback
     */
    private getHoistedNames(func: FunctionExpression) {
        //every name that is declared as a local inside the function
        const localNames = new Map<string, Set<number>>();
        const declare = (name: string) => {
            const lowerName = name.toLowerCase();
            if (!lowerName.startsWith('__bsc_') && !localNames.has(lowerName)) {
                localNames.set(lowerName, new Set());
            }
        };
        for (const param of func.parameters) {
            declare(param.tokens.name.text);
            //parameters live in the outer function, which is never a callback
            localNames.get(param.tokens.name.text.toLowerCase())?.add(-1);
        }
        this.callbacks.forEach((callback) => {
            if (callback.isCatch) {
                declare(callback.func.parameters[0].tokens.name.text);
            }
            callback.func.body.walk((node) => {
                for (const name of this.getDeclaredNames(node)) {
                    declare(name);
                }
            }, { walkMode: WalkMode.visitAll });
        });

        //which callbacks use each one
        this.callbacks.forEach((callback, index) => {
            const use = (name: string) => {
                localNames.get(name.toLowerCase())?.add(index);
            };
            if (callback.isCatch) {
                use(callback.func.parameters[0].tokens.name.text);
            }
            callback.func.body.walk((node) => {
                if (isVariableExpression(node)) {
                    use(node.tokens.name.text);
                }
                for (const name of this.getDeclaredNames(node)) {
                    use(name);
                }
            }, { walkMode: WalkMode.visitAll });
        });

        const hoisted = new Set<string>();
        for (const [name, usedBy] of localNames) {
            //a parameter that is used by any callback, or a variable used by more than one
            if (usedBy.size > 1) {
                hoisted.add(name);
            }
        }
        return hoisted;
    }

    /**
     * The local variable names that a node declares
     */
    private getDeclaredNames(node: AstNode): string[] {
        if (isAssignmentStatement(node)) {
            return [node.tokens.name.text];
        } else if (isForEachStatement(node)) {
            return [node.tokens.item.text];
        } else if (isDimStatement(node)) {
            return [node.tokens.name.text];
        }
        return [];
    }

    /**
     * Move hoisted variables and `m` onto the scope within one callback
     * @returns true if the callback uses `m`
     */
    private rewriteLocals(func: FunctionExpression, hoistedNames: Set<string>, isCatch: boolean) {
        let usesM = false;
        const isHoisted = (name: string) => hoistedNames.has(name.toLowerCase());

        //copy a local into the scope (for the variables that BrightScript requires to be locals, like loop counters)
        const createCopyToScope = (name: Token) => {
            const value = createVariableExpression(name.text, name);
            this.skipNodes.add(value);
            return createDottedSetStatement({
                obj: createVariableExpression(AsyncFunctionTranspiler.scopeName),
                name: name.text,
                value: value,
                dot: createToken(TokenKind.Dot, '.')
            });
        };

        //the catch handler's error parameter is a local, so copy it into the scope if other callbacks use it
        const errorParam = func.parameters[0].tokens.name;
        if (isCatch && isHoisted(errorParam.text)) {
            this.editor.arrayUnshift(func.body.statements, createCopyToScope(errorParam));
        }

        func.body.walk(createVisitor({
            VariableExpression: (expression) => {
                if (this.skipNodes.has(expression)) {
                    return;
                }
                const name = expression.tokens.name.text;
                if (name.toLowerCase() === 'm') {
                    usesM = true;
                    return this.createScopeGet(name, expression);
                }
                if (isHoisted(name)) {
                    return this.createScopeGet(name, expression);
                }
            },
            AssignmentStatement: (statement) => {
                //a `for` loop counter must stay a local (it's copied below)
                if (isForStatement(statement.parent) || !isHoisted(statement.tokens.name.text)) {
                    return;
                }
                const obj = createVariableExpression(AsyncFunctionTranspiler.scopeName);
                this.moveLeadingTrivia(statement, obj);
                return createDottedSetStatement({
                    obj: obj,
                    name: createIdentifier(statement.tokens.name.text, statement.tokens.name),
                    value: statement.value,
                    dot: createToken(TokenKind.Dot, '.'),
                    equals: statement.tokens.equals
                });
            },
            ForStatement: (statement) => {
                const counter = statement.counterDeclaration?.tokens.name;
                if (counter && isHoisted(counter.text)) {
                    //copy the counter into the scope at the top of every iteration, and once more when the loop finishes
                    this.editor.arrayUnshift(statement.body.statements, createCopyToScope(counter));
                    this.insertAfter(statement, createCopyToScope(counter));
                }
            },
            ForEachStatement: (statement) => {
                if (isHoisted(statement.tokens.item.text)) {
                    this.editor.arrayUnshift(statement.body.statements, createCopyToScope(statement.tokens.item));
                }
            },
            DimStatement: (statement) => {
                if (isHoisted(statement.tokens.name.text)) {
                    this.insertAfter(statement, createCopyToScope(statement.tokens.name));
                }
            }
        }), {
            walkMode: WalkMode.visitAll,
            editor: this.editor
        });
        return usesM;
    }

    /**
     * `__bsc_scope.name`
     */
    private createScopeGet(name: string, locatable: VariableExpression) {
        const obj = createVariableExpression(AsyncFunctionTranspiler.scopeName);
        this.moveLeadingTrivia(locatable, obj);
        return new DottedGetExpression({
            obj: obj,
            name: createIdentifier(name, locatable.tokens.name),
            dot: createToken(TokenKind.Dot, '.')
        });
    }

    private createDottedGet(obj: Expression, name: string) {
        return new DottedGetExpression({
            obj: obj,
            name: createIdentifier(name),
            dot: createToken(TokenKind.Dot, '.')
        });
    }

    private createAAMember(key: string, value: Expression) {
        return new AAMemberExpression({
            key: createToken(TokenKind.Identifier, key),
            colon: createToken(TokenKind.Colon, ':'),
            value: value
        });
    }

    /**
     * Insert a statement right after another one in its block
     */
    private insertAfter(statement: Statement, newStatement: Statement) {
        const block = statement.parent;
        if (block instanceof Block) {
            const index = block.statements.indexOf(statement);
            if (index >= 0) {
                this.editor.arraySplice(block.statements, index + 1, 0, newStatement);
            }
        }
    }

    /**
     * A `return` token that carries the comments that were in front of a statement
     */
    private createReturnToken(commentsFrom: Statement) {
        const token = createToken(TokenKind.Return, 'return');
        this.moveLeadingTrivia(commentsFrom, token);
        return token;
    }

    /**
     * Move the comments in front of a node onto the first token of its replacement, so they are still emitted
     */
    private moveLeadingTrivia(node: { leadingTrivia?: Token[] }, target: VariableExpression | Token) {
        const trivia = node.leadingTrivia;
        if (trivia?.length > 0) {
            const targetToken = isVariableExpression(target as AstNode) ? (target as VariableExpression).tokens.name : target as Token;
            targetToken.leadingTrivia = [...trivia];
            this.editor.arraySplice(trivia, 0, trivia.length);
        }
    }

    /**
     * Find every node that matches, without going into nested functions
     */
    private findAll<T extends AstNode>(node: AstNode, matcher: (node: AstNode) => boolean): T[] {
        const result = [] as T[];
        node?.walk((child) => {
            if (matcher(child)) {
                result.push(child as T);
            }
        }, { walkMode: WalkMode.visitAll });
        return result;
    }
}
