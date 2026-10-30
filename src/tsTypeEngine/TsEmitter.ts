import type { BrsFile } from '../files/BrsFile';
import type { Expression, Statement } from '../parser/AstNode';
import type { FunctionExpression, FunctionParameterExpression, TypeExpression, AALiteralExpression } from '../parser/Expression';
import type { ClassStatement, InterfaceStatement, EnumStatement, SelectCaseStatement, MethodStatement, FieldStatement } from '../parser/Statement';
import type { Token, Identifier } from '../lexer/Token';
import { TokenKind } from '../lexer/TokenKind';
import {
    isAALiteralExpression, isAAMemberExpression, isArrayLiteralExpression, isAssignmentStatement, isAugmentedAssignmentStatement,
    isBinaryExpression, isBlock, isCallExpression, isCallfuncExpression, isClassStatement, isConditionalCompileStatement, isConstStatement,
    isContinueStatement, isDimStatement, isDottedGetExpression, isDottedSetStatement, isEnumStatement, isExitStatement, isExpressionStatement,
    isFieldStatement, isForEachStatement, isForStatement, isFunctionExpression, isFunctionStatement, isGroupingExpression, isIfStatement,
    isIncrementStatement, isIndexedGetExpression, isIndexedSetStatement, isInlineInterfaceExpression, isInterfaceFieldStatement,
    isInterfaceMethodStatement, isInterfaceStatement, isLiteralExpression, isMethodStatement, isNamespaceStatement, isNewExpression,
    isNullCoalescingExpression, isPrintSeparatorExpression, isPrintStatement, isReturnStatement, isSelectCaseStatement, isSpreadExpression,
    isTaggedTemplateStringExpression, isTemplateStringExpression, isTernaryExpression, isThrowStatement, isTryCatchStatement, isTypeExpression,
    isTypeStatement, isTypecastExpression, isTypedArrayExpression, isTypedFunctionTypeExpression, isUnaryExpression, isVariableExpression,
    isWhileStatement, isTypeArgumentsExpression
} from '../astUtils/reflection';
import { createVisitor, WalkMode } from '../astUtils/visitors';
import { builtInTypeMap, tsName } from './naming';
import { util } from '../util';

/**
 * Links a span of the generated TypeScript back to the span of BrighterScript it came from
 */
export interface SourceMapping {
    genStart: number;
    genEnd: number;
    srcStart: number;
    srcEnd: number;
}

export interface EmitResult {
    text: string;
    /**
     * Sorted by `genStart`. Spans nest: an expression's mapping contains the mappings of its sub-expressions
     */
    mappings: SourceMapping[];
    /**
     * Lower-cased TypeScript name -> the casing used where the name was declared, for restoring names in messages
     */
    names: Map<string, string>;
}

interface EmitContext {
    /**
     * Inside a namespace, so declarations need `export` to be visible as `Namespace.member`
     */
    inNamespace?: boolean;
    /**
     * Inside a class method (but not a function nested within one), where `m` is the instance
     */
    inClassMethod?: boolean;
}

const arithmeticOperators = new Set([
    TokenKind.Minus, TokenKind.Star, TokenKind.Forwardslash, TokenKind.Backslash, TokenKind.Mod, TokenKind.Caret, TokenKind.LeftShift, TokenKind.RightShift
]);
const comparisonOperators = new Set([TokenKind.Less, TokenKind.LessEqual, TokenKind.Greater, TokenKind.GreaterEqual]);
const augmentedOperators = new Map<TokenKind, TokenKind>([
    [TokenKind.PlusEqual, TokenKind.Plus],
    [TokenKind.MinusEqual, TokenKind.Minus],
    [TokenKind.StarEqual, TokenKind.Star],
    [TokenKind.ForwardslashEqual, TokenKind.Forwardslash],
    [TokenKind.BackslashEqual, TokenKind.Backslash],
    [TokenKind.LeftShiftEqual, TokenKind.LeftShift],
    [TokenKind.RightShiftEqual, TokenKind.RightShift]
]);

/**
 * Lowers a BrsFile into TypeScript that is only ever type-checked, never run. The output is a script (not a module),
 * so declarations from every file in a scope share one global namespace, the same way BrightScript does.
 *
 * The lowering leans on a few TypeScript features to get BrightScript semantics:
 * - locals are declared up front as `let x;` with no type, which makes TypeScript track their type through control flow
 *   ("evolving let"), matching BrightScript variables that change type on reassignment
 * - operators become calls to generic helpers declared in the prelude, so `"a" + 1` is an error like it is in BrightScript
 * - `=`/`<>` become `==`/`!=`, so `if x <> invalid` narrows `x`
 */
export class TsEmitter {
    constructor(
        private file: BrsFile
    ) { }

    private text = '';
    private mappings: SourceMapping[] = [];
    private names = new Map<string, string>();

    public emit(): EmitResult {
        this.write(`// generated from ${this.file.destPath}\n`);
        this.emitDeclarations(this.file.ast.statements, {});
        this.mappings.sort((a, b) => a.genStart - b.genStart || b.genEnd - a.genEnd);
        return {
            text: this.text,
            mappings: this.mappings,
            names: this.names
        };
    }

    private write(text: string) {
        this.text += text;
    }

    /**
     * Record that whatever `callback` writes came from `node`
     */
    private mapped(node: { startPosition?: number; endPosition?: number }, callback: () => void) {
        const genStart = this.text.length;
        callback();
        if (node && typeof node.startPosition === 'number' && typeof node.endPosition === 'number') {
            this.mappings.push({
                genStart: genStart,
                genEnd: this.text.length,
                srcStart: node.startPosition,
                srcEnd: node.endPosition
            });
        }
    }

    private writeName(token: Token, override?: string) {
        if (!token) {
            this.write('$unknown');
            return;
        }
        const name = override ?? tsName(token.text);
        if (!this.names.has(name)) {
            this.names.set(name, token.text);
        }
        this.mapped(token, () => this.write(name));
    }

    private exportKeyword(ctx: EmitContext) {
        return ctx.inNamespace ? 'export ' : '';
    }

    // ----- declarations -----

    private emitDeclarations(statements: Statement[], ctx: EmitContext) {
        for (const statement of statements) {
            if (isFunctionStatement(statement)) {
                this.write(`${this.exportKeyword(ctx)}function `);
                this.writeName(statement.tokens.name);
                this.emitFunctionSignatureAndBody(statement.func, ctx, {});
                this.write('\n');
            } else if (isNamespaceStatement(statement)) {
                const parts = util.getAllDottedGetParts(statement.nameExpression) ?? [];
                this.write(`${this.exportKeyword(ctx)}namespace `);
                parts.forEach((part, i) => {
                    if (i > 0) {
                        this.write('.');
                    }
                    this.writeName(part);
                });
                this.write(' {\n');
                this.emitDeclarations(statement.body.statements, { ...ctx, inNamespace: true });
                this.write('}\n');
            } else if (isClassStatement(statement)) {
                this.emitClass(statement, ctx);
            } else if (isInterfaceStatement(statement)) {
                this.emitInterface(statement, ctx);
            } else if (isEnumStatement(statement)) {
                this.emitEnum(statement, ctx);
            } else if (isConstStatement(statement)) {
                this.mapped(statement, () => {
                    this.write(`${this.exportKeyword(ctx)}const `);
                    this.writeName(statement.tokens.name);
                    this.write(' = ');
                    this.emitExpression(statement.value, ctx);
                    this.write(';');
                });
                this.write('\n');
            } else if (isTypeStatement(statement)) {
                this.write(`${this.exportKeyword(ctx)}type `);
                this.writeName(statement.tokens.name);
                this.write(' = ');
                this.emitType(statement.value);
                this.write(';\n');
            } else if (isConditionalCompileStatement(statement)) {
                //check every branch, not just the active one
                this.emitDeclarations(statement.thenBranch?.statements ?? [], ctx);
                const elseBranch = statement.elseBranch;
                if (elseBranch) {
                    this.emitDeclarations(isBlock(elseBranch) ? elseBranch.statements : [elseBranch], ctx);
                }
            }
            //imports, library statements, comments etc. have nothing to type-check
        }
    }

    private emitTypeParameters(typeParameters: Identifier[]) {
        if (typeParameters?.length > 0) {
            this.write('<');
            typeParameters.forEach((param, i) => {
                if (i > 0) {
                    this.write(', ');
                }
                this.writeName(param);
            });
            this.write('>');
        }
    }

    private emitClass(statement: ClassStatement, ctx: EmitContext) {
        this.write(`${this.exportKeyword(ctx)}class `);
        this.writeName(statement.tokens.name);
        this.emitTypeParameters(statement.typeParameters);
        if (statement.parentClassName) {
            this.write(' extends ');
            this.emitType(statement.parentClassName);
        }
        this.write(' {\n');
        for (const member of statement.body) {
            if (isFieldStatement(member)) {
                this.emitField(member);
            } else if (isMethodStatement(member)) {
                this.emitMethod(member, ctx);
            }
        }
        this.write('}\n');
    }

    private emitField(field: FieldStatement) {
        this.mapped(field, () => {
            this.write('    ');
            const access = field.tokens.accessModifier?.text?.toLowerCase();
            if (access && access !== 'public') {
                this.write(`${access} `);
            }
            this.writeName(field.tokens.name);
            if (field.tokens.optional) {
                this.write('?');
            }
            if (field.typeExpression) {
                this.write(': ');
                this.emitType(field.typeExpression);
            } else if (!field.initialValue) {
                this.write(': any');
            }
            if (field.initialValue) {
                this.write(' = ');
                this.emitExpression(field.initialValue, {});
            }
            this.write(';');
        });
        this.write('\n');
    }

    private emitMethod(method: MethodStatement, ctx: EmitContext) {
        this.write('    ');
        for (const modifier of method.modifiers ?? []) {
            const text = modifier.text.toLowerCase();
            if (text !== 'public') {
                this.write(`${text} `);
            }
        }
        const isConstructor = method.tokens.name.text.toLowerCase() === 'new';
        if (method.tokens.override) {
            this.write('override ');
        }
        if (isConstructor) {
            this.writeName(method.tokens.name, 'constructor');
        } else {
            this.writeName(method.tokens.name);
        }
        this.emitFunctionSignatureAndBody(method.func, { ...ctx, inClassMethod: true }, { isConstructor: isConstructor });
        this.write('\n');
    }

    private emitInterface(statement: InterfaceStatement, ctx: EmitContext) {
        this.write(`${this.exportKeyword(ctx)}interface `);
        this.writeName(statement.tokens.name);
        this.emitTypeParameters(statement.typeParameters);
        if (statement.parentInterfaceName) {
            this.write(' extends ');
            this.emitType(statement.parentInterfaceName);
        }
        this.write(' {\n');
        for (const member of statement.body) {
            if (isInterfaceFieldStatement(member)) {
                this.mapped(member, () => {
                    this.write('    ');
                    this.writeName(member.tokens.name);
                    this.write(member.tokens.optional ? '?: ' : ': ');
                    this.emitTypeOrAny(member.typeExpression);
                    this.write(';');
                });
                this.write('\n');
            } else if (isInterfaceMethodStatement(member)) {
                this.mapped(member, () => {
                    this.write('    ');
                    this.writeName(member.tokens.name);
                    if (member.tokens.optional) {
                        this.write('?');
                    }
                    this.emitParameters(member.params, {});
                    this.write(': ');
                    this.emitReturnType(member.returnTypeExpression, member.tokens.functionType);
                    this.write(';');
                });
                this.write('\n');
            }
        }
        this.write('}\n');
    }

    private emitEnum(statement: EnumStatement, ctx: EmitContext) {
        this.write(`${this.exportKeyword(ctx)}enum `);
        this.writeName(statement.tokens.name);
        this.write(' {\n');
        for (const member of statement.body) {
            this.write('    ');
            this.writeName(member.tokens.name);
            if (member.value) {
                this.write(' = ');
                this.emitExpression(member.value, {});
            }
            this.write(',\n');
        }
        this.write('}\n');
    }

    // ----- functions -----

    private emitParameters(params: FunctionParameterExpression[], ctx: EmitContext) {
        this.write('(');
        params.forEach((param, i) => {
            if (i > 0) {
                this.write(', ');
            }
            this.mapped(param, () => {
                this.writeName(param.tokens.name);
                if (param.typeExpression) {
                    this.write(': ');
                    this.emitType(param.typeExpression);
                } else if (!param.defaultValue) {
                    this.write(': any');
                }
                if (param.defaultValue) {
                    this.write(' = ');
                    this.emitExpression(param.defaultValue, ctx);
                }
            });
        });
        this.write(')');
    }

    private emitReturnType(returnTypeExpression: TypeExpression, functionType: Token) {
        if (returnTypeExpression) {
            this.emitType(returnTypeExpression);
        } else if (functionType?.kind === TokenKind.Sub) {
            this.write('void');
        } else {
            this.write('any');
        }
    }

    private emitFunctionSignatureAndBody(func: FunctionExpression, ctx: EmitContext, options: { isConstructor?: boolean; isExpression?: boolean }) {
        this.emitTypeParameters(func.typeParameters);
        if (options.isExpression) {
            //anonymous functions don't get the class instance as `m`
            ctx = { ...ctx, inClassMethod: false };
        }
        this.emitParameters(func.parameters, ctx);
        if (!options.isConstructor) {
            this.write(': ');
            this.emitReturnType(func.returnTypeExpression, func.tokens.functionType);
        }
        this.write(' {\n');
        this.emitLocalDeclarations(func);
        this.emitStatements(func.body?.statements ?? [], ctx);
        this.write('}');
    }

    /**
     * BrightScript variables are function-scoped and declared by assignment, so hoist them all to the top of the function.
     * Untyped ones are declared with no type at all, so TypeScript infers their type from each assignment (control flow analysis)
     */
    private emitLocalDeclarations(func: FunctionExpression) {
        const paramNames = new Set(func.parameters.map(x => tsName(x.tokens.name.text)));
        const locals = new Map<string, TypeExpression>();
        const addLocal = (token: Token, typeExpression?: TypeExpression) => {
            if (!token) {
                return;
            }
            const name = tsName(token.text);
            if (paramNames.has(name) || name === 'm') {
                return;
            }
            if (!locals.has(name) || typeExpression) {
                locals.set(name, typeExpression ?? locals.get(name));
            }
            if (!this.names.has(name)) {
                this.names.set(name, token.text);
            }
        };
        func.body?.walk(createVisitor({
            AssignmentStatement: (statement) => {
                addLocal(statement.tokens.name, statement.typeExpression);
            },
            ForEachStatement: (statement) => {
                addLocal(statement.tokens.item, statement.typeExpression);
            },
            DimStatement: (statement) => {
                addLocal(statement.tokens.name);
            }
        }), {
            walkMode: WalkMode.visitStatements
        });
        if (locals.size === 0) {
            return;
        }
        const declarations = [...locals].map(([name, typeExpression]) => ({ name: name, typeExpression: typeExpression }));
        this.write('    let ');
        declarations.forEach((declaration, i) => {
            if (i > 0) {
                this.write(', ');
            }
            this.write(declaration.name);
            if (declaration.typeExpression) {
                this.write(': ');
                this.emitType(declaration.typeExpression);
            }
        });
        this.write(';\n');
    }

    // ----- statements -----

    private emitStatements(statements: Statement[], ctx: EmitContext) {
        for (const statement of statements) {
            this.emitStatement(statement, ctx);
        }
    }

    private emitBlock(statements: Statement[], ctx: EmitContext) {
        this.write('{\n');
        this.emitStatements(statements ?? [], ctx);
        this.write('}');
    }

    private emitStatement(statement: Statement, ctx: EmitContext) {
        this.mapped(statement, () => {
            this.emitStatementInner(statement, ctx);
        });
        this.write('\n');
    }

    private emitStatementInner(statement: Statement, ctx: EmitContext) {
        if (isAssignmentStatement(statement)) {
            this.writeName(statement.tokens.name);
            this.write(' = ');
            this.emitExpression(statement.value, ctx);
            this.write(';');

        } else if (isAugmentedAssignmentStatement(statement)) {
            this.emitExpression(statement.item, ctx);
            this.write(' = ');
            this.emitOperator(augmentedOperators.get(statement.tokens.operator?.kind), statement.item, statement.value, ctx);
            this.write(';');

        } else if (isExpressionStatement(statement)) {
            this.emitExpression(statement.expression, ctx);
            this.write(';');

        } else if (isIncrementStatement(statement)) {
            this.emitExpression(statement.value, ctx);
            this.write(statement.tokens.operator?.kind === TokenKind.MinusMinus ? '--;' : '++;');

        } else if (isDottedSetStatement(statement)) {
            this.emitExpression(statement.obj, ctx);
            this.write('.');
            this.writeName(statement.tokens.name);
            this.write(' = ');
            this.emitExpression(statement.value, ctx);
            this.write(';');

        } else if (isIndexedSetStatement(statement)) {
            this.emitExpression(statement.obj, ctx);
            for (const index of statement.indexes) {
                this.write('[');
                this.emitExpression(index, ctx);
                this.write(']');
            }
            this.write(' = ');
            this.emitExpression(statement.value, ctx);
            this.write(';');

        } else if (isIfStatement(statement)) {
            this.write('if (');
            this.emitExpression(statement.condition, ctx);
            this.write(') ');
            this.emitBlock(statement.thenBranch?.statements, ctx);
            if (statement.elseBranch) {
                this.write(' else ');
                if (isIfStatement(statement.elseBranch)) {
                    this.emitStatementInner(statement.elseBranch, ctx);
                } else {
                    this.emitBlock(statement.elseBranch.statements, ctx);
                }
            }

        } else if (isForStatement(statement)) {
            this.write('for (');
            const counter = statement.counterDeclaration;
            if (counter) {
                this.writeName(counter.tokens.name);
                this.write(' = ');
                this.emitExpression(counter.value, ctx);
            }
            this.write('; $forCondition(');
            this.emitExpression(statement.finalValue, ctx);
            if (statement.increment) {
                this.write(', ');
                this.emitExpression(statement.increment, ctx);
            }
            this.write('); ) ');
            this.emitBlock(statement.body?.statements, ctx);

        } else if (isForEachStatement(statement)) {
            this.write('for (');
            this.writeName(statement.tokens.item);
            this.write(' of $iterate(');
            this.emitExpression(statement.target, ctx);
            this.write(')) ');
            this.emitBlock(statement.body?.statements, ctx);

        } else if (isWhileStatement(statement)) {
            this.write('while (');
            this.emitExpression(statement.condition, ctx);
            this.write(') ');
            this.emitBlock(statement.body?.statements, ctx);

        } else if (isExitStatement(statement)) {
            this.write('break;');

        } else if (isContinueStatement(statement)) {
            this.write('continue;');

        } else if (isReturnStatement(statement)) {
            this.write('return');
            if (statement.value) {
                this.write(' ');
                this.emitExpression(statement.value, ctx);
            }
            this.write(';');

        } else if (isPrintStatement(statement)) {
            this.write('$template(');
            const expressions = statement.expressions.filter(x => !isPrintSeparatorExpression(x));
            expressions.forEach((expression, i) => {
                if (i > 0) {
                    this.write(', ');
                }
                this.emitExpression(expression, ctx);
            });
            this.write(');');

        } else if (isDimStatement(statement)) {
            this.writeName(statement.tokens.name);
            this.write(' = [] as any[];');

        } else if (isTryCatchStatement(statement)) {
            this.write('try ');
            this.emitBlock(statement.tryBranch?.statements, ctx);
            this.write(' catch (');
            const exceptionVariable = statement.catchStatement?.exceptionVariableExpression;
            if (isVariableExpression(exceptionVariable)) {
                this.writeName(exceptionVariable.tokens.name);
            } else {
                this.write('$e');
            }
            this.write(') ');
            this.emitBlock(statement.catchStatement?.catchBranch?.statements, ctx);

        } else if (isThrowStatement(statement)) {
            this.write('throw ');
            this.emitExpression(statement.expression, ctx);
            this.write(';');

        } else if (isSelectCaseStatement(statement)) {
            this.emitSelectCase(statement, ctx);

        } else if (isConditionalCompileStatement(statement)) {
            this.emitBlock(statement.thenBranch?.statements, ctx);
            if (statement.elseBranch) {
                this.emitStatementInner(statement.elseBranch as Statement, ctx);
            }

        } else if (isBlock(statement)) {
            this.emitBlock(statement.statements, ctx);

        } else {
            //goto, labels, end, stop, typecast, alias, #const, comments: nothing to check
            this.write(';');
        }
    }

    private emitSelectCase(statement: SelectCaseStatement, ctx: EmitContext) {
        this.write('switch (');
        if (statement.subject) {
            this.emitExpression(statement.subject, ctx);
        } else {
            this.write('true');
        }
        this.write(') {\n');
        for (const caseStatement of statement.cases) {
            if (caseStatement.tokens.else) {
                this.write('default:\n');
            }
            for (const value of caseStatement.values ?? []) {
                this.write('case ');
                this.emitExpression(value, ctx);
                this.write(':\n');
            }
            this.emitBlock(caseStatement.body?.statements, ctx);
            this.write('\nbreak;\n');
        }
        this.write('}');
    }

    // ----- expressions -----

    private emitOperator(operator: TokenKind, left: Expression, right: Expression, ctx: EmitContext) {
        let helper: string;
        let infix: string;
        if (operator === TokenKind.Plus) {
            helper = '$add';
        } else if (arithmeticOperators.has(operator)) {
            helper = '$arith';
        } else if (comparisonOperators.has(operator)) {
            helper = '$compare';
        } else if (operator === TokenKind.Equal) {
            //loose equality, so comparing with `invalid` narrows away both `null` (invalid) and `undefined` (missing optional members)
            infix = ' == ';
        } else if (operator === TokenKind.LessGreater) {
            infix = ' != ';
        } else if (operator === TokenKind.And) {
            infix = ' && ';
        } else if (operator === TokenKind.Or) {
            infix = ' || ';
        } else {
            helper = '$arith';
        }
        if (helper) {
            this.write(`${helper}(`);
            this.emitExpression(left, ctx);
            this.write(', ');
            this.emitExpression(right, ctx);
            this.write(')');
        } else {
            this.write('(');
            this.emitExpression(left, ctx);
            this.write(infix);
            this.emitExpression(right, ctx);
            this.write(')');
        }
    }

    private emitArguments(args: Expression[], ctx: EmitContext) {
        args.forEach((arg, i) => {
            if (i > 0) {
                this.write(', ');
            }
            this.emitExpression(arg, ctx);
        });
    }

    private emitExpression(expression: Expression, ctx: EmitContext) {
        if (!expression) {
            this.write('$unknown');
            return;
        }
        this.mapped(expression, () => {
            this.emitExpressionInner(expression, ctx);
        });
    }

    private emitExpressionInner(expression: Expression, ctx: EmitContext) {
        if (isBinaryExpression(expression)) {
            this.emitOperator(expression.tokens.operator.kind, expression.left, expression.right, ctx);

        } else if (isUnaryExpression(expression)) {
            const operator = expression.tokens.operator.kind;
            if (operator === TokenKind.Not) {
                this.write('!');
                this.emitExpression(expression.right, ctx);
            } else if (operator === TokenKind.Minus && isLiteralExpression(expression.right)) {
                this.write('-');
                this.emitExpression(expression.right, ctx);
            } else if (operator === TokenKind.Minus) {
                this.write('$negate(');
                this.emitExpression(expression.right, ctx);
                this.write(')');
            } else {
                this.emitExpression(expression.right, ctx);
            }

        } else if (isVariableExpression(expression)) {
            const name = tsName(expression.tokens.name.text);
            if (name === 'm' && ctx.inClassMethod) {
                this.writeName(expression.tokens.name, 'this');
            } else if (name === 'super$$') {
                this.writeName(expression.tokens.name, 'super');
            } else {
                this.writeName(expression.tokens.name);
            }

        } else if (isLiteralExpression(expression)) {
            this.emitLiteral(expression.tokens.value);

        } else if (isCallExpression(expression)) {
            this.emitExpression(expression.callee, ctx);
            this.write('(');
            const isCreateObject = isVariableExpression(expression.callee) && expression.callee.tokens.name.text.toLowerCase() === 'createobject';
            if (isCreateObject) {
                //component names are case-insensitive, and the prelude keys components by their lower-cased name
                expression.args.forEach((arg, i) => {
                    if (i > 0) {
                        this.write(', ');
                    }
                    if (i < 2 && isLiteralExpression(arg) && arg.tokens.value.kind === TokenKind.StringLiteral) {
                        this.mapped(arg, () => this.write(JSON.stringify(this.getStringValue(arg.tokens.value).toLowerCase())));
                    } else {
                        this.emitExpression(arg, ctx);
                    }
                });
            } else {
                this.emitArguments(expression.args, ctx);
            }
            this.write(')');

        } else if (isDottedGetExpression(expression)) {
            this.emitExpression(expression.obj, ctx);
            this.write(expression.tokens.dot?.kind === TokenKind.QuestionDot ? '?.' : '.');
            this.writeName(expression.tokens.name);

        } else if (isIndexedGetExpression(expression)) {
            this.emitExpression(expression.obj, ctx);
            if (expression.tokens.questionDot) {
                this.write('?.');
            }
            for (const index of expression.indexes) {
                this.write('[');
                this.emitExpression(index, ctx);
                this.write(']');
            }

        } else if (isGroupingExpression(expression)) {
            this.write('(');
            this.emitExpression(expression.expression, ctx);
            this.write(')');

        } else if (isFunctionExpression(expression)) {
            this.write('(function ');
            this.emitFunctionSignatureAndBody(expression, ctx, { isExpression: true });
            this.write(')');

        } else if (isArrayLiteralExpression(expression)) {
            this.write('[');
            this.emitArguments(expression.elements, ctx);
            this.write(']');

        } else if (isAALiteralExpression(expression)) {
            this.emitAALiteral(expression, ctx);

        } else if (isSpreadExpression(expression)) {
            this.write('...');
            this.emitExpression(expression.expression, ctx);

        } else if (isNewExpression(expression)) {
            this.write('new ');
            this.emitExpression(expression.call.callee, ctx);
            if (expression.typeArguments?.length > 0) {
                this.write('<');
                expression.typeArguments.forEach((arg, i) => {
                    if (i > 0) {
                        this.write(', ');
                    }
                    this.emitType(arg);
                });
                this.write('>');
            }
            this.write('(');
            this.emitArguments(expression.call.args, ctx);
            this.write(')');

        } else if (isCallfuncExpression(expression)) {
            this.write('$callfunc(');
            this.emitExpression(expression.callee, ctx);
            this.write(`, ${JSON.stringify(expression.tokens.methodName?.text ?? '')}`);
            for (const arg of expression.args) {
                this.write(', ');
                this.emitExpression(arg, ctx);
            }
            this.write(')');

        } else if (isTemplateStringExpression(expression)) {
            this.write('$template(');
            this.emitArguments(expression.expressions, ctx);
            this.write(')');

        } else if (isTaggedTemplateStringExpression(expression)) {
            this.writeName(expression.tokens.tagName);
            this.write('([] as string[], [');
            this.emitArguments(expression.expressions, ctx);
            this.write('])');

        } else if (isTernaryExpression(expression)) {
            this.write('(');
            this.emitExpression(expression.test, ctx);
            this.write(' ? ');
            this.emitExpression(expression.consequent, ctx);
            this.write(' : ');
            this.emitExpression(expression.alternate, ctx);
            this.write(')');

        } else if (isNullCoalescingExpression(expression)) {
            this.write('(');
            this.emitExpression(expression.consequent, ctx);
            this.write(' ?? ');
            this.emitExpression(expression.alternate, ctx);
            this.write(')');

        } else if (isTypecastExpression(expression)) {
            this.write('(');
            this.emitExpression(expression.obj, ctx);
            this.write(' as any as ');
            this.emitTypeOrAny(expression.typeExpression);
            this.write(')');

        } else if (expression.kind === 'RegexLiteralExpression' as any) {
            this.write(`createobject("roregex", "", "")`);

        } else {
            //source literals (LINE_NUM, etc), xml attribute access, escaped char codes...
            this.write('$unknown');
        }
    }

    private emitAALiteral(expression: AALiteralExpression, ctx: EmitContext) {
        this.write('$aa({');
        expression.elements.forEach((element, i) => {
            if (i > 0) {
                this.write(', ');
            }
            if (isAAMemberExpression(element)) {
                //associative array keys are case-insensitive
                const key = element.tokens.key;
                if (key.kind === TokenKind.StringLiteral) {
                    this.mapped(key, () => this.write(JSON.stringify(this.getStringValue(key).toLowerCase())));
                } else {
                    this.writeName(key);
                }
                this.write(': ');
                this.emitExpression(element.value, ctx);
            } else if (isSpreadExpression(element)) {
                this.emitExpression(element, ctx);
            } else {
                this.write('[');
                this.emitExpression(element.key, ctx);
                this.write(']: ');
                this.emitExpression(element.value, ctx);
            }
        });
        this.write('})');
    }

    private getStringValue(token: Token) {
        //strip the surrounding quotes and un-double any escaped quotes
        return token.text.replace(/^"|"$/g, '').replace(/""/g, '"');
    }

    private emitLiteral(token: Token) {
        this.mapped(token, () => {
            switch (token.kind) {
                case TokenKind.StringLiteral:
                    this.write(JSON.stringify(this.getStringValue(token)));
                    break;
                case TokenKind.True:
                    this.write('true');
                    break;
                case TokenKind.False:
                    this.write('false');
                    break;
                case TokenKind.Invalid:
                    this.write('null');
                    break;
                case TokenKind.IntegerLiteral:
                case TokenKind.LongIntegerLiteral:
                case TokenKind.FloatLiteral:
                case TokenKind.DoubleLiteral:
                    //parenthesized so member access works (`&hFF.toStr()` -> `(255).tostr()`)
                    this.write(`(${this.getNumberValue(token.text)})`);
                    break;
                default:
                    this.write('$unknown');
            }
        });
    }

    private getNumberValue(text: string) {
        let value: number;
        if (/^&h/i.test(text)) {
            value = parseInt(text.substring(2).replace(/&$/, ''), 16);
        } else {
            value = parseFloat(text.replace(/[!#&%]$/, '').replace(/d/i, 'e'));
        }
        return isNaN(value) ? 0 : value;
    }

    // ----- types -----

    private emitTypeOrAny(typeExpression: TypeExpression) {
        if (typeExpression) {
            this.emitType(typeExpression);
        } else {
            this.write('any');
        }
    }

    private emitType(node: Expression) {
        if (!node) {
            this.write('any');
            return;
        }
        this.mapped(node, () => {
            this.emitTypeInner(node);
        });
    }

    private emitTypeInner(node: Expression) {
        if (isTypeExpression(node)) {
            this.emitType(node.expression);

        } else if (isVariableExpression(node)) {
            const lower = node.tokens.name.text.toLowerCase();
            const builtIn = builtInTypeMap.get(lower);
            if (builtIn) {
                this.write(builtIn);
            } else {
                this.writeName(node.tokens.name);
            }

        } else if (isDottedGetExpression(node)) {
            const parts = util.getAllDottedGetParts(node) ?? [];
            parts.forEach((part, i) => {
                if (i > 0) {
                    this.write('.');
                }
                this.writeName(part);
            });

        } else if (isTypedArrayExpression(node)) {
            this.write('(');
            this.emitType(node.innerType);
            this.write(')[]');

        } else if (isTypeArgumentsExpression(node)) {
            this.emitType(node.typeName);
            this.write('<');
            node.typeArguments.forEach((arg, i) => {
                if (i > 0) {
                    this.write(', ');
                }
                this.emitType(arg);
            });
            this.write('>');

        } else if (isBinaryExpression(node)) {
            this.write('(');
            this.emitType(node.left);
            this.write(node.tokens.operator.kind === TokenKind.And ? ' & ' : ' | ');
            this.emitType(node.right);
            this.write(')');

        } else if (isGroupingExpression(node)) {
            this.write('(');
            this.emitType(node.expression);
            this.write(')');

        } else if (isInlineInterfaceExpression(node)) {
            this.write('{ ');
            for (const member of node.members) {
                const name = member.tokens.name;
                if (name.kind === TokenKind.StringLiteral) {
                    this.write(JSON.stringify(this.getStringValue(name).toLowerCase()));
                } else {
                    this.writeName(name);
                }
                this.write(member.tokens.optional ? '?: ' : ': ');
                this.emitTypeOrAny(member.typeExpression);
                this.write('; ');
            }
            this.write('}');

        } else if (isTypedFunctionTypeExpression(node)) {
            this.write('(');
            this.emitParameters(node.params, {});
            this.write(' => ');
            this.emitReturnType(node.returnType, node.tokens.functionType);
            this.write(')');

        } else {
            this.write('any');
        }
    }
}

