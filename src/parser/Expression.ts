/* eslint-disable no-bitwise */
import type { Token, Identifier } from '../lexer/Token';
import { TokenKind } from '../lexer/TokenKind';
import type { Block, CommentStatement, FunctionStatement, NamespaceStatement } from './Statement';
import type { Range } from 'vscode-languageserver';
import util from '../util';
import type { BrsTranspileState } from './BrsTranspileState';
import { ParseMode } from './Parser';
import * as fileUrl from 'file-url';
import type { WalkOptions, WalkVisitor } from '../astUtils/visitors';
import { createVisitor, WalkMode } from '../astUtils/visitors';
import { walk, InternalWalkMode, walkArray } from '../astUtils/visitors';
import { isAALiteralExpression, isArrayLiteralExpression, isCallExpression, isCallfuncExpression, isCommentStatement, isDottedGetExpression, isEscapedCharCodeLiteralExpression, isFunctionExpression, isFunctionStatement, isIntegerType, isLiteralBoolean, isLiteralExpression, isLiteralNumber, isLiteralString, isLongIntegerType, isMethodStatement, isNamespaceStatement, isStringType, isTypeCastExpression, isUnaryExpression, isVariableExpression } from '../astUtils/reflection';
import type { TranspileResult, TypedefProvider } from '../interfaces';
import { VoidType } from '../types/VoidType';
import { DynamicType } from '../types/DynamicType';
import type { BscType } from '../types/BscType';
import { FunctionType } from '../types/FunctionType';
import type { AstNode } from './AstNode';
import { Expression } from './AstNode';
import { SymbolTable } from '../SymbolTable';
import { SourceNode } from 'source-map';

export type ExpressionVisitor = (expression: Expression, parent: Expression) => void;

export class BinaryExpression extends Expression {
    constructor(
        public left: Expression,
        public operator: Token,
        public right: Expression
    ) {
        super();
        this.range = util.createBoundingRange(this.left, this.operator, this.right);
    }

    public readonly range: Range | undefined;

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
    static MaximumArguments = 32;

    constructor(
        readonly callee: Expression,
        /**
         * Can either be `(`, or `?(` for optional chaining
         */
        readonly openingParen: Token,
        readonly closingParen: Token,
        readonly args: Expression[],
        unused?: any
    ) {
        super();
        this.range = util.createBoundingRange(this.callee, this.openingParen, ...args, this.closingParen);
    }

    public readonly range: Range | undefined;

    /**
     * Get the name of the wrapping namespace (if it exists)
     * @deprecated use `.findAncestor(isNamespaceStatement)` instead.
     */
    public get namespaceName() {
        return this.findAncestor<NamespaceStatement>(isNamespaceStatement)?.nameExpression;
    }

    transpile(state: BrsTranspileState, nameOverride?: string) {
        let result: TranspileResult = [];

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
        if (this.closingParen) {
            result.push(
                state.transpileToken(this.closingParen)
            );
        }
        return result;
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'callee', visitor, options);
            walkArray(this.args, visitor, options, this);
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
        readonly returnTypeToken?: Token
    ) {
        super();
        if (this.returnTypeToken) {
            this.returnType = util.tokenToBscType(this.returnTypeToken);
        } else if (this.functionType?.text.toLowerCase() === 'sub') {
            this.returnType = new VoidType();
        } else {
            this.returnType = DynamicType.instance;
        }

        //if there's a body, and it doesn't have a SymbolTable, assign one
        if (this.body && !this.body.symbolTable) {
            this.body.symbolTable = new SymbolTable(`Function Body`);
        }
        this.symbolTable = new SymbolTable('FunctionExpression', () => this.parent?.getSymbolTable());
    }

    /**
     * The type this function returns
     */
    public returnType: BscType;

    /**
     * Get the name of the wrapping namespace (if it exists)
     * @deprecated use `.findAncestor(isNamespaceStatement)` instead.
     */
    public get namespaceName() {
        return this.findAncestor<NamespaceStatement>(isNamespaceStatement)?.nameExpression;
    }

    /**
     * Get the name of the wrapping namespace (if it exists)
     * @deprecated use `.findAncestor(isFunctionExpression)` instead.
     */
    public get parentFunction() {
        return this.findAncestor<FunctionExpression>(isFunctionExpression);
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
     * @deprecated use `.walk(createVisitor({ FunctionExpression: ()=>{}), { walkMode: WalkMode.visitAllRecursive })` instead
     */
    public get childFunctionExpressions() {
        const expressions = [] as FunctionExpression[];
        this.walk(createVisitor({
            FunctionExpression: (expression) => {
                expressions.push(expression);
            }
        }), {
            walkMode: WalkMode.visitAllRecursive
        });
        return expressions;
    }

    /**
     * The range of the function, starting at the 'f' in function or 's' in sub (or the open paren if the keyword is missing),
     * and ending with the last n' in 'end function' or 'b' in 'end sub'
     */
    public get range() {
        return util.createBoundingRange(
            this.functionType, this.leftParen,
            ...this.parameters,
            this.rightParen,
            this.asToken,
            this.returnTypeToken,
            this.end
        );
    }

    transpile(state: BrsTranspileState, name?: Identifier, includeBody = true) {
        let results = [] as TranspileResult;
        //'function'|'sub'
        results.push(
            state.transpileToken(this.functionType!)
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
        if (this.asToken && !state.options.removeParameterTypes) {
            results.push(
                ' ',
                //as
                state.transpileToken(this.asToken),
                ' ',
                //return type
                state.sourceNode(this.returnTypeToken!, this.returnType.toTypeString())
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

    getTypedef(state: BrsTranspileState) {
        let results = [
            new SourceNode(1, 0, null, [
                //'function'|'sub'
                this.functionType?.text,
                //functionName?
                ...(isFunctionStatement(this.parent) || isMethodStatement(this.parent) ? [' ', this.parent.name?.text ?? ''] : []),
                //leftParen
                '(',
                //parameters
                ...(
                    this.parameters?.map((param, i) => ([
                        //separating comma
                        i > 0 ? ', ' : '',
                        ...param.getTypedef(state)
                    ])) ?? []
                ) as any,
                //right paren
                ')',
                //as <ReturnType>
                ...(this.asToken ? [
                    ' as ',
                    this.returnTypeToken?.text
                ] : []),
                '\n',
                state.indent(),
                //'end sub'|'end function'
                this.end.text
            ])
        ];
        return results;
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walkArray(this.parameters, visitor, options, this);

            //This is the core of full-program walking...it allows us to step into sub functions
            if (options.walkMode & InternalWalkMode.recurseChildFunctions) {
                walk(this, 'body', visitor, options);
            }
        }
    }

    getFunctionType(): FunctionType {
        let functionType = new FunctionType(this.returnType);
        functionType.isSub = this.functionType?.text === 'sub';
        for (let param of this.parameters) {
            functionType.addParameter(param.name.text, param.type, !!param.typeToken);
        }
        return functionType;
    }
}

export class FunctionParameterExpression extends Expression {
    constructor(
        public name: Identifier,
        public typeToken?: Token,
        public defaultValue?: Expression,
        public asToken?: Token
    ) {
        super();
        if (typeToken) {
            this.type = util.tokenToBscType(typeToken);
        } else {
            this.type = new DynamicType();
        }
    }

    public type: BscType;

    public get range(): Range | undefined {
        return util.createBoundingRange(
            this.name,
            this.asToken,
            this.typeToken,
            this.defaultValue
        );
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
        if (this.asToken && !state.options.removeParameterTypes) {
            result.push(' ');
            result.push(state.transpileToken(this.asToken));
            result.push(' ');
            result.push(state.sourceNode(this.typeToken!, this.type.toTypeString()));
        }

        return result;
    }

    public getTypedef(state: BrsTranspileState): TranspileResult {
        const results = [this.name.text] as TranspileResult;

        if (this.defaultValue) {
            results.push(' = ', ...this.defaultValue.transpile(state));
        }

        if (this.asToken) {
            results.push(' as ');

            // TODO: Is this conditional needed? Will typeToken always exist
            // so long as `asToken` exists?
            if (this.typeToken) {
                results.push(this.typeToken.text);
            }
        }

        return results;
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        // eslint-disable-next-line no-bitwise
        if (this.defaultValue && options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'defaultValue', visitor, options);
        }
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
    range: Range | undefined;

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

    getName(parseMode: ParseMode) {
        if (parseMode === ParseMode.BrighterScript) {
            return this.getNameParts().join('.');
        } else {
            return this.getNameParts().join('_');
        }
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        this.expression?.link();
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'expression', visitor, options);
        }
    }
}

export class DottedGetExpression extends Expression {
    constructor(
        readonly obj: Expression,
        readonly name: Identifier,
        /**
         * Can either be `.`, or `?.` for optional chaining
         */
        readonly dot: Token
    ) {
        super();
        this.range = util.createBoundingRange(this.obj, this.dot, this.name);
    }

    public readonly range: Range | undefined;

    transpile(state: BrsTranspileState) {
        //if the callee starts with a namespace name, transpile the name
        if (state.file.calleeStartsWithNamespace(this)) {
            return new NamespacedVariableNameExpression(this as DottedGetExpression | VariableExpression).transpile(state);
        } else {
            return [
                ...this.obj.transpile(state),
                state.transpileToken(this.dot),
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
        /**
         * Can either be `@`, or `?@` for optional chaining
         */
        readonly at: Token
    ) {
        super();
        this.range = util.createBoundingRange(this.obj, this.at, this.name);
    }

    public readonly range: Range | undefined;

    transpile(state: BrsTranspileState) {
        return [
            ...this.obj.transpile(state),
            state.transpileToken(this.at),
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
        public obj: Expression,
        public index: Expression,
        /**
         * Can either be `[` or `?[`. If `?.[` is used, this will be `[` and `optionalChainingToken` will be `?.`
         */
        public openingSquare: Token,
        public closingSquare: Token,
        public questionDotToken?: Token, //  ? or ?.
        /**
         * More indexes, separated by commas
         */
        public additionalIndexes?: Expression[]
    ) {
        super();
        this.range = util.createBoundingRange(this.obj, this.openingSquare, this.questionDotToken, this.openingSquare, this.index, this.closingSquare);
        this.additionalIndexes ??= [];
    }

    public readonly range: Range | undefined;

    transpile(state: BrsTranspileState) {
        const result = [];
        result.push(
            ...this.obj.transpile(state),
            this.questionDotToken ? state.transpileToken(this.questionDotToken) : '',
            state.transpileToken(this.openingSquare)
        );
        const indexes = [this.index, ...this.additionalIndexes ?? []];
        for (let i = 0; i < indexes.length; i++) {
            //add comma between indexes
            if (i > 0) {
                result.push(', ');
            }
            let index = indexes[i];
            result.push(
                ...(index?.transpile(state) ?? [])
            );
        }
        result.push(
            this.closingSquare ? state.transpileToken(this.closingSquare) : ''
        );
        return result;
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'obj', visitor, options);
            walk(this, 'index', visitor, options);
            walkArray(this.additionalIndexes, visitor, options, this);
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

    public readonly range: Range | undefined;

    transpile(state: BrsTranspileState) {
        if (isTypeCastExpression(this.expression)) {
            return this.expression.transpile(state);
        }
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
        this.type = util.tokenToBscType(token);
    }

    public get range() {
        return this.token.range;
    }

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
    readonly range: Range;

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
        this.range = util.createBoundingRange(this.open, ...this.elements, this.close);
    }

    public readonly range: Range | undefined;

    transpile(state: BrsTranspileState) {
        let result = [] as TranspileResult;
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
            }
        }
        state.blockDepth--;
        //add a newline between open and close if there are elements
        if (hasChildren) {
            result.push('\n');
            result.push(state.indent());
        }
        if (this.close) {
            result.push(
                state.transpileToken(this.close)
            );
        }
        return result;
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walkArray(this.elements, visitor, options, this);
        }
    }
}

export class AAMemberExpression extends Expression {
    constructor(
        public keyToken: Token,
        public colonToken: Token,
        /** The expression evaluated to determine the member's initial value. */
        public value: Expression
    ) {
        super();
        this.range = util.createBoundingRange(this.keyToken, this.colonToken, this.value);
    }

    public range: Range | undefined;
    public commaToken?: Token;

    transpile(state: BrsTranspileState) {
        //TODO move the logic from AALiteralExpression loop into this function
        return [];
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        walk(this, 'value', visitor, options);
    }

}

export class AALiteralExpression extends Expression {
    constructor(
        readonly elements: Array<AAMemberExpression | CommentStatement>,
        readonly open: Token,
        readonly close: Token
    ) {
        super();
        this.range = util.createBoundingRange(this.open, ...this.elements, this.close);
    }

    public readonly range: Range | undefined;

    transpile(state: BrsTranspileState) {
        let result = [] as TranspileResult;
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

                //value
                result.push(...element.value.transpile(state));
            }


            //if next element is a same-line comment, skip the newline
            if (nextElement && isCommentStatement(nextElement) && nextElement.range?.start.line === element.range?.start.line) {

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
        if (this.close) {
            result.push(
                state.transpileToken(this.close)
            );
        }
        return result;
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walkArray(this.elements, visitor, options, this);
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

    public readonly range: Range | undefined;

    transpile(state: BrsTranspileState) {
        let separatingWhitespace: string | undefined;
        if (isVariableExpression(this.right)) {
            separatingWhitespace = this.right.name.leadingWhitespace;
        } else if (isLiteralExpression(this.right)) {
            separatingWhitespace = this.right.token.leadingWhitespace;
        }

        return [
            state.transpileToken(this.operator),
            separatingWhitespace ?? ' ',
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
        readonly name: Identifier
    ) {
        super();
        this.range = this.name?.range;
    }

    public readonly range: Range;

    public getName(parseMode: ParseMode) {
        return this.name.text;
    }

    transpile(state: BrsTranspileState) {
        let result = [] as TranspileResult;
        const namespace = this.findAncestor<NamespaceStatement>(isNamespaceStatement);
        //if the callee is the name of a known namespace function
        if (namespace && state.file.calleeIsKnownNamespaceFunction(this, namespace.getName(ParseMode.BrighterScript))) {
            result.push(
                state.sourceNode(this, [
                    namespace.getName(ParseMode.BrightScript),
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
        this.range = token?.range;
    }

    public readonly range: Range;

    private getFunctionName(state: BrsTranspileState, parseMode: ParseMode) {
        let func = this.findAncestor<FunctionExpression>(isFunctionExpression);
        let nameParts = [] as TranspileResult;
        while (func.parentFunction) {
            let index = func.parentFunction.childFunctionExpressions.indexOf(func);
            nameParts.unshift(`anon${index}`);
            func = func.parentFunction;
        }
        //get the index of this function in its parent
        nameParts.unshift(
            func.functionStatement!.getName(parseMode)
        );
        return nameParts.join('$');
    }

    /**
     * Get the line number from our token or from the closest ancestor that has a range
     */
    private getClosestLineNumber() {
        let node: AstNode = this;
        while (node) {
            if (node.range) {
                return node.range.start.line + 1;
            }
            node = node.parent;
        }
        return -1;
    }

    transpile(state: BrsTranspileState) {
        let text: string;
        switch (this.token.kind) {
            case TokenKind.SourceFilePathLiteral:
                const pathUrl = fileUrl(state.srcPath);
                text = `"${pathUrl.substring(0, 4)}" + "${pathUrl.substring(4)}"`;
                break;
            case TokenKind.SourceLineNumLiteral:
                //TODO find first parent that has range, or default to -1
                text = `${this.getClosestLineNumber()}`;
                break;
            case TokenKind.FunctionNameLiteral:
                text = `"${this.getFunctionName(state, ParseMode.BrightScript)}"`;
                break;
            case TokenKind.SourceFunctionNameLiteral:
                text = `"${this.getFunctionName(state, ParseMode.BrighterScript)}"`;
                break;
            case TokenKind.SourceLocationLiteral:
                const locationUrl = fileUrl(state.srcPath);
                //TODO find first parent that has range, or default to -1
                text = `"${locationUrl.substring(0, 4)}" + "${locationUrl.substring(4)}:${this.getClosestLineNumber()}"`;
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

    /**
     * The name of the class to initialize (with optional namespace prefixed)
     */
    public get className() {
        //the parser guarantees the callee of a new statement's call object will be
        //a NamespacedVariableNameExpression
        return this.call.callee as NamespacedVariableNameExpression;
    }

    public readonly range: Range | undefined;

    public transpile(state: BrsTranspileState) {
        const namespace = this.findAncestor<NamespaceStatement>(isNamespaceStatement);
        const cls = state.file.getClassFileLink(
            this.className.getName(ParseMode.BrighterScript),
            namespace?.getName(ParseMode.BrighterScript)
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
        this.range = util.createBoundingRange(
            callee,
            operator,
            methodName,
            openingParen,
            ...args,
            closingParen
        );
    }

    public readonly range: Range | undefined;

    /**
     * Get the name of the wrapping namespace (if it exists)
     * @deprecated use `.findAncestor(isNamespaceStatement)` instead.
     */
    public get namespaceName() {
        return this.findAncestor<NamespaceStatement>(isNamespaceStatement)?.nameExpression;
    }

    public transpile(state: BrsTranspileState) {
        let result = [] as TranspileResult;
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
            walkArray(this.args, visitor, options, this);
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
        this.range = util.createBoundingRange(
            ...expressions
        );
    }
    readonly range: Range | undefined;

    transpile(state: BrsTranspileState, skipEmptyStrings = true) {
        let result = [] as TranspileResult;
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
            walkArray(this.expressions, visitor, options, this);
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
        this.range = util.createBoundingRange(
            openingBacktick,
            quasis[0],
            quasis[quasis.length - 1],
            closingBacktick
        );
    }

    public readonly range: Range | undefined;

    transpile(state: BrsTranspileState) {
        if (this.quasis.length === 1 && this.expressions.length === 0) {
            return this.quasis[0].transpile(state);
        }
        let result = ['('];
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
        //the expression should be wrapped in parens so it can be used line a single expression at runtime
        result.push(')');

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
        this.range = util.createBoundingRange(
            tagName,
            openingBacktick,
            quasis[0],
            quasis[quasis.length - 1],
            closingBacktick
        );
    }

    public readonly range: Range | undefined;

    transpile(state: BrsTranspileState) {
        let result = [] as TranspileResult;
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
        return util.createBoundingRange(
            this.atToken,
            this.nameToken,
            this.call
        );
    }

    public name: string;
    public call: CallExpression | undefined;

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
        this.range = util.createBoundingRange(
            test,
            questionMarkToken,
            consequent,
            colonToken,
            alternate
        );
    }

    public range: Range | undefined;

    transpile(state: BrsTranspileState) {
        let result = [] as TranspileResult;
        let consequentInfo = util.getExpressionInfo(this.consequent!);
        let alternateInfo = util.getExpressionInfo(this.alternate!);

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
        this.range = util.createBoundingRange(
            consequent,
            questionQuestionToken,
            alternate
        );
    }
    public readonly range: Range | undefined;

    transpile(state: BrsTranspileState) {
        let result = [] as TranspileResult;
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
    }

    public get range() {
        return this.tokens?.regexLiteral?.range;
    }

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


export class TypeCastExpression extends Expression {
    constructor(
        public obj: Expression,
        public asToken: Token,
        public typeToken: Token
    ) {
        super();
        this.range = util.createBoundingRange(
            this.obj,
            this.asToken,
            this.typeToken
        );
    }

    public range: Range;

    public transpile(state: BrsTranspileState): TranspileResult {
        return this.obj.transpile(state);
    }
    public walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'obj', visitor, options);
        }
    }
}

// eslint-disable-next-line @typescript-eslint/consistent-indexed-object-style
type ExpressionValue = string | number | boolean | Expression | ExpressionValue[] | { [key: string]: ExpressionValue } | null;

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
