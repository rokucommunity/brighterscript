import { Token, Identifier, Location } from '../lexer';
import { BrsType, ValueKind, BrsString, FunctionParameter } from '../brsTypes';
import { Block, CommentStatement } from './Statement';
import { SourceNode } from 'source-map';

import { util } from '../../util';
import { TranspileState } from './TranspileState';

/** A BrightScript expression */
export interface Expression {
    /** The starting and ending location of the expression. */
    location: Location;

    transpile(state: TranspileState): Array<SourceNode | string>;
}

export class BinaryExpression implements Expression {
    constructor(
        readonly left: Expression,
        readonly operator: Token,
        readonly right: Expression
    ) { }

    get location() {
        return {
            file: this.operator.location.file,
            start: this.left.location.start,
            end: this.right.location.end
        };
    }

    transpile(state: TranspileState) {
        return [
            new SourceNode(this.left.location.start.line, this.left.location.start.column, state.pathAbsolute, this.left.transpile(state)),
            ' ',
            new SourceNode(this.operator.location.start.line, this.operator.location.start.column, state.pathAbsolute, this.operator.text),
            ' ',
            new SourceNode(this.right.location.start.line, this.right.location.start.column, state.pathAbsolute, this.right.transpile(state))
        ];
    }
}

export class CallExpression implements Expression {
    static MaximumArguments = 32;

    constructor(
        readonly callee: Expression,
        readonly openingParen: Token,
        readonly closingParen: Token,
        readonly args: Expression[]
    ) { }

    get location() {
        return {
            file: this.closingParen.location.file,
            start: this.callee.location.start,
            end: this.closingParen.location.end
        };
    }

    transpile(state: TranspileState) {
        let result = [];
        result.push(...this.callee.transpile(state));
        result.push(
            new SourceNode(this.openingParen.location.start.line, this.openingParen.location.start.column, state.pathAbsolute, '(')
        );
        for (let i = 0; i < this.args.length; i++) {
            //add comma between args
            if (i > 0) {
                result.push(', ');
            }
            let arg = this.args[i];
            result.push(...arg.transpile(state));
        }
        result.push(
            new SourceNode(this.closingParen.location.start.line, this.closingParen.location.start.column, state.pathAbsolute, ')')
        );
        return result;
    }
}

export class FunctionExpression implements Expression {
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

    get location() {
        return {
            file: this.leftParen.location.file,
            start: this.functionType ? this.functionType.location.start : this.leftParen.location.start,
            end: this.end.location.end
        };
    }

    transpile(state: TranspileState, name?: Identifier) {
        let results = [];
        //'function'|'sub'
        results.push(
            new SourceNode(this.functionType.location.start.line, this.functionType.location.start.column, state.pathAbsolute, this.functionType.text.toLowerCase())
        );
        //functionName?
        if (name) {
            results.push(
                ' ',
                new SourceNode(name.location.start.line, name.location.start.column, state.pathAbsolute, name.text)
            );
        }
        //leftParen
        results.push(
            new SourceNode(this.leftParen.location.start.line, this.leftParen.location.start.column, state.pathAbsolute, '(')
        );
        //parameters
        for (let i = 0; i < this.parameters.length; i++) {
            let param = this.parameters[i];
            //add commas
            if (i > 0) {
                results.push(new SourceNode(null, null, state.pathAbsolute, ', '));
            }
            //add parameter
            results.push(param.transpile(state));
        }
        //right paren
        results.push(
            new SourceNode(this.rightParen.location.start.line, this.rightParen.location.start.column, state.pathAbsolute, ')')
        );
        //as [Type]
        if (this.asToken) {
            results.push(
                ' ',
                //as
                new SourceNode(this.asToken.location.start.line, this.asToken.location.start.column, state.pathAbsolute, 'as'),
                ' ',
                //return type
                new SourceNode(this.returnTypeToken.location.start.line, this.returnTypeToken.location.start.column, state.pathAbsolute, this.returnTypeToken.text.toLowerCase())
            );
        }
        state.lineage.unshift(this);
        let body = this.body.transpile(state);
        state.lineage.shift();
        results.push(...body);
        results.push('\n');
        //'end sub'|'end function'
        results.push(
            state.indent(),
            new SourceNode(this.end.location.start.line, this.end.location.start.column, state.pathAbsolute, this.end.text)
        );
        return results;
    }
}

export class DottedGetExpression implements Expression {
    constructor(readonly obj: Expression, readonly name: Identifier) { }

    get location() {
        return {
            file: this.obj.location.file,
            start: this.obj.location.start,
            end: this.name.location.end
        };
    }

    transpile(state: TranspileState) {
        return [
            ...this.obj.transpile(state),
            '.',
            new SourceNode(this.name.location.start.line, this.name.location.start.column, state.pathAbsolute, this.name.text)
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

    get location() {
        return {
            file: this.obj.location.file,
            start: this.obj.location.start,
            end: this.closingSquare.location.end
        };
    }

    transpile(state: TranspileState) {
        return [
            ...this.obj.transpile(state),
            new SourceNode(this.openingSquare.location.start.line, this.openingSquare.location.start.column, state.pathAbsolute, '['),
            ...this.index.transpile(state),
            new SourceNode(this.closingSquare.location.start.line, this.closingSquare.location.start.column, state.pathAbsolute, ']')
        ];
    }
}

export class GroupingExpression implements Expression {
    constructor(
        readonly tokens: {
            left: Token;
            right: Token;
        },
        readonly expression: Expression
    ) { }

    get location() {
        return {
            file: this.tokens.left.location.file,
            start: this.tokens.left.location.start,
            end: this.tokens.right.location.end
        };
    }

    transpile(state: TranspileState) {
        return [
            new SourceNode(this.tokens.left.location.start.line, this.tokens.left.location.start.column, state.pathAbsolute, '('),
            ...this.expression.transpile(state),
            new SourceNode(this.tokens.right.location.start.line, this.tokens.right.location.start.column, state.pathAbsolute, ')')
        ];
    }
}

export class LiteralExpression implements Expression {
    constructor(
        readonly value: BrsType,
        readonly _location: Location
    ) { }

    get location() {
        return (
            this._location || {
                file: '(internal)',
                start: {
                    line: -1,
                    column: -1
                },
                end: {
                    line: -1,
                    column: -1
                }
            }
        );
    }

    transpile(state: TranspileState) {
        return [
            new SourceNode(
                this._location.start.line,
                this._location.start.column,
                state.pathAbsolute,
                this.value.kind === ValueKind.String ? `"${this.value.toString()}"` : this.value.toString()
            )
        ];
    }
}

export class ArrayLiteralExpression implements Expression {
    constructor(
        readonly elements: Array<Expression | CommentStatement>,
        readonly open: Token,
        readonly close: Token
    ) { }

    get location() {
        return {
            file: this.open.location.file,
            start: this.open.location.start,
            end: this.close.location.end
        };
    }

    transpile(state: TranspileState) {
        let result = [];
        result.push(
            new SourceNode(this.open.location.start.line, this.open.location.start.column, state.pathAbsolute, '[')
        );
        let hasChildren = this.elements.length > 0;
        state.blockDepth++;

        for (let i = 0; i < this.elements.length; i++) {
            let previousElement = this.elements[i - 1];
            let element = this.elements[i];

            if (element instanceof CommentStatement) {
                //if the comment is on the same line as opening square or previous statement, don't add newline
                if (util.linesTouch(this.open, element) || util.linesTouch(previousElement, element)) {
                    result.push(' ');
                } else {
                    result.push(
                        '\n',
                        state.indent()
                    );
                }
                state.lineage.unshift(this);
                result.push(element.transpile(state));
                state.lineage.shift();
            } else {
                result.push('\n');

                result.push(
                    state.indent(),
                    ...element.transpile(state)
                );
                //add a comma if we know there will be another non-comment statement after this
                for (let j = i + 1; j < this.elements.length; j++) {
                    let el = this.elements[j];
                    //add a comma if there will be another element after this
                    if (el instanceof CommentStatement === false) {
                        result.push(',');
                        break;
                    }
                }
            }
        }
        state.blockDepth--;
        //add a newline between open and close if there are elements
        if (hasChildren) {
            result.push('\n');
            result.push(state.indent());
        }

        result.push(
            new SourceNode(this.close.location.start.line, this.close.location.start.column, state.pathAbsolute, ']')
        );
        return result;
    }
}

/** A member of an associative array literal. */
export interface AAMemberExpression {
    /** The name of the member. */
    key: BrsString;
    keyToken: Token;
    colonToken: Token;
    /** The expression evaluated to determine the member's initial value. */
    value: Expression;
    location: Location;
}

export class AALiteralExpression implements Expression {
    constructor(
        readonly elements: Array<AAMemberExpression | CommentStatement>,
        readonly open: Token,
        readonly close: Token
    ) { }

    get location() {
        return {
            file: this.open.location.file,
            start: this.open.location.start,
            end: this.close.location.end
        };
    }

    transpile(state: TranspileState): Array<SourceNode | string> {
        let result = [];
        //open curly
        result.push(
            new SourceNode(this.open.location.start.line, this.open.location.start.column, state.pathAbsolute, this.open.text)
        );
        let hasChildren = this.elements.length > 0;
        //add newline if the object has children and the first child isn't a comment starting on the same line as opening curly
        if (hasChildren && ((this.elements[0] instanceof CommentStatement) === false || !util.linesTouch(this.elements[0], this.open))) {
            result.push('\n');
        }
        state.blockDepth++;
        for (let i = 0; i < this.elements.length; i++) {
            let element = this.elements[i];
            let previousElement = this.elements[i - 1];
            let nextElement = this.elements[i + 1];

            //don't indent if comment is same-line
            if (element instanceof CommentStatement &&
                (util.linesTouch(this.open, element) || util.linesTouch(previousElement, element))
            ) {
                result.push(' ');

                //indent line
            } else {
                result.push(state.indent());
            }

            //render comments
            if (element instanceof CommentStatement) {
                result.push(...element.transpile(state));
            } else {
                //key
                result.push(
                    new SourceNode(element.keyToken.location.start.line, element.keyToken.location.start.column, state.pathAbsolute, element.keyToken.text)
                );
                //colon
                result.push(
                    new SourceNode(element.colonToken.location.start.line, element.colonToken.location.start.column, state.pathAbsolute, ':'),
                    ' '
                );

                //determine if comments are the only members left in the array
                let onlyCommentsRemaining = true;
                for (let j = i + 1; j < this.elements.length; j++) {
                    if ((this.elements[j] instanceof CommentStatement) === false) {
                        onlyCommentsRemaining = false;
                        break;
                    }
                }

                //value
                result.push(...element.value.transpile(state));
                //add trailing comma if not final element (excluding comments)
                if (i !== this.elements.length - 1 && onlyCommentsRemaining === false) {
                    result.push(',');
                }
            }


            //if next element is a same-line comment, skip the newline
            if (nextElement && nextElement instanceof CommentStatement && nextElement.location.start.line === element.location.start.line) {

                //add a newline between statements
            } else {
                result.push('\n');
            }
        }
        state.blockDepth--;

        //only indent the closing curly if we have children
        if (hasChildren) {
            result.push(state.indent());
        }
        //close curly
        result.push(
            new SourceNode(this.close.location.start.line, this.close.location.start.column, state.pathAbsolute, this.close.text)
        );
        return result;
    }
}

export class UnaryExpression implements Expression {
    constructor(readonly operator: Token, readonly right: Expression) { }

    get location() {
        return {
            file: this.operator.location.file,
            start: this.operator.location.start,
            end: this.right.location.end
        };
    }

    transpile(state: TranspileState) {
        return [
            new SourceNode(this.operator.location.start.line, this.operator.location.start.column, state.pathAbsolute, this.operator.text),
            ' ',
            ...this.right.transpile(state)
        ];
    }
}

export class VariableExpression implements Expression {
    constructor(readonly name: Identifier) { }

    get location() {
        return this.name.location;
    }

    transpile(state: TranspileState) {
        return [
            new SourceNode(this.name.location.start.line, this.name.location.start.column, state.pathAbsolute, this.name.text)
        ];
    }
}

export class NewExpression implements Expression {
    constructor(readonly newKeyword: Token, readonly expression: Expression) { }

    get location() {
        return {
            start: this.newKeyword.location.start,
            end: this.expression.location.end,
            file: this.newKeyword.location.file
        };
    }

    transpile(state: TranspileState) {
        return this.expression.transpile(state);
    }
}
