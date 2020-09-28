import { Token, Identifier, TokenKind } from '../lexer';
import { BrsType, ValueKind, BrsString, FunctionParameter } from '../brsTypes';
import { Block, CommentStatement, FunctionStatement } from './Statement';
import { SourceNode } from 'source-map';
import { Range, CancellationToken } from 'vscode-languageserver';
import util from '../util';
import { TranspileState } from './TranspileState';
import { ParseMode } from './Parser';
import * as fileUrl from 'file-url';

export type ExpressionVisitor = (expression: Expression, parent: Expression) => void;

/** A BrightScript expression */
export interface Expression {
    /** The starting and ending location of the expression. */
    range: Range;

    transpile(state: TranspileState): Array<SourceNode | string>;

    walk(visitor: ExpressionVisitor, parent?: Expression, cancel?: CancellationToken): void;
}

export class BinaryExpression implements Expression {
    constructor(
        readonly left: Expression,
        readonly operator: Token,
        readonly right: Expression
    ) {
        this.range = util.createRangeFromPositions(this.left.range.start, this.right.range.end);
    }

    public readonly range: Range;

    transpile(state: TranspileState) {
        return [
            new SourceNode(this.left.range.start.line + 1, this.left.range.start.character, state.pathAbsolute, this.left.transpile(state)),
            ' ',
            new SourceNode(this.operator.range.start.line + 1, this.operator.range.start.character, state.pathAbsolute, this.operator.text),
            ' ',
            new SourceNode(this.right.range.start.line + 1, this.right.range.start.character, state.pathAbsolute, this.right.transpile(state))
        ];
    }

    walk(visitor: ExpressionVisitor, parent?: Expression, cancel?: CancellationToken): void {
        if (!cancel?.isCancellationRequested) {
            visitor(this, parent);
            this.left.walk(visitor, this, cancel);
            this.right.walk(visitor, this, cancel);
        }
    }
}

export class CallExpression implements Expression {
    static MaximumArguments = 32;

    constructor(
        readonly callee: Expression,
        readonly openingParen: Token,
        readonly closingParen: Token,
        readonly args: Expression[],
        readonly namespaceName: NamespacedVariableNameExpression
    ) {
        this.range = util.createRangeFromPositions(this.callee.range.start, this.closingParen.range.end);
    }

    public readonly range: Range;

    transpile(state: TranspileState) {
        let result = [];

        //transpile the name
        result.push(...this.callee.transpile(state));

        result.push(
            new SourceNode(this.openingParen.range.start.line + 1, this.openingParen.range.start.character, state.pathAbsolute, '(')
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
            new SourceNode(this.closingParen.range.start.line + 1, this.closingParen.range.start.character, state.pathAbsolute, ')')
        );
        return result;
    }

    walk(visitor: ExpressionVisitor, parent?: Expression, cancel?: CancellationToken): void {
        if (!cancel?.isCancellationRequested) {
            visitor(this, parent);
            visitor(this.callee, this);
            this.args.forEach(e => e.walk(visitor, this, cancel));
        }
    }
}

export class FunctionExpression implements Expression {
    constructor(
        readonly parameters: FunctionParameter[],
        readonly returns: ValueKind,
        public body: Block,
        readonly functionType: Token | null,
        public end: Token,
        readonly leftParen: Token,
        readonly rightParen: Token,
        readonly asToken?: Token,
        readonly returnTypeToken?: Token,
        /**
         * If this function is enclosed within another function, this will reference that parent function
         */
        readonly parentFunction?: FunctionExpression
    ) {
    }

    /**
     * The list of function calls that are declared within this function scope. This excludes CallExpressions
     * declared in child functions
     */
    public callExpressions = [] as CallExpression[];

    /**
     * If this function is part of a FunctionStatement, this will be set. Otherwise this will be undefined
     */
    public functionStatement?: FunctionStatement;

    /**
     * A list of all child functions declared directly within this function
     */
    public childFunctionExpressions = [] as FunctionExpression[];

    /**
     * The range of the function, starting at the 'f' in function or 's' in sub (or the open paren if the keyword is missing),
     * and ending with the last n' in 'end function' or 'b' in 'end sub'
     */
    public get range() {
        return util.createRangeFromPositions(
            (this.functionType ?? this.leftParen).range.start,
            (this.end ?? this.body ?? this.returnTypeToken ?? this.asToken ?? this.rightParen).range.end
        );
    }

    transpile(state: TranspileState, name?: Identifier) {
        let results = [];
        //'function'|'sub'
        results.push(
            new SourceNode(this.functionType.range.start.line + 1, this.functionType.range.start.character, state.pathAbsolute, this.functionType.text.toLowerCase())
        );
        //functionName?
        if (name) {
            results.push(
                ' ',
                new SourceNode(name.range.start.line + 1, name.range.start.character, state.pathAbsolute, name.text)
            );
        }
        //leftParen
        results.push(
            new SourceNode(this.leftParen.range.start.line + 1, this.leftParen.range.start.character, state.pathAbsolute, '(')
        );
        //parameters
        for (let i = 0; i < this.parameters.length; i++) {
            let param = this.parameters[i];
            //add commas
            if (i > 0) {
                results.push(', ');
            }
            //add parameter
            results.push(param.transpile(state));
        }
        //right paren
        results.push(
            new SourceNode(this.rightParen.range.start.line + 1, this.rightParen.range.start.character, state.pathAbsolute, ')')
        );
        //as [Type]
        if (this.asToken) {
            results.push(
                ' ',
                //as
                new SourceNode(this.asToken.range.start.line + 1, this.asToken.range.start.character, state.pathAbsolute, 'as'),
                ' ',
                //return type
                new SourceNode(this.returnTypeToken.range.start.line + 1, this.returnTypeToken.range.start.character, state.pathAbsolute, this.returnTypeToken.text.toLowerCase())
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
            new SourceNode(this.end.range.start.line + 1, this.end.range.start.character, state.pathAbsolute, this.end.text)
        );
        return results;
    }

    walk(visitor: ExpressionVisitor, parent?: Expression, cancel?: CancellationToken): void {
        if (!cancel?.isCancellationRequested) {
            visitor(this, parent);
            this.parameters.forEach(p => p.defaultValue?.walk(visitor, this, cancel));
        }
    }
}

export class NamespacedVariableNameExpression implements Expression {
    constructor(
        //if this is a `DottedGetExpression`, it must be comprised only of `VariableExpression`s
        readonly expression: DottedGetExpression | VariableExpression
    ) {
        this.range = expression.range;
    }
    range: Range;

    transpile(state: TranspileState) {
        return [
            new SourceNode(
                this.range.start.line + 1,
                this.range.start.character,
                state.pathAbsolute,
                this.getName(ParseMode.BrightScript)
            )
        ];
    }

    public getNameParts() {
        let parts = [] as string[];
        if (this.expression instanceof VariableExpression) {
            parts.push(this.expression.name.text);
        } else {
            let expr = this.expression;

            parts.push(expr.name.text);

            while (expr instanceof VariableExpression === false) {
                expr = expr.obj as DottedGetExpression;
                parts.unshift(expr.name.text);
            }
        }
        return parts;
    }

    getName(parseMode: ParseMode) {
        if (parseMode === ParseMode.BrighterScript) {
            return this.getNameParts().join('.');
        } else {
            return this.getNameParts().join('_');
        }
    }

    walk(visitor: ExpressionVisitor, parent?: Expression, cancel?: CancellationToken): void {
        if (!cancel?.isCancellationRequested) {
            visitor(this, parent);
            this.expression.walk(visitor, this, cancel);
        }
    }
}

export class DottedGetExpression implements Expression {
    constructor(
        readonly obj: Expression,
        readonly name: Identifier,
        readonly dot: Token
    ) {
        this.range = util.createRangeFromPositions(this.obj.range.start, this.name.range.end);
    }

    public readonly range: Range;

    transpile(state: TranspileState) {
        //if the callee starts with a namespace name, transpile the name
        if (state.file.calleeStartsWithNamespace(this)) {
            return new NamespacedVariableNameExpression(this as DottedGetExpression | VariableExpression).transpile(state);
        } else {
            return [
                ...this.obj.transpile(state),
                '.',
                new SourceNode(this.name.range.start.line + 1, this.name.range.start.character, state.pathAbsolute, this.name.text)
            ];
        }
    }

    walk(visitor: ExpressionVisitor, parent?: Expression, cancel?: CancellationToken): void {
        if (!cancel?.isCancellationRequested) {
            visitor(this, parent);
            this.obj.walk(visitor, this, cancel);
        }
    }
}

export class XmlAttributeGetExpression implements Expression {
    constructor(
        readonly obj: Expression,
        readonly name: Identifier,
        readonly at: Token
    ) {
        this.range = util.createRangeFromPositions(this.obj.range.start, this.name.range.end);
    }

    public readonly range: Range;

    transpile(state: TranspileState) {
        return [
            ...this.obj.transpile(state),
            '@',
            new SourceNode(this.name.range.start.line + 1, this.name.range.start.character, state.pathAbsolute, this.name.text)
        ];
    }

    walk(visitor: ExpressionVisitor, parent?: Expression, cancel?: CancellationToken): void {
        if (!cancel?.isCancellationRequested) {
            visitor(this, parent);
            this.obj.walk(visitor, this, cancel);
        }
    }
}

export class IndexedGetExpression implements Expression {
    constructor(
        readonly obj: Expression,
        readonly index: Expression,
        readonly openingSquare: Token,
        readonly closingSquare: Token
    ) {
        this.range = util.createRangeFromPositions(this.obj.range.start, this.closingSquare.range.end);
    }

    public readonly range: Range;

    transpile(state: TranspileState) {
        return [
            ...this.obj.transpile(state),
            new SourceNode(this.openingSquare.range.start.line + 1, this.openingSquare.range.start.character, state.pathAbsolute, '['),
            ...this.index.transpile(state),
            new SourceNode(this.closingSquare.range.start.line + 1, this.closingSquare.range.start.character, state.pathAbsolute, ']')
        ];
    }

    walk(visitor: ExpressionVisitor, parent?: Expression, cancel?: CancellationToken): void {
        if (!cancel?.isCancellationRequested) {
            visitor(this, parent);
            this.obj.walk(visitor, this, cancel);
            this.index.walk(visitor, this, cancel);
        }
    }
}

export class GroupingExpression implements Expression {
    constructor(
        readonly tokens: {
            left: Token;
            right: Token;
        },
        readonly expression: Expression
    ) {
        this.range = util.createRangeFromPositions(this.tokens.left.range.start, this.tokens.right.range.end);
    }

    public readonly range: Range;

    transpile(state: TranspileState) {
        return [
            new SourceNode(this.tokens.left.range.start.line + 1, this.tokens.left.range.start.character, state.pathAbsolute, '('),
            ...this.expression.transpile(state),
            new SourceNode(this.tokens.right.range.start.line + 1, this.tokens.right.range.start.character, state.pathAbsolute, ')')
        ];
    }

    walk(visitor: ExpressionVisitor, parent?: Expression, cancel?: CancellationToken): void {
        if (!cancel?.isCancellationRequested) {
            visitor(this, parent);
            this.expression.walk(visitor, this, cancel);
        }
    }
}

export class LiteralExpression implements Expression {
    constructor(
        readonly value: BrsType,
        range: Range
    ) {
        this.range = range ?? util.createRange(-1, -1, -1, -1);
    }

    public readonly range: Range;

    transpile(state: TranspileState) {
        let text: string;
        if (this.value.kind === ValueKind.String) {
            //escape quote marks with another quote mark
            text = `"${this.value.value.replace(/"/g, '""')}"`;
        } else {
            text = this.value.toString();
        }

        return [
            new SourceNode(
                this.range.start.line + 1,
                this.range.start.character,
                state.pathAbsolute,
                text
            )
        ];
    }

    walk(visitor: ExpressionVisitor, parent?: Expression, cancel?: CancellationToken): void {
        if (!cancel?.isCancellationRequested) {
            visitor(this, parent);
        }
    }
}

/**
 * This is a special expression only used within template strings. It exists so we can prevent producing lots of empty strings
 * during template string transpile by identifying these expressions explicitly and skipping the bslib_toString around them
 */
export class EscapedCharCodeLiteral implements Expression {
    constructor(
        readonly token: Token & { charCode: number }
    ) {
        this.range = token.range;
    }
    readonly range: Range;

    transpile(state: TranspileState) {
        return [
            new SourceNode(
                this.range.start.line + 1,
                this.range.start.character,
                state.pathAbsolute,
                `chr(${this.token.charCode})`
            )
        ];
    }

    walk(visitor: ExpressionVisitor, parent?: Expression, cancel?: CancellationToken): void {
        if (!cancel?.isCancellationRequested) {
            visitor(this, parent);
        }
    }
}

export class ArrayLiteralExpression implements Expression {
    constructor(
        readonly elements: Array<Expression | CommentStatement>,
        readonly open: Token,
        readonly close: Token
    ) {
        this.range = util.createRangeFromPositions(this.open.range.start, this.close.range.end);
    }

    public readonly range: Range;

    transpile(state: TranspileState) {
        let result = [];
        result.push(
            new SourceNode(this.open.range.start.line + 1, this.open.range.start.character, state.pathAbsolute, '[')
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
            new SourceNode(this.close.range.start.line + 1, this.close.range.start.character, state.pathAbsolute, ']')
        );
        return result;
    }

    walk(visitor: ExpressionVisitor, parent?: Expression, cancel?: CancellationToken): void {
        if (!cancel?.isCancellationRequested) {
            visitor(this, parent);
            this.elements.forEach(element => element.walk(visitor, this, cancel));
        }
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
    range: Range;
}

export class AALiteralExpression implements Expression {
    constructor(
        readonly elements: Array<AAMemberExpression | CommentStatement>,
        readonly open: Token,
        readonly close: Token
    ) {
        this.range = util.createRangeFromPositions(this.open.range.start, this.close.range.end);
    }

    public readonly range: Range;

    transpile(state: TranspileState): Array<SourceNode | string> {
        let result = [];
        //open curly
        result.push(
            new SourceNode(this.open.range.start.line + 1, this.open.range.start.character, state.pathAbsolute, this.open.text)
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
                    new SourceNode(element.keyToken.range.start.line + 1, element.keyToken.range.start.character, state.pathAbsolute, element.keyToken.text)
                );
                //colon
                result.push(
                    new SourceNode(element.colonToken.range.start.line + 1, element.colonToken.range.start.character, state.pathAbsolute, ':'),
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
            if (nextElement && nextElement instanceof CommentStatement && nextElement.range.start.line === element.range.start.line) {

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
            new SourceNode(this.close.range.start.line + 1, this.close.range.start.character, state.pathAbsolute, this.close.text)
        );
        return result;
    }

    walk(visitor: ExpressionVisitor, parent?: Expression, cancel?: CancellationToken): void {
        if (!cancel?.isCancellationRequested) {
            visitor(this, parent);
            this.elements.forEach(element => {
                if (element instanceof CommentStatement) {
                    element.walk(visitor, this, cancel);
                } else {
                    element.value.walk(visitor, this, cancel);
                }
            });
        }
    }
}

export class UnaryExpression implements Expression {
    constructor(
        readonly operator: Token,
        readonly right: Expression
    ) {
        this.range = util.createRangeFromPositions(this.operator.range.start, this.right.range.end);
    }

    public readonly range: Range;

    transpile(state: TranspileState) {
        return [
            new SourceNode(this.operator.range.start.line + 1, this.operator.range.start.character, state.pathAbsolute, this.operator.text),
            ' ',
            ...this.right.transpile(state)
        ];
    }

    walk(visitor: ExpressionVisitor, parent?: Expression, cancel?: CancellationToken): void {
        if (!cancel?.isCancellationRequested) {
            visitor(this, parent);
            this.right.walk(visitor, this, cancel);
        }
    }
}

export class VariableExpression implements Expression {
    constructor(
        readonly name: Identifier,
        readonly namespaceName: NamespacedVariableNameExpression
    ) {
        this.range = this.name.range;
    }

    public readonly range: Range;
    public isCalled: boolean;

    public getName(parseMode: ParseMode) {
        return parseMode === ParseMode.BrightScript ? this.name.text : this.name.text;
    }

    transpile(state: TranspileState) {
        let result = [];
        //if the callee is the name of a known namespace function
        if (state.file.calleeIsKnownNamespaceFunction(this, this.namespaceName?.getName(ParseMode.BrighterScript))) {
            result.push(
                new SourceNode(
                    this.range.start.line + 1,
                    this.range.start.character,
                    state.pathAbsolute,
                    `${this.namespaceName.getName(ParseMode.BrightScript)}_${this.getName(ParseMode.BrightScript)}`
                )
            );

            //transpile  normally
        } else {
            result.push(
                new SourceNode(this.name.range.start.line + 1, this.name.range.start.character, state.pathAbsolute, this.name.text)
            );
        }
        return result;
    }

    walk(visitor: ExpressionVisitor, parent?: Expression, cancel?: CancellationToken): void {
        if (!cancel?.isCancellationRequested) {
            visitor(this, parent);
            this.namespaceName?.walk(visitor, this, cancel);
        }
    }
}

export class SourceLiteralExpression implements Expression {
    constructor(
        readonly token: Token
    ) {
        this.range = token.range;
    }

    public readonly range: Range;

    private getFunctionName(state: TranspileState, parseMode: ParseMode) {
        let func = state.file.getFunctionScopeAtPosition(this.token.range.start).func;
        let nameParts = [];
        while (func.parentFunction) {
            let index = func.parentFunction.childFunctionExpressions.indexOf(func);
            nameParts.unshift(`anon${index}`);
            func = func.parentFunction;
        }
        //get the index of this function in its parent
        nameParts.unshift(
            func.functionStatement.getName(parseMode)
        );
        return nameParts.join('$');
    }

    transpile(state: TranspileState) {
        let text: string;
        switch (this.token.kind) {
            case TokenKind.SourceFilePathLiteral:
                text = `"${fileUrl(state.pathAbsolute)}"`;
                break;
            case TokenKind.SourceLineNumLiteral:
                text = `${this.token.range.start.line + 1}`;
                break;
            case TokenKind.FunctionNameLiteral:
                text = `"${this.getFunctionName(state, ParseMode.BrightScript)}"`;
                break;
            case TokenKind.SourceFunctionNameLiteral:
                text = `"${this.getFunctionName(state, ParseMode.BrighterScript)}"`;
                break;
            case TokenKind.SourceLocationLiteral:
                text = `"${fileUrl(state.pathAbsolute)}:${this.token.range.start.line + 1}"`;
                break;
            case TokenKind.PkgPathLiteral:
                let pkgPath1 = `pkg:/${state.file.pkgPath}`
                    .replace(/\\/g, '/')
                    .replace(/\.bs$/i, '.brs');

                text = `"${pkgPath1}"`;
                break;
            case TokenKind.PkgLocationLiteral:
                let pkgPath2 = `pkg:/${state.file.pkgPath}`
                    .replace(/\\/g, '/')
                    .replace(/\.bs$/i, '.brs');

                text = `"${pkgPath2}:" + str(LINE_NUM)`;
                break;
            case TokenKind.LineNumLiteral:
            default:
                //use the original text (because it looks like a variable)
                text = this.token.text;
                break;

        }
        return [
            new SourceNode(
                this.range.start.line + 1,
                this.range.start.character,
                state.pathAbsolute,
                text
            )
        ];
    }

    walk(visitor: ExpressionVisitor, parent?: Expression, cancel?: CancellationToken): void {
        if (!cancel?.isCancellationRequested) {
            visitor(this, parent);
        }
    }
}

/**
 * This expression transpiles and acts exactly like a CallExpression,
 * except we need to uniquely identify these statements so we can
 * do more type checking.
 */
export class NewExpression implements Expression {
    constructor(
        readonly newKeyword: Token,
        readonly call: CallExpression
    ) {
        this.range = util.createRangeFromPositions(this.newKeyword.range.start, this.call.range.end);
    }

    /**
     * The name of the class to initialize (with optional namespace prefixed)
     */
    public get className() {
        //the parser guarantees the callee of a new statement's call object will be
        //a NamespacedVariableNameExpression
        return this.call.callee as NamespacedVariableNameExpression;
    }

    public get namespaceName() {
        return this.call.namespaceName;
    }

    public readonly range: Range;

    public transpile(state: TranspileState) {
        return this.call.transpile(state);
    }

    walk(visitor: ExpressionVisitor, parent?: Expression, cancel?: CancellationToken): void {
        if (!cancel?.isCancellationRequested) {
            visitor(this, parent);
            this.call.walk(visitor, this, cancel);
        }
    }
}

export class CallfuncExpression implements Expression {
    constructor(
        readonly callee: Expression,
        readonly operator: Token,
        readonly methodName: Identifier,
        readonly openingParen: Token,
        readonly args: Expression[],
        readonly closingParen: Token
    ) {
        this.range = util.createRangeFromPositions(
            callee.range.start,
            (closingParen ?? args[args.length - 1] ?? openingParen ?? methodName ?? operator).range.end
        );
    }

    public readonly range: Range;

    public transpile(state: TranspileState) {
        let result = [];
        result.push(
            ...this.callee.transpile(state),
            new SourceNode(this.operator.range.start.line + 1, this.operator.range.start.character, state.pathAbsolute, '.callfunc'),
            new SourceNode(this.openingParen.range.start.line + 1, this.openingParen.range.start.character, state.pathAbsolute, '('),
            //the name of the function
            new SourceNode(
                this.methodName.range.start.line + 1,
                this.methodName.range.start.character,
                state.pathAbsolute,
                `"${this.methodName.text}"`
            ),
            ', '
        );
        //transpile args
        //callfunc with zero args never gets called, so pass invalid as the first parameter if there are no args
        if (this.args.length === 0) {
            result.push('invalid');
        } else {
            for (let i = 0; i < this.args.length; i++) {
                //add comma between args
                if (i > 0) {
                    result.push(', ');
                }
                let arg = this.args[i];
                result.push(...arg.transpile(state));
            }
        }
        result.push(
            new SourceNode(this.closingParen.range.start.line + 1, this.closingParen.range.start.character, state.pathAbsolute, ')')
        );
        return result;
    }

    walk(visitor: ExpressionVisitor, parent?: Expression, cancel?: CancellationToken): void {
        if (!cancel?.isCancellationRequested) {
            visitor(this, parent);
            this.callee.walk(visitor, this, cancel);
            this.args.forEach(arg => arg.walk(visitor, this, cancel));
        }
    }
}

/**
 * Since template strings can contain newlines, we need to concatenate multiple strings together with chr() calls.
 * This is a single expression that represents the string contatenation of all parts of a single quasi.
 */
export class TemplateStringQuasiExpression implements Expression {
    constructor(
        readonly expressions: Array<LiteralExpression | EscapedCharCodeLiteral>
    ) {
        this.range = util.createRangeFromPositions(
            this.expressions[0].range.start,
            this.expressions[this.expressions.length - 1].range.end
        );
    }
    readonly range: Range;

    transpile(state: TranspileState, skipEmptyStrings = true) {
        let result = [];
        let plus = '';
        for (let expression of this.expressions) {
            //skip empty strings
            if (((expression as LiteralExpression)?.value as BrsString)?.value === '' && skipEmptyStrings === true) {
                continue;
            }
            result.push(
                plus,
                ...expression.transpile(state)
            );
            plus = ' + ';
        }
        return result;
    }

    walk(visitor: ExpressionVisitor, parent?: Expression, cancel?: CancellationToken): void {
        if (!cancel?.isCancellationRequested) {
            visitor(this, parent);
            this.expressions.forEach(element => {
                if (element instanceof LiteralExpression) {
                    element.walk(visitor, this, cancel);
                }
            });
        }
    }
}

export class TemplateStringExpression implements Expression {
    constructor(
        readonly openingBacktick: Token,
        readonly quasis: TemplateStringQuasiExpression[],
        readonly expressions: Expression[],
        readonly closingBacktick: Token
    ) {
        this.range = util.createRangeFromPositions(
            quasis[0].range.start,
            quasis[quasis.length - 1].range.end
        );
    }

    public readonly range: Range;

    transpile(state: TranspileState) {
        if (this.quasis.length === 1 && this.expressions.length === 0) {
            return this.quasis[0].transpile(state);
        }
        let result = [];
        //wrap the expression in parens to readability
        // result.push(
        //     new SourceNode(
        //         this.openingBacktick.range.start.line + 1,
        //         this.openingBacktick.range.start.character,
        //         state.pathAbsolute,
        //         '('
        //     )
        // );
        let plus = '';
        //helper function to figure out when to include the plus
        function add(...items) {
            if (items.length > 0) {
                result.push(
                    plus,
                    ...items
                );
            }
            plus = ' + ';
        }

        for (let i = 0; i < this.quasis.length; i++) {
            let quasi = this.quasis[i];
            let expression = this.expressions[i];

            add(
                ...quasi.transpile(state)
            );
            if (expression) {
                //skip the toString wrapper around certain expressions
                if (
                    expression instanceof EscapedCharCodeLiteral ||
                    (expression instanceof LiteralExpression && expression.value.kind === ValueKind.String)
                ) {
                    add(
                        ...expression.transpile(state)
                    );

                    //wrap all other expressions with a bslib_toString call to prevent runtime type mismatch errors
                } else {
                    add(
                        'bslib_toString(',
                        ...expression.transpile(state),
                        ')'
                    );
                }
            }
        }

        //wrap the expression in parens to readability
        // result.push(
        //     new SourceNode(
        //         this.openingBacktick.range.end.line + 1,
        //         this.openingBacktick.range.end.character,
        //         state.pathAbsolute,
        //         ')'
        //     )
        // );
        return result;
    }

    walk(visitor: ExpressionVisitor, parent?: Expression, cancel?: CancellationToken): void {
        if (!cancel?.isCancellationRequested) {
            visitor(this, parent);
            this.quasis.forEach(e => e.walk(visitor, this, cancel));
            this.expressions.forEach(e => e.walk(visitor, this, cancel));
        }
    }
}

export class TaggedTemplateStringExpression implements Expression {
    constructor(
        readonly tagName: Identifier,
        readonly openingBacktick: Token,
        readonly quasis: TemplateStringQuasiExpression[],
        readonly expressions: Expression[],
        readonly closingBacktick: Token
    ) {
        this.range = util.createRangeFromPositions(
            quasis[0].range.start,
            quasis[quasis.length - 1].range.end
        );
    }

    public readonly range: Range;

    transpile(state: TranspileState) {
        let result = [];
        result.push(
            new SourceNode(
                this.tagName.range.start.line + 1,
                this.tagName.range.start.character,
                state.pathAbsolute,
                this.tagName.text
            ),
            '(['
        );

        //add quasis as the first array
        for (let i = 0; i < this.quasis.length; i++) {
            let quasi = this.quasis[i];
            //separate items with a comma
            if (i > 0) {
                result.push(
                    ', '
                );
            }
            result.push(
                ...quasi.transpile(state, false)
            );
        }
        result.push(
            '], ['
        );

        //add expressions as the second array
        for (let i = 0; i < this.expressions.length; i++) {
            let expression = this.expressions[i];
            if (i > 0) {
                result.push(
                    ', '
                );
            }
            result.push(
                ...expression.transpile(state)
            );
        }
        result.push(
            new SourceNode(
                this.closingBacktick.range.end.line + 1,
                this.closingBacktick.range.end.character,
                state.pathAbsolute,
                '])'
            )
        );
        return result;
    }

    walk(visitor: ExpressionVisitor, parent?: Expression, cancel?: CancellationToken): void {
        if (!cancel?.isCancellationRequested) {
            visitor(this, parent);
            this.quasis.forEach(e => e.walk(visitor, this, cancel));
            this.expressions.forEach(e => e.walk(visitor, this, cancel));
        }
    }
}
