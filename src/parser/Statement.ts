/* eslint-disable no-bitwise */
import type { Token, Identifier } from '../lexer';
import { CompoundAssignmentOperators, TokenKind } from '../lexer';
import type { BinaryExpression, Expression, NamespacedVariableNameExpression, FunctionExpression, AnnotationExpression } from './Expression';
import { CallExpression, VariableExpression } from './Expression';
import { util } from '../util';
import type { Range } from 'vscode-languageserver';
import { Position } from 'vscode-languageserver';
import type { TranspileState } from './TranspileState';
import { ParseMode, Parser } from './Parser';
import type { WalkVisitor, WalkOptions } from '../astUtils/visitors';
import { InternalWalkMode, walk, createVisitor, WalkMode } from '../astUtils/visitors';
import { isCallExpression, isClassFieldStatement, isClassMethodStatement, isCommentStatement, isExpression, isExpressionStatement, isFunctionStatement, isIfStatement, isInvalidType, isLiteralExpression, isVoidType } from '../astUtils/reflection';
import type { TranspileResult, TypedefProvider } from '../interfaces';
import { createInvalidLiteral, createToken, interpolatedRange } from '../astUtils/creators';
import { DynamicType } from '../types/DynamicType';

/**
 * A BrightScript statement
 */
export abstract class Statement {

    /**
     *  The starting and ending location of the statement.
     **/
    public abstract range: Range;

    /**
     * Statement annotations
     */
    public annotations: AnnotationExpression[];

    public abstract transpile(state: TranspileState): TranspileResult;

    /**
     * When being considered by the walk visitor, this describes what type of element the current class is.
     */
    public visitMode = InternalWalkMode.visitStatements;

    public abstract walk(visitor: WalkVisitor, options: WalkOptions);
}

export class EmptyStatement extends Statement {
    constructor(
        /**
         * Create a negative range to indicate this is an interpolated location
         */
        public range: Range = interpolatedRange
    ) {
        super();
    }

    transpile(state: TranspileState) {
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
    constructor(
        public statements: Statement[] = []
    ) {
        super();
    }

    public get range() {
        return util.createRangeFromPositions(
            this.statements[0]?.range.start ?? Position.create(0, 0),
            this.statements[this.statements.length - 1]?.range.end ?? Position.create(0, 0)
        );
    }

    transpile(state: TranspileState) {
        let result = [] as TranspileResult;
        for (let i = 0; i < this.statements.length; i++) {
            let statement = this.statements[i];
            let previousStatement = this.statements[i - 1];
            let nextStatement = this.statements[i + 1];

            if (!previousStatement) {
                //this is the first statement. do nothing related to spacing and newlines

                //if comment is on same line as prior sibling
            } else if (isCommentStatement(statement) && previousStatement && statement.range.start.line === previousStatement.range.end.line) {
                result.push(
                    ' '
                );

                //add double newline if this is a comment, and next is a function
            } else if (isCommentStatement(statement) && nextStatement && isFunctionStatement(nextStatement)) {
                result.push('\n\n');

                //add double newline if is function not preceeded by a comment
            } else if (isFunctionStatement(statement) && previousStatement && !(isCommentStatement(previousStatement))) {
                result.push('\n\n');
            } else {
                //separate statements by a single newline
                result.push('\n');
            }

            result.push(...statement.transpile(state));
        }
        return result;
    }

    getTypedef(state: TranspileState) {
        let result = [];
        for (const statement of this.statements) {
            //if the current statement supports generating typedef, call it
            if ('getTypedef' in statement) {
                result.push(
                    state.indent(),
                    ...(statement as TypedefProvider).getTypedef(state),
                    state.newline()
                );
            }
        }
        return result;
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkStatements) {
            for (let i = 0; i < this.statements.length; i++) {
                walk(this.statements, i, visitor, options, this);
            }
        }
    }
}

export class AssignmentStatement extends Statement {
    constructor(
        readonly equals: Token,
        readonly name: Identifier,
        readonly value: Expression,
        readonly containingFunction: FunctionExpression
    ) {
        super();
        this.range = util.createRangeFromPositions(this.name.range.start, this.value.range.end);
    }

    public readonly range: Range;

    transpile(state: TranspileState) {
        //if the value is a compound assignment, just transpile the expression itself
        if (CompoundAssignmentOperators.includes((this.value as BinaryExpression)?.operator?.kind)) {
            return this.value.transpile(state);
        } else {
            return [
                state.tokenToSourceNode(this.name),
                ' ',
                state.tokenToSourceNode(this.equals),
                ' ',
                ...this.value.transpile(state)
            ];
        }
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'value', visitor, options);
        }
    }
}

export class Block extends Statement {
    constructor(
        readonly statements: Statement[],
        readonly startingRange: Range
    ) {
        super();
        this.range = util.createRangeFromPositions(
            this.startingRange.start,
            this.statements.length
                ? this.statements[this.statements.length - 1].range.end
                : this.startingRange.start
        );
    }

    public readonly range: Range;

    transpile(state: TranspileState) {
        state.blockDepth++;
        let results = [] as TranspileResult;
        for (let i = 0; i < this.statements.length; i++) {
            let previousStatement = this.statements[i - 1];
            let statement = this.statements[i];

            //if comment is on same line as parent
            if (isCommentStatement(statement) &&
                (util.linesTouch(state.lineage[0], statement) || util.linesTouch(previousStatement, statement))
            ) {
                results.push(' ');

                //is not a comment
            } else {
                //add a newline and indent
                results.push(
                    state.newline(),
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
            for (let i = 0; i < this.statements.length; i++) {
                walk(this.statements, i, visitor, options, this);
            }
        }
    }
}

export class ExpressionStatement extends Statement {
    constructor(
        readonly expression: Expression
    ) {
        super();
        this.range = this.expression.range;
    }

    public readonly range: Range;

    transpile(state: TranspileState) {
        return this.expression.transpile(state);
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'expression', visitor, options);
        }
    }
}

export class CommentStatement extends Statement implements Expression, TypedefProvider {
    constructor(
        public comments: Token[]
    ) {
        super();
        this.visitMode = InternalWalkMode.visitStatements | InternalWalkMode.visitExpressions;
        if (this.comments?.length > 0) {

            this.range = util.createRangeFromPositions(
                this.comments[0].range.start,
                this.comments[this.comments.length - 1].range.end
            );
        }
    }

    public range: Range;

    get text() {
        return this.comments.map(x => x.text).join('\n');
    }

    transpile(state: TranspileState) {
        let result = [];
        for (let i = 0; i < this.comments.length; i++) {
            let comment = this.comments[i];
            if (i > 0) {
                result.push(state.indent());
            }
            result.push(
                state.tokenToSourceNode(comment)
            );
            //add newline for all except final comment
            if (i < this.comments.length - 1) {
                result.push('\n');
            }
        }
        return result;
    }

    public getTypedef(state: TranspileState) {
        return this.transpile(state);
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        //nothing to walk
    }
}

export class ExitForStatement extends Statement {
    constructor(
        readonly tokens: {
            exitFor: Token;
        }
    ) {
        super();
        this.range = this.tokens.exitFor.range;
    }

    public readonly range: Range;

    transpile(state: TranspileState) {
        return [
            state.tokenToSourceNode(this.tokens.exitFor)
        ];
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        //nothing to walk
    }

}

export class ExitWhileStatement extends Statement {
    constructor(
        readonly tokens: {
            exitWhile: Token;
        }
    ) {
        super();
        this.range = this.tokens.exitWhile.range;
    }

    public readonly range: Range;

    transpile(state: TranspileState) {
        return [
            state.tokenToSourceNode(this.tokens.exitWhile)
        ];
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        //nothing to walk
    }
}

export class FunctionStatement extends Statement implements TypedefProvider {
    constructor(
        public name: Identifier,
        public func: FunctionExpression,
        public namespaceName: NamespacedVariableNameExpression
    ) {
        super();
        this.range = this.func.range;
    }

    public readonly range: Range;

    /**
     * Get the name of this expression based on the parse mode
     */
    public getName(parseMode: ParseMode) {
        if (this.namespaceName) {
            let delimiter = parseMode === ParseMode.BrighterScript ? '.' : '_';
            let namespaceName = this.namespaceName.getName(parseMode);
            return namespaceName + delimiter + this.name.text;
        } else {
            return this.name.text;
        }
    }


    transpile(state: TranspileState) {
        //create a fake token using the full transpiled name
        let nameToken = {
            ...this.name,
            text: this.getName(ParseMode.BrightScript)
        };

        return this.func.transpile(state, nameToken);
    }

    getTypedef(state: TranspileState) {
        let result = [];
        for (let annotation of this.annotations ?? []) {
            result.push(
                ...annotation.getTypedef(state),
                state.newline(),
                state.indent()
            );
        }

        result.push(
            ...this.func.getTypedef(state, this.name)
        );
        return result;
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'func', visitor, options);
        }
    }
}

export class IfStatement extends Statement {
    constructor(
        readonly tokens: {
            if: Token;
            then?: Token;
            else?: Token;
            endIf?: Token;
        },
        readonly condition: Expression,
        readonly thenBranch: Block,
        readonly elseBranch?: IfStatement | Block,
        readonly isInline?: boolean
    ) {
        super();
        this.range = util.createRangeFromPositions(
            this.tokens.if.range.start,
            (this.tokens.endIf ?? this.elseBranch ?? this.thenBranch).range.end
        );
    }
    public readonly range: Range;

    transpile(state: TranspileState) {
        let results = [];
        //if   (already indented by block)
        results.push(state.tokenToSourceNode(this.tokens.if));
        results.push(' ');
        //conditions
        results.push(...this.condition.transpile(state));
        results.push(' ');
        //then
        if (this.tokens.then) {
            results.push(
                state.tokenToSourceNode(this.tokens.then)
            );
        } else {
            results.push('then');
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
                state.tokenToSourceNode(this.tokens.else)
            );
        }

        if (this.elseBranch) {
            if (isIfStatement(this.elseBranch)) {
                //chained elseif
                state.lineage.unshift(this.elseBranch);
                let body = this.elseBranch.transpile(state);
                state.lineage.shift();

                if (body.length > 0) {
                    results.push(' ');
                    results.push(...body);

                    // stop here because chained if will transpile the rest
                    return results;
                } else {
                    results.push('\n');
                }

            } else {
                //else body
                state.lineage.unshift(this.elseBranch);
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
                state.tokenToSourceNode(this.tokens.endIf)
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
}

export class IncrementStatement extends Statement {
    constructor(
        readonly value: Expression,
        readonly operator: Token
    ) {
        super();
        this.range = util.createRangeFromPositions(this.value.range.start, this.operator.range.end);
    }

    public readonly range: Range;

    transpile(state: TranspileState) {
        return [
            ...this.value.transpile(state),
            state.tokenToSourceNode(this.operator)
        ];
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'value', visitor, options);
        }
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
     * @param expressions an array of expressions or `PrintSeparator`s to be
     *                    evaluated and printed.
     */
    constructor(
        readonly tokens: {
            print: Token;
        },
        readonly expressions: Array<Expression | PrintSeparatorTab | PrintSeparatorSpace>
    ) {
        super();
        this.range = util.createRangeFromPositions(
            this.tokens.print.range.start,
            this.expressions.length
                ? this.expressions[this.expressions.length - 1].range.end
                : this.tokens.print.range.end
        );
    }

    public readonly range: Range;

    transpile(state: TranspileState) {
        let result = [
            state.tokenToSourceNode(this.tokens.print),
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
            for (let i = 0; i < this.expressions.length; i++) {
                //sometimes we have semicolon `Token`s in the expressions list (should probably fix that...), so only emit the actual expressions
                if (isExpression(this.expressions[i] as any)) {
                    walk(this.expressions, i, visitor, options, this);
                }
            }
        }
    }
}

export class DimStatement extends Statement {
    constructor(
        public dimToken: Token,
        public identifier?: Identifier,
        public openingSquare?: Token,
        public dimensions?: Expression[],
        public closingSquare?: Token
    ) {
        super();
        this.range = util.createRangeFromPositions(
            this.dimToken.range.start,
            (this.closingSquare ?? this.dimensions[this.dimensions.length - 1] ?? this.openingSquare ?? this.identifier ?? this.dimToken).range.end
        );
    }
    public range: Range;

    public transpile(state: TranspileState) {
        let result = [
            state.tokenToSourceNode(this.dimToken),
            ' ',
            state.tokenToSourceNode(this.identifier),
            state.tokenToSourceNode(this.openingSquare)
        ];
        for (let i = 0; i < this.dimensions.length; i++) {
            if (i > 0) {
                result.push(', ');
            }
            result.push(
                ...this.dimensions[i].transpile(state)
            );
        }
        result.push(state.tokenToSourceNode(this.closingSquare));
        return result;
    }

    public walk(visitor: WalkVisitor, options: WalkOptions) {
        if (this.dimensions?.length > 0 && options.walkMode & InternalWalkMode.walkExpressions) {
            for (let i = 0; i < this.dimensions.length; i++) {
                walk(this.dimensions, i, visitor, options, this);
            }
        }
    }
}

export class GotoStatement extends Statement {
    constructor(
        readonly tokens: {
            goto: Token;
            label: Token;
        }
    ) {
        super();
        this.range = util.createRangeFromPositions(this.tokens.goto.range.start, this.tokens.label.range.end);
    }

    public readonly range: Range;

    transpile(state: TranspileState) {
        return [
            state.tokenToSourceNode(this.tokens.goto),
            ' ',
            state.tokenToSourceNode(this.tokens.label)
        ];
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        //nothing to walk
    }
}

export class LabelStatement extends Statement {
    constructor(
        readonly tokens: {
            identifier: Token;
            colon: Token;
        }
    ) {
        super();
        this.range = util.createRangeFromPositions(this.tokens.identifier.range.start, this.tokens.colon.range.end);
    }

    public readonly range: Range;

    transpile(state: TranspileState) {
        return [
            state.tokenToSourceNode(this.tokens.identifier),
            state.tokenToSourceNode(this.tokens.colon)

        ];
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        //nothing to walk
    }
}

export class ReturnStatement extends Statement {
    constructor(
        readonly tokens: {
            return: Token;
        },
        readonly value?: Expression
    ) {
        super();
        this.range = util.createRangeFromPositions(
            this.tokens.return.range.start,
            this.value?.range.end || this.tokens.return.range.end
        );
    }

    public readonly range: Range;

    transpile(state: TranspileState) {
        let result = [];
        result.push(
            state.tokenToSourceNode(this.tokens.return)
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
    constructor(
        readonly tokens: {
            end: Token;
        }
    ) {
        super();
        this.range = util.createRangeFromPositions(this.tokens.end.range.start, this.tokens.end.range.end);
    }

    public readonly range: Range;

    transpile(state: TranspileState) {
        return [
            state.tokenToSourceNode(this.tokens.end)
        ];
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        //nothing to walk
    }
}

export class StopStatement extends Statement {
    constructor(
        readonly tokens: {
            stop: Token;
        }
    ) {
        super();
        this.range = util.createRangeFromPositions(this.tokens.stop.range.start, this.tokens.stop.range.end);
    }

    public readonly range: Range;

    transpile(state: TranspileState) {
        return [
            state.tokenToSourceNode(this.tokens.stop)
        ];
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        //nothing to walk
    }
}

export class ForStatement extends Statement {
    constructor(
        public forToken: Token,
        public counterDeclaration: AssignmentStatement,
        public toToken: Token,
        public finalValue: Expression,
        public body: Block,
        public endForToken: Token,
        public stepToken?: Token,
        public increment?: Expression
    ) {
        super();
        const lastRange = this.endForToken?.range ?? body.range;
        this.range = util.createRangeFromPositions(this.forToken.range.start, lastRange.end);
    }

    public readonly range: Range;

    transpile(state: TranspileState) {
        let result = [];
        //for
        result.push(
            state.tokenToSourceNode(this.forToken),
            ' '
        );
        //i=1
        result.push(
            ...this.counterDeclaration.transpile(state),
            ' '
        );
        //to
        result.push(
            state.tokenToSourceNode(this.toToken),
            ' '
        );
        //final value
        result.push(this.finalValue.transpile(state));
        //step
        if (this.stepToken) {
            result.push(
                ' ',
                state.tokenToSourceNode(this.stepToken),
                ' ',
                this.increment.transpile(state)
            );
        }
        //loop body
        state.lineage.unshift(this);
        result.push(...this.body.transpile(state));
        state.lineage.shift();
        if (this.body.statements.length > 0) {
            result.push('\n');
        }
        //end for
        result.push(
            state.indent(),
            state.tokenToSourceNode(this.endForToken)
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
    constructor(
        readonly tokens: {
            forEach: Token;
            in: Token;
            endFor: Token;
        },
        readonly item: Token,
        readonly target: Expression,
        readonly body: Block
    ) {
        super();
        const lastRange = this.tokens.endFor?.range ?? body.range;
        this.range = util.createRangeFromPositions(this.tokens.forEach.range.start, lastRange.end);
    }

    public readonly range: Range;

    transpile(state: TranspileState) {
        let result = [];
        //for each
        result.push(
            state.tokenToSourceNode(this.tokens.forEach),
            ' '
        );
        //item
        result.push(
            state.tokenToSourceNode(this.item),
            ' '
        );
        //in
        result.push(
            state.tokenToSourceNode(this.tokens.in),
            ' '
        );
        //target
        result.push(...this.target.transpile(state));
        //body
        state.lineage.unshift(this);
        result.push(...this.body.transpile(state));
        state.lineage.shift();
        if (this.body.statements.length > 0) {
            result.push('\n');
        }
        //end for
        result.push(
            state.indent(),
            state.tokenToSourceNode(this.tokens.endFor)
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
    constructor(
        readonly tokens: {
            while: Token;
            endWhile: Token;
        },
        readonly condition: Expression,
        readonly body: Block
    ) {
        super();
        const lastRange = this.tokens.endWhile?.range ?? body.range;
        this.range = util.createRangeFromPositions(this.tokens.while.range.start, lastRange.end);
    }

    public readonly range: Range;

    transpile(state: TranspileState) {
        let result = [];
        //while
        result.push(
            state.tokenToSourceNode(this.tokens.while),
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
            state.tokenToSourceNode(this.tokens.endWhile)
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
    constructor(
        readonly obj: Expression,
        readonly name: Identifier,
        readonly value: Expression
    ) {
        super();
        this.range = util.createRangeFromPositions(this.obj.range.start, this.value.range.end);
    }

    public readonly range: Range;

    transpile(state: TranspileState) {
        //if the value is a compound assignment, don't add the obj, dot, name, or operator...the expression will handle that
        if (CompoundAssignmentOperators.includes((this.value as BinaryExpression)?.operator?.kind)) {
            return this.value.transpile(state);
        } else {
            return [
                //object
                ...this.obj.transpile(state),
                '.',
                //name
                state.tokenToSourceNode(this.name),
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
}

export class IndexedSetStatement extends Statement {
    constructor(
        readonly obj: Expression,
        readonly index: Expression,
        readonly value: Expression,
        readonly openingSquare: Token,
        readonly closingSquare: Token
    ) {
        super();
        this.range = util.createRangeFromPositions(this.obj.range.start, this.value.range.end);
    }

    public readonly range: Range;

    transpile(state: TranspileState) {
        //if the value is a component assignment, don't add the obj, index or operator...the expression will handle that
        if (CompoundAssignmentOperators.includes((this.value as BinaryExpression)?.operator?.kind)) {
            return this.value.transpile(state);
        } else {
            return [
                //obj
                ...this.obj.transpile(state),
                //   [
                state.tokenToSourceNode(this.openingSquare),
                //    index
                ...this.index.transpile(state),
                //         ]
                state.tokenToSourceNode(this.closingSquare),
                //           =
                ' = ',
                //             value
                ...this.value.transpile(state)
            ];
        }
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'obj', visitor, options);
            walk(this, 'index', visitor, options);
            walk(this, 'value', visitor, options);
        }
    }
}

export class LibraryStatement extends Statement implements TypedefProvider {
    constructor(
        readonly tokens: {
            library: Token;
            filePath: Token | undefined;
        }
    ) {
        super();
        this.range = util.createRangeFromPositions(
            this.tokens.library.range.start,
            this.tokens.filePath ? this.tokens.filePath.range.end : this.tokens.library.range.end
        );
    }

    public readonly range: Range;

    transpile(state: TranspileState) {
        let result = [];
        result.push(
            state.tokenToSourceNode(this.tokens.library)
        );
        //there will be a parse error if file path is missing, but let's prevent a runtime error just in case
        if (this.tokens.filePath) {
            result.push(
                ' ',
                state.tokenToSourceNode(this.tokens.filePath)
            );
        }
        return result;
    }

    getTypedef(state: TranspileState) {
        return this.transpile(state);
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        //nothing to walk
    }
}

export class NamespaceStatement extends Statement implements TypedefProvider {
    constructor(
        public keyword: Token,
        //this should technically only be a VariableExpression or DottedGetExpression, but that can be enforced elsewhere
        public nameExpression: NamespacedVariableNameExpression,
        public body: Body,
        public endKeyword: Token
    ) {
        super();
        this.name = this.nameExpression.getName(ParseMode.BrighterScript);
    }

    /**
     * The string name for this namespace
     */
    public name: string;

    public get range() {
        return util.createRangeFromPositions(
            this.keyword.range.start,
            (this.endKeyword ?? this.body ?? this.nameExpression ?? this.keyword).range.end
        );
    }

    public getName(parseMode: ParseMode) {
        return this.nameExpression.getName(parseMode);
    }

    transpile(state: TranspileState) {
        //namespaces don't actually have any real content, so just transpile their bodies
        return this.body.transpile(state);
    }

    getTypedef(state: TranspileState) {
        let result = [
            'namespace ',
            ...this.nameExpression.getName(ParseMode.BrighterScript),
            state.newline()
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
}

export class ImportStatement extends Statement implements TypedefProvider {
    constructor(
        readonly importToken: Token,
        readonly filePathToken: Token
    ) {
        super();
        this.range = util.createRangeFromPositions(
            importToken.range.start,
            (filePathToken ?? importToken).range.end
        );
        if (this.filePathToken) {
            //remove quotes
            this.filePath = this.filePathToken.text.replace(/"/g, '');
            //adjust the range to exclude the quotes
            this.filePathToken.range = util.createRange(
                this.filePathToken.range.start.line,
                this.filePathToken.range.start.character + 1,
                this.filePathToken.range.end.line,
                this.filePathToken.range.end.character - 1
            );
        }
    }
    public filePath: string;
    public range: Range;

    transpile(state: TranspileState) {
        //The xml files are responsible for adding the additional script imports, but
        //add the import statement as a comment just for debugging purposes
        return [
            `'`,
            state.tokenToSourceNode(this.importToken),
            ' ',
            state.tokenToSourceNode(this.filePathToken)
        ];
    }

    /**
     * Get the typedef for this statement
     */
    public getTypedef(state: TranspileState) {
        return [
            this.importToken.text,
            ' ',
            //replace any `.bs` extension with `.brs`
            this.filePathToken.text.replace(/\.bs"?$/i, '.brs"')
        ];
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        //nothing to walk
    }
}

export class ClassStatement extends Statement implements TypedefProvider {

    constructor(
        readonly classKeyword: Token,
        /**
         * The name of the class (without namespace prefix)
         */
        readonly name: Identifier,
        public body: Statement[],
        readonly end: Token,
        readonly extendsKeyword?: Token,
        readonly parentClassName?: NamespacedVariableNameExpression,
        readonly namespaceName?: NamespacedVariableNameExpression
    ) {
        super();
        this.body = this.body ?? [];
        for (let statement of this.body) {
            if (isClassMethodStatement(statement)) {
                this.methods.push(statement);
                this.memberMap[statement?.name?.text.toLowerCase()] = statement;
            } else if (isClassFieldStatement(statement)) {
                this.fields.push(statement);
                this.memberMap[statement?.name?.text.toLowerCase()] = statement;
            }
        }

        this.range = util.createRangeFromPositions(this.classKeyword.range.start, this.end.range.end);
    }

    public getName(parseMode: ParseMode) {
        const name = this.name?.text;
        if (name) {
            if (this.namespaceName) {
                let namespaceName = this.namespaceName.getName(parseMode);
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

    public memberMap = {} as Record<string, ClassMemberStatement>;
    public methods = [] as ClassMethodStatement[];
    public fields = [] as ClassFieldStatement[];


    public readonly range: Range;

    transpile(state: TranspileState) {
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

    getTypedef(state: TranspileState) {
        const result = [] as TranspileResult;
        for (let annotation of this.annotations ?? []) {
            result.push(
                ...annotation.getTypedef(state),
                state.newline(),
                state.indent()
            );
        }
        result.push(
            'class ',
            this.name.text
        );
        if (this.extendsKeyword && this.parentClassName) {
            const fqName = util.getFullyQualifiedClassName(
                this.parentClassName.getName(ParseMode.BrighterScript),
                this.namespaceName?.getName(ParseMode.BrighterScript)
            );
            result.push(
                ` extends ${fqName}`
            );
        }
        result.push(state.newline());
        state.blockDepth++;
        for (const member of this.body) {
            if ('getTypedef' in member) {
                result.push(
                    state.indent(),
                    ...(member as TypedefProvider).getTypedef(state),
                    state.newline()
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
    public getParentClassIndex(state: TranspileState) {
        let myIndex = 0;
        let stmt = this as ClassStatement;
        while (stmt) {
            if (stmt.parentClassName) {
                //find the parent class
                stmt = state.file.getClassFileLink(
                    stmt.parentClassName.getName(ParseMode.BrighterScript),
                    stmt.namespaceName?.getName(ParseMode.BrighterScript)
                )?.item;
                myIndex++;
            } else {
                break;
            }
        }
        return myIndex - 1;
    }

    public hasParentClass() {
        return !!this.parentClassName;
    }

    /**
     * Get all ancestor classes, in closest-to-furthest order (i.e. 0 is parent, 1 is grandparent, etc...).
     * This will return an empty array if no ancestors were found
     */
    public getAncestors(state: TranspileState) {
        let ancestors = [] as ClassStatement[];
        let stmt = this as ClassStatement;
        while (stmt) {
            if (stmt.parentClassName) {
                stmt = state.file.getClassFileLink(
                    stmt.parentClassName.getName(ParseMode.BrighterScript),
                    this.namespaceName?.getName(ParseMode.BrighterScript)
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

    /**
     * Get the constructor function for this class (if exists), or undefined if not exist
     */
    private getConstructorFunction() {
        for (let key in this.memberMap) {
            let member = this.memberMap[key];
            if (member.name?.text?.toLowerCase() === 'new') {
                return member as ClassMethodStatement;
            }
        }
    }
    private getEmptyNewFunction() {
        let stmt = (Parser.parse(`
            class UtilClass
                sub new()
                end sub
            end class
        `, { mode: ParseMode.BrighterScript }).statements[0] as ClassStatement).memberMap.new as ClassMethodStatement;
        //TODO make locations point to 0,0 (might not matter?)
        return stmt;
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
    private getTranspiledBuilder(state: TranspileState) {
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
            let fullyQualifiedClassName = util.getFullyQualifiedClassName(
                ancestors[0].getName(ParseMode.BrighterScript),
                ancestors[0].namespaceName?.getName(ParseMode.BrighterScript)
            );
            result.push(
                'instance = ',
                this.getBuilderName(fullyQualifiedClassName), '()');
        } else {
            //use an empty object.
            result.push('instance = {}');
        }
        result.push(
            state.newline(),
            state.indent()
        );
        let parentClassIndex = this.getParentClassIndex(state);

        //create empty `new` function if class is missing it (simplifies transpile logic)
        if (!this.getConstructorFunction()) {
            this.memberMap.new = this.getEmptyNewFunction();
            this.body = [this.memberMap.new, ...this.body];
        }

        for (let statement of this.body) {
            //is field statement
            if (isClassFieldStatement(statement)) {
                //do nothing with class fields in this situation, they are handled elsewhere
                continue;

                //methods
            } else if (isClassMethodStatement(statement)) {

                //store overridden parent methods as super{parentIndex}_{methodName}
                if (
                    //is override method
                    statement.override ||
                    //is constructor function in child class
                    (statement.name.text.toLowerCase() === 'new' && ancestors[0])
                ) {
                    result.push(
                        `instance.super${parentClassIndex}_${statement.name.text} = instance.${statement.name.text}`,
                        state.newline(),
                        state.indent()
                    );
                }

                state.classStatement = this;
                result.push(
                    'instance.',
                    state.tokenToSourceNode(statement.name),
                    ' = ',
                    ...statement.transpile(state),
                    state.newline(),
                    state.indent()
                );
                delete state.classStatement;
            } else {
                //other random statements (probably just comments)
                result.push(
                    ...statement.transpile(state),
                    state.newline(),
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
    private getTranspiledClassFunction(state: TranspileState) {
        let result = [];
        const constructorFunction = this.getConstructorFunction();
        const constructorParams = constructorFunction ? constructorFunction.func.parameters : [];

        result.push(
            state.sourceNode(this.classKeyword, 'function'),
            state.sourceNode(this.classKeyword, ' '),
            state.sourceNode(this.name, this.getName(ParseMode.BrightScript)),
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
                state.tokenToSourceNode(param.name)
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
        if (options.walkMode & InternalWalkMode.walkStatements) {
            for (let i = 0; i < this.body.length; i++) {
                walk(this.body, i, visitor, options, this);
            }
        }
    }
}

export class ClassMethodStatement extends FunctionStatement {
    constructor(
        readonly accessModifier: Token,
        name: Identifier,
        func: FunctionExpression,
        readonly override: Token
    ) {
        super(name, func, undefined);
        this.range = util.createRangeFromPositions(
            (this.accessModifier ?? this.func).range.start,
            this.func.range.end
        );
    }

    public readonly range: Range;

    transpile(state: TranspileState) {
        if (this.name.text.toLowerCase() === 'new') {
            this.ensureSuperConstructorCall(state);
            //TODO we need to undo this at the bottom of this method
            this.injectFieldInitializersForConstructor(state);
        }
        //TODO - remove type information from these methods because that doesn't work
        //convert the `super` calls into the proper methods
        const parentClassIndex = state.classStatement.getParentClassIndex(state);
        const visitor = createVisitor({
            VariableExpression: e => {
                if (e.name.text.toLocaleLowerCase() === 'super') {
                    e.name.text = `m.super${parentClassIndex}_new`;
                }
            },
            DottedGetExpression: e => {
                const beginningVariable = util.findBeginningVariableExpression(e);
                const lowerName = beginningVariable?.getName(ParseMode.BrighterScript).toLowerCase();
                if (lowerName === 'super') {
                    beginningVariable.name.text = 'm';
                    e.name.text = `super${parentClassIndex}_${e.name.text}`;
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

    getTypedef(state: TranspileState) {
        const result = [] as string[];
        for (let annotation of this.annotations ?? []) {
            result.push(
                ...annotation.getTypedef(state),
                state.newline(),
                state.indent()
            );
        }
        if (this.accessModifier) {
            result.push(
                this.accessModifier.text,
                ' '
            );
        }
        if (this.override) {
            result.push('override ');
        }
        result.push(
            ...this.func.getTypedef(state, this.name)
        );
        return result;
    }

    /**
     * All child classes must call the parent constructor. The type checker will warn users when they don't call it in their own class,
     * but we still need to call it even if they have omitted it. This injects the super call if it's missing
     */
    private ensureSuperConstructorCall(state: TranspileState) {
        //if this class doesn't extend another class, quit here
        if (state.classStatement.getAncestors(state).length === 0) {
            return;
        }

        //if the first statement is a call to super, quit here
        let firstStatement = this.func.body.statements[0];
        if (
            //is a call statement
            isExpressionStatement(firstStatement) && isCallExpression(firstStatement.expression) &&
            //is a call to super
            util.findBeginningVariableExpression(firstStatement?.expression.callee as any).name.text.toLowerCase() === 'super'
        ) {
            return;
        }

        //this is a child class, and the first statement isn't a call to super. Inject one
        this.func.body.statements.unshift(
            new ExpressionStatement(
                new CallExpression(
                    new VariableExpression(
                        {
                            kind: TokenKind.Identifier,
                            text: 'super',
                            isReserved: false,
                            range: state.classStatement.name.range,
                            leadingWhitespace: ''
                        },
                        null
                    ),
                    {
                        kind: TokenKind.LeftParen,
                        text: '(',
                        isReserved: false,
                        range: state.classStatement.name.range,
                        leadingWhitespace: ''
                    },
                    {
                        kind: TokenKind.RightParen,
                        text: ')',
                        isReserved: false,
                        range: state.classStatement.name.range,
                        leadingWhitespace: ''
                    },
                    [],
                    null
                )
            )
        );
    }

    /**
     * Inject field initializers at the top of the `new` function (after any present `super()` call)
     */
    private injectFieldInitializersForConstructor(state: TranspileState) {
        let startingIndex = state.classStatement.hasParentClass() ? 1 : 0;

        let newStatements = [] as Statement[];
        //insert the field initializers in order
        for (let field of state.classStatement.fields) {
            let thisQualifiedName = { ...field.name };
            thisQualifiedName.text = 'm.' + field.name.text;
            if (field.initialValue) {
                newStatements.push(
                    new AssignmentStatement(field.equal, thisQualifiedName, field.initialValue, this.func)
                );
            } else {
                //if there is no initial value, set the initial value to `invalid`
                newStatements.push(
                    new AssignmentStatement(
                        createToken(TokenKind.Equal, '=', field.name.range),
                        thisQualifiedName,
                        createInvalidLiteral('invalid', field.name.range),
                        this.func
                    )
                );
            }
        }
        this.func.body.statements.splice(startingIndex, 0, ...newStatements);
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'func', visitor, options);
        }
    }
}

export class ClassFieldStatement extends Statement implements TypedefProvider {

    constructor(
        readonly accessModifier?: Token,
        readonly name?: Identifier,
        readonly as?: Token,
        readonly type?: Token,
        readonly equal?: Token,
        readonly initialValue?: Expression
    ) {
        super();
        this.range = util.createRangeFromPositions(
            (this.accessModifier ?? this.name).range.start,
            (this.initialValue ?? this.type ?? this.as ?? this.name).range.end
        );
    }

    /**
     * Derive a ValueKind from the type token, or the initial value.
     * Defaults to `ValueKind.Dynamic`
     */
    getType() {
        if (this.type) {
            return util.tokenToBscType(this.type);
        } else if (isLiteralExpression(this.initialValue)) {
            return this.initialValue.type;
        } else {
            return new DynamicType();
        }
    }

    public readonly range: Range;

    transpile(state: TranspileState): TranspileResult {
        throw new Error('transpile not implemented for ' + Object.getPrototypeOf(this).constructor.name);
    }

    getTypedef(state: TranspileState) {
        const result = [];
        if (this.name) {
            for (let annotation of this.annotations ?? []) {
                result.push(
                    ...annotation.getTypedef(state),
                    state.newline(),
                    state.indent()
                );
            }

            let type = this.getType();
            if (isInvalidType(type) || isVoidType(type)) {
                type = new DynamicType();
            }

            result.push(
                this.accessModifier?.text ?? 'public',
                ' ',
                this.name?.text,
                ' as ',
                type.toTypeString()
            );
        }
        return result;
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (this.initialValue && options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'initialValue', visitor, options);
        }
    }
}
export type ClassMemberStatement = ClassFieldStatement | ClassMethodStatement;

export class TryCatchStatement extends Statement {
    constructor(
        public tryToken: Token,
        public tryBranch?: Block,
        public catchToken?: Token,
        public exceptionVariable?: Identifier,
        public catchBranch?: Block,
        public endTryToken?: Token
    ) {
        super();
    }

    public get range() {
        return util.createRangeFromPositions(
            this.tryToken.range.start,
            (this.endTryToken ?? this.catchBranch ?? this.exceptionVariable ?? this.catchToken ?? this.tryBranch ?? this.tryToken).range.end
        );
    }

    public transpile(state: TranspileState): TranspileResult {
        return [
            state.tokenToSourceNode(this.tryToken),
            ...this.tryBranch.transpile(state),
            state.newline(),
            state.indent(),
            state.tokenToSourceNode(this.catchToken),
            ' ',
            state.tokenToSourceNode(this.exceptionVariable),
            ...this.catchBranch.transpile(state),
            state.newline(),
            state.indent(),
            state.tokenToSourceNode(this.endTryToken)
        ];
    }

    public walk(visitor: WalkVisitor, options: WalkOptions) {
        if (this.tryBranch && options.walkMode & InternalWalkMode.walkStatements) {
            walk(this, 'tryBranch', visitor, options);
            walk(this, 'catchBranch', visitor, options);
        }
    }
}

export class ThrowStatement extends Statement {
    constructor(
        public throwToken: Token,
        public expression?: Expression
    ) {
        super();
        this.range = util.createRangeFromPositions(
            this.throwToken.range.start,
            (this.expression ?? this.throwToken).range.end
        );
    }
    public range: Range;

    public transpile(state: TranspileState) {
        const result = [
            state.tokenToSourceNode(this.throwToken),
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
}
