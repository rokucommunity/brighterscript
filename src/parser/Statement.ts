/* eslint-disable no-bitwise */
import type { Token, Identifier } from '../lexer/Token';
import { CompoundAssignmentOperators, TokenKind } from '../lexer/TokenKind';
import type { BinaryExpression, DottedGetExpression, FunctionExpression, FunctionParameterExpression, LiteralExpression, TypeExpression } from './Expression';
import { CallExpression, VariableExpression } from './Expression';
import { util } from '../util';
import type { Range } from 'vscode-languageserver';
import type { BrsTranspileState } from './BrsTranspileState';
import { ParseMode } from './Parser';
import type { WalkVisitor, WalkOptions } from '../astUtils/visitors';
import { InternalWalkMode, walk, createVisitor, WalkMode, walkArray } from '../astUtils/visitors';
import { isCallExpression, isEnumMemberStatement, isExpression, isExpressionStatement, isFieldStatement, isFunctionStatement, isIfStatement, isInterfaceFieldStatement, isInterfaceMethodStatement, isInvalidType, isLiteralExpression, isMethodStatement, isNamespaceStatement, isTypedefProvider, isUnaryExpression, isVoidType } from '../astUtils/reflection';
import type { GetTypeOptions, TranspileResult, TypedefProvider } from '../interfaces';
import { TypeChainEntry } from '../interfaces';
import { SymbolTypeFlag } from '../SymbolTableFlag';
import { createInvalidLiteral, createMethodStatement, createToken, interpolatedRange } from '../astUtils/creators';
import { DynamicType } from '../types/DynamicType';
import type { SourceNode } from 'source-map';
import { SymbolTable } from '../SymbolTable';
import type { Expression } from './AstNode';
import { AstNodeKind } from './AstNode';
import { Statement } from './AstNode';
import { ClassType } from '../types/ClassType';
import { EnumMemberType, EnumType } from '../types/EnumType';
import { NamespaceType } from '../types/NamespaceType';
import { InterfaceType } from '../types/InterfaceType';
import type { BscType } from '../types/BscType';
import { VoidType } from '../types/VoidType';
import { TypedFunctionType } from '../types/TypedFunctionType';
import { ArrayType } from '../types/ArrayType';

export class EmptyStatement extends Statement {
    constructor(options?: { range?: Range }
    ) {
        super();
        this.range = options?.range ?? interpolatedRange;
    }
    /**
     * Create a negative range to indicate this is an interpolated location
     */
    public readonly range: Range;

    public readonly kind = AstNodeKind.EmptyStatement;

    transpile(state: BrsTranspileState) {
        return [];
    }
    walk(visitor: WalkVisitor, options: WalkOptions) {
        //nothing to walk
    }
}

/**
 * This is a top-level statement. Consider this the root of the AST
 */
export class Body extends Statement implements TypedefProvider {
    constructor(options?: {
        statements?: Statement[];
    }) {
        super();
        this.statements = options?.statements ?? [];
    }

    public readonly statements: Statement[] = [];
    public readonly kind = AstNodeKind.Body;

    public readonly symbolTable = new SymbolTable('Body', () => this.parent?.getSymbolTable());

    public get range() {
        //this needs to be a getter because the body has its statements pushed to it after being constructed
        return util.createBoundingRange(
            ...(this.statements ?? [])
        );
    }

    transpile(state: BrsTranspileState) {
        let result = [] as TranspileResult;
        for (let i = 0; i < this.statements.length; i++) {
            let statement = this.statements[i];
            let previousStatement = this.statements[i - 1];
            let nextStatement = this.statements[i + 1];

            if (!previousStatement) {
                //this is the first statement. do nothing related to spacing and newlines

                //if comment is on same line as prior sibling
            } else if (util.hasLeadingComments(statement) && previousStatement && util.getLeadingComments(statement)?.[0]?.range.start.line === previousStatement.range.end.line) {
                result.push(
                    ' '
                );
                //add double newline if this is a comment, and next is a function
            } else if (util.hasLeadingComments(statement) && nextStatement && isFunctionStatement(nextStatement)) {
                result.push('\n\n');

                //add double newline if is function not preceeded by a comment
            } else if (isFunctionStatement(statement) && previousStatement && !util.hasLeadingComments(statement)) {
                result.push('\n\n');
            } else {
                //separate statements by a single newline
                result.push('\n');
            }

            result.push(...statement.transpile(state));
        }
        return result;
    }

    getTypedef(state: BrsTranspileState) {
        let result = [];
        for (const statement of this.statements) {
            //if the current statement supports generating typedef, call it
            if (isTypedefProvider(statement)) {
                result.push(
                    state.indent(),
                    ...statement.getTypedef(state),
                    state.newline
                );
            }
        }
        return result;
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkStatements) {
            walkArray(this.statements, visitor, options, this);
        }
    }
}

export class AssignmentStatement extends Statement {
    constructor(options: {
        name: Identifier;
        equals?: Token;
        value: Expression;
        as?: Token;
        typeExpression?: TypeExpression;
    }) {
        super();
        this.value = options.value;
        this.tokens = {
            equals: options.equals,
            name: options.name,
            as: options.as
        };
        this.typeExpression = options.typeExpression;
        this.range = util.createBoundingRange(util.createBoundingRangeFromTokens(this.tokens), this.value);
    }

    public readonly tokens: {
        readonly equals?: Token;
        readonly name: Identifier;
        readonly as?: Token;
    };

    public readonly value: Expression;

    public readonly typeExpression: TypeExpression;

    public readonly kind = AstNodeKind.AssignmentStatement;

    public readonly range: Range;

    transpile(state: BrsTranspileState) {
        //if the value is a compound assignment, just transpile the expression itself
        if (CompoundAssignmentOperators.includes((this.value as BinaryExpression)?.tokens?.operator?.kind)) {
            return this.value.transpile(state);
        } else {
            return [
                ...state.transpileToken(this.tokens.name),
                ' ',
                ...state.transpileToken(this.tokens.equals ?? createToken(TokenKind.Equal)),
                ' ',
                ...this.value.transpile(state)
            ];
        }
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            //TODO: Walk TypeExpression. We need to decide how to implement types on assignments
            walk(this, 'value', visitor, options);
        }
    }

    getType(options: GetTypeOptions) {
        const variableType = this.typeExpression?.getType({ ...options, typeChain: undefined }) ?? this.value.getType({ ...options, typeChain: undefined });

        // Note: compound assignments (eg. +=) are internally dealt with via the RHS being a BinaryExpression
        // so this.value will be a BinaryExpression, and BinaryExpressions can figure out their own types
        options.typeChain?.push(new TypeChainEntry({ name: this.tokens.name.text, type: variableType, data: options.data, range: this.tokens.name.range, kind: this.kind }));
        return variableType;
    }

    getLeadingTrivia(): Token[] {
        return this.tokens.name.leadingTrivia ?? [];
    }
}

export class Block extends Statement {
    constructor(options: {
        statements: Statement[];
        startingRange: Range;
    }) {
        super();
        this.statements = options.statements;
        this.startingRange = options.startingRange;
        this.range = util.createBoundingRange(
            this.startingRange,
            ...(this.statements ?? [])
        );
    }

    public readonly statements: Statement[];
    public readonly startingRange: Range;

    public readonly kind = AstNodeKind.Block;

    public readonly range: Range;

    transpile(state: BrsTranspileState) {
        state.blockDepth++;
        let results = [] as TranspileResult;
        for (let i = 0; i < this.statements.length; i++) {
            let previousStatement = this.statements[i - 1];
            let statement = this.statements[i];
            //is not a comment
            //if comment is on same line as parent
            if (util.isLeadingCommentOnSameLine(state.lineage[0], statement) ||
                util.isLeadingCommentOnSameLine(previousStatement, statement)
            ) {
                results.push(' ');

                //is not a comment
            } else {
                //add a newline and indent
                results.push(
                    state.newline,
                    state.indent()
                );
            }

            //push block onto parent list
            state.lineage.unshift(this);
            results.push(
                ...statement.transpile(state)
            );
            state.lineage.shift();
        }
        state.blockDepth--;
        return results;
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkStatements) {
            walkArray(this.statements, visitor, options, this);
        }
    }

}

export class ExpressionStatement extends Statement {
    constructor(options: {
        expression: Expression;
    }) {
        super();
        this.expression = options.expression;
        this.range = this.expression.range;
    }
    public readonly expression: Expression;
    public readonly kind = AstNodeKind.ExpressionStatement;

    public readonly range: Range;

    transpile(state: BrsTranspileState) {
        return this.expression.transpile(state);
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'expression', visitor, options);
        }
    }
}


export class ExitForStatement extends Statement {
    constructor(options?: {
        exitFor?: Token;
    }) {
        super();
        this.tokens = {
            exitFor: options?.exitFor
        };
        this.range = this.tokens.exitFor?.range;
    }

    public readonly tokens: {
        readonly exitFor?: Token;
    };

    public readonly kind = AstNodeKind.ExitForStatement;

    public readonly range: Range;

    transpile(state: BrsTranspileState) {
        return this.tokens.exitFor ? state.transpileToken(this.tokens.exitFor) : ['exit for'];
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        //nothing to walk
    }

    getLeadingTrivia(): Token[] {
        return this.tokens.exitFor?.leadingTrivia ?? [];
    }

}

export class ExitWhileStatement extends Statement {
    constructor(options?: {
        exitWhile?: Token;
    }) {
        super();
        this.tokens = {
            exitWhile: options?.exitWhile
        };
        this.range = this.tokens.exitWhile?.range;
    }

    public readonly tokens: {
        readonly exitWhile?: Token;
    };

    public readonly kind = AstNodeKind.ExitWhileStatement;

    public readonly range: Range;

    transpile(state: BrsTranspileState) {
        return this.tokens.exitWhile ? state.transpileToken(this.tokens.exitWhile) : ['exit while'];
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        //nothing to walk
    }

    getLeadingTrivia(): Token[] {
        return this.tokens.exitWhile?.leadingTrivia ?? [];
    }
}

export class FunctionStatement extends Statement implements TypedefProvider {
    constructor(options: {
        name: Identifier;
        func: FunctionExpression;
    }) {
        super();
        this.tokens = {
            name: options.name
        };
        this.func = options.func;
        this.func.symbolTable.name += `: '${this.tokens.name?.text}'`;
        this.func.functionStatement = this;

        this.range = this.func.range;
    }

    public readonly tokens: {
        readonly name: Identifier;
    };
    public readonly func: FunctionExpression;

    public readonly kind = AstNodeKind.FunctionStatement as AstNodeKind;

    public readonly range: Range;

    /**
     * Get the name of this expression based on the parse mode
     */
    public getName(parseMode: ParseMode) {
        const namespace = this.findAncestor<NamespaceStatement>(isNamespaceStatement);
        if (namespace) {
            let delimiter = parseMode === ParseMode.BrighterScript ? '.' : '_';
            let namespaceName = namespace.getName(parseMode);
            return namespaceName + delimiter + this.tokens.name?.text;
        } else {
            return this.tokens.name.text;
        }
    }

    public getLeadingTrivia(): Token[] {
        return util.concatAnnotationLeadingTrivia(this, this.func.getLeadingTrivia());
    }

    transpile(state: BrsTranspileState) {
        //create a fake token using the full transpiled name
        let nameToken = {
            ...this.tokens.name,
            text: this.getName(ParseMode.BrightScript)
        };

        return this.func.transpile(state, nameToken);
    }

    getTypedef(state: BrsTranspileState) {
        let result = [];
        for (let annotation of this.annotations ?? []) {
            result.push(
                ...annotation.getTypedef(state),
                state.newline,
                state.indent()
            );
        }

        result.push(
            ...this.func.getTypedef(state)
        );
        return result;
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'func', visitor, options);
        }
    }

    getType(options: GetTypeOptions) {
        const funcExprType = this.func.getType(options);
        funcExprType.setName(this.tokens.name?.text);
        return funcExprType;
    }
}

export class IfStatement extends Statement {
    constructor(options: {
        if?: Token;
        then?: Token;
        else?: Token;
        endIf?: Token;

        condition: Expression;
        thenBranch: Block;
        elseBranch?: IfStatement | Block;
        isInline?: boolean;
    }) {
        super();
        this.condition = options.condition;
        this.thenBranch = options.thenBranch;
        this.elseBranch = options.elseBranch;
        this.isInline = options.isInline;

        this.tokens = {
            if: options.if,
            then: options.then,
            else: options.else,
            endIf: options.endIf
        };

        this.range = util.createBoundingRange(
            util.createBoundingRangeFromTokens(this.tokens),
            this.condition,
            this.thenBranch,
            this.elseBranch
        );
    }

    readonly tokens: {
        readonly if?: Token;
        readonly then?: Token;
        readonly else?: Token;
        readonly endIf?: Token;
    };
    public readonly condition: Expression;
    public readonly thenBranch: Block;
    public readonly elseBranch?: IfStatement | Block;
    public readonly isInline?: boolean;

    public readonly kind = AstNodeKind.IfStatement;

    public readonly range: Range;

    transpile(state: BrsTranspileState) {
        let results = [];
        //if   (already indented by block)
        results.push(state.transpileToken(this.tokens.if ?? createToken(TokenKind.If)));
        results.push(' ');
        //conditions
        results.push(...this.condition.transpile(state));
        //then
        if (this.tokens.then) {
            results.push(' ');
            results.push(
                ...state.transpileToken(this.tokens.then)
            );
        }
        state.lineage.unshift(this);

        //if statement body
        let thenNodes = this.thenBranch.transpile(state);
        state.lineage.shift();
        if (thenNodes.length > 0) {
            results.push(thenNodes);
        }
        results.push('\n');

        //else branch
        if (this.tokens.else) {
            //else
            results.push(
                state.indent(),
                ...state.transpileToken(this.tokens.else)
            );
        }

        if (this.elseBranch) {
            if (isIfStatement(this.elseBranch)) {
                //chained elseif
                state.lineage.unshift(this.elseBranch);
                let body = this.elseBranch.transpile(state);
                state.lineage.shift();

                if (body.length > 0) {
                    //zero or more spaces between the `else` and the `if`
                    results.push(this.elseBranch.tokens.if.leadingWhitespace);
                    results.push(...body);

                    // stop here because chained if will transpile the rest
                    return results;
                } else {
                    results.push('\n');
                }

            } else {
                //else body
                state.lineage.unshift(this.tokens.else);
                let body = this.elseBranch.transpile(state);
                state.lineage.shift();

                if (body.length > 0) {
                    results.push(...body);
                }
                results.push('\n');
            }
        }

        //end if
        results.push(state.indent());
        if (this.tokens.endIf) {
            results.push(
                ...state.transpileToken(this.tokens.endIf)
            );
        } else {
            results.push('end if');
        }
        return results;
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'condition', visitor, options);
        }
        if (options.walkMode & InternalWalkMode.walkStatements) {
            walk(this, 'thenBranch', visitor, options);
        }
        if (this.elseBranch && options.walkMode & InternalWalkMode.walkStatements) {
            walk(this, 'elseBranch', visitor, options);
        }
    }

    getLeadingTrivia(): Token[] {
        return this.tokens.if?.leadingTrivia ?? [];
    }
}

export class IncrementStatement extends Statement {
    constructor(options: {
        value: Expression;
        operator: Token;
    }) {
        super();
        this.value = options.value;
        this.tokens = {
            operator: options.operator
        };
        this.range = util.createBoundingRange(
            this.value,
            this.tokens.operator
        );
    }

    public readonly value: Expression;
    public readonly tokens: {
        readonly operator: Token;
    };

    public readonly kind = AstNodeKind.IncrementStatement;

    public readonly range: Range;

    transpile(state: BrsTranspileState) {
        return [
            ...this.value.transpile(state),
            ...state.transpileToken(this.tokens.operator)
        ];
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'value', visitor, options);
        }
    }

    getLeadingTrivia(): Token[] {
        return this.value?.getLeadingTrivia() ?? [];
    }
}

/** Used to indent the current `print` position to the next 16-character-width output zone. */
export interface PrintSeparatorTab extends Token {
    kind: TokenKind.Comma;
}

/** Used to insert a single whitespace character at the current `print` position. */
export interface PrintSeparatorSpace extends Token {
    kind: TokenKind.Semicolon;
}

/**
 * Represents a `print` statement within BrightScript.
 */
export class PrintStatement extends Statement {
    /**
     * Creates a new internal representation of a BrightScript `print` statement.
     * @param options the options for this statement
     * @param options.print a print token
     * @param options.expressions an array of expressions or `PrintSeparator`s to be evaluated and printed.
     */
    constructor(options: {
        print: Token;
        expressions: Array<Expression | PrintSeparatorTab | PrintSeparatorSpace>;
    }) {
        super();
        this.tokens = {
            print: options.print
        };
        this.expressions = options.expressions;
        this.range = util.createBoundingRange(
            this.tokens.print,
            ...(this.expressions ?? [])
        );
    }
    public readonly tokens: {
        readonly print: Token;
    };
    public readonly expressions: Array<Expression | PrintSeparatorTab | PrintSeparatorSpace>;
    public readonly kind = AstNodeKind.PrintStatement;

    public readonly range: Range;

    transpile(state: BrsTranspileState) {
        let result = [
            ...state.transpileToken(this.tokens.print),
            ' '
        ];
        for (let i = 0; i < this.expressions.length; i++) {
            const expressionOrSeparator: any = this.expressions[i];
            if (expressionOrSeparator.transpile) {
                result.push(...(expressionOrSeparator as ExpressionStatement).transpile(state));
            } else {
                result.push(
                    state.tokenToSourceNode(expressionOrSeparator)
                );
            }
            //if there's an expression after us, add a space
            if ((this.expressions[i + 1] as any)?.transpile) {
                result.push(' ');
            }
        }
        return result;
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            //sometimes we have semicolon Tokens in the expressions list (should probably fix that...), so only walk the actual expressions
            walkArray(this.expressions, visitor, options, this, (item) => isExpression(item as any));
        }
    }

    getLeadingTrivia(): Token[] {
        return this.tokens.print?.leadingTrivia ?? [];
    }
}

export class DimStatement extends Statement {
    constructor(options: {
        dim?: Token;
        name: Identifier;
        openingSquare?: Token;
        dimensions: Expression[];
        closingSquare?: Token;
    }) {
        super();
        this.tokens = {
            dim: options?.dim,
            name: options.name,
            openingSquare: options.openingSquare,
            closingSquare: options.closingSquare
        };
        this.dimensions = options.dimensions;
        this.range = util.createBoundingRange(
            options.dim,
            options.name,
            options.openingSquare,
            ...(this.dimensions ?? []),
            options.closingSquare
        );
    }

    public readonly tokens: {
        readonly dim?: Token;
        readonly name: Identifier;
        readonly openingSquare?: Token;
        readonly closingSquare?: Token;
    };
    public readonly dimensions: Expression[];

    public readonly kind = AstNodeKind.DimStatement;

    public readonly range: Range;

    public transpile(state: BrsTranspileState) {
        let result = [
            ...state.transpileToken(this.tokens.dim, 'dim'),
            ' ',
            ...state.transpileToken(this.tokens.name),
            ...state.transpileToken(this.tokens.openingSquare, '[')
        ];
        for (let i = 0; i < this.dimensions.length; i++) {
            if (i > 0) {
                result.push(', ');
            }
            result.push(
                ...this.dimensions[i].transpile(state)
            );
        }
        result.push(state.transpileToken(this.tokens.closingSquare, ']'));
        return result;
    }

    public walk(visitor: WalkVisitor, options: WalkOptions) {
        if (this.dimensions?.length > 0 && options.walkMode & InternalWalkMode.walkExpressions) {
            walkArray(this.dimensions, visitor, options, this);

        }
    }

    public getType(options: GetTypeOptions): BscType {
        const numDimensions = this.dimensions?.length ?? 1;
        let type = new ArrayType();
        for (let i = 0; i < numDimensions - 1; i++) {
            type = new ArrayType(type);
        }
        return type;
    }
}

export class GotoStatement extends Statement {
    constructor(options: {
        goto?: Token;
        label: Token;
    }) {
        super();
        this.tokens = {
            goto: options.goto,
            label: options.label
        };
        this.range = util.createBoundingRange(
            this.tokens.goto,
            this.tokens.label
        );
    }

    public readonly tokens: {
        readonly goto?: Token;
        readonly label: Token;
    };

    public readonly kind = AstNodeKind.GotoStatement;

    public readonly range: Range;

    transpile(state: BrsTranspileState) {
        return [
            ...state.transpileToken(this.tokens.goto, 'goto'),
            ' ',
            ...state.transpileToken(this.tokens.label)
        ];
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        //nothing to walk
    }
}

export class LabelStatement extends Statement {
    constructor(options: {
        name: Token;
        colon?: Token;
    }) {
        super();
        this.tokens = {
            name: options.name,
            colon: options.colon
        };
        this.range = util.createBoundingRange(
            this.tokens.name,
            this.tokens.colon
        );
    }
    public readonly tokens: {
        readonly name: Token;
        readonly colon: Token;
    };
    public readonly kind = AstNodeKind.LabelStatement;

    public readonly range: Range;

    public getLeadingTrivia(): Token[] {
        return util.concatAnnotationLeadingTrivia(this, this.tokens.name.leadingTrivia);
    }

    transpile(state: BrsTranspileState) {
        return [
            ...state.transpileToken(this.tokens.name),
            ...state.transpileToken(this.tokens.colon, ':')

        ];
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        //nothing to walk
    }
}

export class ReturnStatement extends Statement {
    constructor(options?: {
        return?: Token;
        value?: Expression;
    }) {
        super();
        this.tokens = {
            return: options?.return
        };
        this.value = options?.value;
        this.range = util.createBoundingRange(
            this.tokens.return,
            this.value
        );
    }

    public readonly tokens: {
        readonly return?: Token;
    };
    public readonly value?: Expression;
    public readonly kind = AstNodeKind.ReturnStatement;

    public readonly range: Range;

    transpile(state: BrsTranspileState) {
        let result = [];
        result.push(
            ...state.transpileToken(this.tokens.return, 'return')
        );
        if (this.value) {
            result.push(' ');
            result.push(...this.value.transpile(state));
        }
        return result;
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'value', visitor, options);
        }
    }
}

export class EndStatement extends Statement {
    constructor(options?: {
        end?: Token;
    }) {
        super();
        this.tokens = {
            end: options?.end
        };
        this.range = this.tokens.end?.range;
    }
    public readonly tokens: {
        readonly end?: Token;
    };
    public readonly kind = AstNodeKind.EndStatement;

    public readonly range: Range;

    transpile(state: BrsTranspileState) {
        return [
            ...state.transpileToken(this.tokens.end, 'end')
        ];
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        //nothing to walk
    }
}

export class StopStatement extends Statement {
    constructor(options?: {
        stop?: Token;
    }) {
        super();
        this.tokens = { stop: options?.stop };
        this.range = this.tokens?.stop?.range;
    }
    public readonly tokens: {
        readonly stop?: Token;
    };

    public readonly kind = AstNodeKind.StopStatement;

    public readonly range: Range;

    transpile(state: BrsTranspileState) {
        return [
            ...state.transpileToken(this.tokens.stop, 'stop')
        ];
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        //nothing to walk
    }
}

export class ForStatement extends Statement {
    constructor(options: {
        for?: Token;
        counterDeclaration: AssignmentStatement;
        to?: Token;
        finalValue: Expression;
        body: Block;
        endFor?: Token;
        step?: Token;
        increment?: Expression;
    }) {
        super();
        this.tokens = {
            for: options.for,
            to: options.to,
            endFor: options.endFor,
            step: options.step
        };
        this.counterDeclaration = options.counterDeclaration;
        this.finalValue = options.finalValue;
        this.body = options.body;
        this.increment = options.increment;

        this.range = util.createBoundingRange(
            this.tokens.for,
            this.counterDeclaration,
            this.tokens.to,
            this.finalValue,
            this.tokens.step,
            this.increment,
            this.body,
            this.tokens.endFor
        );
    }

    public readonly tokens: {
        readonly for?: Token;
        readonly to?: Token;
        readonly endFor?: Token;
        readonly step?: Token;
    };

    public readonly counterDeclaration: AssignmentStatement;
    public readonly finalValue: Expression;
    public readonly body: Block;
    public readonly increment?: Expression;

    public readonly kind = AstNodeKind.ForStatement;

    public readonly range: Range;

    transpile(state: BrsTranspileState) {
        let result = [];
        //for
        result.push(
            ...state.transpileToken(this.tokens.for, 'for'),
            ' '
        );
        //i=1
        result.push(
            ...this.counterDeclaration.transpile(state),
            ' '
        );
        //to
        result.push(
            ...state.transpileToken(this.tokens.to, 'to'),
            ' '
        );
        //final value
        result.push(this.finalValue.transpile(state));
        //step
        if (this.increment) {
            result.push(
                ' ',
                ...state.transpileToken(this.tokens.step, 'step'),
                ' ',
                this.increment.transpile(state)
            );
        }
        //loop body
        state.lineage.unshift(this);
        result.push(...this.body.transpile(state));
        state.lineage.shift();

        // add new line before "end for"
        result.push('\n');

        //end for
        result.push(
            state.indent(),
            ...state.transpileToken(this.tokens.endFor, 'end for')
        );

        return result;
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkStatements) {
            walk(this, 'counterDeclaration', visitor, options);
        }
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'finalValue', visitor, options);
            walk(this, 'increment', visitor, options);
        }
        if (options.walkMode & InternalWalkMode.walkStatements) {
            walk(this, 'body', visitor, options);
        }
    }
}

export class ForEachStatement extends Statement {
    constructor(options: {
        forEach?: Token;
        item: Token;
        in?: Token;
        target: Expression;
        body: Block;
        endFor?: Token;
    }) {
        super();
        this.tokens = {
            forEach: options.forEach,
            item: options.item,
            in: options.in,
            endFor: options.endFor
        };
        this.body = options.body;
        this.target = options.target;

        this.range = util.createBoundingRange(
            this.tokens.forEach,
            this.tokens.item,
            this.tokens.in,
            this.target,
            this.body,
            this.tokens.endFor
        );
    }

    public readonly tokens: {
        readonly forEach?: Token;
        readonly item: Token;
        readonly in?: Token;
        readonly endFor?: Token;
    };
    public readonly body: Block;
    public readonly target: Expression;

    public readonly kind = AstNodeKind.ForEachStatement;

    public readonly range: Range;

    transpile(state: BrsTranspileState) {
        let result = [];
        //for each
        result.push(
            ...state.transpileToken(this.tokens.forEach, 'for each'),
            ' '
        );
        //item
        result.push(
            ...state.transpileToken(this.tokens.item),
            ' '
        );
        //in
        result.push(
            ...state.transpileToken(this.tokens.in, 'in'),
            ' '
        );
        //target
        result.push(...this.target.transpile(state));
        //body
        state.lineage.unshift(this);
        result.push(...this.body.transpile(state));
        state.lineage.shift();

        // add new line before "end for"
        result.push('\n');

        //end for
        result.push(
            state.indent(),
            ...state.transpileToken(this.tokens.endFor, 'end for')
        );
        return result;
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'target', visitor, options);
        }
        if (options.walkMode & InternalWalkMode.walkStatements) {
            walk(this, 'body', visitor, options);
        }
    }
}

export class WhileStatement extends Statement {
    constructor(options: {
        while?: Token;
        endWhile?: Token;
        condition: Expression;
        body: Block;
    }) {
        super();
        this.tokens = {
            while: options.while,
            endWhile: options.endWhile
        };
        this.body = options.body;
        this.condition = options.condition;
        this.range = util.createBoundingRange(
            this.tokens.while,
            this.condition,
            this.body,
            this.tokens.endWhile
        );
    }

    public readonly tokens: {
        readonly while?: Token;
        readonly endWhile?: Token;
    };
    public readonly condition: Expression;
    public readonly body: Block;

    public readonly kind = AstNodeKind.WhileStatement;

    public readonly range: Range;

    transpile(state: BrsTranspileState) {
        let result = [];
        //while
        result.push(
            ...state.transpileToken(this.tokens.while, 'while'),
            ' '
        );
        //condition
        result.push(
            ...this.condition.transpile(state)
        );
        state.lineage.unshift(this);
        //body
        result.push(...this.body.transpile(state));
        state.lineage.shift();

        //trailing newline only if we have body statements
        result.push('\n');

        //end while
        result.push(
            state.indent(),
            ...state.transpileToken(this.tokens.endWhile, 'end while')
        );

        return result;
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'condition', visitor, options);
        }
        if (options.walkMode & InternalWalkMode.walkStatements) {
            walk(this, 'body', visitor, options);
        }
    }
}

export class DottedSetStatement extends Statement {
    constructor(options: {
        obj: Expression;
        name: Identifier;
        value: Expression;
        dot?: Token;
    }) {
        super();
        this.tokens = {
            name: options.name,
            dot: options.dot
        };
        this.obj = options.obj;
        this.value = options.value;
        this.range = util.createBoundingRange(
            this.obj,
            this.tokens.dot,
            this.tokens.name,
            this.value
        );
    }
    public readonly tokens: {
        readonly name: Identifier;
        readonly dot?: Token;
    };

    public readonly obj: Expression;
    public readonly value: Expression;

    public readonly kind = AstNodeKind.DottedSetStatement;

    public readonly range: Range;

    transpile(state: BrsTranspileState) {
        //if the value is a compound assignment, don't add the obj, dot, name, or operator...the expression will handle that
        if (CompoundAssignmentOperators.includes((this.value as BinaryExpression)?.tokens?.operator?.kind)) {
            return this.value.transpile(state);
        } else {
            return [
                //object
                ...this.obj.transpile(state),
                this.tokens.dot ? state.tokenToSourceNode(this.tokens.dot) : '.',
                //name
                ...state.transpileToken(this.tokens.name),
                ' = ',
                //right-hand-side of assignment
                ...this.value.transpile(state)
            ];
        }
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'obj', visitor, options);
            walk(this, 'value', visitor, options);
        }
    }

    getType(options: GetTypeOptions) {
        const objType = this.obj?.getType(options);
        const result = objType?.getMemberType(this.tokens.name?.text, options);
        options.typeChain?.push(new TypeChainEntry({
            name: this.tokens.name?.text,
            type: result, data: options.data,
            range: this.tokens.name?.range ?? this.range,
            kind: this.kind
        }));
        return result;
    }
}

export class IndexedSetStatement extends Statement {
    constructor(options: {
        obj: Expression;
        indexes: Expression[];
        value: Expression;
        openingSquare?: Token;
        closingSquare?: Token;
    }) {
        super();
        this.tokens = {
            openingSquare: options.openingSquare,
            closingSquare: options.closingSquare
        };
        this.obj = options.obj;
        this.indexes = options.indexes;
        this.value = options.value;
        this.range = util.createBoundingRange(
            this.obj,
            this.tokens.openingSquare,
            ...this.indexes,
            this.tokens.closingSquare,
            this.value
        );
    }

    public readonly tokens: {
        readonly openingSquare?: Token;
        readonly closingSquare?: Token;
    };
    public readonly obj: Expression;
    public readonly indexes: Expression[];
    public readonly value: Expression;

    public readonly kind = AstNodeKind.IndexedSetStatement;

    public readonly range: Range;

    transpile(state: BrsTranspileState) {
        //if the value is a component assignment, don't add the obj, index or operator...the expression will handle that
        if (CompoundAssignmentOperators.includes((this.value as BinaryExpression)?.tokens?.operator?.kind)) {
            return this.value.transpile(state);
        } else {
            const result = [];
            result.push(
                //obj
                ...this.obj.transpile(state),
                //   [
                ...state.transpileToken(this.tokens.openingSquare)
            );
            for (let i = 0; i < this.indexes.length; i++) {
                //add comma between indexes
                if (i > 0) {
                    result.push(', ');
                }
                let index = this.indexes[i];
                result.push(
                    ...(index?.transpile(state) ?? [])
                );
            }
            result.push(
                ...state.transpileToken(this.tokens.closingSquare),
                ' = ',
                ...this.value.transpile(state)
            );
            return result;
        }
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'obj', visitor, options);
            walkArray(this.indexes, visitor, options, this);
            walk(this, 'value', visitor, options);
        }
    }
}

export class LibraryStatement extends Statement implements TypedefProvider {
    constructor(options: {
        library: Token;
        filePath?: Token;
    }) {
        super();
        this.tokens = {
            library: options.library,
            filePath: options.filePath
        };
        this.range = util.createBoundingRange(
            this.tokens.library,
            this.tokens.filePath
        );
    }
    public readonly tokens: {
        readonly library: Token;
        readonly filePath?: Token;
    };

    public readonly kind = AstNodeKind.LibraryStatement;

    public readonly range: Range;

    transpile(state: BrsTranspileState) {
        let result = [];
        result.push(
            ...state.transpileToken(this.tokens.library)
        );
        //there will be a parse error if file path is missing, but let's prevent a runtime error just in case
        if (this.tokens.filePath) {
            result.push(
                ' ',
                ...state.transpileToken(this.tokens.filePath)
            );
        }
        return result;
    }

    getTypedef(state: BrsTranspileState) {
        return this.transpile(state);
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        //nothing to walk
    }
}

export class NamespaceStatement extends Statement implements TypedefProvider {
    constructor(options: {
        namespace?: Token;
        nameExpression: VariableExpression | DottedGetExpression;
        body: Body;
        endNamespace?: Token;
    }) {
        super();
        this.tokens = {
            namespace: options.namespace,
            endNamespace: options.endNamespace
        };
        this.nameExpression = options.nameExpression;
        this.body = options.body;
        this.name = this.getName(ParseMode.BrighterScript);
        this.symbolTable = new SymbolTable(`NamespaceStatement: '${this.name}'`, () => this.parent?.getSymbolTable());
    }

    public readonly tokens: {
        readonly namespace?: Token;
        readonly endNamespace?: Token;
    };

    public readonly nameExpression: VariableExpression | DottedGetExpression;
    public readonly body: Body;

    public readonly kind = AstNodeKind.NamespaceStatement;

    /**
     * The string name for this namespace
     */
    public name: string;

    public get range() {
        return this.cacheRange();
    }
    private _range: Range;

    public cacheRange() {
        if (!this._range) {
            this._range = util.createBoundingRange(
                this.tokens.namespace,
                this.nameExpression,
                this.body,
                this.tokens.endNamespace
            ) ?? interpolatedRange;
        }
        return this._range;
    }

    public getName(parseMode: ParseMode) {
        const sep = parseMode === ParseMode.BrighterScript ? '.' : '_';
        let name = util.getAllDottedGetPartsAsString(this.nameExpression, parseMode);
        if ((this.parent as Body)?.parent?.kind === AstNodeKind.NamespaceStatement) {
            name = (this.parent.parent as NamespaceStatement).getName(parseMode) + sep + name;
        }
        return name;
    }

    public getLeadingTrivia(): Token[] {
        return util.concatAnnotationLeadingTrivia(this, this.tokens.namespace?.leadingTrivia);
    }

    public getNameParts() {
        let parts = util.getAllDottedGetParts(this.nameExpression);

        if ((this.parent as Body)?.parent?.kind === AstNodeKind.NamespaceStatement) {
            parts = (this.parent.parent as NamespaceStatement).getNameParts().concat(parts);
        }
        return parts;
    }

    transpile(state: BrsTranspileState) {
        //namespaces don't actually have any real content, so just transpile their bodies
        return this.body.transpile(state);
    }

    getTypedef(state: BrsTranspileState) {
        let result = [
            'namespace ',
            ...this.getName(ParseMode.BrighterScript),
            state.newline
        ];
        state.blockDepth++;
        result.push(
            ...this.body.getTypedef(state)
        );
        state.blockDepth--;

        result.push(
            state.indent(),
            'end namespace'
        );
        return result;
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'nameExpression', visitor, options);
        }

        if (this.body.statements.length > 0 && options.walkMode & InternalWalkMode.walkStatements) {
            walk(this, 'body', visitor, options);
        }
    }

    getType(options: GetTypeOptions) {
        const resultType = new NamespaceType(this.name);
        return resultType;
    }

}

export class ImportStatement extends Statement implements TypedefProvider {
    constructor(options: {
        import?: Token;
        path: Token;
    }) {
        super();
        this.tokens = {
            import: options.import,
            path: options.path
        };
        this.range = util.createBoundingRange(
            this.tokens.import,
            this.tokens.path
        );
        if (this.tokens.path) {
            //remove quotes
            this.filePath = this.tokens.path.text.replace(/"/g, '');
            //adjust the range to exclude the quotes
            this.tokens.path.range = util.createRange(
                this.tokens.path.range.start.line,
                this.tokens.path.range.start.character + 1,
                this.tokens.path.range.end.line,
                this.tokens.path.range.end.character - 1
            );
        }
    }

    public readonly tokens: {
        readonly import?: Token;
        readonly path: Token;
    };

    public readonly kind = AstNodeKind.ImportStatement;

    public readonly range: Range;

    public readonly filePath: string;

    transpile(state: BrsTranspileState) {
        //The xml files are responsible for adding the additional script imports, but
        //add the import statement as a comment just for debugging purposes
        return [
            `'`,
            ...state.transpileToken(this.tokens.import, 'import'),
            ' ',
            ...state.transpileToken(this.tokens.path)
        ];
    }

    /**
     * Get the typedef for this statement
     */
    public getTypedef(state: BrsTranspileState) {
        return [
            this.tokens.import?.text ?? 'import',
            ' ',
            //replace any `.bs` extension with `.brs`
            this.tokens.path.text.replace(/\.bs"?$/i, '.brs"')
        ];
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        //nothing to walk
    }
}

export class InterfaceStatement extends Statement implements TypedefProvider {
    constructor(options: {
        interface: Token;
        name: Identifier;
        extends?: Token;
        parentInterfaceName?: TypeExpression;
        body: Statement[];
        endInterface?: Token;
    }) {
        super();
        this.tokens = {
            interface: options.interface,
            name: options.name,
            extends: options.extends,
            endInterface: options.endInterface
        };
        this.parentInterfaceName = options.parentInterfaceName;
        this.body = options.body;
        this.range = util.createBoundingRange(
            this.tokens.interface,
            this.tokens.name,
            this.tokens.extends,
            this.parentInterfaceName,
            ...this.body,
            this.tokens.endInterface
        );
    }
    public readonly parentInterfaceName?: TypeExpression;
    public readonly body: Statement[];

    public readonly kind = AstNodeKind.InterfaceStatement;

    public readonly tokens = {} as {
        readonly interface?: Token;
        readonly name: Identifier;
        readonly extends?: Token;
        readonly endInterface?: Token;
    };

    public readonly range: Range;

    public get fields(): InterfaceFieldStatement[] {
        return this.body.filter(x => isInterfaceFieldStatement(x)) as InterfaceFieldStatement[];
    }

    public get methods(): InterfaceMethodStatement[] {
        return this.body.filter(x => isInterfaceMethodStatement(x)) as InterfaceMethodStatement[];
    }


    public hasParentInterface() {
        return !!this.parentInterfaceName;
    }

    public getLeadingTrivia(): Token[] {
        return util.concatAnnotationLeadingTrivia(this,
            this.tokens.interface.leadingTrivia);
    }


    /**
     * The name of the interface WITH its leading namespace (if applicable)
     */
    public get fullName() {
        const name = this.tokens.name?.text;
        if (name) {
            const namespace = this.findAncestor<NamespaceStatement>(isNamespaceStatement);
            if (namespace) {
                let namespaceName = namespace.getName(ParseMode.BrighterScript);
                return `${namespaceName}.${name}`;
            } else {
                return name;
            }
        } else {
            //return undefined which will allow outside callers to know that this interface doesn't have a name
            return undefined;
        }
    }

    /**
     * The name of the interface (without the namespace prefix)
     */
    public get name() {
        return this.tokens.name?.text;
    }

    /**
     * Get the name of this expression based on the parse mode
     */
    public getName(parseMode: ParseMode) {
        const namespace = this.findAncestor<NamespaceStatement>(isNamespaceStatement);
        if (namespace) {
            let delimiter = parseMode === ParseMode.BrighterScript ? '.' : '_';
            let namespaceName = namespace.getName(parseMode);
            return namespaceName + delimiter + this.name;
        } else {
            return this.name;
        }
    }

    public transpile(state: BrsTranspileState): TranspileResult {
        //interfaces should completely disappear at runtime
        return [];
    }

    getTypedef(state: BrsTranspileState) {
        const result = [] as TranspileResult;
        for (let annotation of this.annotations ?? []) {
            result.push(
                ...annotation.getTypedef(state),
                state.newline,
                state.indent()
            );
        }
        result.push(
            this.tokens.interface.text,
            ' ',
            this.tokens.name.text
        );
        const parentInterfaceName = this.parentInterfaceName?.getName();
        if (parentInterfaceName) {
            result.push(
                ' extends ',
                parentInterfaceName
            );
        }
        const body = this.body ?? [];
        if (body.length > 0) {
            state.blockDepth++;
        }
        for (const statement of body) {
            if (isInterfaceMethodStatement(statement) || isInterfaceFieldStatement(statement)) {
                result.push(
                    state.newline,
                    state.indent(),
                    ...statement.getTypedef(state)
                );
            } else {
                result.push(
                    state.newline,
                    state.indent(),
                    ...statement.transpile(state)
                );
            }
        }
        if (body.length > 0) {
            state.blockDepth--;
        }
        result.push(
            state.newline,
            state.indent(),
            'end interface',
            state.newline
        );
        return result;
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        //visitor-less walk function to do parent linking
        walk(this, 'parentInterfaceName', null, options);

        if (options.walkMode & InternalWalkMode.walkStatements) {
            walkArray(this.body, visitor, options, this);
        }
    }

    getType(options: GetTypeOptions) {
        const superIface = this.parentInterfaceName?.getType(options) as InterfaceType;

        const resultType = new InterfaceType(this.getName(ParseMode.BrighterScript), superIface);
        for (const statement of this.methods) {
            const memberType = statement?.getType({ ...options, typeChain: undefined }); // no typechain info needed
            const flag = statement.isOptional ? SymbolTypeFlag.runtime | SymbolTypeFlag.optional : SymbolTypeFlag.runtime;
            resultType.addMember(statement?.tokens.name?.text, { definingNode: statement }, memberType, flag);
        }
        for (const statement of this.fields) {
            const memberType = statement?.getType({ ...options, typeChain: undefined }); // no typechain info needed
            const flag = statement.isOptional ? SymbolTypeFlag.runtime | SymbolTypeFlag.optional : SymbolTypeFlag.runtime;
            resultType.addMember(statement?.tokens.name?.text, { definingNode: statement }, memberType, flag);
        }
        options.typeChain?.push(new TypeChainEntry({
            name: this.getName(ParseMode.BrighterScript),
            type: resultType,
            data: options.data,
            range: this.range,
            kind: this.kind
        }));
        return resultType;
    }
}

export class InterfaceFieldStatement extends Statement implements TypedefProvider {
    public transpile(state: BrsTranspileState): TranspileResult {
        throw new Error('Method not implemented.');
    }
    constructor(options: {
        name: Identifier;
        as?: Token;
        typeExpression?: TypeExpression;
        optional?: Token;
    }) {
        super();
        this.tokens = {
            optional: options.optional,
            name: options.name,
            as: options.as
        };
        this.typeExpression = options.typeExpression;
        this.range = util.createBoundingRange(
            this.tokens.optional,
            this.tokens.name,
            this.tokens.as,
            this.typeExpression
        );
    }

    public readonly kind = AstNodeKind.InterfaceFieldStatement;

    public readonly typeExpression?: TypeExpression;

    public readonly range: Range;

    public readonly tokens: {
        readonly name: Identifier;
        readonly as: Token;
        readonly optional?: Token;
    };

    public getLeadingTrivia(): Token[] {
        return util.concatAnnotationLeadingTrivia(this, this.tokens.optional?.leadingTrivia ?? this.tokens.name.leadingTrivia);
    }

    public get name() {
        return this.tokens.name.text;
    }

    public get isOptional() {
        return !!this.tokens.optional;
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'typeExpression', visitor, options);
        }
    }

    getTypedef(state: BrsTranspileState): (string | SourceNode)[] {
        const result = [] as TranspileResult;
        for (let annotation of this.annotations ?? []) {
            result.push(
                ...annotation.getTypedef(state),
                state.newline,
                state.indent()
            );
        }
        if (this.isOptional) {
            result.push(
                this.tokens.optional.text,
                ' '
            );
        }
        result.push(
            this.tokens.name.text
        );

        if (this.typeExpression) {
            result.push(
                ' as ',
                ...this.typeExpression.getTypedef(state)
            );
        }
        return result;
    }

    public getType(options: GetTypeOptions): BscType {
        return this.typeExpression?.getType(options) ?? DynamicType.instance;
    }

}

//TODO: there is much that is similar with this and FunctionExpression.
//It would be nice to refactor this so there is less duplicated code
export class InterfaceMethodStatement extends Statement implements TypedefProvider {
    public transpile(state: BrsTranspileState): TranspileResult {
        throw new Error('Method not implemented.');
    }
    constructor(options: {
        functionType?: Token;
        name: Identifier;
        leftParen?: Token;
        params?: FunctionParameterExpression[];
        rightParen?: Token;
        as?: Token;
        returnTypeExpression?: TypeExpression;
        optional?: Token;
    }) {
        super();
        this.tokens = {
            optional: options.optional,
            functionType: options.functionType,
            name: options.name,
            leftParen: options.leftParen,
            rightParen: options.rightParen,
            as: options.as
        };
        this.params = options.params ?? [];
        this.returnTypeExpression = options.returnTypeExpression;
    }

    public readonly kind = AstNodeKind.InterfaceMethodStatement;

    public get range() {
        return util.createBoundingRange(
            this.tokens.optional,
            this.tokens.functionType,
            this.tokens.name,
            this.tokens.leftParen,
            ...(this.params ?? []),
            this.tokens.rightParen,
            this.tokens.as,
            this.returnTypeExpression
        );
    }
    /**
     * Get the name of this method.
     */
    public getName(parseMode: ParseMode) {
        return this.tokens.name.text;
    }

    public readonly tokens: {
        readonly optional?: Token;
        readonly functionType: Token;
        readonly name: Identifier;
        readonly leftParen?: Token;
        readonly rightParen?: Token;
        readonly as?: Token;
    };

    public readonly params: FunctionParameterExpression[];
    public readonly returnTypeExpression?: TypeExpression;

    public get isOptional() {
        return !!this.tokens.optional;
    }

    public getLeadingTrivia(): Token[] {
        return util.concatAnnotationLeadingTrivia(this, this.tokens.optional?.leadingTrivia ?? this.tokens.functionType.leadingTrivia);
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'returnTypeExpression', visitor, options);
        }
    }

    getTypedef(state: BrsTranspileState) {
        const result = [] as TranspileResult;
        for (let annotation of this.annotations ?? []) {
            result.push(
                ...annotation.getTypedef(state),
                state.newline,
                state.indent()
            );
        }
        if (this.isOptional) {
            result.push(
                this.tokens.optional.text,
                ' '
            );
        }
        result.push(
            this.tokens.functionType?.text ?? 'function',
            ' ',
            this.tokens.name.text,
            '('
        );
        const params = this.params ?? [];
        for (let i = 0; i < params.length; i++) {
            if (i > 0) {
                result.push(', ');
            }
            const param = params[i];
            result.push(param.tokens.name.text);
            if (param.typeExpression) {
                result.push(
                    ' as ',
                    ...param.typeExpression.getTypedef(state)
                );
            }
        }
        result.push(
            ')'
        );
        if (this.returnTypeExpression) {
            result.push(
                ' as ',
                ...this.returnTypeExpression.getTypedef(state)
            );
        }
        return result;
    }

    public getType(options: GetTypeOptions): TypedFunctionType {
        //if there's a defined return type, use that
        let returnType = this.returnTypeExpression?.getType(options);
        const isSub = this.tokens.functionType?.kind === TokenKind.Sub || !returnType;
        //if we don't have a return type and this is a sub, set the return type to `void`. else use `dynamic`
        if (!returnType) {
            returnType = isSub ? VoidType.instance : DynamicType.instance;
        }

        const resultType = new TypedFunctionType(returnType);
        resultType.isSub = isSub;
        for (let param of this.params) {
            resultType.addParameter(param.tokens.name.text, param.getType(options), !!param.defaultValue);
        }
        if (options.typeChain) {
            // need Interface type for type chain
            this.parent?.getType(options);
        }
        let funcName = this.getName(ParseMode.BrighterScript);
        resultType.setName(funcName);
        options.typeChain?.push(new TypeChainEntry({ name: resultType.name, type: resultType, data: options.data, range: this.range, kind: this.kind }));
        return resultType;
    }
}

export class ClassStatement extends Statement implements TypedefProvider {
    constructor(options: {
        class?: Token;
        /**
         * The name of the class (without namespace prefix)
         */
        name: Identifier;
        body: Statement[];
        endClass?: Token;
        extends?: Token;
        parentClassName?: TypeExpression;
    }) {
        super();
        this.body = options.body ?? [];
        this.tokens = {
            name: options.name,
            class: options.class,
            endClass: options.endClass,
            extends: options.extends
        };
        this.parentClassName = options.parentClassName;
        this.symbolTable = new SymbolTable(`ClassStatement: '${this.tokens.name?.text}'`, () => this.parent?.getSymbolTable());

        for (let statement of this.body) {
            if (isMethodStatement(statement)) {
                this.methods.push(statement);
                this.memberMap[statement?.tokens.name?.text.toLowerCase()] = statement;
            } else if (isFieldStatement(statement)) {
                this.fields.push(statement);
                this.memberMap[statement?.tokens.name?.text.toLowerCase()] = statement;
            }
        }

        this.range = util.createBoundingRange(
            this.parentClassName,
            ...(this.body ?? []),
            util.createBoundingRangeFromTokens(this.tokens)
        );
    }

    public readonly kind = AstNodeKind.ClassStatement;


    public readonly tokens: {
        readonly class?: Token;
        /**
         * The name of the class (without namespace prefix)
         */
        readonly name: Identifier;
        readonly endClass?: Token;
        readonly extends?: Token;
    };
    public readonly body: Statement[];
    public readonly parentClassName: TypeExpression;


    public getName(parseMode: ParseMode) {
        const name = this.tokens.name?.text;
        if (name) {
            const namespace = this.findAncestor<NamespaceStatement>(isNamespaceStatement);
            if (namespace) {
                let namespaceName = namespace.getName(parseMode);
                let separator = parseMode === ParseMode.BrighterScript ? '.' : '_';
                return namespaceName + separator + name;
            } else {
                return name;
            }
        } else {
            //return undefined which will allow outside callers to know that this class doesn't have a name
            return undefined;
        }
    }

    public getLeadingTrivia(): Token[] {
        return util.concatAnnotationLeadingTrivia(this, this.tokens.class?.leadingTrivia);
    }

    public readonly memberMap = {} as Record<string, MemberStatement>;
    public readonly methods = [] as MethodStatement[];
    public readonly fields = [] as FieldStatement[];

    public readonly range: Range;

    transpile(state: BrsTranspileState) {
        let result = [];
        //make the builder
        result.push(...this.getTranspiledBuilder(state));
        result.push(
            '\n',
            state.indent()
        );
        //make the class assembler (i.e. the public-facing class creator method)
        result.push(...this.getTranspiledClassFunction(state));
        return result;
    }

    getTypedef(state: BrsTranspileState) {
        const result = [] as TranspileResult;
        for (let annotation of this.annotations ?? []) {
            result.push(
                ...annotation.getTypedef(state),
                state.newline,
                state.indent()
            );
        }
        result.push(
            'class ',
            this.tokens.name.text
        );
        if (this.parentClassName) {
            const namespace = this.findAncestor<NamespaceStatement>(isNamespaceStatement);
            const fqName = util.getFullyQualifiedClassName(
                this.parentClassName.getName(),
                namespace?.getName(ParseMode.BrighterScript)
            );
            result.push(
                ` extends ${fqName}`
            );
        }
        result.push(state.newline);
        state.blockDepth++;

        let body = this.body;
        //inject an empty "new" method if missing
        if (!this.getConstructorFunction()) {
            const constructor = createMethodStatement('new', TokenKind.Sub);
            constructor.parent = this;
            //walk the constructor to set up parent links
            constructor.link();
            body = [
                constructor,
                ...this.body
            ];
        }

        for (const member of body) {
            if (isTypedefProvider(member)) {
                result.push(
                    state.indent(),
                    ...member.getTypedef(state),
                    state.newline
                );
            }
        }
        state.blockDepth--;
        result.push(
            state.indent(),
            'end class'
        );
        return result;
    }

    /**
     * Find the parent index for this class's parent.
     * For class inheritance, every class is given an index.
     * The base class is index 0, its child is index 1, and so on.
     */
    public getParentClassIndex(state: BrsTranspileState) {
        let myIndex = 0;
        let stmt = this as ClassStatement;
        while (stmt) {
            if (stmt.parentClassName) {
                const namespace = stmt.findAncestor<NamespaceStatement>(isNamespaceStatement);
                //find the parent class
                stmt = state.file.getClassFileLink(
                    stmt.parentClassName.getName(),
                    namespace?.getName(ParseMode.BrighterScript)
                )?.item;
                myIndex++;
            } else {
                break;
            }
        }
        const result = myIndex - 1;
        if (result >= 0) {
            return result;
        } else {
            return null;
        }
    }

    public hasParentClass() {
        return !!this.parentClassName;
    }

    /**
     * Get all ancestor classes, in closest-to-furthest order (i.e. 0 is parent, 1 is grandparent, etc...).
     * This will return an empty array if no ancestors were found
     */
    public getAncestors(state: BrsTranspileState) {
        let ancestors = [] as ClassStatement[];
        let stmt = this as ClassStatement;
        while (stmt) {
            if (stmt.parentClassName) {
                const namespace = this.findAncestor<NamespaceStatement>(isNamespaceStatement);
                stmt = state.file.getClassFileLink(
                    stmt.parentClassName.getName(),
                    namespace?.getName(ParseMode.BrighterScript)
                )?.item;
                ancestors.push(stmt);
            } else {
                break;
            }
        }
        return ancestors;
    }

    private getBuilderName(name: string) {
        if (name.includes('.')) {
            name = name.replace(/\./gi, '_');
        }
        return `__${name}_builder`;
    }

    public getConstructorType() {
        const constructorType = this.getConstructorFunction()?.getType({ flags: SymbolTypeFlag.runtime }) ?? new TypedFunctionType(null);
        constructorType.returnType = this.getType({ flags: SymbolTypeFlag.runtime });
        return constructorType;
    }

    /**
     * Get the constructor function for this class (if exists), or undefined if not exist
     */
    private getConstructorFunction() {
        return this.body.find((stmt) => {
            return (stmt as MethodStatement)?.tokens.name?.text?.toLowerCase() === 'new';
        }) as MethodStatement;
    }

    /**
     * Determine if the specified field was declared in one of the ancestor classes
     */
    public isFieldDeclaredByAncestor(fieldName: string, ancestors: ClassStatement[]) {
        let lowerFieldName = fieldName.toLowerCase();
        for (let ancestor of ancestors) {
            if (ancestor.memberMap[lowerFieldName]) {
                return true;
            }
        }
        return false;
    }

    /**
     * The builder is a function that assigns all of the methods and property names to a class instance.
     * This needs to be a separate function so that child classes can call the builder from their parent
     * without instantiating the parent constructor at that point in time.
     */
    private getTranspiledBuilder(state: BrsTranspileState) {
        let result = [];
        result.push(`function ${this.getBuilderName(this.getName(ParseMode.BrightScript))}()\n`);
        state.blockDepth++;
        //indent
        result.push(state.indent());

        /**
         * The lineage of this class. index 0 is a direct parent, index 1 is index 0's parent, etc...
         */
        let ancestors = this.getAncestors(state);

        //construct parent class or empty object
        if (ancestors[0]) {
            const ancestorNamespace = ancestors[0].findAncestor<NamespaceStatement>(isNamespaceStatement);
            let fullyQualifiedClassName = util.getFullyQualifiedClassName(
                ancestors[0].getName(ParseMode.BrighterScript),
                ancestorNamespace?.getName(ParseMode.BrighterScript)
            );
            result.push(
                'instance = ',
                this.getBuilderName(fullyQualifiedClassName), '()');
        } else {
            //use an empty object.
            result.push('instance = {}');
        }
        result.push(
            state.newline,
            state.indent()
        );
        let parentClassIndex = this.getParentClassIndex(state);

        let body = this.body;
        //inject an empty "new" method if missing
        if (!this.getConstructorFunction()) {
            body = [
                createMethodStatement('new', TokenKind.Sub),
                ...this.body
            ];
        }

        for (let statement of body) {
            //is field statement
            if (isFieldStatement(statement)) {
                //do nothing with class fields in this situation, they are handled elsewhere
                continue;

                //methods
            } else if (isMethodStatement(statement)) {

                //store overridden parent methods as super{parentIndex}_{methodName}
                if (
                    //is override method
                    statement.tokens.override ||
                    //is constructor function in child class
                    (statement.tokens.name.text.toLowerCase() === 'new' && ancestors[0])
                ) {
                    result.push(
                        `instance.super${parentClassIndex}_${statement.tokens.name.text} = instance.${statement.tokens.name.text}`,
                        state.newline,
                        state.indent()
                    );
                }

                state.classStatement = this;
                result.push(
                    'instance.',
                    ...state.transpileToken(statement.tokens.name),
                    ' = ',
                    ...statement.transpile(state),
                    state.newline,
                    state.indent()
                );
                delete state.classStatement;
            } else {
                //other random statements (probably just comments)
                result.push(
                    ...statement.transpile(state),
                    state.newline,
                    state.indent()
                );
            }
        }
        //return the instance
        result.push('return instance\n');
        state.blockDepth--;
        result.push(state.indent());
        result.push(`end function`);
        return result;
    }

    /**
     * The class function is the function with the same name as the class. This is the function that
     * consumers should call to create a new instance of that class.
     * This invokes the builder, gets an instance of the class, then invokes the "new" function on that class.
     */
    private getTranspiledClassFunction(state: BrsTranspileState) {
        let result = [];
        const constructorFunction = this.getConstructorFunction();
        const constructorParams = constructorFunction ? constructorFunction.func.parameters : [];

        result.push(
            state.sourceNode(this, 'function'),
            state.sourceNode(this, ' '),
            state.sourceNode(this.tokens.name, this.getName(ParseMode.BrightScript)),
            `(`
        );
        let i = 0;
        for (let param of constructorParams) {
            if (i > 0) {
                result.push(', ');
            }
            result.push(
                param.transpile(state)
            );
            i++;
        }
        result.push(
            ')',
            '\n'
        );

        state.blockDepth++;
        result.push(state.indent());
        result.push(`instance = ${this.getBuilderName(this.getName(ParseMode.BrightScript))}()\n`);

        result.push(state.indent());
        result.push(`instance.new(`);

        //append constructor arguments
        i = 0;
        for (let param of constructorParams) {
            if (i > 0) {
                result.push(', ');
            }
            result.push(
                ...state.transpileToken(param.tokens.name)
            );
            i++;
        }
        result.push(
            ')',
            '\n'
        );

        result.push(state.indent());
        result.push(`return instance\n`);

        state.blockDepth--;
        result.push(state.indent());
        result.push(`end function`);
        return result;
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        //visitor-less walk function to do parent linking
        walk(this, 'parentClassName', null, options);

        if (options.walkMode & InternalWalkMode.walkStatements) {
            walkArray(this.body, visitor, options, this);
        }
    }

    getType(options: GetTypeOptions) {
        const superClass = this.parentClassName?.getType(options) as ClassType;

        const resultType = new ClassType(this.getName(ParseMode.BrighterScript), superClass);

        for (const statement of this.methods) {
            const funcType = statement?.func.getType({ ...options, typeChain: undefined }); //no typechain needed
            let flag = SymbolTypeFlag.runtime;
            if (statement.accessModifier?.kind === TokenKind.Private) {
                flag |= SymbolTypeFlag.private;
            }
            if (statement.accessModifier?.kind === TokenKind.Protected) {
                flag |= SymbolTypeFlag.protected;
            }
            resultType.addMember(statement?.tokens.name?.text, { definingNode: statement }, funcType, flag);
        }
        for (const statement of this.fields) {
            const fieldType = statement.getType({ ...options, typeChain: undefined }); //no typechain needed
            let flag = SymbolTypeFlag.runtime;
            if (statement.isOptional) {
                flag |= SymbolTypeFlag.optional;
            }
            if (statement.tokens.accessModifier?.kind === TokenKind.Private) {
                flag |= SymbolTypeFlag.private;
            }
            if (statement.tokens.accessModifier?.kind === TokenKind.Protected) {
                flag |= SymbolTypeFlag.protected;
            }
            resultType.addMember(statement?.tokens.name?.text, { definingNode: statement }, fieldType, flag);
        }
        options.typeChain?.push(new TypeChainEntry({ name: resultType.name, type: resultType, data: options.data, range: this.range, kind: this.kind }));
        return resultType;
    }
}

const accessModifiers = [
    TokenKind.Public,
    TokenKind.Protected,
    TokenKind.Private
];
export class MethodStatement extends FunctionStatement {
    constructor(
        options: {
            modifiers?: Token | Token[];
            name: Identifier;
            func: FunctionExpression;
            override?: Token;
        }
    ) {
        super(options);
        if (options.modifiers) {
            if (Array.isArray(options.modifiers)) {
                this.modifiers.push(...options.modifiers);
            } else {
                this.modifiers.push(options.modifiers);
            }
        }
        this.tokens = {
            ...this.tokens,
            override: options.override
        };
        this.range = util.createBoundingRange(
            ...(this.modifiers),
            util.createBoundingRangeFromTokens(this.tokens),
            this.func
        );
    }

    public readonly kind = AstNodeKind.MethodStatement as AstNodeKind;

    public readonly modifiers: Token[] = [];

    public readonly tokens: {
        readonly name: Identifier;
        readonly override?: Token;
    };

    public get accessModifier() {
        return this.modifiers.find(x => accessModifiers.includes(x.kind));
    }

    public readonly range: Range;

    /**
     * Get the name of this method.
     */
    public getName(parseMode: ParseMode) {
        return this.tokens.name.text;
    }

    public getLeadingTrivia(): Token[] {
        return util.concatAnnotationLeadingTrivia(this, this.func.getLeadingTrivia());
    }

    transpile(state: BrsTranspileState) {
        if (this.tokens.name.text.toLowerCase() === 'new') {
            this.ensureSuperConstructorCall(state);
            //TODO we need to undo this at the bottom of this method
            this.injectFieldInitializersForConstructor(state);
        }
        //TODO - remove type information from these methods because that doesn't work
        //convert the `super` calls into the proper methods
        const parentClassIndex = state.classStatement.getParentClassIndex(state);
        const visitor = createVisitor({
            VariableExpression: e => {
                if (e.tokens.name.text.toLocaleLowerCase() === 'super') {
                    state.editor.setProperty(e.tokens.name, 'text', `m.super${parentClassIndex}_new`);
                }
            },
            DottedGetExpression: e => {
                const beginningVariable = util.findBeginningVariableExpression(e);
                const lowerName = beginningVariable?.getName(ParseMode.BrighterScript).toLowerCase();
                if (lowerName === 'super') {
                    state.editor.setProperty(beginningVariable.tokens.name, 'text', 'm');
                    state.editor.setProperty(e.tokens.name, 'text', `super${parentClassIndex}_${e.tokens.name.text}`);
                }
            }
        });
        const walkOptions: WalkOptions = { walkMode: WalkMode.visitExpressions };
        for (const statement of this.func.body.statements) {
            visitor(statement, undefined);
            statement.walk(visitor, walkOptions);
        }
        return this.func.transpile(state);
    }

    getTypedef(state: BrsTranspileState) {
        const result = [] as Array<string | SourceNode>;
        for (let annotation of this.annotations ?? []) {
            result.push(
                ...annotation.getTypedef(state),
                state.newline,
                state.indent()
            );
        }
        if (this.accessModifier) {
            result.push(
                this.accessModifier.text,
                ' '
            );
        }
        if (this.tokens.override) {
            result.push('override ');
        }
        result.push(
            ...this.func.getTypedef(state)
        );
        return result;
    }

    /**
     * All child classes must call the parent constructor. The type checker will warn users when they don't call it in their own class,
     * but we still need to call it even if they have omitted it. This injects the super call if it's missing
     */
    private ensureSuperConstructorCall(state: BrsTranspileState) {
        //if this class doesn't extend another class, quit here
        if (state.classStatement.getAncestors(state).length === 0) {
            return;
        }

        //check whether any calls to super exist
        let containsSuperCall =
            this.func.body.statements.findIndex((x) => {
                //is a call statement
                return isExpressionStatement(x) && isCallExpression(x.expression) &&
                    //is a call to super
                    util.findBeginningVariableExpression(x.expression.callee as any).tokens.name.text.toLowerCase() === 'super';
            }) !== -1;

        //if a call to super exists, quit here
        if (containsSuperCall) {
            return;
        }

        //this is a child class, and the constructor doesn't contain a call to super. Inject one
        const superCall = new ExpressionStatement({
            expression: new CallExpression({
                callee: new VariableExpression({
                    name: {
                        kind: TokenKind.Identifier,
                        text: 'super',
                        isReserved: false,
                        range: state.classStatement.tokens.name.range,
                        leadingWhitespace: '',
                        leadingTrivia: []
                    }
                }),
                openingParen: {
                    kind: TokenKind.LeftParen,
                    text: '(',
                    isReserved: false,
                    range: state.classStatement.tokens.name.range,
                    leadingWhitespace: '',
                    leadingTrivia: []
                },
                closingParen: {
                    kind: TokenKind.RightParen,
                    text: ')',
                    isReserved: false,
                    range: state.classStatement.tokens.name.range,
                    leadingWhitespace: '',
                    leadingTrivia: []
                },
                args: []
            })
        });
        state.editor.arrayUnshift(this.func.body.statements, superCall);
    }

    /**
     * Inject field initializers at the top of the `new` function (after any present `super()` call)
     */
    private injectFieldInitializersForConstructor(state: BrsTranspileState) {
        let startingIndex = state.classStatement.hasParentClass() ? 1 : 0;

        let newStatements = [] as Statement[];
        //insert the field initializers in order
        for (let field of state.classStatement.fields) {
            let thisQualifiedName = { ...field.tokens.name };
            thisQualifiedName.text = 'm.' + field.tokens.name.text;
            const fieldAssignment = field.initialValue
                ? new AssignmentStatement({
                    equals: field.tokens.equals,
                    name: thisQualifiedName,
                    value: field.initialValue
                })
                : new AssignmentStatement({
                    equals: createToken(TokenKind.Equal, '=', field.tokens.name.range),
                    name: thisQualifiedName,
                    //if there is no initial value, set the initial value to `invalid`
                    value: createInvalidLiteral('invalid', field.tokens.name.range)
                });
            // Add parent so namespace lookups work
            fieldAssignment.parent = state.classStatement;
            newStatements.push(fieldAssignment);
        }
        state.editor.arraySplice(this.func.body.statements, startingIndex, 0, ...newStatements);
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'func', visitor, options);
        }
    }
}

export class FieldStatement extends Statement implements TypedefProvider {
    constructor(options: {
        accessModifier?: Token;
        name: Identifier;
        as?: Token;
        typeExpression?: TypeExpression;
        equals?: Token;
        initialValue?: Expression;
        optional?: Token;
    }) {
        super();
        this.tokens = {
            accessModifier: options.accessModifier,
            name: options.name,
            as: options.as,
            equals: options.equals,
            optional: options.optional
        };
        this.typeExpression = options.typeExpression;
        this.initialValue = options.initialValue;

        this.range = util.createBoundingRange(
            util.createBoundingRangeFromTokens(this.tokens),
            this.typeExpression,
            this.initialValue
        );
    }

    public readonly tokens: {
        readonly accessModifier?: Token;
        readonly name: Identifier;
        readonly as?: Token;
        readonly equals?: Token;
        readonly optional?: Token;
    };

    public readonly typeExpression?: TypeExpression;
    public readonly initialValue?: Expression;

    public readonly kind = AstNodeKind.FieldStatement;

    /**
     * Derive a ValueKind from the type token, or the initial value.
     * Defaults to `DynamicType`
     */
    getType(options: GetTypeOptions) {
        return this.typeExpression?.getType({ ...options, flags: SymbolTypeFlag.typetime }) ??
            this.initialValue?.getType({ ...options, flags: SymbolTypeFlag.runtime }) ?? DynamicType.instance;
    }

    public readonly range: Range;

    public getLeadingTrivia(): Token[] {
        return util.concatAnnotationLeadingTrivia(this, this.tokens.accessModifier?.leadingTrivia ?? this.tokens.optional?.leadingTrivia ?? this.tokens.name?.leadingTrivia ?? []);
    }

    public get isOptional() {
        return !!this.tokens.optional;
    }

    transpile(state: BrsTranspileState): TranspileResult {
        throw new Error('transpile not implemented for ' + Object.getPrototypeOf(this).constructor.name);
    }

    getTypedef(state: BrsTranspileState) {
        const result = [];
        if (this.tokens.name) {
            for (let annotation of this.annotations ?? []) {
                result.push(
                    ...annotation.getTypedef(state),
                    state.newline,
                    state.indent()
                );
            }

            let type = this.getType({ flags: SymbolTypeFlag.typetime });
            if (isInvalidType(type) || isVoidType(type)) {
                type = new DynamicType();
            }

            result.push(
                this.tokens.accessModifier?.text ?? 'public',
                ' '
            );
            if (this.isOptional) {
                result.push(this.tokens.optional.text, ' ');
            }
            result.push(this.tokens.name?.text,
                ' as ',
                type.toTypeString()
            );
        }
        return result;
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'typeExpression', visitor, options);
            walk(this, 'initialValue', visitor, options);
        }
    }
}

export type MemberStatement = FieldStatement | MethodStatement;

export class TryCatchStatement extends Statement {
    constructor(options?: {
        try?: Token;
        endTry?: Token;
        tryBranch?: Block;
        catchStatement?: CatchStatement;
    }) {
        super();
        this.tokens = {
            try: options.try,
            endTry: options.endTry
        };
        this.tryBranch = options.tryBranch;
        this.catchStatement = options.catchStatement;
        this.range = util.createBoundingRange(
            this.tokens.try,
            this.tryBranch,
            this.catchStatement,
            this.tokens.endTry
        );
    }

    public readonly tokens: {
        readonly try?: Token;
        readonly endTry?: Token;
    };

    public readonly tryBranch: Block;
    public readonly catchStatement: CatchStatement;

    public readonly kind = AstNodeKind.TryCatchStatement;

    public readonly range: Range;

    public transpile(state: BrsTranspileState): TranspileResult {
        return [
            ...state.transpileToken(this.tokens.try, 'try'),
            ...this.tryBranch.transpile(state),
            state.newline,
            state.indent(),
            ...(this.catchStatement?.transpile(state) ?? ['catch']),
            state.newline,
            state.indent(),
            ...state.transpileToken(this.tokens.endTry, 'end try')
        ];
    }

    public walk(visitor: WalkVisitor, options: WalkOptions) {
        if (this.tryBranch && options.walkMode & InternalWalkMode.walkStatements) {
            walk(this, 'tryBranch', visitor, options);
            walk(this, 'catchStatement', visitor, options);
        }
    }

    public getLeadingTrivia(): Token[] {
        return this.tokens.try?.leadingTrivia ?? [];
    }
}

export class CatchStatement extends Statement {
    constructor(options?: {
        catch?: Token;
        exceptionVariable?: Identifier;
        catchBranch?: Block;
    }) {
        super();
        this.tokens = {
            catch: options?.catch,
            exceptionVariable: options?.exceptionVariable
        };
        this.catchBranch = options?.catchBranch;
        this.range = util.createBoundingRange(
            this.tokens.catch,
            this.tokens.exceptionVariable,
            this.catchBranch
        );
    }

    public readonly tokens: {
        readonly catch?: Token;
        readonly exceptionVariable?: Identifier;
    };

    public readonly catchBranch?: Block;

    public readonly kind = AstNodeKind.CatchStatement;

    public readonly range: Range;

    public transpile(state: BrsTranspileState): TranspileResult {
        return [
            ...state.transpileToken(this.tokens.catch, 'catch'),
            ' ',
            this.tokens.exceptionVariable?.text ?? 'e',
            ...(this.catchBranch?.transpile(state) ?? [])
        ];
    }

    public walk(visitor: WalkVisitor, options: WalkOptions) {
        if (this.catchBranch && options.walkMode & InternalWalkMode.walkStatements) {
            walk(this, 'catchBranch', visitor, options);
        }
    }

    public getLeadingTrivia(): Token[] {
        return this.tokens.catch?.leadingTrivia ?? [];
    }
}

export class ThrowStatement extends Statement {
    constructor(options?: {
        throw?: Token;
        expression?: Expression;
    }) {
        super();
        this.tokens = {
            throw: options.throw
        };
        this.expression = options.expression;
        this.range = util.createBoundingRange(
            this.tokens.throw,
            this.expression
        );
    }

    public readonly tokens: {
        readonly throw?: Token;
    };
    public readonly expression?: Expression;

    public readonly kind = AstNodeKind.ThrowStatement;

    public readonly range: Range;

    public transpile(state: BrsTranspileState) {
        const result = [
            ...state.transpileToken(this.tokens.throw, 'throw'),
            ' '
        ];

        //if we have an expression, transpile it
        if (this.expression) {
            result.push(
                ...this.expression.transpile(state)
            );

            //no expression found. Rather than emit syntax errors, provide a generic error message
        } else {
            result.push('"An error has occurred"');
        }
        return result;
    }

    public walk(visitor: WalkVisitor, options: WalkOptions) {
        if (this.expression && options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'expression', visitor, options);
        }
    }

    public getLeadingTrivia(): Token[] {
        return this.tokens.throw?.leadingTrivia ?? [];
    }
}


export class EnumStatement extends Statement implements TypedefProvider {
    constructor(options: {
        enum?: Token;
        name: Identifier;
        endEnum?: Token;
        body: Array<EnumMemberStatement>;
    }) {
        super();
        this.tokens = {
            enum: options.enum,
            name: options.name,
            endEnum: options.endEnum
        };
        this.symbolTable = new SymbolTable('Enum');
        this.body = options.body ?? [];
    }

    public readonly tokens: {
        readonly enum?: Token;
        readonly name: Identifier;
        readonly endEnum?: Token;
    };
    public readonly body: Array<EnumMemberStatement>;

    public readonly kind = AstNodeKind.EnumStatement;

    public get range(): Range {
        return util.createBoundingRange(
            this.tokens.enum,
            this.tokens.name,
            ...this.body,
            this.tokens.endEnum
        );
    }

    public getMembers() {
        const result = [] as EnumMemberStatement[];
        for (const statement of this.body) {
            if (isEnumMemberStatement(statement)) {
                result.push(statement);
            }
        }
        return result;
    }

    public getLeadingTrivia(): Token[] {
        return util.concatAnnotationLeadingTrivia(this, this.tokens.enum?.leadingTrivia);
    }

    /**
     * Get a map of member names and their values.
     * All values are stored as their AST LiteralExpression representation (i.e. string enum values include the wrapping quotes)
     */
    public getMemberValueMap() {
        const result = new Map<string, string>();
        const members = this.getMembers();
        let currentIntValue = 0;
        for (const member of members) {
            //if there is no value, assume an integer and increment the int counter
            if (!member.value) {
                result.set(member.name?.toLowerCase(), currentIntValue.toString());
                currentIntValue++;

                //if explicit integer value, use it and increment the int counter
            } else if (isLiteralExpression(member.value) && member.value.tokens.value.kind === TokenKind.IntegerLiteral) {
                //try parsing as integer literal, then as hex integer literal.
                let tokenIntValue = util.parseInt(member.value.tokens.value.text) ?? util.parseInt(member.value.tokens.value.text.replace(/&h/i, '0x'));
                if (tokenIntValue !== undefined) {
                    currentIntValue = tokenIntValue;
                    currentIntValue++;
                }
                result.set(member.name?.toLowerCase(), member.value.tokens.value.text);

                //simple unary expressions (like `-1`)
            } else if (isUnaryExpression(member.value) && isLiteralExpression(member.value.right)) {
                result.set(member.name?.toLowerCase(), member.value.tokens.operator.text + member.value.right.tokens.value.text);

                //all other values
            } else {
                result.set(member.name?.toLowerCase(), (member.value as LiteralExpression)?.tokens?.value?.text ?? 'invalid');
            }
        }
        return result;
    }

    public getMemberValue(name: string) {
        return this.getMemberValueMap().get(name.toLowerCase());
    }

    /**
     * The name of the enum (without the namespace prefix)
     */
    public get name() {
        return this.tokens.name?.text;
    }

    /**
     * The name of the enum WITH its leading namespace (if applicable)
     */
    public get fullName() {
        const name = this.tokens.name?.text;
        if (name) {
            const namespace = this.findAncestor<NamespaceStatement>(isNamespaceStatement);

            if (namespace) {
                let namespaceName = namespace.getName(ParseMode.BrighterScript);
                return `${namespaceName}.${name}`;
            } else {
                return name;
            }
        } else {
            //return undefined which will allow outside callers to know that this doesn't have a name
            return undefined;
        }
    }

    transpile(state: BrsTranspileState) {
        //enum declarations do not exist at runtime, so don't transpile anything...
        return [];
    }

    getTypedef(state: BrsTranspileState) {
        const result = [] as TranspileResult;
        for (let annotation of this.annotations ?? []) {
            result.push(
                ...annotation.getTypedef(state),
                state.newline,
                state.indent()
            );
        }
        result.push(
            this.tokens.enum?.text ?? 'enum',
            ' ',
            this.tokens.name.text
        );
        result.push(state.newline);
        state.blockDepth++;
        for (const member of this.body) {
            if (isTypedefProvider(member)) {
                result.push(
                    state.indent(),
                    ...member.getTypedef(state),
                    state.newline
                );
            }
        }
        state.blockDepth--;
        result.push(
            state.indent(),
            this.tokens.endEnum?.text ?? 'end enum'
        );
        return result;
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkStatements) {
            walkArray(this.body, visitor, options, this);

        }
    }

    getType(options: GetTypeOptions) {
        const members = this.getMembers();

        const resultType = new EnumType(
            this.fullName,
            members[0]?.getType(options).underlyingType
        );
        resultType.pushMemberProvider(() => this.getSymbolTable());
        for (const statement of members) {
            resultType.addMember(statement?.tokens?.name?.text, { definingNode: statement }, statement.getType(options), SymbolTypeFlag.runtime);
        }
        return resultType;
    }
}

export class EnumMemberStatement extends Statement implements TypedefProvider {
    public constructor(options: {
        name: Identifier;
        equals?: Token;
        value?: Expression;
    }) {
        super();
        this.tokens = {
            name: options.name,
            equals: options.equals
        };
        this.value = options.value;
    }

    public readonly tokens: {
        readonly name: Identifier;
        readonly equals?: Token;
    };
    public readonly value?: Expression;

    public readonly kind = AstNodeKind.EnumMemberStatement;

    public get range() {
        return util.createBoundingRange(
            this.tokens.name,
            this.tokens.equals,
            this.value
        );
    }

    /**
     * The name of the member
     */
    public get name() {
        return this.tokens.name.text;
    }

    public getLeadingTrivia(): Token[] {
        return util.concatAnnotationLeadingTrivia(this, this.tokens.name.leadingTrivia);
    }

    public transpile(state: BrsTranspileState): TranspileResult {
        return [];
    }

    getTypedef(state: BrsTranspileState): (string | SourceNode)[] {
        const result = [
            this.tokens.name.text
        ] as TranspileResult;
        if (this.tokens.equals) {
            result.push(' ', this.tokens.equals.text, ' ');
            if (this.value) {
                result.push(
                    ...this.value.transpile(state)
                );
            }
        }
        return result;
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (this.value && options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'value', visitor, options);
        }
    }

    getType(options: GetTypeOptions) {
        return new EnumMemberType(
            (this.parent as EnumStatement)?.fullName,
            this.tokens?.name?.text,
            this.value?.getType(options)
        );
    }
}

export class ConstStatement extends Statement implements TypedefProvider {
    public constructor(options: {
        const?: Token;
        name: Identifier;
        equals?: Token;
        value: Expression;
    }) {
        super();
        this.tokens = {
            const: options.const,
            name: options.name,
            equals: options.equals
        };
        this.value = options.value;
        this.range = util.createBoundingRange(this.tokens.const, this.tokens.name, this.tokens.equals, this.value);
    }

    public readonly tokens: {
        readonly const: Token;
        readonly name: Identifier;
        readonly equals: Token;
    };
    public readonly value: Expression;

    public readonly kind = AstNodeKind.ConstStatement;

    public readonly range: Range;

    public get name() {
        return this.tokens.name.text;
    }

    public getLeadingTrivia(): Token[] {
        return util.concatAnnotationLeadingTrivia(this, this.tokens.const?.leadingTrivia);
    }

    /**
     * The name of the statement WITH its leading namespace (if applicable)
     */
    public get fullName() {
        const name = this.tokens.name?.text;
        if (name) {
            const namespace = this.findAncestor<NamespaceStatement>(isNamespaceStatement);
            if (namespace) {
                let namespaceName = namespace.getName(ParseMode.BrighterScript);
                return `${namespaceName}.${name}`;
            } else {
                return name;
            }
        } else {
            //return undefined which will allow outside callers to know that this doesn't have a name
            return undefined;
        }
    }

    public transpile(state: BrsTranspileState): TranspileResult {
        //const declarations don't exist at runtime, so just transpile empty
        return [];
    }

    getTypedef(state: BrsTranspileState): (string | SourceNode)[] {
        return [
            this.tokens.const ? state.tokenToSourceNode(this.tokens.const) : 'const',
            ' ',
            state.tokenToSourceNode(this.tokens.name),
            ' ',
            this.tokens.equals ? state.tokenToSourceNode(this.tokens.equals) : '=',
            ' ',
            ...this.value.transpile(state)
        ];
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (this.value && options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'value', visitor, options);
        }
    }

    getType(options: GetTypeOptions) {
        return this.value.getType(options);
    }
}

export class ContinueStatement extends Statement {
    constructor(options: {
        continue?: Token;
        loopType: Token;
    }
    ) {
        super();
        this.tokens = {
            continue: options.continue,
            loopType: options.loopType
        };
        this.range = util.createBoundingRange(
            this.tokens.continue,
            this.tokens.loopType
        );
    }

    public readonly tokens: {
        readonly continue?: Token;
        readonly loopType: Token;
    };

    public readonly kind = AstNodeKind.ContinueStatement;

    public readonly range: Range;

    transpile(state: BrsTranspileState) {
        return [
            state.sourceNode(this.tokens.continue, this.tokens.continue?.text ?? 'continue'),
            this.tokens.loopType?.leadingWhitespace ?? ' ',
            state.sourceNode(this.tokens.continue, this.tokens.loopType?.text)
        ];
    }
    walk(visitor: WalkVisitor, options: WalkOptions) {
        //nothing to walk
    }

    public getLeadingTrivia(): Token[] {
        return this.tokens.continue?.leadingTrivia ?? [];
    }
}
