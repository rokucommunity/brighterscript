/* eslint-disable no-bitwise */
import type { Token, Identifier } from '../lexer/Token';
import { TokenKind } from '../lexer/TokenKind';
import type { Block, CommentStatement, FunctionStatement, LabelStatement } from './Statement';
import type { Range } from 'vscode-languageserver';
import util, { MAX_PARAM_COUNT } from '../util';
import type { BrsTranspileState } from './BrsTranspileState';
import { getBscTypeFromExpression, ParseMode } from './Parser';
import * as fileUrl from 'file-url';
import type { WalkOptions, WalkVisitor } from '../astUtils/visitors';
import { walk, InternalWalkMode } from '../astUtils/visitors';
import { isAALiteralExpression, isAAMemberExpression, isArrayLiteralExpression, isCallExpression, isCallfuncExpression, isCommentStatement, isDottedGetExpression, isEscapedCharCodeLiteralExpression, isIntegerType, isLiteralBoolean, isLiteralExpression, isLiteralNumber, isLiteralString, isLongIntegerType, isStringType, isUnaryExpression, isVariableExpression } from '../astUtils/reflection';
import type { TranspileResult, TypedefProvider } from '../interfaces';
import { VoidType } from '../types/VoidType';
import { DynamicType } from '../types/DynamicType';
import type { BscType, SymbolContainer } from '../types/BscType';
import { SymbolTable } from '../SymbolTable';
import { FunctionType } from '../types/FunctionType';
import { ObjectType } from '../types/ObjectType';
import { ArrayType } from '../types/ArrayType';

export type ExpressionVisitor = (expression: Expression, parent: Expression) => void;

/** A BrightScript expression */
export abstract class Expression {
    /**
     * The starting and ending location of the expression.
     */
    public abstract range: Range;

    public abstract transpile(state: BrsTranspileState): TranspileResult;
    /**
     * When being considered by the walk visitor, this describes what type of element the current class is.
     */
    public visitMode = InternalWalkMode.visitExpressions;

    public abstract walk(visitor: WalkVisitor, options: WalkOptions);
}

export class BinaryExpression extends Expression {
    constructor(
        public left: Expression,
        public operator: Token,
        public right: Expression
    ) {
        super();
        this.range = util.createBoundingRange(this.left, this.right);
    }

    public readonly range: Range;

    transpile(state: BrsTranspileState) {
        return [
            state.sourceNode(this.left, this.left.transpile(state)),
            ' ',
            state.transpileToken(this.operator),
            ' ',
            state.sourceNode(this.right, this.right.transpile(state))
        ];
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'left', visitor, options);
            walk(this, 'right', visitor, options);
        }
    }
}

export class CallExpression extends Expression {
    static MaximumArguments = MAX_PARAM_COUNT;

    constructor(
        readonly callee: Expression,
        readonly openingParen: Token,
        readonly closingParen: Token,
        readonly args: Expression[],
        /**
         * The namespace that currently wraps this call expression. This is NOT the namespace of the callee...that will be represented in the callee expression itself.
         */
        readonly namespaceName: NamespacedVariableNameExpression
    ) {
        super();
        this.range = util.createBoundingRange(this.callee, this.closingParen);
    }

    public readonly range: Range;

    transpile(state: BrsTranspileState, nameOverride?: string) {
        let result = [];

        //transpile the name
        if (nameOverride) {
            result.push(state.sourceNode(this.callee, nameOverride));
        } else {
            result.push(...this.callee.transpile(state));
        }

        result.push(
            state.transpileToken(this.openingParen)
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
            state.transpileToken(this.closingParen)
        );
        return result;
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'callee', visitor, options);
            for (let i = 0; i < this.args.length; i++) {
                walk(this.args, i, visitor, options, this);
            }
        }
    }
}

export class FunctionExpression extends Expression implements TypedefProvider {
    constructor(
        readonly parameters: FunctionParameterExpression[],
        public body: Block,
        readonly functionType: Token | null,
        public end: Token,
        readonly leftParen: Token,
        readonly rightParen: Token,
        readonly asToken?: Token,
        readonly returnType?: TypeExpression,
        /**
         * If this function is enclosed within another function, this will reference that parent function
         */
        readonly parentFunction?: FunctionExpression,
        readonly namespaceName?: NamespacedVariableNameExpression,
        readonly parentSymbolTable?: SymbolTable
    ) {
        super();
        if (this.returnType) {
            this._returnType = this.returnType.type;
        } else if (this.functionType.text.toLowerCase() === 'sub') {
            this._returnType = new VoidType();
        } else {
            this._returnType = new DynamicType();
        }
        this.symbolTable = new SymbolTable(parentSymbolTable);
        for (let param of parameters) {
            this.symbolTable.addSymbol(param.name.text, param.name.range, param.getType());
        }
    }

    public get range() {
        return this.cacheRange();
    }

    /**
     * The range of the function
     */
    public cacheRange() {
        if (!this._range) {
            this._range = util.createBoundingRange(
                this.functionType,
                this.leftParen,
                ...(this.parameters ?? []),
                this.rightParen,
                this.asToken,
                this.returnType,
                this.body,
                this.end
            );
        }
        return this._range;
    }
    private _range: Range;

    public readonly symbolTable: SymbolTable;

    public labelStatements = [] as LabelStatement[];


    private _returnType: BscType;
    /**
     * The type this function returns
     */
    public getReturnType() {
        return this._returnType;
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

    transpile(state: BrsTranspileState, name?: Identifier, includeBody = true) {
        let results = [];
        //'function'|'sub'
        results.push(
            state.transpileToken(this.functionType)
        );
        //functionName?
        if (name) {
            results.push(
                ' ',
                state.transpileToken(name)
            );
        }
        //leftParen
        results.push(
            state.transpileToken(this.leftParen)
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
            state.transpileToken(this.rightParen)
        );
        //as [Type]
        if (this.asToken) {
            results.push(
                ' ',
                //as
                state.transpileToken(this.asToken),
                ' ',
                //return type
                state.sourceNode(this.returnType, this.getReturnType().toTypeString(state.typeContext))
            );
        }
        if (includeBody) {
            state.lineage.unshift(this);
            let body = this.body.transpile(state);
            state.lineage.shift();
            results.push(...body);
        }
        results.push('\n');
        //'end sub'|'end function'
        results.push(
            state.indent(),
            state.transpileToken(this.end)
        );
        return results;
    }

    getTypedef(state: BrsTranspileState, name?: Identifier) {
        return this.transpile(state, name, false);
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            for (let i = 0; i < this.parameters.length; i++) {
                walk(this.parameters, i, visitor, options, this);
            }

            //This is the core of full-program walking...it allows us to step into sub functions
            if (options.walkMode & InternalWalkMode.recurseChildFunctions) {
                walk(this, 'returnType', visitor, options);
                walk(this, 'body', visitor, options);

            }
        }
    }

    getFunctionType(): FunctionType {
        let functionType = new FunctionType(this.getReturnType());
        functionType.isSub = this.functionType.text === 'sub';
        for (let param of this.parameters) {
            functionType.addParameter(param.name.text, param.getType(), param.isOptional);
        }
        return functionType;
    }
}

export class FunctionParameterExpression extends Expression {
    constructor(
        public name: Identifier,
        private typeInContext: BscType,
        public equalsToken?: Token,
        public defaultValue?: Expression,
        public asToken?: Token,
        public type?: TypeExpression,
        readonly namespaceName?: NamespacedVariableNameExpression
    ) {
        super();
        this.range = util.createBoundingRange(this.name, this.equalsToken, this.defaultValue, this.asToken, this.type);
    }

    public readonly range: Range;

    public getType() {
        return this.typeInContext;
    }

    public transpile(state: BrsTranspileState) {
        let result = [
            //name
            state.transpileToken(this.name)
        ] as any[];
        //default value
        if (this.defaultValue) {
            result.push(' = ');
            result.push(this.defaultValue.transpile(state));
        }
        //type declaration
        if (this.asToken) {
            result.push(' ');
            result.push(state.transpileToken(this.asToken));
            result.push(' ');
            result.push(state.sourceNode(this.type, this.getType().toTypeString(state.typeContext)));
        }

        return result;
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        // eslint-disable-next-line no-bitwise
        if (this.defaultValue && options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'defaultValue', visitor, options);
            walk(this, 'type', visitor, options);
        }
    }

    get isOptional(): boolean {
        return !!this.defaultValue;
    }
}

export class NamespacedVariableNameExpression extends Expression {
    constructor(
        //if this is a `DottedGetExpression`, it must be comprised only of `VariableExpression`s
        readonly expression: DottedGetExpression | VariableExpression
    ) {
        super();
        this.range = expression.range;
    }
    public readonly range: Range;

    transpile(state: BrsTranspileState) {
        return [
            state.sourceNode(this, this.getName(ParseMode.BrightScript))
        ];
    }

    public getNameParts() {
        let parts = [] as string[];
        if (isVariableExpression(this.expression)) {
            parts.push(this.expression.name.text);
        } else {
            let expr = this.expression;

            parts.push(expr.name.text);

            while (isVariableExpression(expr) === false) {
                expr = expr.obj as DottedGetExpression;
                parts.unshift(expr.name.text);
            }
        }
        return parts;
    }

    getName(parseMode: ParseMode = ParseMode.BrighterScript) {
        if (parseMode === ParseMode.BrighterScript) {
            return this.getNameParts().join('.');
        } else {
            return this.getNameParts().join('_');
        }
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'expression', visitor, options);
        }
    }
}

export class DottedGetExpression extends Expression {
    constructor(
        readonly obj: Expression,
        readonly name: Identifier,
        readonly dot: Token
    ) {
        super();
        this.range = util.createBoundingRange(this.obj, this.dot, this.name);
    }

    public readonly range: Range;

    transpile(state: BrsTranspileState) {
        //if the callee starts with a namespace name, transpile the name
        if (state.file.calleeStartsWithNamespace(this)) {
            return new NamespacedVariableNameExpression(this as DottedGetExpression | VariableExpression).transpile(state);
        } else {
            return [
                ...this.obj.transpile(state),
                '.',
                state.transpileToken(this.name)
            ];
        }
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'obj', visitor, options);
        }
    }
}

export class XmlAttributeGetExpression extends Expression {
    constructor(
        readonly obj: Expression,
        readonly name: Identifier,
        readonly at: Token
    ) {
        super();
        this.range = util.createBoundingRange(this.obj, this.at, this.name);
    }

    public readonly range: Range;

    transpile(state: BrsTranspileState) {
        return [
            ...this.obj.transpile(state),
            '@',
            state.transpileToken(this.name)
        ];
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'obj', visitor, options);
        }
    }
}

export class IndexedGetExpression extends Expression {
    constructor(
        readonly obj: Expression,
        readonly index: Expression,
        readonly openingSquare: Token,
        readonly closingSquare: Token
    ) {
        super();
        this.range = util.createBoundingRange(this.obj, this.openingSquare, this.index, this.closingSquare);
    }

    public readonly range: Range;

    transpile(state: BrsTranspileState) {
        return [
            ...this.obj.transpile(state),
            state.transpileToken(this.openingSquare),
            ...this.index.transpile(state),
            state.transpileToken(this.closingSquare)
        ];
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'obj', visitor, options);
            walk(this, 'index', visitor, options);
        }
    }
}

export class GroupingExpression extends Expression {
    constructor(
        readonly tokens: {
            left: Token;
            right: Token;
        },
        public expression: Expression
    ) {
        super();
        this.range = util.createBoundingRange(this.tokens.left, this.expression, this.tokens.right);
    }

    public readonly range: Range;

    transpile(state: BrsTranspileState) {
        return [
            state.transpileToken(this.tokens.left),
            ...this.expression.transpile(state),
            state.transpileToken(this.tokens.right)
        ];
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'expression', visitor, options);
        }
    }
}

export class LiteralExpression extends Expression {
    constructor(
        public token: Token
    ) {
        super();
        this.range = this.token.range;
        this.type = util.tokenToBscType(token);
    }

    public readonly range: Range;

    /**
     * The (data) type of this expression
     */
    public type: BscType;

    transpile(state: BrsTranspileState) {
        let text: string;
        if (this.token.kind === TokenKind.TemplateStringQuasi) {
            //wrap quasis with quotes (and escape inner quotemarks)
            text = `"${this.token.text.replace(/"/g, '""')}"`;

        } else if (isStringType(this.type)) {
            text = this.token.text;
            //add trailing quotemark if it's missing. We will have already generated a diagnostic for this.
            if (text.endsWith('"') === false) {
                text += '"';
            }
        } else {
            text = this.token.text;
        }

        return [
            state.sourceNode(this, text)
        ];
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        //nothing to walk
    }
}

/**
 * This is a special expression only used within template strings. It exists so we can prevent producing lots of empty strings
 * during template string transpile by identifying these expressions explicitly and skipping the bslib_toString around them
 */
export class EscapedCharCodeLiteralExpression extends Expression {
    constructor(
        readonly token: Token & { charCode: number }
    ) {
        super();
        this.range = token.range;
    }
    public readonly range: Range;

    transpile(state: BrsTranspileState) {
        return [
            state.sourceNode(this, `chr(${this.token.charCode})`)
        ];
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        //nothing to walk
    }
}

export class ArrayLiteralExpression extends Expression {
    constructor(
        readonly elements: Array<Expression | CommentStatement>,
        readonly open: Token,
        readonly close: Token,
        readonly hasSpread = false
    ) {
        super();
        this.range = util.createBoundingRange(this.open, ...(this.elements ?? []), this.close);
    }

    public readonly range: Range;

    transpile(state: BrsTranspileState) {
        let result = [];
        result.push(
            state.transpileToken(this.open)
        );
        let hasChildren = this.elements.length > 0;
        state.blockDepth++;

        for (let i = 0; i < this.elements.length; i++) {
            let previousElement = this.elements[i - 1];
            let element = this.elements[i];

            if (isCommentStatement(element)) {
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
                    if (isCommentStatement(el) === false) {
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
            state.transpileToken(this.close)
        );
        return result;
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            for (let i = 0; i < this.elements.length; i++) {
                walk(this.elements, i, visitor, options, this);
            }
        }
    }
}

export class AAMemberExpression extends Expression {
    constructor(
        public keyToken: Token,
        public colonToken: Token,
        /** The expression evaluated to determine the member's initial value. */
        public value: Expression,
        public type: BscType
    ) {
        super();
        this.range = util.createBoundingRange(this.keyToken, this.colonToken, this.value);
    }

    public readonly range: Range;
    public commaToken?: Token;

    transpile(state: BrsTranspileState) {
        //TODO move the logic from AALiteralExpression loop into this function
        return [];
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        walk(this, 'value', visitor, options);
    }

}

export class AALiteralExpression extends Expression implements SymbolContainer {
    constructor(
        readonly elements: Array<AAMemberExpression | CommentStatement>,
        readonly open: Token,
        readonly close: Token,
        readonly functionExpression: FunctionExpression
    ) {
        super();
        this.range = util.createBoundingRange(this.open, ...(this.elements ?? []), this.close);
        this.buildSymbolTable();
    }

    public readonly range: Range;

    readonly symbolTable: SymbolTable = new SymbolTable();
    readonly memberTable: SymbolTable = new SymbolTable();

    public buildSymbolTable() {
        this.symbolTable.clear();
        this.symbolTable.addSymbol('m', { start: this.open.range.start, end: this.close.range.end }, new ObjectType(this.memberTable));
        for (const element of this.elements) {
            if (isAAMemberExpression(element)) {
                this.memberTable.addSymbol(element.keyToken.text, element.keyToken.range, getBscTypeFromExpression(element.value, this.functionExpression));
            }
        }
    }

    transpile(state: BrsTranspileState) {
        let result = [];
        //open curly
        result.push(
            state.transpileToken(this.open)
        );
        let hasChildren = this.elements.length > 0;
        //add newline if the object has children and the first child isn't a comment starting on the same line as opening curly
        if (hasChildren && (isCommentStatement(this.elements[0]) === false || !util.linesTouch(this.elements[0], this.open))) {
            result.push('\n');
        }
        state.blockDepth++;
        for (let i = 0; i < this.elements.length; i++) {
            let element = this.elements[i];
            let previousElement = this.elements[i - 1];
            let nextElement = this.elements[i + 1];

            //don't indent if comment is same-line
            if (isCommentStatement(element as any) &&
                (util.linesTouch(this.open, element) || util.linesTouch(previousElement, element))
            ) {
                result.push(' ');

                //indent line
            } else {
                result.push(state.indent());
            }

            //render comments
            if (isCommentStatement(element)) {
                result.push(...element.transpile(state));
            } else {
                //key
                result.push(
                    state.transpileToken(element.keyToken)
                );
                //colon
                result.push(
                    state.transpileToken(element.colonToken),
                    ' '
                );

                //determine if comments are the only members left in the array
                let onlyCommentsRemaining = true;
                for (let j = i + 1; j < this.elements.length; j++) {
                    if (isCommentStatement(this.elements[j]) === false) {
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
            if (nextElement && isCommentStatement(nextElement) && nextElement.range.start.line === element.range.start.line) {

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
            state.transpileToken(this.close)
        );
        return result;
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            for (let i = 0; i < this.elements.length; i++) {
                if (isCommentStatement(this.elements[i])) {
                    walk(this.elements, i, visitor, options, this);
                } else {
                    walk(this.elements, i, visitor, options, this);
                }
            }
        }
    }
}

export class UnaryExpression extends Expression {
    constructor(
        public operator: Token,
        public right: Expression
    ) {
        super();
        this.range = util.createBoundingRange(this.operator, this.right);
    }

    public readonly range: Range;

    transpile(state: BrsTranspileState) {
        return [
            state.transpileToken(this.operator),
            ' ',
            ...this.right.transpile(state)
        ];
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'right', visitor, options);
        }
    }
}

export class VariableExpression extends Expression {
    constructor(
        public name: Identifier,
        public namespaceName: NamespacedVariableNameExpression
    ) {
        super();
        this.range = this.name.range;
    }

    public readonly range: Range;

    public isCalled: boolean;

    public getName(parseMode: ParseMode) {
        return parseMode === ParseMode.BrightScript ? this.name.text : this.name.text;
    }

    transpile(state: BrsTranspileState) {
        let result = [];
        //if the callee is the name of a known namespace function
        if (state.file.calleeIsKnownNamespaceFunction(this, this.namespaceName?.getName(ParseMode.BrighterScript))) {
            result.push(
                state.sourceNode(this, [
                    this.namespaceName.getName(ParseMode.BrightScript),
                    '_',
                    this.getName(ParseMode.BrightScript)
                ])
            );

            //transpile  normally
        } else {
            result.push(
                state.transpileToken(this.name)
            );
        }
        return result;
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        //nothing to walk
    }
}

export class SourceLiteralExpression extends Expression {
    constructor(
        readonly token: Token
    ) {
        super();
        this.range = token.range;
    }

    public readonly range: Range;

    private getFunctionName(state: BrsTranspileState, parseMode: ParseMode) {
        let functionExpression = state.file.getFunctionExpressionAtPosition(this.token.range.start);
        let nameParts = [];
        while (functionExpression.parentFunction) {
            let index = functionExpression.parentFunction.childFunctionExpressions.indexOf(functionExpression);
            nameParts.unshift(`anon${index}`);
            functionExpression = functionExpression.parentFunction;
        }
        //get the index of this function in its parent
        nameParts.unshift(
            functionExpression.functionStatement.getName(parseMode)
        );
        return nameParts.join('$');
    }

    transpile(state: BrsTranspileState) {
        let text: string;
        switch (this.token.kind) {
            case TokenKind.SourceFilePathLiteral:
                const pathUrl = fileUrl(state.srcPath);
                text = `"${pathUrl.substring(0, 4)}" + "${pathUrl.substring(4)}"`;
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
                const locationUrl = fileUrl(state.srcPath);
                text = `"${locationUrl.substring(0, 4)}" + "${locationUrl.substring(4)}:${this.token.range.start.line + 1}"`;
                break;
            case TokenKind.PkgPathLiteral:
                text = `"${state.file.pkgPath.replace(/\.bs$/i, '.brs')}"`;
                break;
            case TokenKind.PkgLocationLiteral:
                text = `"${state.file.pkgPath.replace(/\.bs$/i, '.brs')}:" + str(LINE_NUM)`;
                break;
            case TokenKind.LineNumLiteral:
            default:
                //use the original text (because it looks like a variable)
                text = this.token.text;
                break;

        }
        return [
            state.sourceNode(this, text)
        ];
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        //nothing to walk
    }
}

/**
 * This expression transpiles and acts exactly like a CallExpression,
 * except we need to uniquely identify these statements so we can
 * do more type checking.
 */
export class NewExpression extends Expression {
    constructor(
        readonly newKeyword: Token,
        readonly call: CallExpression
    ) {
        super();
        this.range = util.createBoundingRange(this.newKeyword, this.call);
    }

    public readonly range: Range;

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

    public transpile(state: BrsTranspileState) {
        const cls = state.file.getClassFileLink(
            this.className.getName(ParseMode.BrighterScript),
            this.namespaceName?.getName(ParseMode.BrighterScript)
        )?.item;
        //new statements within a namespace block can omit the leading namespace if the class resides in that same namespace.
        //So we need to figure out if this is a namespace-omitted class, or if this class exists without a namespace.
        return this.call.transpile(state, cls?.getName(ParseMode.BrightScript));
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'call', visitor, options);
        }
    }
}

export class CallfuncExpression extends Expression {
    constructor(
        readonly callee: Expression,
        readonly operator: Token,
        readonly methodName: Identifier,
        readonly openingParen: Token,
        readonly args: Expression[],
        readonly closingParen: Token
    ) {
        super();
        this.range = util.createBoundingRange(this.callee, this.operator, this.methodName, this.openingParen, ...(this.args ?? []), this.closingParen);
    }

    public readonly range: Range;

    public transpile(state: BrsTranspileState) {
        let result = [];
        result.push(
            ...this.callee.transpile(state),
            state.sourceNode(this.operator, '.callfunc'),
            state.transpileToken(this.openingParen),
            //the name of the function
            state.sourceNode(this.methodName, ['"', this.methodName.text, '"']),
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
            state.transpileToken(this.closingParen)
        );
        return result;
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'callee', visitor, options);
            for (let i = 0; i < this.args.length; i++) {
                walk(this.args, i, visitor, options, this);
            }
        }
    }
}

/**
 * Since template strings can contain newlines, we need to concatenate multiple strings together with chr() calls.
 * This is a single expression that represents the string contatenation of all parts of a single quasi.
 */
export class TemplateStringQuasiExpression extends Expression {
    constructor(
        readonly expressions: Array<LiteralExpression | EscapedCharCodeLiteralExpression>
    ) {
        super();
        this.range = util.createBoundingRange(...(this.expressions ?? []));
    }

    public readonly range: Range;

    transpile(state: BrsTranspileState, skipEmptyStrings = true) {
        let result = [];
        let plus = '';
        for (let expression of this.expressions) {
            //skip empty strings
            //TODO what does an empty string literal expression look like?
            if (expression.token.text === '' && skipEmptyStrings === true) {
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

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            for (let i = 0; i < this.expressions.length; i++) {
                walk(this.expressions, i, visitor, options, this);
            }
        }
    }
}

export class TemplateStringExpression extends Expression {
    constructor(
        readonly openingBacktick: Token,
        readonly quasis: TemplateStringQuasiExpression[],
        readonly expressions: Expression[],
        readonly closingBacktick: Token
    ) {
        super();
        //the expression always starts and ends with a quasi, so we don't need to consider the expression locations
        this.range = util.createBoundingRange(this.openingBacktick, ...(this.quasis ?? []), this.closingBacktick);
    }

    public readonly range: Range;

    transpile(state: BrsTranspileState) {
        if (this.quasis.length === 1 && this.expressions.length === 0) {
            return this.quasis[0].transpile(state);
        }
        let result = [];
        let plus = '';
        //helper function to figure out when to include the plus
        function add(...items) {
            if (items.length > 0) {
                result.push(
                    plus,
                    ...items
                );
            }
            //set the plus after the first occurance of a nonzero length set of items
            if (plus === '' && items.length > 0) {
                plus = ' + ';
            }
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
                    isEscapedCharCodeLiteralExpression(expression) ||
                    (isLiteralExpression(expression) && isStringType(expression.type))
                ) {
                    add(
                        ...expression.transpile(state)
                    );

                    //wrap all other expressions with a bslib_toString call to prevent runtime type mismatch errors
                } else {
                    add(
                        state.bslibPrefix + '_toString(',
                        ...expression.transpile(state),
                        ')'
                    );
                }
            }
        }

        return result;
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            //walk the quasis and expressions in left-to-right order
            for (let i = 0; i < this.quasis.length; i++) {
                walk(this.quasis, i, visitor, options, this);

                //this skips the final loop iteration since we'll always have one more quasi than expression
                if (this.expressions[i]) {
                    walk(this.expressions, i, visitor, options, this);
                }
            }
        }
    }
}

export class TaggedTemplateStringExpression extends Expression {
    constructor(
        readonly tagName: Identifier,
        readonly openingBacktick: Token,
        readonly quasis: TemplateStringQuasiExpression[],
        readonly expressions: Expression[],
        readonly closingBacktick: Token
    ) {
        super();
        //the expression always starts and ends with a quasi, so we don't need to consider the expression locations
        this.range = util.createBoundingRange(this.tagName, this.openingBacktick, ...(this.quasis ?? []), this.closingBacktick);
    }

    public readonly range: Range;

    transpile(state: BrsTranspileState) {
        let result = [];
        result.push(
            state.transpileToken(this.tagName),
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
            state.sourceNode(this.closingBacktick, '])')
        );
        return result;
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            //walk the quasis and expressions in left-to-right order
            for (let i = 0; i < this.quasis.length; i++) {
                walk(this.quasis, i, visitor, options, this);

                //this skips the final loop iteration since we'll always have one more quasi than expression
                if (this.expressions[i]) {
                    walk(this.expressions, i, visitor, options, this);
                }
            }
        }
    }
}

export class AnnotationExpression extends Expression {
    constructor(
        readonly atToken: Token,
        readonly nameToken: Token
    ) {
        super();
        this.name = nameToken.text;
    }

    public get range() {
        return this.cacheRange();
    }

    public cacheRange() {
        if (!this._range) {
            this._range = util.createBoundingRange(this.atToken, this.nameToken, this.call);
        }
        return this._range;
    }
    private _range: Range;

    public name: string;
    public call: CallExpression;

    /**
     * Convert annotation arguments to JavaScript types
     * @param strict If false, keep Expression objects not corresponding to JS types
     */
    getArguments(strict = true): ExpressionValue[] {
        if (!this.call) {
            return [];
        }
        return this.call.args.map(e => expressionToValue(e, strict));
    }

    transpile(state: BrsTranspileState) {
        return [];
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        //nothing to walk
    }
    getTypedef(state: BrsTranspileState) {
        return [
            '@',
            this.name,
            ...(this.call?.transpile(state) ?? [])
        ];
    }
}

export class TernaryExpression extends Expression {
    constructor(
        readonly test: Expression,
        readonly questionMarkToken: Token,
        readonly consequent?: Expression,
        readonly colonToken?: Token,
        readonly alternate?: Expression
    ) {
        super();
        this.range = util.createBoundingRange(this.test, this.questionMarkToken, this.consequent, this.colonToken, this.alternate);
    }

    public readonly range: Range;

    transpile(state: BrsTranspileState) {
        let result = [];
        let consequentInfo = util.getExpressionInfo(this.consequent);
        let alternateInfo = util.getExpressionInfo(this.alternate);

        //get all unique variable names used in the consequent and alternate, and sort them alphabetically so the output is consistent
        let allUniqueVarNames = [...new Set([...consequentInfo.uniqueVarNames, ...alternateInfo.uniqueVarNames])].sort();
        let mutatingExpressions = [
            ...consequentInfo.expressions,
            ...alternateInfo.expressions
        ].filter(e => e instanceof CallExpression || e instanceof CallfuncExpression || e instanceof DottedGetExpression);

        if (mutatingExpressions.length > 0) {
            result.push(
                state.sourceNode(
                    this.questionMarkToken,
                    //write all the scope variables as parameters.
                    //TODO handle when there are more than 31 parameters
                    `(function(__bsCondition, ${allUniqueVarNames.join(', ')})`
                ),
                state.newline,
                //double indent so our `end function` line is still indented one at the end
                state.indent(2),
                state.sourceNode(this.test, `if __bsCondition then`),
                state.newline,
                state.indent(1),
                state.sourceNode(this.consequent ?? this.questionMarkToken, 'return '),
                ...this.consequent?.transpile(state) ?? [state.sourceNode(this.questionMarkToken, 'invalid')],
                state.newline,
                state.indent(-1),
                state.sourceNode(this.consequent ?? this.questionMarkToken, 'else'),
                state.newline,
                state.indent(1),
                state.sourceNode(this.consequent ?? this.questionMarkToken, 'return '),
                ...this.alternate?.transpile(state) ?? [state.sourceNode(this.consequent ?? this.questionMarkToken, 'invalid')],
                state.newline,
                state.indent(-1),
                state.sourceNode(this.questionMarkToken, 'end if'),
                state.newline,
                state.indent(-1),
                state.sourceNode(this.questionMarkToken, 'end function)('),
                ...this.test.transpile(state),
                state.sourceNode(this.questionMarkToken, `, ${allUniqueVarNames.join(', ')})`)
            );
            state.blockDepth--;
        } else {
            result.push(
                state.sourceNode(this.test, state.bslibPrefix + `_ternary(`),
                ...this.test.transpile(state),
                state.sourceNode(this.test, `, `),
                ...this.consequent?.transpile(state) ?? ['invalid'],
                `, `,
                ...this.alternate?.transpile(state) ?? ['invalid'],
                `)`
            );
        }
        return result;
    }

    public walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'test', visitor, options);
            walk(this, 'consequent', visitor, options);
            walk(this, 'alternate', visitor, options);
        }
    }
}

export class NullCoalescingExpression extends Expression {
    constructor(
        public consequent: Expression,
        public questionQuestionToken: Token,
        public alternate: Expression
    ) {
        super();
        this.range = util.createBoundingRange(this.consequent, this.questionQuestionToken, this.alternate);
    }

    public readonly range: Range;

    transpile(state: BrsTranspileState) {
        let result = [];
        let consequentInfo = util.getExpressionInfo(this.consequent);
        let alternateInfo = util.getExpressionInfo(this.alternate);

        //get all unique variable names used in the consequent and alternate, and sort them alphabetically so the output is consistent
        let allUniqueVarNames = [...new Set([...consequentInfo.uniqueVarNames, ...alternateInfo.uniqueVarNames])].sort();
        let hasMutatingExpression = [
            ...consequentInfo.expressions,
            ...alternateInfo.expressions
        ].find(e => isCallExpression(e) || isCallfuncExpression(e) || isDottedGetExpression(e));

        if (hasMutatingExpression) {
            result.push(
                `(function(`,
                //write all the scope variables as parameters.
                //TODO handle when there are more than 31 parameters
                allUniqueVarNames.join(', '),
                ')',
                state.newline,
                //double indent so our `end function` line is still indented one at the end
                state.indent(2),
                //evaluate the consequent exactly once, and then use it in the following condition
                `__bsConsequent = `,
                ...this.consequent.transpile(state),
                state.newline,
                state.indent(),
                `if __bsConsequent <> invalid then`,
                state.newline,
                state.indent(1),
                'return __bsConsequent',
                state.newline,
                state.indent(-1),
                'else',
                state.newline,
                state.indent(1),
                'return ',
                ...this.alternate.transpile(state),
                state.newline,
                state.indent(-1),
                'end if',
                state.newline,
                state.indent(-1),
                'end function)(',
                allUniqueVarNames.join(', '),
                ')'
            );
            state.blockDepth--;
        } else {
            result.push(
                state.bslibPrefix + `_coalesce(`,
                ...this.consequent.transpile(state),
                ', ',
                ...this.alternate.transpile(state),
                ')'
            );
        }
        return result;
    }

    public walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'consequent', visitor, options);
            walk(this, 'alternate', visitor, options);
        }
    }
}

export class RegexLiteralExpression extends Expression {
    public constructor(
        public tokens: {
            regexLiteral: Token;
        }
    ) {
        super();
        this.range = this.tokens.regexLiteral.range;
    }

    public readonly range: Range;

    public transpile(state: BrsTranspileState): TranspileResult {
        let text = this.tokens.regexLiteral?.text ?? '';
        let flags = '';
        //get any flags from the end
        const flagMatch = /\/([a-z]+)$/i.exec(text);
        if (flagMatch) {
            text = text.substring(0, flagMatch.index + 1);
            flags = flagMatch[1];
        }
        let pattern = text
            //remove leading and trailing slashes
            .substring(1, text.length - 1)
            //escape quotemarks
            .split('"').join('" + chr(34) + "');

        return [
            state.sourceNode(this.tokens.regexLiteral, [
                'CreateObject("roRegex", ',
                `"${pattern}", `,
                `"${flags}"`,
                ')'
            ])
        ];
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        //nothing to walk
    }
}

export class TypeExpression extends Expression {
    public constructor(
        private tokens: {
            type?: Token;
        },
        public namespaceName?: NamespacedVariableNameExpression
    ) {
        super();
    }

    public get range() {
        const lastToken = this.tokens.type;
        return util.createRangeFromPositions(this.tokens.type?.range.start, lastToken?.range.end);
    }

    private _type: BscType;
    /**
     * The this TypeExpression refers to
     */
    public get type(): BscType {
        if (this._type) {
            return this._type;
        }
        this._type = this.getType(ParseMode.BrighterScript);
        return this._type;
    }

    /**
     * Derive a BscType from the type token
     * Can deal with multiple brackets to make multidimensional arrays, eg. float[][]
     * Defaults to `DynamicType`
     */
    getType(parseMode: ParseMode = ParseMode.BrighterScript) {
        let exprType = this.tokens.type
            ? util.tokenToBscType(this.tokens.type, parseMode === ParseMode.BrighterScript, this.namespaceName)
            : new DynamicType();
        return exprType;
    }

    /**
     * Is this a valid, (eg. known) type?
     */
    isValidType(parseMode: ParseMode = ParseMode.BrighterScript) {
        return !!util.tokenToBscType(this.tokens.type, parseMode === ParseMode.BrighterScript, this.namespaceName);
    }

    /**
     * Gives a human readable string that says the type
     * @returns text to display to show the type
     */
    getText(): string {
        let result = this.tokens.type.text;
        return result;
    }

    public transpile(state: BrsTranspileState): TranspileResult {
        let result = [];
        //type declaration
        result.push(state.sourceNode({ range: this.range }, this.type.toTypeString(state.typeContext)));
        return result;
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        //nothing to walk
    }
}

export class ArrayTypeExpression extends TypeExpression {
    public constructor(
        public innerTypes: TypeExpression[], // this is an array so that in the future when we support union types
        private bracketTokens: {
            leftBracket?: Token;
            rightBracket?: Token;
        },
        public namespaceName?: NamespacedVariableNameExpression
    ) {
        super({}, namespaceName);

    }

    /*
     * TODO - Support union types
    */
    private get defaultTypeExpression() {
        return this.innerTypes[0];
    }

    public get range() {
        return util.createRangeFromPositions(this.defaultTypeExpression.range.start, this.bracketTokens.rightBracket?.range.end);
    }

    /**
     * Derive a BscType from the type token
     * Returns an array type with the inner types based on the inner type expressions
     */
    getType(parseMode: ParseMode = ParseMode.BrighterScript) {
        const innerBscTypes = this.innerTypes.map(inner => inner.getType(parseMode));
        return new ArrayType(...innerBscTypes);
    }

    /**
     * Is this a valid, (eg. known) type?
     */
    isValidType(parseMode: ParseMode = ParseMode.BrighterScript) {
        if (parseMode === ParseMode.BrighterScript) {
            return this.innerTypes.reduce((validSoFar, innerType) => {
                return validSoFar && innerType.isValidType(parseMode);
            }, true);
        }
        return false;
    }

    /**
     * Gives a human readable string that says the type
     * @returns text to display to show the type
     */
    getText(): string {
        return this.defaultTypeExpression.getText() + '[]';
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            for (let i = 0; i < this.innerTypes.length; i++) {
                walk(this.innerTypes, i, visitor, options, this);
            }
        }
    }
}

// eslint-disable-next-line @typescript-eslint/consistent-indexed-object-style
type ExpressionValue = string | number | boolean | Expression | ExpressionValue[] | { [key: string]: ExpressionValue };

function expressionToValue(expr: Expression, strict: boolean): ExpressionValue {
    if (!expr) {
        return null;
    }
    if (isUnaryExpression(expr) && isLiteralNumber(expr.right)) {
        return numberExpressionToValue(expr.right, expr.operator.text);
    }
    if (isLiteralString(expr)) {
        //remove leading and trailing quotes
        return expr.token.text.replace(/^"/, '').replace(/"$/, '');
    }
    if (isLiteralNumber(expr)) {
        return numberExpressionToValue(expr);
    }

    if (isLiteralBoolean(expr)) {
        return expr.token.text.toLowerCase() === 'true';
    }
    if (isArrayLiteralExpression(expr)) {
        return expr.elements
            .filter(e => !isCommentStatement(e))
            .map(e => expressionToValue(e, strict));
    }
    if (isAALiteralExpression(expr)) {
        return expr.elements.reduce((acc, e) => {
            if (!isCommentStatement(e)) {
                acc[e.keyToken.text] = expressionToValue(e.value, strict);
            }
            return acc;
        }, {});
    }
    return strict ? null : expr;
}

function numberExpressionToValue(expr: LiteralExpression, operator = '') {
    if (isIntegerType(expr.type) || isLongIntegerType(expr.type)) {
        return parseInt(operator + expr.token.text);
    } else {
        return parseFloat(operator + expr.token.text);
    }
}
