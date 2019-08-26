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
    visitIndexedGet(expression: IndexedGetExpression): T;
    visitGrouping(expression: Grouping): T;
    visitLiteral(expression: Literal): T;
    visitArrayLiteral(expression: ArrayLiteralExpression): T;
    visitAALiteral(expression: AALiteralExpression): T;
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

    transpile(pkgPath: string): Array<SourceNode | string>;
}

export class Binary implements Expression {
    constructor(
        readonly left: Expression,
        readonly operator: Token,
        readonly right: Expression
    ) { }

    accept<R>(visitor: Visitor<R>): R {
        return visitor.visitBinary(this);
    }

    get location() {
        return {
            file: this.operator.location.file,
            start: this.left.location.start,
            end: this.right.location.end,
        };
    }

    transpile(pkgPath: string) {
        return [
            //TODO remove any cast
            new SourceNode(this.left.location.start.line, this.left.location.start.column, pkgPath, (this.left as any).transpile(pkgPath)),
            ' ',
            new SourceNode(this.operator.location.start.line, this.operator.location.start.column, pkgPath, this.operator.text),
            ' ',
            //TODO remove any cast
            new SourceNode(this.right.location.start.line, this.right.location.start.column, pkgPath, (this.right as any).transpile(pkgPath))
        ];
    }
}

export class Call implements Expression {
    static MaximumArguments = 32;

    constructor(
        readonly callee: Expression,
        readonly openingParen: Token,
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

    transpile(pkgPath: string) {
        let result = [];
        result.push(...this.callee.transpile(pkgPath));
        result.push(
            new SourceNode(this.openingParen.location.start.line, this.openingParen.location.start.column, pkgPath, '(')
        );
        for (let i = 0; i < this.args.length; i++) {
            //add comma between args
            if (i > 0) {
                result.push(', ');
            }
            let arg = this.args[i];
            result.push(...arg.transpile(pkgPath));
        }
        result.push(
            new SourceNode(this.closingParen.location.start.line, this.closingParen.location.start.column, pkgPath, ')')
        );
        return result;
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
        readonly rightParen: Token,
        readonly asToken?: Token,
        readonly returnTypeToken?: Token
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
        let results = [];
        //'function'|'sub'
        results.push(
            new SourceNode(this.functionType.location.start.line, this.functionType.location.start.column, pkgPath, this.functionType.text.toLowerCase()),
            ' ',
        );
        //functionName?
        if (name) {
            results.push(
                new SourceNode(name.location.start.line, name.location.start.column, pkgPath, name.text)
            );
        }
        //leftParen
        results.push(
            new SourceNode(this.leftParen.location.start.line, this.leftParen.location.start.column, pkgPath, '(')
        );
        //parameters
        for (let i = 0; i < this.parameters.length; i++) {
            let param = this.parameters[i];
            //add commas
            if (i > 0) {
                results.push(new SourceNode(null, null, pkgPath, ','));
            }
            //add parameter
            results.push(param.transpile(pkgPath));
        }
        //right paren
        results.push(
            new SourceNode(this.rightParen.location.start.line, this.rightParen.location.start.column, pkgPath, ')')
        );
        if (this.asToken) {
            results.push(
                ' ',
                //as
                new SourceNode(this.asToken.location.start.line, this.asToken.location.start.column, pkgPath, 'as'),
                ' ',
                //return type
                new SourceNode(this.returnTypeToken.location.start.line, this.returnTypeToken.location.start.column, pkgPath, this.returnTypeToken.text.toLowerCase())
            );
        }
        results.push('\n');
        let body = this.body.transpile(pkgPath);
        results.push(...body);
        if (body.length > 0) {
            results.push('\n');
        }
        //'end sub'|'end function'
        results.push(
            new SourceNode(this.end.location.start.line, this.end.location.start.column, pkgPath, this.end.text)
        );
        return results;
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

    transpile(pkgPath: string) {
        return [
            //TODO remove any cast
            //TODO - is this correct?
            ...(this.obj as any).transpile(pkgPath),
            '.',
            new SourceNode(this.name.location.start.line, this.name.location.start.column, pkgPath, this.name.text)
        ];
    }
}

export class IndexedGetExpression implements Expression {
    constructor(
        readonly obj: Expression,
        readonly index: Expression,
        readonly openingSquare: Token,
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

    transpile(pkgPath: string) {
        return [
            ...this.obj.transpile(pkgPath),
            new SourceNode(this.openingSquare.location.start.line, this.openingSquare.location.start.column, pkgPath, '['),
            ...this.index.transpile(pkgPath),
            new SourceNode(this.closingSquare.location.start.line, this.closingSquare.location.start.column, pkgPath, ']')
        ];
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

    transpile(pkgPath: string): Array<SourceNode | string> {
        throw new Error('transpile not implemented for ' + (this as any).__proto__.constructor.name);
    }
}

export class Literal implements Expression {
    constructor(
        readonly value: BrsType,
        readonly _location: Location
    ) { }

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

    transpile(pkgPath: string) {
        return [
            new SourceNode(
                this._location.start.line,
                this._location.start.column,
                pkgPath,
                this.value.kind === ValueKind.String ? `"${this.value.toString()}"` : this.value.toString()
            )
        ]
    }
}

export class ArrayLiteralExpression implements Expression {
    constructor(
        readonly elements: Expression[],
        readonly open: Token,
        readonly close: Token
    ) { }

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

    transpile(pkgPath: string) {
        let result = [];
        result.push(
            new SourceNode(this.open.location.start.line, this.open.location.start.column, pkgPath, '[')
        );
        for (let i = 0; i < this.elements.length; i++) {
            if (i > 0) {
                result.push(',');
            }
            let element = this.elements[i];
            result.push('\n');
            result.push(...element.transpile(pkgPath));
        }
        //add a newline between open and close if there are elements
        if (this.elements.length > 0) {
            result.push('\n');
        }
        result.push(
            new SourceNode(this.close.location.start.line, this.close.location.start.column, pkgPath, ']')
        );
        return result;
    }
}

/** A member of an associative array literal. */
export interface AAMember {
    /** The name of the member. */
    key: BrsString;
    keyToken: Token;
    colonToken: Token;
    /** The expression evaluated to determine the member's initial value. */
    value: Expression;
}

export class AALiteralExpression implements Expression {
    constructor(
        readonly elements: AAMember[],
        readonly open: Token,
        readonly close: Token
    ) { }

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

    transpile(pkgPath: string): Array<SourceNode | string> {
        let result = [];
        //open curly
        result.push(
            new SourceNode(this.open.location.start.line, this.open.location.start.column, pkgPath, this.open.text),
            '\n'
        );
        for (let i = 0; i < this.elements.length; i++) {
            let element = this.elements[i];
            //key
            result.push(
                new SourceNode(element.keyToken.location.start.line, element.keyToken.location.start.column, pkgPath, element.keyToken.text)
            );
            //colon
            result.push(
                new SourceNode(element.colonToken.location.start.line, element.colonToken.location.start.column, pkgPath, ':')
            );
            //value
            result.push(...element.value.transpile(pkgPath))
            //if not final element, add trailing comma 
            if (i !== this.elements.length - 1) {
                result.push(',');
            }
            result.push('\n');
        }

        //close curly
        result.push(
            new SourceNode(this.close.location.start.line, this.close.location.start.column, pkgPath, this.close.text)
        );
        return result;
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

    transpile(pkgPath: string) {
        return [
            new SourceNode(this.operator.location.start.line, this.operator.location.start.column, pkgPath, this.operator.text),
            //TODO remove any cast
            ...(this.right as any).transpile()
        ];
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

    transpile(pkgPath: string) {
        return [
            new SourceNode(this.name.location.start.line, this.name.location.start.column, pkgPath, this.name.text)
        ];
    }
}
