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
import { WalkMode } from '../astUtils/visitors';
import { walk, InternalWalkMode, walkArray } from '../astUtils/visitors';
import { isAALiteralExpression, isAAMemberExpression, isArrayLiteralExpression, isArrayType, isCallExpression, isCallableType, isCallfuncExpression, isCommentStatement, isComponentType, isDottedGetExpression, isEscapedCharCodeLiteralExpression, isFunctionExpression, isFunctionStatement, isIntegerType, isInterfaceMethodStatement, isLiteralBoolean, isLiteralExpression, isLiteralNumber, isLiteralString, isLongIntegerType, isMethodStatement, isNamespaceStatement, isNewExpression, isReferenceType, isStringType, isTypeCastExpression, isUnaryExpression, isVariableExpression } from '../astUtils/reflection';
import type { GetTypeOptions, TranspileResult, TypedefProvider } from '../interfaces';
import { TypeChainEntry } from '../interfaces';
import type { BscType } from '../types/BscType';
import { SymbolTypeFlag } from '../SymbolTable';
import { TypedFunctionType } from '../types/TypedFunctionType';
import { AstNodeKind, Expression } from './AstNode';
import { SymbolTable } from '../SymbolTable';
import { SourceNode } from 'source-map';
import type { TranspileState } from './TranspileState';
import { StringType } from '../types/StringType';
import { DynamicType } from '../types/DynamicType';
import { VoidType } from '../types/VoidType';
import { TypePropertyReferenceType } from '../types/ReferenceType';
import { UnionType } from '../types/UnionType';
import { ArrayType } from '../types';
import { AssociativeArrayType } from '../types/AssociativeArrayType';
import type { ComponentType } from '../types/ComponentType';
import { createToken } from '../astUtils/creators';

export type ExpressionVisitor = (expression: Expression, parent: Expression) => void;

export class BinaryExpression extends Expression {
    constructor(
        public left: Expression,
        public operator: Token,
        public right: Expression
    ) {
        super();
        this.range = util.createRangeFromPositions(this.left.range.start, this.right.range.end);
    }

    public readonly kind = AstNodeKind.BinaryExpression;

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


    public getType(options: GetTypeOptions): BscType {
        const operatorKind = this.operator.kind;
        if (options.flags & SymbolTypeFlag.typetime) {
            // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check
            switch (operatorKind) {
                case TokenKind.Or:
                    return new UnionType([this.left.getType(options), this.right.getType(options)]);
                //TODO: Intersection Types?, eg. case TokenKind.And:
            }
        } else if (options.flags & SymbolTypeFlag.runtime) {
            return util.binaryOperatorResultType(
                this.left.getType(options),
                this.operator,
                this.right.getType(options));
        }
        return DynamicType.instance;
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

    public readonly kind = AstNodeKind.CallExpression;

    public readonly range: Range;

    transpile(state: BrsTranspileState, nameOverride?: string) {
        let result: Array<string | SourceNode> = [];

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

    getType(options: GetTypeOptions) {
        const calleeType = this.callee.getType(options);
        if (options.ignoreCall) {
            return calleeType;
        }
        if (isNewExpression(this.parent)) {
            return calleeType;
        }
        if (isCallableType(calleeType) && (!isReferenceType(calleeType.returnType) || calleeType.returnType?.isResolvable())) {
            return calleeType.returnType;
        }
        if (!isReferenceType(calleeType) && (calleeType as any).returnType?.isResolvable()) {
            return (calleeType as any).returnType;
        }
        return new TypePropertyReferenceType(calleeType, 'returnType');
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
        public returnTypeExpression?: TypeExpression
    ) {
        super();

        //if there's a body, and it doesn't have a SymbolTable, assign one
        if (this.body && !this.body.symbolTable) {
            this.body.symbolTable = new SymbolTable(`Function Body`);
        }
        this.symbolTable = new SymbolTable('FunctionExpression', () => this.parent?.getSymbolTable());
    }

    public readonly kind = AstNodeKind.FunctionExpression;

    /**
     * The list of function calls that are declared within this function scope. This excludes CallExpressions
     * declared in child functions
     */
    public callExpressions = [] as CallExpression[];

    /**
     * If this function is part of a FunctionStatement, this will be set. Otherwise this will be undefined
     */
    public functionStatement?: FunctionStatement;

    public getLeadingTrivia(): Token[] {
        return this.functionType?.leadingTrivia ?? [];
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
            this.returnTypeExpression,
            this.end
        );
    }

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
        if (this.asToken && !state.options.removeParameterTypes && this.returnTypeExpression) {
            results.push(
                ' ',
                //as
                state.transpileToken(this.asToken),
                ' ',
                //return type
                ...this.returnTypeExpression.transpile(state)
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
                ...(isFunctionStatement(this.parent) || isMethodStatement(this.parent) ? [' ', this.parent.tokens.name?.text ?? ''] : []),
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
                    ...this.returnTypeExpression.getTypedef(state)
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
            walk(this, 'returnTypeExpression', visitor, options);
            //This is the core of full-program walking...it allows us to step into sub functions
            if (options.walkMode & InternalWalkMode.recurseChildFunctions) {
                walk(this, 'body', visitor, options);
            }
        }
    }

    public getType(options: GetTypeOptions): TypedFunctionType {
        //if there's a defined return type, use that
        let returnType = this.returnTypeExpression?.getType({ ...options, typeChain: undefined });
        const isSub = this.functionType.kind === TokenKind.Sub;
        //if we don't have a return type and this is a sub, set the return type to `void`. else use `dynamic`
        if (!returnType) {
            returnType = isSub ? VoidType.instance : DynamicType.instance;
        }

        const resultType = new TypedFunctionType(returnType);
        resultType.isSub = isSub;
        for (let param of this.parameters) {
            resultType.addParameter(param.name.text, param.getType({ ...options, typeChain: undefined }), !!param.defaultValue);
        }
        // Figure out this function's name if we can
        let funcName = '';
        if (isMethodStatement(this.parent) || isInterfaceMethodStatement(this.parent)) {
            funcName = this.parent.getName(ParseMode.BrighterScript);
            if (options.typeChain) {
                // Get the typechain info from the parent class
                this.parent.parent?.getType(options);
            }
        } else if (isFunctionStatement(this.parent)) {
            funcName = this.parent.getName(ParseMode.BrighterScript);
        }
        if (funcName) {
            resultType.setName(funcName);
        }
        options.typeChain?.push(new TypeChainEntry(funcName, resultType, options.data, this.range));
        return resultType;
    }
}

export class FunctionParameterExpression extends Expression {
    constructor(
        public name: Identifier,
        public equalToken?: Token,
        public defaultValue?: Expression,
        public asToken?: Token,
        public typeExpression?: TypeExpression
    ) {
        super();
    }

    public readonly kind = AstNodeKind.FunctionParameterExpression;

    public getType(options: GetTypeOptions) {
        const paramType = this.typeExpression?.getType({ ...options, flags: SymbolTypeFlag.typetime, typeChain: undefined }) ??
            this.defaultValue?.getType({ ...options, flags: SymbolTypeFlag.runtime, typeChain: undefined }) ??
            DynamicType.instance;
        options.typeChain?.push(new TypeChainEntry(this.name.text, paramType, options.data, this.range));
        return paramType;
    }

    public get range(): Range {
        return util.createBoundingRange(
            this.name,
            this.asToken,
            this.typeExpression,
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
            result.push(
                ...(this.typeExpression?.transpile(state) ?? [])
            );
        }

        return result;
    }

    public getTypedef(state: BrsTranspileState): TranspileResult {
        return [
            //name
            this.name.text,
            //default value
            ...(this.defaultValue ? [
                ' = ',
                ...this.defaultValue.transpile(state)
            ] : []),
            //type declaration
            ...(this.asToken ? [
                ' as ',
                ...(this.typeExpression?.getTypedef(state) ?? [''])
            ] : [])
        ];
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        // eslint-disable-next-line no-bitwise
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'defaultValue', visitor, options);
            walk(this, 'typeExpression', visitor, options);
        }
    }
}

export class DottedGetExpression extends Expression {
    constructor(options: {
        obj: Expression;
        nameToken: Identifier;
        /**
         * Can either be `.`, or `?.` for optional chaining - defaults in transpile to '.'
         */
        dotToken?: Token;
    }) {
        super();
        this.tokens = {
            name: options.nameToken,
            dot: options.dotToken
        };
        this.obj = options.obj;

        this.range = util.createBoundingRange(this.obj, this.tokens.dot, this.tokens.name);
    }

    readonly tokens: {
        name: Identifier;
        dot?: Token;
    };
    readonly obj: Expression;

    public readonly kind = AstNodeKind.DottedGetExpression;

    public readonly range: Range;

    transpile(state: BrsTranspileState) {
        //if the callee starts with a namespace name, transpile the name
        if (state.file.calleeStartsWithNamespace(this)) {
            return [
                state.sourceNode(this, this.getName(ParseMode.BrightScript))
            ];
        } else {
            return [
                ...this.obj.transpile(state),
                state.transpileToken(this.tokens.dot, '.'),
                state.transpileToken(this.tokens.name)
            ];
        }
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'obj', visitor, options);
        }
    }

    getType(options: GetTypeOptions) {
        const objType = this.obj?.getType(options);
        const result = objType?.getMemberType(this.tokens.name?.text, options);
        options.typeChain?.push(new TypeChainEntry(this.tokens.name?.text, result, options.data, this.tokens.name?.range ?? this.range));
        if (result || options.flags & SymbolTypeFlag.typetime) {
            // All types should be known at typetime
            return result;
        }
        // It is possible at runtime that a value has been added dynamically to an object, or something
        // TODO: maybe have a strict flag on this?
        return DynamicType.instance;
    }

    getName(parseMode: ParseMode) {
        return util.getAllDottedGetPartsAsString(this, parseMode);
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

    public readonly kind = AstNodeKind.XmlAttributeGetExpression;

    public readonly range: Range;

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
        public questionDotToken?: Token //  ? or ?.
    ) {
        super();
        this.range = util.createBoundingRange(this.obj, this.openingSquare, this.questionDotToken, this.openingSquare, this.index, this.closingSquare);
    }

    public readonly kind = AstNodeKind.IndexedGetExpression;

    public readonly range: Range;

    transpile(state: BrsTranspileState) {
        return [
            ...this.obj.transpile(state),
            this.questionDotToken ? state.transpileToken(this.questionDotToken) : '',
            state.transpileToken(this.openingSquare),
            ...(this.index?.transpile(state) ?? []),
            this.closingSquare ? state.transpileToken(this.closingSquare) : ''
        ];
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'obj', visitor, options);
            walk(this, 'index', visitor, options);
        }
    }

    getType(options: GetTypeOptions): BscType {
        const objType = this.obj.getType(options);
        if (isArrayType(objType)) {
            // This is used on an array. What is the default type of that array?
            return objType.defaultType;
        }
        return super.getType(options);
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

    public readonly kind = AstNodeKind.GroupingExpression;

    public readonly range: Range;

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

    getType(options: GetTypeOptions) {
        return this.expression.getType(options);
    }
}

export class LiteralExpression extends Expression {
    constructor(
        public token: Token
    ) {
        super();
    }
    public readonly kind = AstNodeKind.LiteralExpression;

    public get range() {
        return this.token.range;
    }

    public getType(options?: GetTypeOptions) {
        return util.tokenToBscType(this.token);
    }

    transpile(state: BrsTranspileState) {
        let text: string;
        if (this.token.kind === TokenKind.TemplateStringQuasi) {
            //wrap quasis with quotes (and escape inner quotemarks)
            text = `"${this.token.text.replace(/"/g, '""')}"`;

        } else if (this.token.kind === TokenKind.StringLiteral) {
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

    public readonly kind = AstNodeKind.EscapedCharCodeLiteralExpression;

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

    public readonly kind = AstNodeKind.ArrayLiteralExpression;

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

    getType(options: GetTypeOptions): BscType {
        const innerTypes = this.elements.filter(x => !isCommentStatement(x)).map(expr => expr.getType(options));
        return new ArrayType(...innerTypes);
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

    public readonly kind = AstNodeKind.AAMemberExpression;

    public range: Range;

    public commaToken?: Token;

    transpile(state: BrsTranspileState) {
        //TODO move the logic from AALiteralExpression loop into this function
        return [];
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        walk(this, 'value', visitor, options);
    }

    getType(options: GetTypeOptions): BscType {
        return this.value.getType(options);
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

    public readonly kind = AstNodeKind.AALiteralExpression;

    public readonly range: Range;

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

                //value
                result.push(...element.value.transpile(state));
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

    getType(options: GetTypeOptions): BscType {
        const resultType = new AssociativeArrayType();
        for (const element of this.elements) {
            if (isAAMemberExpression(element)) {
                resultType.addMember(element.keyToken.text, { definingNode: element }, element.getType(options), SymbolTypeFlag.runtime);
            }
        }
        return resultType;
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

    public readonly kind = AstNodeKind.UnaryExpression;

    public readonly range: Range;

    transpile(state: BrsTranspileState) {
        let separatingWhitespace: string;
        if (isVariableExpression(this.right)) {
            separatingWhitespace = this.right.tokens.name.leadingWhitespace;
        } else if (isLiteralExpression(this.right)) {
            separatingWhitespace = this.right.token.leadingWhitespace;
        } else {
            separatingWhitespace = ' ';
        }
        return [
            state.transpileToken(this.operator),
            separatingWhitespace,
            ...this.right.transpile(state)
        ];
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'right', visitor, options);
        }
    }

    getType(options: GetTypeOptions): BscType {
        return util.unaryOperatorResultType(this.operator, this.right.getType(options));
    }
}

export class VariableExpression extends Expression {
    constructor(options: {
        nameToken: Identifier;
    }) {
        super();
        this.tokens = {
            name: options.nameToken
        };
        this.range = this.tokens.name?.range;
    }

    readonly tokens: {
        name: Identifier;
    };

    public readonly kind = AstNodeKind.VariableExpression;

    public readonly range: Range;

    public getName(parseMode?: ParseMode) {
        return this.tokens.name.text;
    }

    transpile(state: BrsTranspileState) {
        let result = [];
        const namespace = this.findAncestor<NamespaceStatement>(isNamespaceStatement);
        //if the callee is the name of a known namespace function
        if (state.file.calleeIsKnownNamespaceFunction(this, namespace?.getName(ParseMode.BrighterScript))) {
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
                state.transpileToken(this.tokens.name)
            );
        }
        return result;
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        //nothing to walk
    }


    getType(options: GetTypeOptions) {
        let resultType: BscType = util.tokenToBscType(this.tokens.name);
        const nameKey = this.getName();
        if (!resultType) {
            const symbolTable = this.getSymbolTable();
            resultType = symbolTable?.getSymbolType(nameKey, { ...options, fullName: nameKey, tableProvider: () => this.getSymbolTable() });
        }
        options.typeChain?.push(new TypeChainEntry(nameKey, resultType, options.data, this.range));
        return resultType;
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

    public readonly kind = AstNodeKind.SourceLiteralExpression;

    /**
     * Find the index of the function in its parent
     */
    private findFunctionIndex(parentFunction: FunctionExpression, func: FunctionExpression) {
        let index = -1;
        parentFunction.findChild((node) => {
            if (isFunctionExpression(node)) {
                index++;
                if (node === func) {
                    return true;
                }
            }
        }, {
            walkMode: WalkMode.visitAllRecursive
        });
        return index;
    }

    private getFunctionName(state: BrsTranspileState, parseMode: ParseMode) {
        let func = state.file.getFunctionScopeAtPosition(this.token.range.start).func;
        let nameParts = [];
        let parentFunction: FunctionExpression;
        while ((parentFunction = func.findAncestor<FunctionExpression>(isFunctionExpression))) {
            let index = this.findFunctionIndex(parentFunction, func);
            nameParts.unshift(`anon${index}`);
            func = parentFunction;
        }
        //get the index of this function in its parent
        nameParts.unshift(
            func.functionStatement.getName(parseMode)
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
                text = `"${util.sanitizePkgPath(state.file.pkgPath)}"`;
                break;
            case TokenKind.PkgLocationLiteral:
                text = `"${util.sanitizePkgPath(state.file.pkgPath)}:" + str(LINE_NUM)`;
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

    public readonly kind = AstNodeKind.NewExpression;

    public readonly range: Range;

    /**
     * The name of the class to initialize (with optional namespace prefixed)
     */
    public get className() {
        //the parser guarantees the callee of a new statement's call object will be
        //either a VariableExpression or a DottedGet
        return this.call.callee as (VariableExpression | DottedGetExpression);
    }

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

    getType(options: GetTypeOptions) {
        return this.call.getType(options);
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

    public readonly kind = AstNodeKind.CallfuncExpression;

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
            walkArray(this.args, visitor, options, this);
        }
    }

    getType(options: GetTypeOptions) {
        let result: BscType = DynamicType.instance;
        // a little hacky here with checking options.ignoreCall because callFuncExpression has the method name
        // It's nicer for CallExpression, because it's a call on any expression.
        const calleeType = this.callee.getType({ ...options, flags: SymbolTypeFlag.runtime });
        if (isComponentType(calleeType) || isReferenceType(calleeType)) {
            const funcType = (calleeType as ComponentType).getCallFuncType?.(this.methodName.text, options);
            if (funcType) {
                options.typeChain?.push(new TypeChainEntry(this.methodName.text, funcType, options.data, this.methodName.range, createToken(TokenKind.Callfunc)));
                if (options.ignoreCall) {
                    result = funcType;
                }
            }
            /* TODO:
                make callfunc return types work
            else if (isCallableType(funcType) && (!isReferenceType(funcType.returnType) || funcType.returnType.isResolvable())) {
                result = funcType.returnType;
            } else if (!isReferenceType(funcType) && (funcType as any)?.returnType?.isResolvable()) {
                result = (funcType as any).returnType;
            } else {
                return new TypePropertyReferenceType(funcType, 'returnType');
            }
            */
        }

        return result;
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

    public readonly kind = AstNodeKind.TemplateStringQuasiExpression;

    readonly range: Range;

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

    public readonly kind = AstNodeKind.TemplateStringExpression;

    public readonly range: Range;

    public getType(options: GetTypeOptions) {
        return StringType.instance;
    }

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
                    (isLiteralExpression(expression) && isStringType(expression.getType()))
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

    public readonly kind = AstNodeKind.TaggedTemplateStringExpression;

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

    public readonly kind = AstNodeKind.AnnotationExpression;

    public get range() {
        return util.createBoundingRange(
            this.atToken,
            this.nameToken,
            this.call
        );
    }

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

    public getLeadingTrivia(): Token[] {
        return this.atToken.leadingTrivia;
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

    public readonly kind = AstNodeKind.TernaryExpression;

    public range: Range;

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
        this.range = util.createBoundingRange(
            consequent,
            questionQuestionToken,
            alternate
        );
    }

    public readonly kind = AstNodeKind.NullCoalescingExpression;

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
    }

    public readonly kind = AstNodeKind.RegexLiteralExpression;

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
    if (isIntegerType(expr.getType()) || isLongIntegerType(expr.getType())) {
        return parseInt(operator + expr.token.text);
    } else {
        return parseFloat(operator + expr.token.text);
    }
}

export class TypeExpression extends Expression implements TypedefProvider {
    constructor(
        /**
         * The standard AST expression that represents the type for this TypeExpression.
         */
        public expression: Expression
    ) {
        super();
        this.range = expression?.range;
    }

    public readonly kind = AstNodeKind.TypeExpression;

    public range: Range;

    public transpile(state: BrsTranspileState): TranspileResult {
        return [this.getType({ flags: SymbolTypeFlag.typetime }).toTypeString()];
    }
    public walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'expression', visitor, options);
        }
    }

    public getType(options: GetTypeOptions): BscType {
        return this.expression.getType({ ...options, flags: SymbolTypeFlag.typetime });
    }

    getTypedef(state: TranspileState): (string | SourceNode)[] {
        // TypeDefs should pass through any valid type names
        return this.expression.transpile(state as BrsTranspileState);
    }

    getName(parseMode = ParseMode.BrighterScript): string {
        //TODO: this may not support Complex Types, eg. generics or Unions
        return util.getAllDottedGetPartsAsString(this.expression, parseMode);
    }

    getNameParts(): string[] {
        //TODO: really, this code is only used to get Namespaces. It could be more clear.
        return util.getAllDottedGetParts(this.expression).map(x => x.text);
    }

}

export class TypeCastExpression extends Expression {
    constructor(
        public obj: Expression,
        public asToken?: Token,
        public typeExpression?: TypeExpression
    ) {
        super();
        this.range = util.createBoundingRange(
            this.obj,
            this.asToken,
            this.typeExpression
        );
    }

    public readonly kind = AstNodeKind.TypeCastExpression;

    public range: Range;

    public transpile(state: BrsTranspileState): TranspileResult {
        return this.obj.transpile(state);
    }
    public walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'obj', visitor, options);
            walk(this, 'typeExpression', visitor, options);
        }
    }

    public getType(options: GetTypeOptions): BscType {
        return this.typeExpression.getType(options);
    }
}

export class TypedArrayExpression extends Expression {
    constructor(
        public innerType: Expression,
        public leftBracket: Token,
        public rightBracket: Token
    ) {
        super();
        this.range = util.createBoundingRange(
            this.innerType,
            this.leftBracket,
            this.rightBracket
        );
    }

    public readonly kind = AstNodeKind.TypedArrayExpression;

    public range: Range;

    public transpile(state: BrsTranspileState): TranspileResult {
        return [this.getType({ flags: SymbolTypeFlag.typetime }).toTypeString()];
    }

    public walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'innerType', visitor, options);
        }
    }

    public getType(options: GetTypeOptions): BscType {
        return new ArrayType(this.innerType.getType(options));
    }
}
