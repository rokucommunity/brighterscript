import { createAssignmentStatement, createBlock, createDottedSetStatement, createIfStatement, createIndexedSetStatement, createInvalidLiteral, createToken, createVariableExpression } from '../../astUtils/creators';
import { isAssignmentStatement, isBinaryExpression, isBlock, isBody, isBrsFile, isDottedGetExpression, isDottedSetStatement, isFunctionExpression, isGroupingExpression, isIndexedGetExpression, isIndexedSetStatement, isLiteralExpression, isNamedArgumentExpression, isNamespaceStatement, isStatement, isTernaryExpression, isUnaryExpression, isVariableExpression } from '../../astUtils/reflection';
import { createVisitor, WalkMode } from '../../astUtils/visitors';
import type { BrsFile } from '../../files/BrsFile';
import type { BeforeFileTranspileEvent } from '../../interfaces';
import type { Token } from '../../lexer/Token';
import { TokenKind } from '../../lexer/TokenKind';
import type { Expression, Statement } from '../../parser/AstNode';
import type { BrsTranspileState } from '../../parser/BrsTranspileState';
import type { CallExpression, FunctionExpression, FunctionParameterExpression, NamedArgumentExpression, TernaryExpression } from '../../parser/Expression';
import type { TranspileResult } from '../../interfaces';
import { LiteralExpression } from '../../parser/Expression';
import { ParseMode } from '../../parser/Parser';
import type { ClassStatement, IfStatement, MethodStatement, NamespaceStatement } from '../../parser/Statement';
import type { Scope } from '../../Scope';
import util from '../../util';

interface WrittenArgInfo {
    paramIdx: number;
    value: Expression;
}

export class BrsFilePreTranspileProcessor {
    public constructor(
        private event: BeforeFileTranspileEvent<BrsFile>
    ) {
    }

    public process() {
        if (isBrsFile(this.event.file)) {
            this.processNamedArgumentCalls();
            this.iterateExpressions();
        }
    }

    /**
     * Returns true if an expression needs to be hoisted into a temp variable to preserve evaluation order.
     * Literals and simple variable references are side-effect-free and can be used directly.
     */
    private needsHoisting(expr: Expression) {
        return !isLiteralExpression(expr) && !isVariableExpression(expr);
    }

    /**
     * Rewrite calls that use named arguments into positional calls, hoisting complex argument
     * expressions into temporary `__bsArgs*` variables to preserve written evaluation order.
     * This follows the same beforeFileTranspile pattern as ternary expression rewriting.
     */
    private processNamedArgumentCalls() {
        const scope = this.event.program.getFirstScopeForFile(this.event.file);
        if (!scope) {
            return;
        }
        const callableContainerMap = util.getCallableContainersByLowerName(scope.getAllCallables());
        // Track a hoisting counter per function so variable names are unique within each function scope
        const hoistCounters = new WeakMap<FunctionExpression, number>();

        for (const func of this.event.file.parser.references.functionExpressions) {
            // Iterate in reverse (outermost calls first) so that when an outer call hoists an inner
            // call expression into a temp variable, the inner call's own hoisting inserts after the
            // outer call's earlier hoists — preserving written evaluation order across nesting levels.
            for (const callExpr of [...func.callExpressions].reverse()) {
                if (!callExpr.args.some(isNamedArgumentExpression)) {
                    continue;
                }

                let params: FunctionParameterExpression[] | undefined;

                if (isVariableExpression(callExpr.callee)) {
                    const funcName = callExpr.callee.name.text;
                    params = callableContainerMap.get(funcName.toLowerCase())?.[0]?.callable?.functionStatement?.func?.parameters;
                } else if (isDottedGetExpression(callExpr.callee)) {
                    // Namespace function call (e.g. MyNs.myFunc(a: 1))
                    const brsName = this.getNamespaceCallableBrsName(callExpr.callee, scope);
                    if (brsName) {
                        params = callableContainerMap.get(brsName.toLowerCase())?.[0]?.callable?.functionStatement?.func?.parameters;
                    }
                }

                if (!params) {
                    continue;
                }

                this.rewriteNamedArgCall(callExpr, params, func, hoistCounters);
            }

            // Process constructor calls (new MyClass(...)) after regular calls.
            // Constructor CallExpressions are not in func.callExpressions (the parser removes them),
            // so they are handled here. Processing after regular calls ensures that when a constructor
            // call is hoisted as an arg to an outer named-arg call, the parent pointer update done by
            // the outer call's hoisting is already in place when we process the constructor's own args.
            for (const newExpr of this.event.file.parser.references.newExpressions) {
                const callExpr = newExpr.call;
                if (!callExpr.args.some(isNamedArgumentExpression)) {
                    continue;
                }
                // Only process constructor calls that belong to this function
                if (newExpr.findAncestor<FunctionExpression>(isFunctionExpression) !== func) {
                    continue;
                }

                const className = newExpr.className.getName(ParseMode.BrighterScript);
                const containingNamespace = newExpr.findAncestor<NamespaceStatement>(isNamespaceStatement)?.getName(ParseMode.BrighterScript)?.toLowerCase();
                const classLink = scope.getClassFileLink(className, containingNamespace);
                if (!classLink) {
                    continue;
                }

                const params = this.getClassConstructorParams(classLink.item, scope, containingNamespace);
                this.rewriteNamedArgCall(callExpr, params, func, hoistCounters);
            }
        }
    }

    /**
     * Rewrite a single named-argument call expression in place, hoisting complex arg expressions
     * into temp variables as needed to preserve written evaluation order.
     */
    private rewriteNamedArgCall(callExpr: CallExpression, params: FunctionParameterExpression[], func: FunctionExpression, hoistCounters: WeakMap<FunctionExpression, number>) {
        // Map each written arg to its positional param index and value.
        // If anything is invalid (unknown param, duplicate, positional-after-named),
        // bail out and leave the call untouched — diagnostics are already emitted by validation.
        const writtenArgInfos: WrittenArgInfo[] = [];
        const assignedParams = new Set<number>();
        let seenNamedArg = false;
        let isValid = true;
        let positionalCount = 0;

        for (const arg of callExpr.args) {
            if (!isNamedArgumentExpression(arg)) {
                if (seenNamedArg) {
                    isValid = false;
                    break;
                }
                const paramIdx = positionalCount++;
                if (paramIdx >= params.length || assignedParams.has(paramIdx)) {
                    isValid = false;
                    break;
                }
                assignedParams.add(paramIdx);
                writtenArgInfos.push({ paramIdx: paramIdx, value: arg });
            } else {
                seenNamedArg = true;
                const namedArg = arg as NamedArgumentExpression;
                const paramIdx = params.findIndex(p => p.name.text.toLowerCase() === namedArg.name.text.toLowerCase());
                if (paramIdx < 0 || assignedParams.has(paramIdx)) {
                    isValid = false;
                    break;
                }
                assignedParams.add(paramIdx);
                writtenArgInfos.push({ paramIdx: paramIdx, value: namedArg.value });
            }
        }

        if (!isValid) {
            return;
        }

        // Find the immediate containing statement and check if it lives directly inside a
        // Block or Body. If it does, we can safely insert hoisting assignments before it.
        // If not (e.g. an `else if` condition whose containing IfStatement is the elseBranch
        // of an outer IfStatement), we fall back to inline reordering without hoisting —
        // similar to how ternary falls back to `bslib_ternary()` when it can't restructure.
        const containingStatement = callExpr.findAncestor<Statement>(isStatement);
        const parentBlock = containingStatement?.parent;
        // Also prevent hoisting if the call is inside a ternary consequent or alternate —
        // hoisting before the containing statement would run the expression unconditionally,
        // breaking the ternary's conditional evaluation semantics.
        let insideTernaryBranch = false;
        {
            let child: typeof callExpr.parent = callExpr;
            let ancestor = callExpr.parent;
            while (ancestor && ancestor !== containingStatement) {
                if (isTernaryExpression(ancestor) && child !== ancestor.test) {
                    insideTernaryBranch = true;
                    break;
                }
                child = ancestor;
                ancestor = ancestor.parent;
            }
        }
        const canHoist = !!containingStatement && (isBlock(parentBlock) || isBody(parentBlock)) && !insideTernaryBranch;
        const parentStatements = canHoist ? (parentBlock as any).statements as Statement[] : undefined;

        // Find the last written index whose value is complex (needs hoisting).
        // Args written after this point are side-effect-free and can be placed directly.
        let lastComplexWrittenIdx = -1;
        for (let i = writtenArgInfos.length - 1; i >= 0; i--) {
            if (this.needsHoisting(writtenArgInfos[i].value)) {
                lastComplexWrittenIdx = i;
                break;
            }
        }

        // If we can't hoist AND there are complex expressions, wrap the call in an IIFE
        // so args are evaluated in written order but passed in positional order —
        // the same pattern ternary uses when it can't restructure the surrounding statement.
        if (!canHoist && lastComplexWrittenIdx >= 0) {
            this.event.editor.setProperty(callExpr, 'transpile', (state) => this.transpileNamedArgAsIIFE(state, callExpr, writtenArgInfos, params));
            return;
        }

        // Build the positional arg map, hoisting complex expressions when safe to do so
        const positionalArgExprs = new Map<number, Expression>();
        for (let writtenIdx = 0; writtenIdx < writtenArgInfos.length; writtenIdx++) {
            const { paramIdx, value } = writtenArgInfos[writtenIdx];

            if (canHoist && writtenIdx <= lastComplexWrittenIdx && this.needsHoisting(value)) {
                // Hoist: emit `__bsArgs<N> = <value>` before the containing statement
                const counter = hoistCounters.get(func) ?? 0;
                hoistCounters.set(func, counter + 1);
                const varName = `__bsArgs${counter}`;

                const currentStmtIdx = parentStatements.indexOf(containingStatement);
                const hoistStatement = createAssignmentStatement({ name: varName, value: value });
                this.event.editor.addToArray(parentStatements, currentStmtIdx, hoistStatement);
                // Update the value's parent to the new hoist statement so that when a nested
                // named-arg call inside `value` is processed (in reversed order), its
                // findAncestor<Statement> walks up to the hoist statement and inserts its own
                // hoisting before it — preserving written evaluation order across nesting levels.
                this.event.editor.setProperty(value, 'parent', hoistStatement);
                positionalArgExprs.set(paramIdx, createVariableExpression(varName));
            } else {
                // Cannot hoist (e.g. inside an else-if condition) — place the expression
                // directly in positional order. Evaluation order may differ from written
                // order for complex expressions, but the call only runs if the branch is
                // reached, which is the correct semantic (unlike hoisting before the outer if).
                positionalArgExprs.set(paramIdx, value);
            }
        }

        // Find the highest assigned positional index to know how many args to emit
        let lastProvidedIdx = -1;
        for (const idx of positionalArgExprs.keys()) {
            if (idx > lastProvidedIdx) {
                lastProvidedIdx = idx;
            }
        }

        // Build the final positional arg list, filling any skipped middle optional params
        const finalArgs: Expression[] = [];
        for (let i = 0; i <= lastProvidedIdx; i++) {
            if (positionalArgExprs.has(i)) {
                finalArgs.push(positionalArgExprs.get(i)!);
            } else {
                // Skipped optional param — use its default value or `invalid`
                finalArgs.push(params[i].defaultValue?.clone() ?? createInvalidLiteral());
            }
        }

        // Replace the call's args with the reordered positional list
        this.event.editor.arraySplice(callExpr.args, 0, callExpr.args.length, ...finalArgs);
    }

    /**
     * If the callee is a dotted-get expression whose leftmost identifier is a known namespace,
     * returns the BrightScript-flattened name (e.g. "MyNs_myFunc"). Otherwise returns undefined.
     */
    private getNamespaceCallableBrsName(callee: Expression, scope: Scope): string | undefined {
        const parts = util.getAllDottedGetParts(callee);
        if (!parts || !scope.namespaceLookup.has(parts[0].text.toLowerCase())) {
            return undefined;
        }
        return parts.map(p => p.text).join('_');
    }

    /**
     * Walk the class and its ancestor chain to find the first constructor's parameter list.
     * Returns an empty array if no constructor is defined anywhere in the hierarchy.
     */
    private getClassConstructorParams(classStmt: ClassStatement, scope: Scope, containingNamespace: string | undefined): FunctionParameterExpression[] {
        let stmt: ClassStatement | undefined = classStmt;
        while (stmt) {
            const ctor = stmt.body.find(
                s => (s as MethodStatement)?.name?.text?.toLowerCase() === 'new'
            ) as MethodStatement | undefined;
            if (ctor) {
                return ctor.func.parameters;
            }
            if (!stmt.parentClassName) {
                break;
            }
            const parentName = stmt.parentClassName.getName(ParseMode.BrighterScript);
            stmt = scope.getClassFileLink(parentName, containingNamespace)?.item;
        }
        return [];
    }

    /**
     * Builds the transpile output for a named-argument call that cannot be hoisted
     * (e.g. inside an `else if` condition). Wraps the call in an IIFE so args are
     * evaluated in written order but passed in positional order — the same pattern
     * ternary uses for complex consequent/alternate expressions.
     *
     *   (function(__bsArg0, __bsArg1)
     *       return funcName(__bsArgN, __bsArgM)
     *   end function)(writtenVal0, writtenVal1)
     */
    private transpileNamedArgAsIIFE(state: BrsTranspileState, callExpr: CallExpression, writtenArgInfos: WrittenArgInfo[], params: FunctionParameterExpression[]): TranspileResult {
        const result: TranspileResult = [];

        // One IIFE param per written arg, in written order: __bsArg0, __bsArg1, ...
        const iifeParamNames = writtenArgInfos.map((_, i) => `__bsArg${i}`);

        // Find the highest positional index that was provided
        let lastProvidedIdx = -1;
        for (const { paramIdx } of writtenArgInfos) {
            if (paramIdx > lastProvidedIdx) {
                lastProvidedIdx = paramIdx;
            }
        }

        // Map from positional param index → IIFE param name
        const paramIdxToIIFEParam = new Map<number, string>();
        for (let i = 0; i < writtenArgInfos.length; i++) {
            paramIdxToIIFEParam.set(writtenArgInfos[i].paramIdx, iifeParamNames[i]);
        }

        result.push(
            // (function(__bsArg0, __bsArg1)
            state.sourceNode(callExpr.openingParen, `(function(${iifeParamNames.join(', ')})`),
            state.newline,
            // double-indent so `end function)(` sits one level deeper than the call site,
            // matching the ternary IIFE convention
            state.indent(2),
            state.sourceNode(callExpr.callee, 'return '),
            ...callExpr.callee.transpile(state),
            '('
        );

        // Positional call args inside the IIFE body
        for (let i = 0; i <= lastProvidedIdx; i++) {
            if (i > 0) {
                result.push(', ');
            }
            if (paramIdxToIIFEParam.has(i)) {
                result.push(state.sourceNode(callExpr, paramIdxToIIFEParam.get(i)!));
            } else {
                // Skipped optional param — use its default or `invalid`
                const defaultVal = params[i].defaultValue;
                if (defaultVal) {
                    result.push(...defaultVal.transpile(state));
                } else {
                    result.push(state.sourceNode(callExpr, 'invalid'));
                }
            }
        }

        result.push(
            ')',
            state.newline,
            state.indent(-1),
            // end function)(writtenVal0, writtenVal1, ...)
            state.sourceNode(callExpr.closingParen ?? callExpr.openingParen, 'end function)(')
        );

        // Written-order values passed to the IIFE
        for (let i = 0; i < writtenArgInfos.length; i++) {
            if (i > 0) {
                result.push(', ');
            }
            result.push(...writtenArgInfos[i].value.transpile(state));
        }

        result.push(')');
        // compensate for the net +1 from indent(2) + indent(-1)
        state.blockDepth--;

        return result;
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
            if (isBlock(parent) || isBody(parent)) {
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
            //if this is an indexedSetStatement, and the ternary expression is NOT an index
        } else if (isIndexedSetStatement(parent) && parent.index !== ternaryExpression && !parent.additionalIndexes?.includes(ternaryExpression)) {
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
            const entityName = value.name.text.toLowerCase();

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
                    processedNames.push(part?.name?.text?.toLowerCase());
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
            let isCircular = false;

            //did we find a const? transpile the value
            let constStatement = scope?.getConstFileLink(entityName, containingNamespace)?.item;
            if (constStatement) {
                // Recursively resolve the const value to its final form
                const resolved = this.resolveConstValue(constStatement.value, scope, containingNamespace);
                value = resolved.value;
                isCircular = resolved.isCircular;
            } else {
                //did we find an enum member? transpile that
                let enumInfo = this.getEnumInfo(entityName, containingNamespace, scope);
                if (enumInfo?.value) {
                    value = enumInfo.value;
                }
            }

            if (value && !isCircular) {
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
