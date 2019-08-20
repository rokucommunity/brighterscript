//tslint:disable
import * as Expr from "./Expression";
import { Token, Identifier, Location, Lexeme } from "../lexer";
import { BrsType, BrsInvalid } from "../brsTypes";

/** A set of reasons why a `Block` stopped executing. */
export * from "./BlockEndReason";

export interface Visitor<T> {
    visitAssignment(statement: Assignment): BrsType;
    visitExpression(statement: Expression): BrsType;
    visitExitFor(statement: ExitFor): never;
    visitExitWhile(statement: ExitWhile): never;
    visitPrint(statement: Print): BrsType;
    visitIf(statement: If): BrsType;
    visitBlock(block: Block): BrsType;
    visitFor(statement: For): BrsType;
    visitForEach(statement: ForEach): BrsType;
    visitWhile(statement: While): BrsType;
    visitNamedFunction(statement: FunctionStatement): BrsType;
    visitReturn(statement: Return): never;
    visitDottedSet(statement: DottedSet): BrsType;
    visitIndexedSet(statement: IndexedSet): BrsType;
    visitIncrement(expression: Increment): BrsInvalid;
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
}

export class Assignment implements Statement {
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
}

export class Block implements Statement {
    constructor(
        readonly statements: ReadonlyArray<Statement>,
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
}

export class Expression implements Statement {
    constructor(readonly expression: Expr.Expression) { }

    accept<R>(visitor: Visitor<R>): BrsType {
        return visitor.visitExpression(this);
    }

    get location() {
        return this.expression.location;
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
}

export class FunctionStatement implements Statement {
    constructor(readonly name: Identifier, readonly func: Expr.Function) { }

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
}

export class ClassMethodStatement implements Statement {
    constructor(
        readonly accessModifier: Token,
        readonly name: Identifier,
        readonly func: Expr.Function
    ) { }

    accept<R>(visitor: Visitor<R>): BrsType {
        return visitor.visitNamedFunction(this);
    }

    get location() {
        return {
            file: this.name.location.file,
            start: this.accessModifier ? this.accessModifier.location.start : this.func.location.start,
            end: this.func.location.end,
        };
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
            start: this.accessModifier ? this.accessModifier.location.start : this.name.location.start,
            end: this.type.location.end,
        };
    }
}

export interface ElseIf {
    condition: Expr.Expression;
    thenBranch: Block;
}

export class If implements Statement {
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
}

export class Increment implements Statement {
    constructor(readonly value: Expr.Expression, readonly token: Token) { }

    accept<R>(visitor: Visitor<R>): BrsType {
        return visitor.visitIncrement(this);
    }

    get location() {
        return {
            file: this.value.location.file,
            start: this.value.location.start,
            end: this.token.location.end,
        };
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
export class Print implements Statement {
    /**
     * Creates a new internal representation of a BrightScript `print` statement.
     * @param expressions an array of expressions or `PrintSeparator`s to be
     *                    evaluated and printed.
     */
    constructor(
        readonly tokens: {
            print: Token;
        },
        readonly expressions: (Expr.Expression | Token)[]
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
}

export class For implements Statement {
    constructor(
        readonly tokens: {
            for: Token;
            to: Token;
            step?: Token;
            endFor: Token;
        },
        readonly counterDeclaration: Assignment,
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
}

export class ForEach implements Statement {
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
}

export class While implements Statement {
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
}

export class DottedSet implements Statement {
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
}

export class IndexedSet implements Statement {
    constructor(
        readonly obj: Expr.Expression,
        readonly index: Expr.Expression,
        readonly value: Expr.Expression,
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
}

export class Library implements Statement {
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
}