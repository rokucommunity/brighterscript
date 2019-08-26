//tslint:disable
import * as Expr from "./Expression";
import { Token, Identifier, Location, Lexeme } from "../lexer";
import { BrsType, BrsInvalid } from "../brsTypes";
import { SourceNode } from 'source-map';
import { Stmt } from '.';
import { TranspileState, indent } from './Expression';

/** A set of reasons why a `Block` stopped executing. */
export * from "./BlockEndReason";

export interface Visitor<T> {
    visitAssignment(statement: AssignmentStatement): BrsType;
    visitExpression(statement: ExpressionStatement): BrsType;
    visitExitFor(statement: ExitFor): never;
    visitExitWhile(statement: ExitWhile): never;
    visitPrint(statement: PrintStatement): BrsType;
    visitIf(statement: IfStatement): BrsType;
    visitBlock(block: Block): BrsType;
    visitFor(statement: ForStatement): BrsType;
    visitForEach(statement: ForEachStatement): BrsType;
    visitWhile(statement: WhileStatement): BrsType;
    visitNamedFunction(statement: FunctionStatement): BrsType;
    visitReturn(statement: Return): never;
    visitDottedSet(statement: DottedSetStatement): BrsType;
    visitIndexedSet(statement: IndexedSetStatement): BrsType;
    visitIncrement(expression: IncrementStatement): BrsInvalid;
}

/** A BrightScript statement */
export interface Statement {
    /**
     * Handles the enclosing `Statement` with `visitor`.
     * @param visitor the `Visitor` that will handle the enclosing `Statement`
     * @returns a BrightScript value (typically `invalid`) and the reason why
     *          the statement exited (typically `StopReason.End`)
     */
    accept<R>(visitor: Visitor<R>): BrsType;

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
        readonly value: Expr.Expression
    ) { }

    accept<R>(visitor: Visitor<R>): BrsType {
        return visitor.visitAssignment(this);
    }

    get location() {
        return {
            file: this.name.location.file,
            start: this.name.location.start,
            end: this.value.location.end,
        };
    }

    transpile(state: TranspileState) {
        return [
            new SourceNode(this.name.location.start.line, this.name.location.start.column, state.pkgPath, this.name.text),
            ' ',
            new SourceNode(this.tokens.equals.location.start.line, this.tokens.equals.location.start.column, state.pkgPath, '='),
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

    accept<R>(visitor: Visitor<R>): BrsType {
        return visitor.visitBlock(this);
    }

    get location() {
        let end = this.statements.length
            ? this.statements[this.statements.length - 1].location.end
            : this.startingLocation.start;

        return {
            file: this.startingLocation.file,
            start: this.startingLocation.start,
            end: end,
        };
    }

    transpile(state: TranspileState) {
        state.blockDepth++;
        let results = [] as Array<SourceNode | string>;
        for (let i = 0; i < this.statements.length; i++) {
            //every statement gets a newline (assumes already had newline for first item)
            if (this.statements[i - 1]) {
                results.push('\n');
            }
            results.push(
                indent(state.blockDepth),
                ...this.statements[i].transpile(state)
            );
        }
        state.blockDepth--;
        return results
    }
}

export class ExpressionStatement implements Statement {
    constructor(
        readonly expression: Expr.Expression
    ) { }

    accept<R>(visitor: Visitor<R>): BrsType {
        return visitor.visitExpression(this);
    }

    get location() {
        return this.expression.location;
    }

    transpile(state: TranspileState) {
        return this.expression.transpile(state);
    }
}

export class ExitFor implements Statement {
    constructor(
        readonly tokens: {
            exitFor: Token;
        }
    ) { }

    accept<R>(visitor: Visitor<R>): BrsType {
        return visitor.visitExitFor(this);
    }

    get location() {
        return this.tokens.exitFor.location;
    }

    transpile(state: TranspileState): Array<SourceNode | string> {
        return [
            new SourceNode(this.tokens.exitFor.location.start.line, this.tokens.exitFor.location.start.column, state.pkgPath, 'exit for')
        ];
    }
}

export class ExitWhile implements Statement {
    constructor(
        readonly tokens: {
            exitWhile: Token;
        }
    ) { }

    accept<R>(visitor: Visitor<R>): BrsType {
        return visitor.visitExitWhile(this);
    }

    get location() {
        return this.tokens.exitWhile.location;
    }

    transpile(state: TranspileState): Array<SourceNode | string> {
        return [
            new SourceNode(this.tokens.exitWhile.location.start.line, this.tokens.exitWhile.location.start.column, state.pkgPath, 'exit while')
        ];
    }
}

export class FunctionStatement implements Statement {
    constructor(readonly name: Identifier, readonly func: Expr.FunctionExpression) { }

    accept<R>(visitor: Visitor<R>): BrsType {
        return visitor.visitNamedFunction(this);
    }

    get location() {
        return {
            file: this.name.location.file,
            start: this.func.location.start,
            end: this.func.location.end,
        };
    }

    transpile(state: TranspileState) {
        return this.func.transpile(state, this.name);
    }
}

export class ClassMethodStatement implements Statement {
    constructor(
        readonly accessModifier: Token,
        readonly name: Identifier,
        readonly func: Expr.FunctionExpression
    ) { }

    accept<R>(visitor: Visitor<R>): BrsType {
        return visitor.visitNamedFunction(this as any);
    }

    get location() {
        return {
            file: this.name.location.file,
            start: this.accessModifier ? this.accessModifier.location.start : this.func.location.start,
            end: this.func.location.end,
        };
    }

    transpile(state: TranspileState): Array<SourceNode | string> {
        throw new Error('transpile not implemented for ' + (this as any).__proto__.constructor.name);
    }
}

export type ClassMemberStatement = ClassFieldStatement | ClassMethodStatement;

export class ClassFieldStatement implements Statement {

    constructor(
        readonly accessModifier: Token,
        readonly name: Identifier,
        readonly as: Token,
        readonly type: Token
    ) { }

    accept<R>(visitor: Visitor<R>): BrsType {
        throw new Error('Method not implemented.');
    }

    get location() {
        return {
            file: this.name.location.file,
            start: this.accessModifier.location.start,
            end: this.type.location.end
        };
    }

    transpile(state: TranspileState): Array<SourceNode | string> {
        throw new Error('transpile not implemented for ' + (this as any).__proto__.constructor.name);
    }
}

export interface ElseIf {
    elseIfToken: Token;
    thenToken?: Token;
    condition: Expr.Expression;
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
        readonly condition: Expr.Expression,
        readonly thenBranch: Block,
        readonly elseIfs: ElseIf[],
        readonly elseBranch?: Block
    ) { }

    accept<R>(visitor: Visitor<R>): BrsType {
        return visitor.visitIf(this);
    }

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
            file: this.tokens.if.location.file,
            start: this.tokens.if.location.start,
            end: this.getEndLocation().end,
        };
    }

    transpile(state: TranspileState) {
        let results = [];
        //if   (already indented by block)
        results.push(new SourceNode(this.tokens.if.location.start.line, this.tokens.if.location.start.column, state.pkgPath, 'if'));
        results.push(' ');
        //conditions
        results.push(...this.condition.transpile(state));
        results.push(' ');
        //then
        if (this.tokens.then) {
            results.push(
                new SourceNode(this.tokens.then.location.start.line, this.tokens.then.location.start.column, state.pkgPath, 'then')
            );
        } else {
            results.push('then')
        }
        //render all if statements as multi-line
        results.push('\n');
        //if statement body
        let thenNodes = this.thenBranch.transpile(state);
        if (thenNodes.length > 0) {
            results.push(thenNodes);
            results.push('\n')
        }

        //else if blocks
        for (let i = 0; i < this.elseIfs.length; i++) {
            let elseif = this.elseIfs[i];
            //elseif
            results.push(
                indent(state.blockDepth),
                new SourceNode(elseif.elseIfToken.location.start.line, elseif.elseIfToken.location.start.column, state.pkgPath, 'else if'),
                ' '
            );
            //condition
            results.push(...elseif.condition.transpile(state));
            //then
            results.push(' ');
            if (elseif.thenToken) {
                results.push(
                    new SourceNode(elseif.thenToken.location.start.line, elseif.thenToken.location.start.column, state.pkgPath, 'then')
                );
            } else {
                results.push('then');
            }

            results.push('\n');
            //then body
            let body = elseif.thenBranch.transpile(state);
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
                new SourceNode(this.tokens.else.location.start.line, this.tokens.else.location.start.column, state.pkgPath, 'else')
            );
            results.push('\n');
            //then body
            let body = this.elseBranch.transpile(state);
            if (body.length > 0) {
                results.push(...body);
                results.push('\n');
            }
        }

        //end if
        results.push(indent(state.blockDepth));
        if (this.tokens.endIf) {
            results.push(
                new SourceNode(this.tokens.endIf.location.start.line, this.tokens.endIf.location.start.column, state.pkgPath, 'end if')
            );
        } else {
            results.push('end if');
        }

        return results;
    }
}

export class IncrementStatement implements Statement {
    constructor(readonly value: Expr.Expression, readonly operator: Token) { }

    accept<R>(visitor: Visitor<R>): BrsType {
        return visitor.visitIncrement(this);
    }

    get location() {
        return {
            file: this.value.location.file,
            start: this.value.location.start,
            end: this.operator.location.end,
        };
    }

    transpile(state: TranspileState): Array<SourceNode | string> {
        return [
            ...this.value.transpile(state),
            new SourceNode(this.operator.location.start.line, this.operator.location.start.column, state.pkgPath, this.operator.text)
        ];
    }
}

/** The set of all accepted `print` statement separators. */
export namespace PrintSeparator {
    /** Used to indent the current `print` position to the next 16-character-width output zone. */
    export interface Tab extends Token {
        kind: Lexeme.Comma;
    }

    /** Used to insert a single whitespace character at the current `print` position. */
    export interface Space extends Token {
        kind: Lexeme.Semicolon;
    }
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
        readonly expressions: Array<Expr.Expression | Stmt.PrintSeparator.Tab | Stmt.PrintSeparator.Space>
    ) { }

    accept<R>(visitor: Visitor<R>): BrsType {
        return visitor.visitPrint(this);
    }

    get location() {
        let end = this.expressions.length
            ? this.expressions[this.expressions.length - 1].location.end
            : this.tokens.print.location.end;

        return {
            file: this.tokens.print.location.file,
            start: this.tokens.print.location.start,
            end: end,
        };
    }

    transpile(state: TranspileState) {
        let result = [
            new SourceNode(this.tokens.print.location.start.line, this.tokens.print.location.start.column, state.pkgPath, 'print'),
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

export class Goto implements Statement {
    constructor(
        readonly tokens: {
            goto: Token;
            label: Token;
        }
    ) { }

    accept<R>(visitor: Visitor<R>): BrsType {
        //should search the code for the corresponding label, and set that as the next line to execute
        throw new Error("Not implemented");
    }

    get location() {
        return {
            file: this.tokens.goto.location.file,
            start: this.tokens.goto.location.start,
            end: this.tokens.label.location.end,
        };
    }

    transpile(state: TranspileState): Array<SourceNode | string> {
        return [
            new SourceNode(this.tokens.goto.location.start.line, this.tokens.goto.location.start.column, state.pkgPath, 'goto'),
            ' ',
            new SourceNode(this.tokens.label.location.start.line, this.tokens.label.location.start.column, state.pkgPath, this.tokens.label.text),
        ];
    }
}

export class Label implements Statement {
    constructor(
        readonly tokens: {
            identifier: Token;
            colon: Token;
        }
    ) { }

    accept<R>(visitor: Visitor<R>): BrsType {
        throw new Error("Not implemented");
    }

    get location() {
        return {
            file: this.tokens.identifier.location.file,
            start: this.tokens.identifier.location.start,
            end: this.tokens.colon.location.end,
        };
    }

    transpile(state: TranspileState): Array<SourceNode | string> {
        return [
            new SourceNode(this.tokens.identifier.location.start.line, this.tokens.identifier.location.start.column, state.pkgPath, this.tokens.identifier.text),
            new SourceNode(this.tokens.colon.location.start.line, this.tokens.colon.location.start.column, state.pkgPath, ':'),

        ];
    }
}

export class Return implements Statement {
    constructor(
        readonly tokens: {
            return: Token;
        },
        readonly value?: Expr.Expression
    ) { }

    accept<R>(visitor: Visitor<R>): BrsType {
        return visitor.visitReturn(this);
    }

    get location() {
        return {
            file: this.tokens.return.location.file,
            start: this.tokens.return.location.start,
            end: (this.value && this.value.location.end) || this.tokens.return.location.end,
        };
    }

    transpile(state: TranspileState) {
        let result = [];
        result.push(
            new SourceNode(this.tokens.return.location.start.line, this.tokens.return.location.start.column, state.pkgPath, 'return')
        );
        if (this.value) {
            result.push(' ');
            result.push(...this.value.transpile(state));
        }
        return result;
    }
}

export class End implements Statement {
    constructor(
        readonly tokens: {
            end: Token;
        }
    ) { }

    accept<R>(visitor: Visitor<R>): BrsType {
        //TODO implement this in the runtime. It should immediately terminate program execution, without error
        throw new Error("Not implemented");
    }

    get location() {
        return {
            file: this.tokens.end.location.file,
            start: this.tokens.end.location.start,
            end: this.tokens.end.location.end,
        };
    }

    transpile(state: TranspileState) {
        return [
            new SourceNode(this.tokens.end.location.start.line, this.tokens.end.location.start.column, state.pkgPath, 'end')
        ];
    }
}

export class Stop implements Statement {
    constructor(
        readonly tokens: {
            stop: Token;
        }
    ) { }

    accept<R>(visitor: Visitor<R>): BrsType {
        //TODO implement this in the runtime. It should pause code execution until a `c` command is issued from the console
        throw new Error("Not implemented");
    }

    get location() {
        return {
            file: this.tokens.stop.location.file,
            start: this.tokens.stop.location.start,
            end: this.tokens.stop.location.end,
        };
    }

    transpile(state: TranspileState) {
        return [
            new SourceNode(this.tokens.stop.location.start.line, this.tokens.stop.location.start.column, state.pkgPath, 'stop')
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
        readonly finalValue: Expr.Expression,
        readonly increment: Expr.Expression,
        readonly body: Block
    ) { }

    accept<R>(visitor: Visitor<R>): BrsType {
        return visitor.visitFor(this);
    }

    get location() {
        return {
            file: this.tokens.for.location.file,
            start: this.tokens.for.location.start,
            end: this.tokens.endFor.location.end,
        };
    }

    transpile(state: TranspileState) {
        let result = [];
        //for
        result.push(
            new SourceNode(this.tokens.for.location.start.line, this.tokens.for.location.start.column, state.pkgPath, 'for'),
            ' '
        );
        //i=1
        result.push(
            ...this.counterDeclaration.transpile(state),
            ' '
        );
        //to
        result.push(
            new SourceNode(this.tokens.to.location.start.line, this.tokens.to.location.start.column, state.pkgPath, 'to'),
            ' '
        );
        //final value
        result.push(this.finalValue.transpile(state));
        //step
        if (this.tokens.step) {
            result.push(
                ' ',
                new SourceNode(this.tokens.step.location.start.line, this.tokens.step.location.start.column, state.pkgPath, 'step'),
                ' ',
                this.increment.transpile(state)
            )
        }
        result.push('\n');
        //loop body
        result.push(...this.body.transpile(state));
        if (this.body.statements.length > 0) {
            result.push('\n');
        }
        //end for
        result.push(
            indent(state.blockDepth),
            new SourceNode(this.tokens.endFor.location.start.line, this.tokens.endFor.location.start.column, state.pkgPath, 'end for')
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
        readonly target: Expr.Expression,
        readonly body: Block
    ) { }

    accept<R>(visitor: Visitor<R>): BrsType {
        return visitor.visitForEach(this);
    }

    get location() {
        return {
            file: this.tokens.forEach.location.file,
            start: this.tokens.forEach.location.start,
            end: this.tokens.endFor.location.end,
        };
    }

    transpile(state: TranspileState) {
        let result = [];
        //for each
        result.push(
            new SourceNode(this.tokens.forEach.location.start.line, this.tokens.forEach.location.start.column, state.pkgPath, 'for each'),
            ' '
        );
        //item
        result.push(
            new SourceNode(this.tokens.forEach.location.start.line, this.tokens.forEach.location.start.column, state.pkgPath, this.item.text),
            ' '
        );
        //in
        result.push(
            new SourceNode(this.tokens.in.location.start.line, this.tokens.in.location.start.column, state.pkgPath, 'in'),
            ' '
        );
        //target
        result.push(...this.target.transpile(state));
        result.push('\n');
        //body
        result.push(...this.body.transpile(state));
        if (this.body.statements.length > 0) {
            result.push('\n');
        }
        //end for
        result.push(
            indent(state.blockDepth),
            new SourceNode(this.tokens.endFor.location.start.line, this.tokens.endFor.location.start.column, state.pkgPath, 'end for'),
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
        readonly condition: Expr.Expression,
        readonly body: Block
    ) { }

    accept<R>(visitor: Visitor<R>): BrsType {
        return visitor.visitWhile(this);
    }

    get location() {
        return {
            file: this.tokens.while.location.file,
            start: this.tokens.while.location.start,
            end: this.tokens.endWhile.location.end,
        };
    }

    transpile(state: TranspileState) {
        let result = [];
        //while
        result.push(
            new SourceNode(this.tokens.while.location.start.line, this.tokens.while.location.start.column, state.pkgPath, 'while'),
            ' '
        );
        //condition
        result.push(
            ...this.condition.transpile(state),
        );
        result.push('\n');
        //body
        result.push(...this.body.transpile(state));

        //trailing newline only if we have body statements
        if (this.body.statements.length > 0) {
            result.push('\n');
        }

        //end while
        result.push(
            indent(state.blockDepth),
            new SourceNode(this.tokens.endWhile.location.start.line, this.tokens.endWhile.location.start.column, state.pkgPath, 'end while')
        );

        return result;
    }
}

export class DottedSetStatement implements Statement {
    constructor(
        readonly obj: Expr.Expression,
        readonly name: Identifier,
        readonly value: Expr.Expression
    ) { }

    accept<R>(visitor: Visitor<R>): BrsType {
        return visitor.visitDottedSet(this);
    }

    get location() {
        return {
            file: this.obj.location.file,
            start: this.obj.location.start,
            end: this.value.location.end,
        };
    }

    transpile(state: TranspileState) {
        return [
            //object
            ...this.obj.transpile(state),
            '.',
            //name
            new SourceNode(this.name.location.start.line, this.name.location.start.column, state.pkgPath, this.name.text),
            ' = ',
            //right-hand-side of assignment
            ...this.value.transpile(state)
        ];
    }
}

export class IndexedSetStatement implements Statement {
    constructor(
        readonly obj: Expr.Expression,
        readonly index: Expr.Expression,
        readonly value: Expr.Expression,
        readonly openingSquare: Token,
        readonly closingSquare: Token
    ) { }

    accept<R>(visitor: Visitor<R>): BrsType {
        return visitor.visitIndexedSet(this);
    }

    get location() {
        return {
            file: this.obj.location.file,
            start: this.obj.location.start,
            end: this.value.location.end,
        };
    }

    transpile(state: TranspileState) {
        return [
            //obj
            ...this.obj.transpile(state),
            //   [
            new SourceNode(this.openingSquare.location.start.line, this.openingSquare.location.start.column, state.pkgPath, '['),
            //    index
            ...this.index.transpile(state),
            //         ]
            new SourceNode(this.closingSquare.location.start.line, this.closingSquare.location.start.column, state.pkgPath, ']'),
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
    accept<R>(visitor: Visitor<R>): BrsType {
        throw new Error("Library is not implemented");
    }

    get location() {
        return {
            file: this.tokens.library.location.file,
            start: this.tokens.library.location.start,
            end: this.tokens.filePath
                ? this.tokens.filePath.location.end
                : this.tokens.library.location.end,
        };
    }

    transpile(state: TranspileState) {
        let result = [];
        result.push(
            new SourceNode(this.tokens.library.location.start.line, this.tokens.library.location.start.column, state.pkgPath, 'library'),
        );
        //there will be a parse error if file path is missing, but let's prevent a runtime error just in case
        if (this.tokens.filePath) {
            result.push(
                ' ',
                new SourceNode(this.tokens.filePath.location.start.line, this.tokens.filePath.location.start.column, state.pkgPath, this.tokens.filePath.text)
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

    accept<R>(visitor: Visitor<R>): BrsType {
        throw new Error('Method not implemented.');
    }

    get location() {
        return {
            file: this.keyword.location.file,
            start: this.keyword.location.start,
            end: this.end.location.end,
        };
    }

    transpile(state: TranspileState): Array<SourceNode | string> {
        throw new Error('transpile not implemented for ' + (this as any).__proto__.constructor.name);
    }
}
