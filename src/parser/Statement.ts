import { Token, Identifier, TokenKind, CompoundAssignmentOperators } from '../lexer';
import { SourceNode } from 'source-map';
import { Expression, FunctionExpression, NamespacedVariableNameExpression, BinaryExpression } from './Expression';
import { util } from '../util';
import { Range, Position } from 'vscode-languageserver';
import { TranspileState } from './TranspileState';
import { ParseMode } from './Parser';
import { walk, WalkVisitor, WalkOptions } from '../astUtils/visitors';

/**
 * A BrightScript statement
 */
export interface Statement {
    /**
     *  The starting and ending location of the statement.
     **/
    range: Range;

    transpile(state: TranspileState): Array<SourceNode | string>;
    walk(visitor: WalkVisitor, options?: WalkOptions);
}

export class EmptyStatement implements Statement {
    range: Range;

    transpile(state: TranspileState) {
        return [];
    }
    walk(visitor: WalkVisitor, options?: WalkOptions) {
        //nothing to walk
    }
}

export class Body implements Statement {
    constructor(
        public statements: Statement[] = []
    ) {
    }

    public get range() {
        return Range.create(
            this.statements[0]?.range.start ?? Position.create(0, 0),
            this.statements[this.statements.length - 1]?.range.end ?? Position.create(0, 0)
        );
    }

    transpile(state: TranspileState) {
        let result = [] as Array<string | SourceNode>;
        for (let i = 0; i < this.statements.length; i++) {
            let statement = this.statements[i];
            let previousStatement = this.statements[i - 1];
            let nextStatement = this.statements[i + 1];

            if (!previousStatement) {
                //this is the first statement. do nothing related to spacing and newlines

                //if comment is on same line as prior sibling
            } else if (statement instanceof CommentStatement && previousStatement && statement.range.start.line === previousStatement.range.end.line) {
                result.push(
                    ' '
                );

                //add double newline if this is a comment, and next is a function
            } else if (statement instanceof CommentStatement && nextStatement && nextStatement instanceof FunctionStatement) {
                result.push('\n\n');

                //add double newline if is function not preceeded by a comment
            } else if (statement instanceof FunctionStatement && previousStatement && !(previousStatement instanceof CommentStatement)) {
                result.push('\n\n');
            } else {
                //separate statements by a single newline
                result.push('\n');
            }

            result.push(...statement.transpile(state));
        }
        return result;
    }

    walk(visitor: WalkVisitor, options?: WalkOptions) {
        for (let i = 0; i < this.statements.length; i++) {
            walk(this.statements, i, visitor, options, this);
        }
    }
}

export class AssignmentStatement implements Statement {
    constructor(
        readonly equals: Token,
        readonly name: Identifier,
        readonly value: Expression,
        readonly containingFunction: FunctionExpression
    ) {
        this.range = Range.create(this.name.range.start, this.value.range.end);
    }

    public readonly range: Range;

    transpile(state: TranspileState) {
        //if the value is a compound assignment, just transpile the expression itself
        if (CompoundAssignmentOperators.includes((this.value as BinaryExpression)?.operator?.kind)) {
            return this.value.transpile(state);
        } else {
            return [
                new SourceNode(this.name.range.start.line + 1, this.name.range.start.character, state.pathAbsolute, this.name.text),
                ' ',
                new SourceNode(this.equals.range.start.line + 1, this.equals.range.start.character, state.pathAbsolute, '='),
                ' ',
                ...this.value.transpile(state)
            ];
        }
    }

    walk(visitor: WalkVisitor, options?: WalkOptions) {
        if (options?.walkExpressions) {
            walk(this, 'value', visitor, options);
        }
    }
}

export class Block implements Statement {
    constructor(
        readonly statements: Statement[],
        readonly startingRange: Range
    ) {
        this.range = Range.create(
            this.startingRange.start,
            this.statements.length
                ? this.statements[this.statements.length - 1].range.end
                : this.startingRange.start
        );
    }

    public readonly range: Range;

    transpile(state: TranspileState) {
        state.blockDepth++;
        let results = [] as Array<SourceNode | string>;
        for (let i = 0; i < this.statements.length; i++) {
            let previousStatement = this.statements[i - 1];
            let statement = this.statements[i];

            //if comment is on same line as parent
            if (statement instanceof CommentStatement &&
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

    walk(visitor: WalkVisitor, options?: WalkOptions) {
        for (let i = 0; i < this.statements.length; i++) {
            walk(this.statements, i, visitor, options, this);
        }
    }
}

export class ExpressionStatement implements Statement {
    constructor(
        readonly expression: Expression
    ) {
        this.range = this.expression.range;
    }

    public readonly range: Range;

    transpile(state: TranspileState) {
        return this.expression.transpile(state);
    }

    walk(visitor: WalkVisitor, options?: WalkOptions) {
        if (options?.walkExpressions) {
            walk(this, 'expression', visitor, options);
        }
    }
}

export class CommentStatement implements Statement, Expression {
    constructor(
        public comments: Token[]
    ) {
        if (this.comments?.length > 0) {
            this.range = Range.create(
                this.comments[0].range.start,
                this.comments[this.comments.length - 1].range.end
            );
        }
    }

    public range: Range;

    get text() {
        return this.comments.map(x => x.text).join('\n');
    }

    transpile(state: TranspileState): Array<SourceNode | string> {
        let result = [];
        for (let i = 0; i < this.comments.length; i++) {
            let comment = this.comments[i];
            if (i > 0) {
                result.push(state.indent());
            }
            result.push(
                new SourceNode(comment.range.start.line + 1, comment.range.start.character, state.pathAbsolute, comment.text)
            );
            //add newline for all except final comment
            if (i < this.comments.length - 1) {
                result.push('\n');
            }
        }
        return result;
    }

    walk(visitor: WalkVisitor, options?: WalkOptions) {
        //nothing to walk
    }
}

export class ExitForStatement implements Statement {
    constructor(
        readonly tokens: {
            exitFor: Token;
        }
    ) {
        this.range = this.tokens.exitFor.range;
    }

    public readonly range: Range;

    transpile(state: TranspileState): Array<SourceNode | string> {
        return [
            new SourceNode(this.tokens.exitFor.range.start.line + 1, this.tokens.exitFor.range.start.character, state.pathAbsolute, 'exit for')
        ];
    }

    walk(visitor: WalkVisitor, options?: WalkOptions) {
        //nothing to walk
    }

}

export class ExitWhileStatement implements Statement {
    constructor(
        readonly tokens: {
            exitWhile: Token;
        }
    ) {
        this.range = this.tokens.exitWhile.range;
    }

    public readonly range: Range;

    transpile(state: TranspileState): Array<SourceNode | string> {
        return [
            new SourceNode(this.tokens.exitWhile.range.start.line + 1, this.tokens.exitWhile.range.start.character, state.pathAbsolute, 'exit while')
        ];
    }

    walk(visitor: WalkVisitor, options?: WalkOptions) {
        //nothing to walk
    }
}

export class FunctionStatement implements Statement {
    constructor(
        public name: Identifier,
        public func: FunctionExpression,
        public namespaceName: NamespacedVariableNameExpression
    ) {
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

    walk(visitor: WalkVisitor, options?: WalkOptions) {
        if (options?.walkExpressions) {
            walk(this, 'func', visitor, options);
        }
    }
}

export interface ElseIf {
    elseIfToken: Token;
    thenToken?: Token;
    condition: Expression;
    thenBranch: Block;
}

export class IfStatement implements Statement {
    constructor(
        readonly tokens: {
            if: Token;
            then?: Token;
            else?: Token;
            endIf?: Token;
        },
        readonly condition: Expression,
        readonly thenBranch: Block,
        readonly elseIfs: ElseIf[],
        readonly elseBranch?: Block
    ) {
        this.range = Range.create(
            this.tokens.if.range.start,
            (this.tokens.endIf ?? this.elseBranch ?? this.elseIfs?.[this.elseIfs?.length - 1]?.thenBranch ?? this.thenBranch).range.end
        );
    }
    public readonly range: Range;

    transpile(state: TranspileState) {
        let results = [];
        //if   (already indented by block)
        results.push(new SourceNode(this.tokens.if.range.start.line + 1, this.tokens.if.range.start.character, state.pathAbsolute, 'if'));
        results.push(' ');
        //conditions
        results.push(...this.condition.transpile(state));
        results.push(' ');
        //then
        if (this.tokens.then) {
            results.push(
                new SourceNode(this.tokens.then.range.start.line + 1, this.tokens.then.range.start.character, state.pathAbsolute, 'then')
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

        //else if blocks
        for (let elseif of this.elseIfs) {
            //elseif
            results.push(
                state.indent(),
                new SourceNode(elseif.elseIfToken.range.start.line + 1, elseif.elseIfToken.range.start.character, state.pathAbsolute, 'else if'),
                ' '
            );

            //condition
            results.push(...elseif.condition.transpile(state));
            //then
            results.push(' ');
            if (elseif.thenToken) {
                results.push(
                    new SourceNode(elseif.thenToken.range.start.line + 1, elseif.thenToken.range.start.character, state.pathAbsolute, 'then')
                );
            } else {
                results.push('then');
            }

            //then body
            state.lineage.unshift(elseif.thenBranch);
            let body = elseif.thenBranch.transpile(state);
            state.lineage.shift();

            if (body.length > 0) {
                results.push(...body);
            }
            results.push('\n');
        }

        //else branch
        if (this.tokens.else) {
            //else
            results.push(
                state.indent(),
                new SourceNode(this.tokens.else.range.start.line + 1, this.tokens.else.range.start.character, state.pathAbsolute, 'else')
            );

            //then body
            state.lineage.unshift(this.elseBranch);
            let body = this.elseBranch.transpile(state);
            state.lineage.shift();

            if (body.length > 0) {
                results.push(...body);
            }
            results.push('\n');
        }
        //end if
        results.push(state.indent());
        if (this.tokens.endIf) {
            results.push(
                new SourceNode(this.tokens.endIf.range.start.line + 1, this.tokens.endIf.range.start.character, state.pathAbsolute, 'end if')
            );
        } else {
            results.push('end if');
        }

        return results;
    }

    walk(visitor: WalkVisitor, options?: WalkOptions) {
        if (options?.walkExpressions) {
            walk(this, 'condition', visitor, options);
        }
        walk(this, 'thenBranch', visitor, options);

        for (let i = 0; i < this.elseIfs.length; i++) {
            if (options?.walkExpressions) {
                walk(this.elseIfs[i], 'condition', visitor, options, this);
            }
            walk(this.elseIfs[i], 'thenBranch', visitor, options, this);
        }

        if (this.elseBranch) {
            walk(this, 'elseBranch', visitor, options);
        }
    }
}

export class IncrementStatement implements Statement {
    constructor(
        readonly value: Expression,
        readonly operator: Token
    ) {
        this.range = Range.create(this.value.range.start, this.operator.range.end);
    }

    public readonly range: Range;


    transpile(state: TranspileState): Array<SourceNode | string> {
        return [
            ...this.value.transpile(state),
            new SourceNode(this.operator.range.start.line + 1, this.operator.range.start.character, state.pathAbsolute, this.operator.text)
        ];
    }

    walk(visitor: WalkVisitor, options?: WalkOptions) {
        if (options?.walkExpressions) {
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
export class PrintStatement implements Statement {
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
        this.range = Range.create(
            this.tokens.print.range.start,
            this.expressions.length
                ? this.expressions[this.expressions.length - 1].range.end
                : this.tokens.print.range.end
        );
    }

    public readonly range: Range;

    transpile(state: TranspileState) {
        let result = [
            new SourceNode(this.tokens.print.range.start.line + 1, this.tokens.print.range.start.character, state.pathAbsolute, 'print'),
            ' '
        ];
        for (let i = 0; i < this.expressions.length; i++) {
            let expression: any = this.expressions[i];
            if (expression.transpile) {
                //separate print statements with a semi-colon
                if (i > 0) {
                    result.push(' ; ');
                }
                result.push(...(expression as ExpressionStatement).transpile(state));
            } else {
                //skip these because I think they are bogus items only added for use in the runtime
            }
        }
        return result;
    }
    walk(visitor: WalkVisitor, options?: WalkOptions) {
        if (options?.walkExpressions) {
            for (let i = 0; i < this.expressions.length; i++) {
                //TODO the original walk code did an `isExpression()` check before walking. Do we need that?
                walk(this.expressions, i, visitor, options, this);
            }
        }
    }
}

export class GotoStatement implements Statement {
    constructor(
        readonly tokens: {
            goto: Token;
            label: Token;
        }
    ) {
        this.range = Range.create(this.tokens.goto.range.start, this.tokens.label.range.end);
    }

    public readonly range: Range;

    transpile(state: TranspileState): Array<SourceNode | string> {
        return [
            new SourceNode(this.tokens.goto.range.start.line + 1, this.tokens.goto.range.start.character, state.pathAbsolute, 'goto'),
            ' ',
            new SourceNode(this.tokens.label.range.start.line + 1, this.tokens.label.range.start.character, state.pathAbsolute, this.tokens.label.text)
        ];
    }

    walk(visitor: WalkVisitor, options?: WalkOptions) {
        //nothing to walk
    }
}

export class LabelStatement implements Statement {
    constructor(
        readonly tokens: {
            identifier: Token;
            colon: Token;
        }
    ) {
        this.range = Range.create(this.tokens.identifier.range.start, this.tokens.colon.range.end);
    }

    public readonly range: Range;

    transpile(state: TranspileState): Array<SourceNode | string> {
        return [
            new SourceNode(this.tokens.identifier.range.start.line + 1, this.tokens.identifier.range.start.character, state.pathAbsolute, this.tokens.identifier.text),
            new SourceNode(this.tokens.colon.range.start.line + 1, this.tokens.colon.range.start.character, state.pathAbsolute, ':')

        ];
    }

    walk(visitor: WalkVisitor, options?: WalkOptions) {
        //nothing to walk
    }
}

export class ReturnStatement implements Statement {
    constructor(
        readonly tokens: {
            return: Token;
        },
        readonly value?: Expression
    ) {
        this.range = Range.create(
            this.tokens.return.range.start,
            (this.value && this.value.range.end) || this.tokens.return.range.end
        );
    }

    public readonly range: Range;

    transpile(state: TranspileState) {
        let result = [];
        result.push(
            new SourceNode(this.tokens.return.range.start.line + 1, this.tokens.return.range.start.character, state.pathAbsolute, 'return')
        );
        if (this.value) {
            result.push(' ');
            result.push(...this.value.transpile(state));
        }
        return result;
    }

    walk(visitor: WalkVisitor, options?: WalkOptions) {
        if (options?.walkExpressions) {
            walk(this, 'value', visitor, options);
        }
    }
}

export class EndStatement implements Statement {
    constructor(
        readonly tokens: {
            end: Token;
        }
    ) {
        this.range = Range.create(this.tokens.end.range.start, this.tokens.end.range.end);
    }

    public readonly range: Range;

    transpile(state: TranspileState) {
        return [
            new SourceNode(this.tokens.end.range.start.line + 1, this.tokens.end.range.start.character, state.pathAbsolute, 'end')
        ];
    }

    walk(visitor: WalkVisitor, options?: WalkOptions) {
        //nothing to walk
    }
}

export class StopStatement implements Statement {
    constructor(
        readonly tokens: {
            stop: Token;
        }
    ) {
        this.range = Range.create(this.tokens.stop.range.start, this.tokens.stop.range.end);
    }

    public readonly range: Range;

    transpile(state: TranspileState) {
        return [
            new SourceNode(this.tokens.stop.range.start.line + 1, this.tokens.stop.range.start.character, state.pathAbsolute, 'stop')
        ];
    }

    walk(visitor: WalkVisitor, options?: WalkOptions) {
        //nothing to walk
    }
}

export class ForStatement implements Statement {
    constructor(
        readonly tokens: {
            for: Token;
            to: Token;
            step?: Token;
            endFor: Token;
        },
        readonly counterDeclaration: AssignmentStatement,
        readonly finalValue: Expression,
        readonly increment: Expression,
        readonly body: Block
    ) {
        this.range = Range.create(this.tokens.for.range.start, this.tokens.endFor.range.end);
    }

    public readonly range: Range;

    transpile(state: TranspileState) {
        let result = [];
        //for
        result.push(
            new SourceNode(this.tokens.for.range.start.line + 1, this.tokens.for.range.start.character, state.pathAbsolute, 'for'),
            ' '
        );
        //i=1
        result.push(
            ...this.counterDeclaration.transpile(state),
            ' '
        );
        //to
        result.push(
            new SourceNode(this.tokens.to.range.start.line + 1, this.tokens.to.range.start.character, state.pathAbsolute, 'to'),
            ' '
        );
        //final value
        result.push(this.finalValue.transpile(state));
        //step
        if (this.tokens.step) {
            result.push(
                ' ',
                new SourceNode(this.tokens.step.range.start.line + 1, this.tokens.step.range.start.character, state.pathAbsolute, 'step'),
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
            new SourceNode(this.tokens.endFor.range.start.line + 1, this.tokens.endFor.range.start.character, state.pathAbsolute, 'end for')
        );

        return result;
    }

    walk(visitor: WalkVisitor, options?: WalkOptions) {
        walk(this, 'counterDeclaration', visitor, options);
        if (options?.walkExpressions) {
            walk(this, 'finalValue', visitor, options);
            walk(this, 'increment', visitor, options);
        }
        walk(this, 'body', visitor, options);
    }
}

export class ForEachStatement implements Statement {
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
        this.range = Range.create(this.tokens.forEach.range.start, this.tokens.endFor.range.end);
    }

    public readonly range: Range;

    transpile(state: TranspileState) {
        let result = [];
        //for each
        result.push(
            new SourceNode(this.tokens.forEach.range.start.line + 1, this.tokens.forEach.range.start.character, state.pathAbsolute, 'for each'),
            ' '
        );
        //item
        result.push(
            new SourceNode(this.tokens.forEach.range.start.line + 1, this.tokens.forEach.range.start.character, state.pathAbsolute, this.item.text),
            ' '
        );
        //in
        result.push(
            new SourceNode(this.tokens.in.range.start.line + 1, this.tokens.in.range.start.character, state.pathAbsolute, 'in'),
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
            new SourceNode(this.tokens.endFor.range.start.line + 1, this.tokens.endFor.range.start.character, state.pathAbsolute, 'end for')
        );
        return result;
    }

    walk(visitor: WalkVisitor, options?: WalkOptions) {
        if (options?.walkExpressions) {
            walk(this, 'target', visitor, options);
        }
        walk(this, 'body', visitor, options);
    }
}

export class WhileStatement implements Statement {
    constructor(
        readonly tokens: {
            while: Token;
            endWhile: Token;
        },
        readonly condition: Expression,
        readonly body: Block
    ) {
        this.range = Range.create(this.tokens.while.range.start, this.tokens.endWhile.range.end);
    }

    public readonly range: Range;

    transpile(state: TranspileState) {
        let result = [];
        //while
        result.push(
            new SourceNode(this.tokens.while.range.start.line + 1, this.tokens.while.range.start.character, state.pathAbsolute, 'while'),
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
            new SourceNode(this.tokens.endWhile.range.start.line + 1, this.tokens.endWhile.range.start.character, state.pathAbsolute, 'end while')
        );

        return result;
    }

    walk(visitor: WalkVisitor, options?: WalkOptions) {
        if (options.walkExpressions) {
            walk(this, 'condition', visitor, options);
        }
        walk(this, 'body', visitor, options);
    }
}

export class DottedSetStatement implements Statement {
    constructor(
        readonly obj: Expression,
        readonly name: Identifier,
        readonly value: Expression
    ) {
        this.range = Range.create(this.obj.range.start, this.value.range.end);
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
                new SourceNode(this.name.range.start.line + 1, this.name.range.start.character, state.pathAbsolute, this.name.text),
                ' = ',
                //right-hand-side of assignment
                ...this.value.transpile(state)
            ];
        }
    }

    walk(visitor: WalkVisitor, options?: WalkOptions) {
        if (options?.walkExpressions) {
            walk(this, 'obj', visitor, options);
            walk(this, 'value', visitor, options);
        }
    }
}

export class IndexedSetStatement implements Statement {
    constructor(
        readonly obj: Expression,
        readonly index: Expression,
        readonly value: Expression,
        readonly openingSquare: Token,
        readonly closingSquare: Token
    ) {
        this.range = Range.create(this.obj.range.start, this.value.range.end);
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
                new SourceNode(this.openingSquare.range.start.line + 1, this.openingSquare.range.start.character, state.pathAbsolute, '['),
                //    index
                ...this.index.transpile(state),
                //         ]
                new SourceNode(this.closingSquare.range.start.line + 1, this.closingSquare.range.start.character, state.pathAbsolute, ']'),
                //           =
                ' = ',
                //             value
                ...this.value.transpile(state)
            ];
        }
    }

    walk(visitor: WalkVisitor, options?: WalkOptions) {
        if (options?.walkExpressions) {
            walk(this, 'obj', visitor, options);
            walk(this, 'index', visitor, options);
            walk(this, 'value', visitor, options);
        }
    }
}

export class LibraryStatement implements Statement {
    constructor(
        readonly tokens: {
            library: Token;
            filePath: Token | undefined;
        }
    ) {
        this.range = Range.create(
            this.tokens.library.range.start,
            this.tokens.filePath ? this.tokens.filePath.range.end : this.tokens.library.range.end
        );
    }

    public readonly range: Range;

    transpile(state: TranspileState) {
        let result = [];
        result.push(
            new SourceNode(this.tokens.library.range.start.line + 1, this.tokens.library.range.start.character, state.pathAbsolute, 'library')
        );
        //there will be a parse error if file path is missing, but let's prevent a runtime error just in case
        if (this.tokens.filePath) {
            result.push(
                ' ',
                new SourceNode(this.tokens.filePath.range.start.line + 1, this.tokens.filePath.range.start.character, state.pathAbsolute, this.tokens.filePath.text)
            );
        }
        return result;
    }

    walk(visitor: WalkVisitor, options?: WalkOptions) {
        //nothing to walk
    }
}

export class NamespaceStatement implements Statement {
    constructor(
        public keyword: Token,
        //this should technically only be a VariableExpression or DottedGetExpression, but that can be enforced elsewhere
        public nameExpression: NamespacedVariableNameExpression,
        public body: Body,
        public endKeyword: Token
    ) {
        this.name = this.nameExpression.getName(ParseMode.BrighterScript);
    }

    /**
     * The string name for this namespace
     */
    public name: string;

    public get range() {
        return Range.create(
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

    walk(visitor: WalkVisitor, options?: WalkOptions) {
        if (options?.walkExpressions) {
            walk(this, 'nameExpression', visitor, options);
        }
        if (this.body.statements.length > 0) {
            walk(this, 'body', visitor, options);
        }
    }
}

export class ImportStatement implements Statement {
    constructor(
        readonly importToken: Token,
        readonly filePathToken: Token
    ) {
        this.range = Range.create(
            importToken.range.start,
            (filePathToken ?? importToken).range.end
        );
        if (this.filePathToken) {
            //remove quotes
            this.filePath = this.filePathToken.text.replace(/"/g, '');
            //adjust the range to exclude the quotes
            this.filePathToken.range = Range.create(
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
            new SourceNode(
                this.range.start.line + 1,
                this.range.start.character,
                state.file.pathAbsolute,
                `'${this.importToken.text} ${this.filePathToken.text}`
            )
        ];
    }

    walk(visitor: WalkVisitor, options?: WalkOptions) {
        //nothing to walk
    }
}
