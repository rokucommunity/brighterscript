//tslint:disable
import { Token, Identifier, Location } from "../lexer";
import { BrsType, ValueKind, BrsString, FunctionParameter } from "../brsTypes";
import { Block } from "./Statement";
import { SourceNode } from 'source-map';

export interface Visitor<T> {
    visitBinary(expression: Binary): T;
    visitCall(expression: Call): T;
    visitAnonymousFunction(func: Function): T;
    visitDottedGet(expression: DottedGet): T;
    visitIndexedGet(expression: IndexedGet): T;
    visitGrouping(expression: Grouping): T;
    visitLiteral(expression: Literal): T;
    visitArrayLiteral(expression: ArrayLiteral): T;
    visitAALiteral(expression: AALiteral): T;
    visitUnary(expression: Unary): T;
    visitVariable(expression: Variable): T;
}

/** A BrightScript expression */
export interface Expression {
    /**
     * Handles the enclosing `Expression` with `visitor`.
     * @param visitor the `Visitor` that will handle the enclosing `Expression`
     * @returns the BrightScript value resulting from evaluating the expression
     */
    accept<R>(visitor: Visitor<R>): R;

    /** The starting and ending location of the expression. */
    location: Location;

    // transpile(pkgPath: string): SourceNode;
}

export class Binary implements Expression {
    constructor(readonly left: Expression, readonly token: Token, readonly right: Expression) { }

    accept<R>(visitor: Visitor<R>): R {
        return visitor.visitBinary(this);
    }

    get location() {
        return {
            file: this.token.location.file,
            start: this.left.location.start,
            end: this.right.location.end,
        };
    }
}

export class Call implements Expression {
    static MaximumArguments = 32;

    constructor(
        readonly callee: Expression,
        readonly closingParen: Token,
        readonly args: Expression[]
    ) { }

    accept<R>(visitor: Visitor<R>): R {
        return visitor.visitCall(this);
    }

    get location() {
        return {
            file: this.closingParen.location.file,
            start: this.callee.location.start,
            end: this.closingParen.location.end,
        };
    }
}

export class Function implements Expression {
    constructor(
        readonly parameters: FunctionParameter[],
        readonly returns: ValueKind,
        readonly body: Block,
        readonly functionType: Token | null,
        readonly end: Token,
        readonly leftParen: Token,
        readonly rightParen: Token
    ) { }

    accept<R>(visitor: Visitor<R>): R {
        return visitor.visitAnonymousFunction(this);
    }

    get location() {
        return {
            file: this.leftParen.location.file,
            start: this.functionType ? this.functionType.location.start : this.leftParen.location.start,
            end: this.end.location.end,
        };
    }

    transpile(pkgPath: string, name?: Identifier) {
        let params = [] as SourceNode[];
        for (let param of this.parameters) {
            //add commas
            if (params.length > 0) {
                params.push(new SourceNode(null, null, pkgPath, ','));
            }
            //add parameter
            params.push(param.transpile(pkgPath));
        }


        return new SourceNode(null, null, pkgPath, [
            //'function'|'sub'
            new SourceNode(this.functionType.location.start.line, this.functionType.location.start.column, pkgPath, this.functionType.text),
            ' ',
            //function name (optional)
            name ? new SourceNode(name.location.start.line, name.location.start.column, pkgPath, name.text) : '',
            //leftParen
            new SourceNode(this.leftParen.location.start.line, this.leftParen.location.start.column, pkgPath, '('),
            //parameters
            ...params,
            //right paren
            new SourceNode(this.rightParen.location.start.line, this.rightParen.location.start.column, pkgPath, ')'),
            '\n',
            //TODO include function body

            //'end sub'|'end function'
            new SourceNode(this.end.location.start.line, this.end.location.start.column, pkgPath, this.end.text)
        ]);
    }
}

export class DottedGet implements Expression {
    constructor(readonly obj: Expression, readonly name: Identifier) { }

    accept<R>(visitor: Visitor<R>): R {
        return visitor.visitDottedGet(this);
    }

    get location() {
        return {
            file: this.obj.location.file,
            start: this.obj.location.start,
            end: this.name.location.end,
        };
    }
}

export class IndexedGet implements Expression {
    constructor(
        readonly obj: Expression,
        readonly index: Expression,
        readonly closingSquare: Token
    ) { }

    accept<R>(visitor: Visitor<R>): R {
        return visitor.visitIndexedGet(this);
    }

    get location() {
        return {
            file: this.obj.location.file,
            start: this.obj.location.start,
            end: this.closingSquare.location.end,
        };
    }
}

export class Grouping implements Expression {
    constructor(
        readonly tokens: {
            left: Token;
            right: Token;
        },
        readonly expression: Expression
    ) { }

    accept<R>(visitor: Visitor<R>): R {
        return visitor.visitGrouping(this);
    }

    get location() {
        return {
            file: this.tokens.left.location.file,
            start: this.tokens.left.location.start,
            end: this.tokens.right.location.end,
        };
    }
}

export class Literal implements Expression {
    constructor(readonly value: BrsType, readonly _location: Location | undefined) { }

    accept<R>(visitor: Visitor<R>): R {
        return visitor.visitLiteral(this);
    }

    get location() {
        return (
            this._location || {
                file: "(internal)",
                start: {
                    line: -1,
                    column: -1,
                },
                end: {
                    line: -1,
                    column: -1,
                },
            }
        );
    }
}

export class ArrayLiteral implements Expression {
    constructor(readonly elements: Expression[], readonly open: Token, readonly close: Token) { }

    accept<R>(visitor: Visitor<R>): R {
        return visitor.visitArrayLiteral(this);
    }

    get location() {
        return {
            file: this.open.location.file,
            start: this.open.location.start,
            end: this.close.location.end,
        };
    }
}

/** A member of an associative array literal. */
export interface AAMember {
    /** The name of the member. */
    name: BrsString;
    /** The expression evaluated to determine the member's initial value. */
    value: Expression;
}

export class AALiteral implements Expression {
    constructor(readonly elements: AAMember[], readonly open: Token, readonly close: Token) { }

    accept<R>(visitor: Visitor<R>): R {
        return visitor.visitAALiteral(this);
    }

    get location() {
        return {
            file: this.open.location.file,
            start: this.open.location.start,
            end: this.close.location.end,
        };
    }
}

export class Unary implements Expression {
    constructor(readonly operator: Token, readonly right: Expression) { }

    accept<R>(visitor: Visitor<R>): R {
        return visitor.visitUnary(this);
    }

    get location() {
        return {
            file: this.operator.location.file,
            start: this.operator.location.start,
            end: this.right.location.end,
        };
    }
}

export class Variable implements Expression {
    constructor(readonly name: Identifier) { }

    accept<R>(visitor: Visitor<R>): R {
        return visitor.visitVariable(this);
    }

    get location() {
        return this.name.location;
    }
}
