import { Token, Identifier, Location, TokenKind } from '../lexer';
import { SourceNode } from 'source-map';
import { Stmt } from '.';
import { TranspileState, indent, Expression, FunctionExpression } from './Expression';
import { util } from '../../util';

/** A BrightScript statement */
export interface Statement {
    /** The starting and ending location of the expression. */
    location: Location;

    transpile(state: TranspileState): Array<SourceNode | string>;
}

export class AssignmentStatement implements Statement {
    constructor(
        readonly tokens: {
            equals: Token;
        },
        readonly name: Identifier,
        readonly value: Expression
    ) { }

    get location() {
        return {
            start: this.name.location.start,
            end: this.value.location.end
        };
    }

    transpile(state: TranspileState) {
        return [
            new SourceNode(this.name.location.start.line, this.name.location.start.column, state.pathAbsolute, this.name.text),
            ' ',
            new SourceNode(this.tokens.equals.location.start.line, this.tokens.equals.location.start.column, state.pathAbsolute, '='),
            ' ',
            ...this.value.transpile(state)
        ];
    }
}

export class Block implements Statement {
    constructor(
        readonly statements: Statement[],
        readonly startingLocation: Location
    ) { }

    get location() {
        let end = this.statements.length
            ? this.statements[this.statements.length - 1].location.end
            : this.startingLocation.start;

        return {
            start: this.startingLocation.start,
            end: end
        };
    }

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
                //add a newline
                results.push('\n');
                //indent
                results.push(indent(state.blockDepth));
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
}

export class ExpressionStatement implements Statement {
    constructor(
        readonly expression: Expression
    ) { }

    get location() {
        return this.expression.location;
    }

    transpile(state: TranspileState) {
        return this.expression.transpile(state);
    }
}

export class CommentStatement implements Statement, Expression {
    constructor(
        public comments: Token[]
    ) { }

    get location() {
        return {
            start: this.comments[0].location.start,
            end: this.comments[this.comments.length - 1].location.end
        };
    }

    get text() {
        return this.comments.map(x => x.text).join('\n');
    }

    transpile(state: TranspileState): Array<SourceNode | string> {
        let result = [];
        for (let i = 0; i < this.comments.length; i++) {
            let comment = this.comments[i];
            if (i > 0) {
                result.push(indent(state.blockDepth));
            }
            result.push(
                new SourceNode(comment.location.start.line, comment.location.start.column, state.pathAbsolute, comment.text)
            );
            //add newline for all except final comment
            if (i < this.comments.length - 1) {
                result.push('\n');
            }
        }
        return result;
    }
}

export class ExitForStatement implements Statement {
    constructor(
        readonly tokens: {
            exitFor: Token;
        }
    ) { }

    get location() {
        return this.tokens.exitFor.location;
    }

    transpile(state: TranspileState): Array<SourceNode | string> {
        return [
            new SourceNode(this.tokens.exitFor.location.start.line, this.tokens.exitFor.location.start.column, state.pathAbsolute, 'exit for')
        ];
    }
}

export class ExitWhileStatement implements Statement {
    constructor(
        readonly tokens: {
            exitWhile: Token;
        }
    ) { }

    get location() {
        return this.tokens.exitWhile.location;
    }

    transpile(state: TranspileState): Array<SourceNode | string> {
        return [
            new SourceNode(this.tokens.exitWhile.location.start.line, this.tokens.exitWhile.location.start.column, state.pathAbsolute, 'exit while')
        ];
    }
}

export class FunctionStatement implements Statement {
    constructor(readonly name: Identifier, readonly func: FunctionExpression) { }

    get location() {
        return {
            start: this.func.location.start,
            end: this.func.location.end
        };
    }

    transpile(state: TranspileState) {
        return this.func.transpile(state, this.name);
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
            // TODO: figure a decent way to represent the if/then + elseif/then pairs to enable a
            // linter to check for the lack of `then` with this AST. maybe copy ESTree's format?
            elseIfs?: Token[];
            else?: Token;
            endIf?: Token;
        },
        readonly condition: Expression,
        readonly thenBranch: Block,
        readonly elseIfs: ElseIf[],
        readonly elseBranch?: Block
    ) { }

    private getEndLocation(): Location {
        if (this.tokens.endIf) {
            return this.tokens.endIf.location;
        } else if (this.elseBranch) {
            return this.elseBranch.location;
        } else if (this.elseIfs.length) {
            return this.elseIfs[this.elseIfs.length - 1].thenBranch.location;
        } else {
            return this.thenBranch.location;
        }
    }

    get location() {
        return {
            start: this.tokens.if.location.start,
            end: this.getEndLocation().end
        };
    }

    transpile(state: TranspileState) {
        let results = [];
        //if   (already indented by block)
        results.push(new SourceNode(this.tokens.if.location.start.line, this.tokens.if.location.start.column, state.pathAbsolute, 'if'));
        results.push(' ');
        //conditions
        results.push(...this.condition.transpile(state));
        results.push(' ');
        //then
        if (this.tokens.then) {
            results.push(
                new SourceNode(this.tokens.then.location.start.line, this.tokens.then.location.start.column, state.pathAbsolute, 'then')
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
            results.push('\n');
        }

        //else if blocks
        for (let elseif of this.elseIfs) {
            //elseif
            results.push(
                indent(state.blockDepth),
                new SourceNode(elseif.elseIfToken.location.start.line, elseif.elseIfToken.location.start.column, state.pathAbsolute, 'else if'),
                ' '
            );

            //condition
            results.push(...elseif.condition.transpile(state));
            //then
            results.push(' ');
            if (elseif.thenToken) {
                results.push(
                    new SourceNode(elseif.thenToken.location.start.line, elseif.thenToken.location.start.column, state.pathAbsolute, 'then')
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
                results.push('\n');
            }
        }

        //else branch
        if (this.tokens.else) {
            //else
            results.push(
                indent(state.blockDepth),
                new SourceNode(this.tokens.else.location.start.line, this.tokens.else.location.start.column, state.pathAbsolute, 'else')
            );

            //then body
            state.lineage.unshift(this.elseBranch);
            let body = this.elseBranch.transpile(state);
            state.lineage.shift();

            if (body.length > 0) {
                results.push(...body);
                results.push('\n');
            }
        }
        //end if
        results.push(indent(state.blockDepth));
        if (this.tokens.endIf) {
            results.push(
                new SourceNode(this.tokens.endIf.location.start.line, this.tokens.endIf.location.start.column, state.pathAbsolute, 'end if')
            );
        } else {
            results.push('end if');
        }

        return results;
    }
}

export class IncrementStatement implements Statement {
    constructor(readonly value: Expression, readonly operator: Token) { }

    get location() {
        return {
            start: this.value.location.start,
            end: this.operator.location.end
        };
    }

    transpile(state: TranspileState): Array<SourceNode | string> {
        return [
            ...this.value.transpile(state),
            new SourceNode(this.operator.location.start.line, this.operator.location.start.column, state.pathAbsolute, this.operator.text)
        ];
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
        readonly expressions: Array<Expression | PrintSeparatorTab | Stmt.PrintSeparatorSpace>
    ) { }

    get location() {
        let end = this.expressions.length
            ? this.expressions[this.expressions.length - 1].location.end
            : this.tokens.print.location.end;

        return {
            start: this.tokens.print.location.start,
            end: end
        };
    }

    transpile(state: TranspileState) {
        let result = [
            new SourceNode(this.tokens.print.location.start.line, this.tokens.print.location.start.column, state.pathAbsolute, 'print'),
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
}

export class GotoStatement implements Statement {
    constructor(
        readonly tokens: {
            goto: Token;
            label: Token;
        }
    ) { }

    get location() {
        return {
            start: this.tokens.goto.location.start,
            end: this.tokens.label.location.end
        };
    }

    transpile(state: TranspileState): Array<SourceNode | string> {
        return [
            new SourceNode(this.tokens.goto.location.start.line, this.tokens.goto.location.start.column, state.pathAbsolute, 'goto'),
            ' ',
            new SourceNode(this.tokens.label.location.start.line, this.tokens.label.location.start.column, state.pathAbsolute, this.tokens.label.text)
        ];
    }
}

export class LabelStatement implements Statement {
    constructor(
        readonly tokens: {
            identifier: Token;
            colon: Token;
        }
    ) { }

    get location() {
        return {
            start: this.tokens.identifier.location.start,
            end: this.tokens.colon.location.end
        };
    }

    transpile(state: TranspileState): Array<SourceNode | string> {
        return [
            new SourceNode(this.tokens.identifier.location.start.line, this.tokens.identifier.location.start.column, state.pathAbsolute, this.tokens.identifier.text),
            new SourceNode(this.tokens.colon.location.start.line, this.tokens.colon.location.start.column, state.pathAbsolute, ':')

        ];
    }
}

export class ReturnStatement implements Statement {
    constructor(
        readonly tokens: {
            return: Token;
        },
        readonly value?: Expression
    ) { }

    get location() {
        return {
            start: this.tokens.return.location.start,
            end: (this.value && this.value.location.end) || this.tokens.return.location.end
        };
    }

    transpile(state: TranspileState) {
        let result = [];
        result.push(
            new SourceNode(this.tokens.return.location.start.line, this.tokens.return.location.start.column, state.pathAbsolute, 'return')
        );
        if (this.value) {
            result.push(' ');
            result.push(...this.value.transpile(state));
        }
        return result;
    }
}

export class EndStatement implements Statement {
    constructor(
        readonly tokens: {
            end: Token;
        }
    ) { }

    get location() {
        return {
            start: this.tokens.end.location.start,
            end: this.tokens.end.location.end
        };
    }

    transpile(state: TranspileState) {
        return [
            new SourceNode(this.tokens.end.location.start.line, this.tokens.end.location.start.column, state.pathAbsolute, 'end')
        ];
    }
}

export class StopStatement implements Statement {
    constructor(
        readonly tokens: {
            stop: Token;
        }
    ) { }

    get location() {
        return {
            start: this.tokens.stop.location.start,
            end: this.tokens.stop.location.end
        };
    }

    transpile(state: TranspileState) {
        return [
            new SourceNode(this.tokens.stop.location.start.line, this.tokens.stop.location.start.column, state.pathAbsolute, 'stop')
        ];
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
    ) { }

    get location() {
        return {
            start: this.tokens.for.location.start,
            end: this.tokens.endFor.location.end
        };
    }

    transpile(state: TranspileState) {
        let result = [];
        //for
        result.push(
            new SourceNode(this.tokens.for.location.start.line, this.tokens.for.location.start.column, state.pathAbsolute, 'for'),
            ' '
        );
        //i=1
        result.push(
            ...this.counterDeclaration.transpile(state),
            ' '
        );
        //to
        result.push(
            new SourceNode(this.tokens.to.location.start.line, this.tokens.to.location.start.column, state.pathAbsolute, 'to'),
            ' '
        );
        //final value
        result.push(this.finalValue.transpile(state));
        //step
        if (this.tokens.step) {
            result.push(
                ' ',
                new SourceNode(this.tokens.step.location.start.line, this.tokens.step.location.start.column, state.pathAbsolute, 'step'),
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
            indent(state.blockDepth),
            new SourceNode(this.tokens.endFor.location.start.line, this.tokens.endFor.location.start.column, state.pathAbsolute, 'end for')
        );

        return result;
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
    ) { }

    get location() {
        return {
            start: this.tokens.forEach.location.start,
            end: this.tokens.endFor.location.end
        };
    }

    transpile(state: TranspileState) {
        let result = [];
        //for each
        result.push(
            new SourceNode(this.tokens.forEach.location.start.line, this.tokens.forEach.location.start.column, state.pathAbsolute, 'for each'),
            ' '
        );
        //item
        result.push(
            new SourceNode(this.tokens.forEach.location.start.line, this.tokens.forEach.location.start.column, state.pathAbsolute, this.item.text),
            ' '
        );
        //in
        result.push(
            new SourceNode(this.tokens.in.location.start.line, this.tokens.in.location.start.column, state.pathAbsolute, 'in'),
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
            indent(state.blockDepth),
            new SourceNode(this.tokens.endFor.location.start.line, this.tokens.endFor.location.start.column, state.pathAbsolute, 'end for')
        );
        return result;
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
    ) { }

    get location() {
        return {
            start: this.tokens.while.location.start,
            end: this.tokens.endWhile.location.end
        };
    }

    transpile(state: TranspileState) {
        let result = [];
        //while
        result.push(
            new SourceNode(this.tokens.while.location.start.line, this.tokens.while.location.start.column, state.pathAbsolute, 'while'),
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
            indent(state.blockDepth),
            new SourceNode(this.tokens.endWhile.location.start.line, this.tokens.endWhile.location.start.column, state.pathAbsolute, 'end while')
        );

        return result;
    }
}

export class DottedSetStatement implements Statement {
    constructor(
        readonly obj: Expression,
        readonly name: Identifier,
        readonly value: Expression
    ) { }

    get location() {
        return {
            start: this.obj.location.start,
            end: this.value.location.end
        };
    }

    transpile(state: TranspileState) {
        return [
            //object
            ...this.obj.transpile(state),
            '.',
            //name
            new SourceNode(this.name.location.start.line, this.name.location.start.column, state.pathAbsolute, this.name.text),
            ' = ',
            //right-hand-side of assignment
            ...this.value.transpile(state)
        ];
    }
}

export class IndexedSetStatement implements Statement {
    constructor(
        readonly obj: Expression,
        readonly index: Expression,
        readonly value: Expression,
        readonly openingSquare: Token,
        readonly closingSquare: Token
    ) { }

    get location() {
        return {
            start: this.obj.location.start,
            end: this.value.location.end
        };
    }

    transpile(state: TranspileState) {
        return [
            //obj
            ...this.obj.transpile(state),
            //   [
            new SourceNode(this.openingSquare.location.start.line, this.openingSquare.location.start.column, state.pathAbsolute, '['),
            //    index
            ...this.index.transpile(state),
            //         ]
            new SourceNode(this.closingSquare.location.start.line, this.closingSquare.location.start.column, state.pathAbsolute, ']'),
            //           =
            ' = ',
            //             value
            ...this.value.transpile(state)
        ];
    }
}

export class LibraryStatement implements Statement {
    constructor(
        readonly tokens: {
            library: Token;
            filePath: Token | undefined;
        }
    ) { }

    get location() {
        return {
            start: this.tokens.library.location.start,
            end: this.tokens.filePath ? this.tokens.filePath.location.end : this.tokens.library.location.end
        };
    }

    transpile(state: TranspileState) {
        let result = [];
        result.push(
            new SourceNode(this.tokens.library.location.start.line, this.tokens.library.location.start.column, state.pathAbsolute, 'library')
        );
        //there will be a parse error if file path is missing, but let's prevent a runtime error just in case
        if (this.tokens.filePath) {
            result.push(
                ' ',
                new SourceNode(this.tokens.filePath.location.start.line, this.tokens.filePath.location.start.column, state.pathAbsolute, this.tokens.filePath.text)
            );
        }
        return result;
    }
}

export class ClassStatement implements Statement {

    constructor(
        readonly keyword: Token,
        readonly name: Identifier,
        readonly members: ClassMemberStatement[],
        readonly end: Token
    ) {
        for (let member of this.members) {
            if (member instanceof ClassMethodStatement) {
                this.methods.push(member);
            } else if (member instanceof ClassFieldStatement) {
                this.fields.push(member);
            } else {
                throw new Error(`Critical error: unknown member type added to class definition ${this.name}`);
            }
        }
    }

    public methods = [] as ClassMethodStatement[];
    public fields = [] as ClassFieldStatement[];

    get location() {
        return {
            start: this.keyword.location.start,
            end: this.end.location.end
        };
    }

    transpile(state: TranspileState): Array<SourceNode | string> {
        throw new Error('transpile not implemented for ' + Object.getPrototypeOf(this).constructor.name);
    }
}

export class ClassMethodStatement implements Statement {
    constructor(
        readonly accessModifier: Token,
        readonly name: Identifier,
        readonly func: FunctionExpression
    ) { }

    get location() {
        return {
            start: this.accessModifier ? this.accessModifier.location.start : this.func.location.start,
            end: this.func.location.end
        };
    }

    transpile(state: TranspileState): Array<SourceNode | string> {
        throw new Error('transpile not implemented for ' + Object.getPrototypeOf(this).constructor.name);
    }
}

export class ClassFieldStatement implements Statement {

    constructor(
        readonly accessModifier: Token,
        readonly name: Identifier,
        readonly as: Token,
        readonly type: Token
    ) { }

    get location() {
        return {
            start: this.accessModifier.location.start,
            end: this.type.location.end
        };
    }

    transpile(state: TranspileState): Array<SourceNode | string> {
        throw new Error('transpile not implemented for ' + Object.getPrototypeOf(this).constructor.name);
    }
}
export type ClassMemberStatement = ClassFieldStatement | ClassMethodStatement;
