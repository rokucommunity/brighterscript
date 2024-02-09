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
import type { GetTypeOptions } from '../interfaces';
import { TypeChainEntry, type TranspileResult, type TypedefProvider } from '../interfaces';
import { VoidType } from '../types/VoidType';
import { DynamicType } from '../types/DynamicType';
import type { BscType } from '../types/BscType';
import { SymbolTypeFlag } from '../SymbolTable';
import { TypedFunctionType } from '../types/TypedFunctionType';
import { AstNodeKind, Expression } from './AstNode';
import { SymbolTable } from '../SymbolTable';
import { SourceNode } from 'source-map';
import type { TranspileState } from './TranspileState';
import { StringType } from '../types/StringType';
import { TypePropertyReferenceType } from '../types/ReferenceType';
import { UnionType } from '../types/UnionType';
import { ArrayType } from '../types/ArrayType';
import { AssociativeArrayType } from '../types/AssociativeArrayType';
import type { ComponentType } from '../types/ComponentType';
import { createToken } from '../astUtils/creators';

export type ExpressionVisitor = (expression: Expression, parent: Expression) => void;

export class BinaryExpression extends Expression {
    constructor(options: {
        left: Expression;
        operator: Token;
        right: Expression;
    }) {
        super();
        this.tokens = {
            operator: options.operator
        };
        this.left = options.left;
        this.right = options.right;
        this.range = util.createBoundingRange(this.left, this.tokens.operator, this.right);
    }
    public tokens: {
        operator: Token;
    };

    public left: Expression;
    public right: Expression;

    public readonly kind = AstNodeKind.BinaryExpression;

    public readonly range: Range;

    transpile(state: BrsTranspileState) {
        return [
            state.sourceNode(this.left, this.left.transpile(state)),
            ' ',
            state.transpileToken(this.tokens.operator),
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
        const operatorKind = this.tokens.operator.kind;
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
                this.tokens.operator,
                this.right.getType(options));
        }
        return DynamicType.instance;
    }

}


export class CallExpression extends Expression {
    static MaximumArguments = 32;

    constructor(options: {
        callee: Expression;
        openingParen: Token;
        args?: Expression[];
        closingParen: Token;
    }) {
        super();
        this.tokens = {
            openingParen: options.openingParen,
            closingParen: options.closingParen
        };
        this.callee = options.callee;
        this.args = options.args ?? [];
        this.range = util.createBoundingRange(this.callee, this.tokens.openingParen, ...this.args, this.tokens.closingParen);
    }

    readonly callee: Expression;
    readonly args: Expression[];
    public tokens: {
        /**
         * Can either be `(`, or `?(` for optional chaining - defaults to '('
         */
        readonly openingParen?: Token;
        readonly closingParen?: Token;
    };

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
            state.transpileToken(this.tokens.openingParen, '(')
        );
        for (let i = 0; i < this.args.length; i++) {
            //add comma between args
            if (i > 0) {
                result.push(', ');
            }
            let arg = this.args[i];
            result.push(...arg.transpile(state));
        }
        if (this.tokens.closingParen) {
            result.push(
                state.transpileToken(this.tokens.closingParen)
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
    constructor(options: {
        functionType?: Token;
        leftParen?: Token;
        parameters?: FunctionParameterExpression[];
        rightParen?: Token;
        as?: Token;
        returnTypeExpression?: TypeExpression;
        body: Block;
        endFunctionType?: Token;
    }) {
        super();
        this.tokens = {
            functionType: options.functionType,
            leftParen: options.leftParen,
            rightParen: options.rightParen,
            as: options.as,
            endFunctionType: options.endFunctionType
        };
        this.parameters = options.parameters ?? [];
        this.body = options.body;
        this.returnTypeExpression = options.returnTypeExpression;

        //if there's a body, and it doesn't have a SymbolTable, assign one
        if (this.body && !this.body.symbolTable) {
            this.body.symbolTable = new SymbolTable(`Function Body`);
        }
        this.symbolTable = new SymbolTable('FunctionExpression', () => this.parent?.getSymbolTable());
    }

    public readonly kind = AstNodeKind.FunctionExpression;

    readonly parameters: FunctionParameterExpression[];
    public body: Block;
    public returnTypeExpression?: TypeExpression;

    readonly tokens: {
        functionType?: Token;
        endFunctionType?: Token;
        leftParen?: Token;
        rightParen?: Token;
        as?: Token;
    };

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
        return this.tokens.functionType?.leadingTrivia ?? [];
    }

    /**
     * The range of the function, starting at the 'f' in function or 's' in sub (or the open paren if the keyword is missing),
     * and ending with the last n' in 'end function' or 'b' in 'end sub'
     */
    public get range() {
        return util.createBoundingRange(
            this.tokens.functionType,
            this.tokens.leftParen,
            ...this.parameters,
            this.tokens.rightParen,
            this.tokens.as,
            this.returnTypeExpression,
            this.tokens.endFunctionType
        );
    }

    transpile(state: BrsTranspileState, name?: Identifier, includeBody = true) {
        let results = [];
        //'function'|'sub'
        results.push(
            state.transpileToken(this.tokens.functionType, 'function')
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
            state.transpileToken(this.tokens.leftParen)
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
            state.transpileToken(this.tokens.rightParen)
        );
        //as [Type]
        if (!state.options.removeParameterTypes && this.returnTypeExpression) {
            results.push(
                ' ',
                //as
                state.transpileToken(this.tokens.as, 'as'),
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
            state.transpileToken(this.tokens.endFunctionType, `end ${this.tokens.functionType ?? 'function'}`)
        );
        return results;
    }

    getTypedef(state: BrsTranspileState) {
        let results = [
            new SourceNode(1, 0, null, [
                //'function'|'sub'
                this.tokens.functionType?.text ?? 'function',
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
                ...(this.returnTypeExpression ? [
                    ' ',
                    this.tokens.as?.text ?? 'as',
                    ' ',
                    ...this.returnTypeExpression.getTypedef(state)
                ] : []),
                '\n',
                state.indent(),
                //'end sub'|'end function'
                this.tokens.endFunctionType?.text ?? `end ${this.tokens.functionType ?? 'function'}`
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
        const isSub = this.tokens.functionType?.kind === TokenKind.Sub;
        //if we don't have a return type and this is a sub, set the return type to `void`. else use `dynamic`
        if (!returnType) {
            returnType = isSub ? VoidType.instance : DynamicType.instance;
        }

        const resultType = new TypedFunctionType(returnType);
        resultType.isSub = isSub;
        for (let param of this.parameters) {
            resultType.addParameter(param.tokens.name.text, param.getType({ ...options, typeChain: undefined }), !!param.defaultValue);
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
    constructor(options: {
        name: Identifier;
        equals?: Token;
        defaultValue?: Expression;
        as?: Token;
        typeExpression?: TypeExpression;
    }) {
        super();
        this.tokens = {
            name: options.name,
            equals: options.equals,
            as: options.as
        };
        this.defaultValue = options.defaultValue;
        this.typeExpression = options.typeExpression;
    }

    public readonly kind = AstNodeKind.FunctionParameterExpression;

    public tokens: {
        name: Identifier;
        equals?: Token;
        as?: Token;
    };

    public defaultValue?: Expression;
    public typeExpression?: TypeExpression;

    public getType(options: GetTypeOptions) {
        const paramType = this.typeExpression?.getType({ ...options, flags: SymbolTypeFlag.typetime, typeChain: undefined }) ??
            this.defaultValue?.getType({ ...options, flags: SymbolTypeFlag.runtime, typeChain: undefined }) ??
            DynamicType.instance;
        options.typeChain?.push(new TypeChainEntry(this.tokens.name.text, paramType, options.data, this.range));
        return paramType;
    }

    public get range(): Range {
        return util.createBoundingRange(
            this.tokens.name,
            this.tokens.as,
            this.typeExpression,
            this.tokens.equals,
            this.defaultValue
        );
    }

    public transpile(state: BrsTranspileState) {
        let result = [
            //name
            state.transpileToken(this.tokens.name)
        ] as any[];
        //default value
        if (this.defaultValue) {
            result.push(' = ');
            result.push(this.defaultValue.transpile(state));
        }
        //type declaration
        if (this.typeExpression && !state.options.removeParameterTypes) {
            result.push(' ');
            result.push(state.transpileToken(this.tokens.as, 'as'));
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
            this.tokens.name.text,
            //default value
            ...(this.defaultValue ? [
                ' = ',
                ...this.defaultValue.transpile(state)
            ] : []),
            //type declaration
            ...(this.typeExpression ? [
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
        name: Identifier;
        /**
         * Can either be `.`, or `?.` for optional chaining - defaults in transpile to '.'
         */
        dot?: Token;
    }) {
        super();
        this.tokens = {
            name: options.name,
            dot: options.dot
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
    constructor(options: {
        obj: Expression;
        /**
         * Can either be `@`, or `?@` for optional chaining - defaults to '@'
         */
        at?: Token;
        name: Identifier;
    }) {
        super();
        this.obj = options.obj;
        this.tokens = { at: options.at, name: options.name };
        this.range = util.createBoundingRange(this.obj, this.tokens.at, this.tokens.name);
    }

    public readonly kind = AstNodeKind.XmlAttributeGetExpression;

    public tokens: {
        name: Identifier;
        at?: Token;
    };

    readonly obj: Expression;

    public readonly range: Range;

    transpile(state: BrsTranspileState) {
        return [
            ...this.obj.transpile(state),
            state.transpileToken(this.tokens.at, '@'),
            state.transpileToken(this.tokens.name)
        ];
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'obj', visitor, options);
        }
    }
}

export class IndexedGetExpression extends Expression {
    constructor(options: {
        obj: Expression;
        indexes: Expression[];
        /**
         * Can either be `[` or `?[`. If `?.[` is used, this will be `[` and `optionalChainingToken` will be `?.` - defaults to '[' in transpile
         */
        openingSquare?: Token;
        closingSquare?: Token;
        questionDot?: Token;//  ? or ?.
    }) {
        super();
        this.tokens = {
            openingSquare: options.openingSquare,
            closingSquare: options.closingSquare,
            questionDot: options.questionDot
        };
        this.obj = options.obj;
        this.indexes = options.indexes;
        this.range = util.createBoundingRange(this.obj, this.tokens.openingSquare, this.tokens.questionDot, this.tokens.openingSquare, ...this.indexes, this.tokens.closingSquare);
    }

    public readonly kind = AstNodeKind.IndexedGetExpression;

    public obj: Expression;
    public indexes: Expression[];

    public tokens: {
        /**
         * Can either be `[` or `?[`. If `?.[` is used, this will be `[` and `optionalChainingToken` will be `?.` - defaults to '[' in transpile
         */
        openingSquare?: Token;
        closingSquare?: Token;
        questionDot?: Token; //  ? or ?.
    };

    public readonly range: Range;

    transpile(state: BrsTranspileState) {
        const result = [];
        result.push(
            ...this.obj.transpile(state),
            this.tokens.questionDot ? state.transpileToken(this.tokens.questionDot) : '',
            state.transpileToken(this.tokens.openingSquare, '[')
        );
        for (let i = 0; i < this.indexes.length; i++) {
            //add comma between indexes
            if (i > 0) {
                result.push(', ');
            }
            let index = this.indexes[i];
            result.push(
                ...(index?.transpile(state) ?? [])
            );
        }
        result.push(
            state.transpileToken(this.tokens.closingSquare, ']')
        );
        return result;
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'obj', visitor, options);
            walkArray(this.indexes, visitor, options, this);
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
    constructor(options: {
        leftParen?: Token;
        rightParen?: Token;
        expression: Expression;
    }) {
        super();
        this.tokens = {
            rightParen: options.rightParen,
            leftParen: options.leftParen
        };
        this.expression = options.expression;
        this.range = util.createBoundingRange(this.tokens.leftParen, this.expression, this.tokens.rightParen);
    }

    readonly tokens: {
        leftParen?: Token;
        rightParen?: Token;
    };
    public expression: Expression;

    public readonly kind = AstNodeKind.GroupingExpression;

    public readonly range: Range;

    transpile(state: BrsTranspileState) {
        if (isTypeCastExpression(this.expression)) {
            return this.expression.transpile(state);
        }
        return [
            state.transpileToken(this.tokens.leftParen),
            ...this.expression.transpile(state),
            state.transpileToken(this.tokens.rightParen)
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
    constructor(options: {
        value: Token;
    }) {
        super();
        this.tokens = {
            value: options.value
        };
    }

    public tokens: {
        value: Token;
    };

    public readonly kind = AstNodeKind.LiteralExpression;

    public get range() {
        return this.tokens.value.range;
    }

    public getType(options?: GetTypeOptions) {
        return util.tokenToBscType(this.tokens.value);
    }

    transpile(state: BrsTranspileState) {
        let text: string;
        if (this.tokens.value.kind === TokenKind.TemplateStringQuasi) {
            //wrap quasis with quotes (and escape inner quotemarks)
            text = `"${this.tokens.value.text.replace(/"/g, '""')}"`;

        } else if (this.tokens.value.kind === TokenKind.StringLiteral) {
            text = this.tokens.value.text;
            //add trailing quotemark if it's missing. We will have already generated a diagnostic for this.
            if (text.endsWith('"') === false) {
                text += '"';
            }
        } else {
            text = this.tokens.value.text;
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
    constructor(options: {
        value: Token & { charCode: number };
    }) {
        super();
        this.tokens = { value: options.value };
        this.range = this.tokens.value.range;
    }

    public readonly kind = AstNodeKind.EscapedCharCodeLiteralExpression;

    public tokens: {
        value: Token & { charCode: number };
    };

    readonly range: Range;

    transpile(state: BrsTranspileState) {
        return [
            state.sourceNode(this, `chr(${this.tokens.value.charCode})`)
        ];
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        //nothing to walk
    }
}

export class ArrayLiteralExpression extends Expression {
    constructor(options: {
        elements: Array<Expression | CommentStatement>;
        open?: Token;
        close?: Token;
    }) {
        super();
        this.tokens = {
            open: options.open,
            close: options.close
        };
        this.elements = options.elements;
        this.range = util.createBoundingRange(this.tokens.open, ...this.elements, this.tokens.close);
    }

    readonly elements: Array<Expression | CommentStatement>;

    readonly tokens: {
        open?: Token;
        close?: Token;
    };

    public readonly kind = AstNodeKind.ArrayLiteralExpression;

    public readonly range: Range;

    transpile(state: BrsTranspileState) {
        let result = [];
        result.push(
            state.transpileToken(this.tokens.open, '[')
        );
        let hasChildren = this.elements.length > 0;
        state.blockDepth++;

        for (let i = 0; i < this.elements.length; i++) {
            let previousElement = this.elements[i - 1];
            let element = this.elements[i];

            if (isCommentStatement(element)) {
                //if the comment is on the same line as opening square or previous statement, don't add newline
                if (util.linesTouch(this.tokens.open, element) || util.linesTouch(previousElement, element)) {
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
        if (this.tokens.close) {
            result.push(
                state.transpileToken(this.tokens.close)
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
    constructor(options: {
        key: Token;
        colon?: Token;
        /** The expression evaluated to determine the member's initial value. */
        value: Expression;
        comma?: Token;
    }) {
        super();
        this.tokens = {
            key: options.key,
            colon: options.colon,
            comma: options.comma
        };
        this.value = options.value;
        this.range = util.createBoundingRange(this.tokens.key, this.tokens.colon, this.value);
    }

    public readonly kind = AstNodeKind.AAMemberExpression;

    public range: Range;

    public tokens: {
        key: Token;
        colon?: Token;
        comma?: Token;
    };

    /** The expression evaluated to determine the member's initial value. */
    public value: Expression;


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
    constructor(options: {
        elements: Array<AAMemberExpression | CommentStatement>;
        open?: Token;
        close?: Token;
    }) {
        super();
        this.tokens = {
            open: options.open,
            close: options.close
        };
        this.elements = options.elements;
        this.range = util.createBoundingRange(this.tokens.open, ...this.elements, this.tokens.close);
    }

    readonly elements: Array<AAMemberExpression | CommentStatement>;
    readonly tokens: {
        open?: Token;
        close?: Token;
    };


    public readonly kind = AstNodeKind.AALiteralExpression;

    public readonly range: Range;

    transpile(state: BrsTranspileState) {
        let result = [];
        //open curly
        result.push(
            state.transpileToken(this.tokens.open, '{')
        );
        let hasChildren = this.elements.length > 0;
        //add newline if the object has children and the first child isn't a comment starting on the same line as opening curly
        if (hasChildren && (isCommentStatement(this.elements[0]) === false || !util.linesTouch(this.elements[0], this.tokens.open))) {
            result.push('\n');
        }
        state.blockDepth++;
        for (let i = 0; i < this.elements.length; i++) {
            let element = this.elements[i];
            let previousElement = this.elements[i - 1];
            let nextElement = this.elements[i + 1];

            //don't indent if comment is same-line
            if (isCommentStatement(element as any) &&
                (util.linesTouch(this.tokens.open, element) || util.linesTouch(previousElement, element))
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
                    state.transpileToken(element.tokens.key)
                );
                //colon
                result.push(
                    state.transpileToken(element.tokens.colon, ':'),
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
        result.push(state.transpileToken(this.tokens.close, '}'));

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
                resultType.addMember(element.tokens.key.text, { definingNode: element }, element.getType(options), SymbolTypeFlag.runtime);
            }
        }
        return resultType;
    }
}

export class UnaryExpression extends Expression {
    constructor(options: {
        operator: Token;
        right: Expression;
    }) {
        super();
        this.tokens = {
            operator: options.operator
        };
        this.right = options.right;
        this.range = util.createBoundingRange(this.tokens.operator, this.right);
    }

    public readonly kind = AstNodeKind.UnaryExpression;

    public readonly range: Range;

    public tokens: {
        operator: Token;
    };
    public right: Expression;

    transpile(state: BrsTranspileState) {
        let separatingWhitespace: string;
        if (isVariableExpression(this.right)) {
            separatingWhitespace = this.right.tokens.name.leadingWhitespace;
        } else if (isLiteralExpression(this.right)) {
            separatingWhitespace = this.right.tokens.value.leadingWhitespace;
        } else {
            separatingWhitespace = ' ';
        }
        return [
            state.transpileToken(this.tokens.operator),
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
        return util.unaryOperatorResultType(this.tokens.operator, this.right.getType(options));
    }
}

export class VariableExpression extends Expression {
    constructor(options: {
        name: Identifier;
    }) {
        super();
        this.tokens = {
            name: options.name
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
    constructor(options: {
        value: Token;
    }) {
        super();
        this.tokens = {
            value: options.value
        };
        this.range = this.tokens.value?.range;
    }

    public readonly range: Range;

    public readonly kind = AstNodeKind.SourceLiteralExpression;

    readonly tokens: {
        value: Token;
    };

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
        let func = state.file.getFunctionScopeAtPosition(this.tokens.value.range.start).func;
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
        switch (this.tokens.value.kind) {
            case TokenKind.SourceFilePathLiteral:
                const pathUrl = fileUrl(state.srcPath);
                text = `"${pathUrl.substring(0, 4)}" + "${pathUrl.substring(4)}"`;
                break;
            case TokenKind.SourceLineNumLiteral:
                text = `${this.tokens.value.range.start.line + 1}`;
                break;
            case TokenKind.FunctionNameLiteral:
                text = `"${this.getFunctionName(state, ParseMode.BrightScript)}"`;
                break;
            case TokenKind.SourceFunctionNameLiteral:
                text = `"${this.getFunctionName(state, ParseMode.BrighterScript)}"`;
                break;
            case TokenKind.SourceLocationLiteral:
                const locationUrl = fileUrl(state.srcPath);
                text = `"${locationUrl.substring(0, 4)}" + "${locationUrl.substring(4)}:${this.tokens.value.range.start.line + 1}"`;
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
                text = this.tokens.value.text;
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
    constructor(options: {
        new?: Token;
        call: CallExpression;
    }) {
        super();
        this.tokens = {
            new: options.new
        };
        this.call = options.call;
        this.range = util.createBoundingRange(this.tokens.new, this.call);
    }

    public readonly kind = AstNodeKind.NewExpression;

    public readonly range: Range;

    readonly tokens: {
        new?: Token;
    };
    readonly call: CallExpression;

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
    constructor(options: {
        callee: Expression;
        operator?: Token;
        methodName: Identifier;
        openingParen?: Token;
        args?: Expression[];
        closingParen?: Token;
    }) {
        super();
        this.tokens = {
            operator: options.operator,
            methodName: options.methodName,
            openingParen: options.openingParen,
            closingParen: options.closingParen
        };
        this.callee = options.callee;
        this.args = options.args ?? [];

        this.range = util.createBoundingRange(
            this.callee,
            this.tokens.operator,
            this.tokens.methodName,
            this.tokens.openingParen,
            ...this.args,
            this.tokens.closingParen
        );
    }

    readonly callee: Expression;
    readonly args: Expression[];

    readonly tokens: {
        operator: Token;
        methodName: Identifier;
        openingParen?: Token;
        closingParen?: Token;
    };

    public readonly kind = AstNodeKind.CallfuncExpression;

    public readonly range: Range;

    public transpile(state: BrsTranspileState) {
        let result = [];
        result.push(
            ...this.callee.transpile(state),
            state.sourceNode(this.tokens.operator, '.callfunc'),
            state.transpileToken(this.tokens.openingParen, '('),
            //the name of the function
            state.sourceNode(this.tokens.methodName, ['"', this.tokens.methodName.text, '"'])
        );
        if (this.args?.length > 0) {
            result.push(', ');
            //transpile args
            for (let i = 0; i < this.args.length; i++) {
                //add comma between args
                if (i > 0) {
                    result.push(', ');
                }
                let arg = this.args[i];
                result.push(...arg.transpile(state));
            }
        } else if (state.options.legacyCallfuncHandling) {
            result.push(', ', 'invalid');
        }

        result.push(
            state.transpileToken(this.tokens.closingParen, ')')
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
            const funcType = (calleeType as ComponentType).getCallFuncType?.(this.tokens.methodName.text, options);
            if (funcType) {
                options.typeChain?.push(new TypeChainEntry(this.tokens.methodName.text, funcType, options.data, this.tokens.methodName.range, createToken(TokenKind.Callfunc)));
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
    constructor(options: {
        expressions: Array<LiteralExpression | EscapedCharCodeLiteralExpression>;
    }) {
        super();
        this.expressions = options.expressions;
        this.range = util.createBoundingRange(
            ...this.expressions
        );
    }

    readonly expressions: Array<LiteralExpression | EscapedCharCodeLiteralExpression>;
    public readonly kind = AstNodeKind.TemplateStringQuasiExpression;

    readonly range: Range;

    transpile(state: BrsTranspileState, skipEmptyStrings = true) {
        let result = [];
        let plus = '';
        for (let expression of this.expressions) {
            //skip empty strings
            //TODO what does an empty string literal expression look like?
            if (expression.tokens.value.text === '' && skipEmptyStrings === true) {
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
    constructor(options: {
        openingBacktick?: Token;
        quasis: TemplateStringQuasiExpression[];
        expressions: Expression[];
        closingBacktick?: Token;
    }) {
        super();
        this.tokens = {
            openingBacktick: options.openingBacktick,
            closingBacktick: options.closingBacktick
        };
        this.quasis = options.quasis;
        this.expressions = options.expressions;
        this.range = util.createBoundingRange(
            this.tokens.openingBacktick,
            this.quasis[0],
            this.quasis[this.quasis.length - 1],
            this.tokens.closingBacktick
        );
    }

    public readonly kind = AstNodeKind.TemplateStringExpression;

    readonly tokens: {
        openingBacktick?: Token;
        closingBacktick?: Token;
    };
    readonly quasis: TemplateStringQuasiExpression[];
    readonly expressions: Expression[];

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
    constructor(options: {
        tagName: Identifier;
        openingBacktick?: Token;
        quasis: TemplateStringQuasiExpression[];
        expressions: Expression[];
        closingBacktick?: Token;
    }) {
        super();
        this.tokens = {
            tagName: options.tagName,
            openingBacktick: options.openingBacktick,
            closingBacktick: options.closingBacktick
        };
        this.quasis = options.quasis;
        this.expressions = options.expressions;

        this.range = util.createBoundingRange(
            this.tokens.tagName,
            this.tokens.openingBacktick,
            this.quasis[0],
            this.quasis[this.quasis.length - 1],
            this.tokens.closingBacktick
        );
    }

    public readonly kind = AstNodeKind.TaggedTemplateStringExpression;

    public tokens: {
        tagName: Identifier;
        openingBacktick?: Token;
        closingBacktick?: Token;
    };

    readonly quasis: TemplateStringQuasiExpression[];
    readonly expressions: Expression[];

    public readonly range: Range;

    transpile(state: BrsTranspileState) {
        let result = [];
        result.push(
            state.transpileToken(this.tokens.tagName),
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
            state.sourceNode(this.tokens.closingBacktick, '])')
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
    constructor(options: {
        at?: Token;
        name: Token;
        call?: CallExpression;
    }) {
        super();
        this.tokens = {
            at: options.at,
            name: options.name
        };
        this.call = options.call;
        this.name = this.tokens.name.text;
    }

    public readonly kind = AstNodeKind.AnnotationExpression;

    readonly tokens: {
        at: Token;
        name: Token;
    };

    public get range() {
        return util.createBoundingRange(
            this.tokens.at,
            this.tokens.name,
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
        return this.tokens.at?.leadingTrivia;
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
    constructor(options: {
        test: Expression;
        questionMark?: Token;
        consequent?: Expression;
        colon?: Token;
        alternate?: Expression;
    }) {
        super();
        this.tokens = {
            questionMark: options.questionMark,
            colon: options.colon
        };
        this.test = options.test;
        this.consequent = options.consequent;
        this.alternate = options.alternate;
        this.range = util.createBoundingRange(
            this.test,
            this.tokens.questionMark,
            this.consequent,
            this.tokens.colon,
            this.alternate
        );
    }

    public readonly kind = AstNodeKind.TernaryExpression;

    public range: Range;

    readonly tokens: {
        questionMark?: Token;
        colon?: Token;
    };

    readonly test: Expression;
    readonly consequent?: Expression;
    readonly alternate?: Expression;

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
                    this.tokens.questionMark,
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
                state.sourceNode(this.consequent ?? this.tokens.questionMark, 'return '),
                ...this.consequent?.transpile(state) ?? [state.sourceNode(this.tokens.questionMark, 'invalid')],
                state.newline,
                state.indent(-1),
                state.sourceNode(this.consequent ?? this.tokens.questionMark, 'else'),
                state.newline,
                state.indent(1),
                state.sourceNode(this.consequent ?? this.tokens.questionMark, 'return '),
                ...this.alternate?.transpile(state) ?? [state.sourceNode(this.consequent ?? this.tokens.questionMark, 'invalid')],
                state.newline,
                state.indent(-1),
                state.sourceNode(this.tokens.questionMark, 'end if'),
                state.newline,
                state.indent(-1),
                state.sourceNode(this.tokens.questionMark, 'end function)('),
                ...this.test.transpile(state),
                state.sourceNode(this.tokens.questionMark, `, ${allUniqueVarNames.join(', ')})`)
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
    constructor(options: {
        consequent: Expression;
        questionQuestion?: Token;
        alternate: Expression;
    }) {
        super();
        this.tokens = {
            questionQuestion: options.questionQuestion
        };
        this.consequent = options.consequent;
        this.alternate = options.alternate;
        this.range = util.createBoundingRange(
            this.consequent,
            this.tokens.questionQuestion,
            this.alternate
        );
    }

    public readonly kind = AstNodeKind.NullCoalescingExpression;

    public readonly range: Range;

    public tokens: {
        questionQuestion?: Token;
    };

    public consequent: Expression;
    public alternate: Expression;

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
    constructor(options: {
        regexLiteral: Token;
    }) {
        super();
        this.tokens = {
            regexLiteral: options.regexLiteral
        };
    }

    public readonly kind = AstNodeKind.RegexLiteralExpression;
    public tokens: {
        regexLiteral: Token;
    };

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
        return numberExpressionToValue(expr.right, expr.tokens.operator.text);
    }
    if (isLiteralString(expr)) {
        //remove leading and trailing quotes
        return expr.tokens.value.text.replace(/^"/, '').replace(/"$/, '');
    }
    if (isLiteralNumber(expr)) {
        return numberExpressionToValue(expr);
    }

    if (isLiteralBoolean(expr)) {
        return expr.tokens.value.text.toLowerCase() === 'true';
    }
    if (isArrayLiteralExpression(expr)) {
        return expr.elements
            .filter(e => !isCommentStatement(e))
            .map(e => expressionToValue(e, strict));
    }
    if (isAALiteralExpression(expr)) {
        return expr.elements.reduce((acc, e) => {
            if (!isCommentStatement(e)) {
                acc[e.tokens.key.text] = expressionToValue(e.value, strict);
            }
            return acc;
        }, {});
    }
    return strict ? null : expr;
}

function numberExpressionToValue(expr: LiteralExpression, operator = '') {
    if (isIntegerType(expr.getType()) || isLongIntegerType(expr.getType())) {
        return parseInt(operator + expr.tokens.value.text);
    } else {
        return parseFloat(operator + expr.tokens.value.text);
    }
}

export class TypeExpression extends Expression implements TypedefProvider {
    constructor(options: {
        /**
         * The standard AST expression that represents the type for this TypeExpression.
         */
        expression: Expression;
    }) {
        super();
        this.expression = options.expression;
        this.range = this.expression?.range;
    }

    public readonly kind = AstNodeKind.TypeExpression;

    /**
     * The standard AST expression that represents the type for this TypeExpression.
     */
    public expression: Expression;

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
    constructor(options: {
        obj: Expression;
        as?: Token;
        typeExpression?: TypeExpression;
    }) {
        super();
        this.tokens = {
            as: options.as
        };
        this.obj = options.obj;
        this.typeExpression = options.typeExpression;
        this.range = util.createBoundingRange(
            this.obj,
            this.tokens.as,
            this.typeExpression
        );
    }

    public readonly kind = AstNodeKind.TypeCastExpression;

    public obj: Expression;

    public tokens: {
        as?: Token;
    };

    public typeExpression?: TypeExpression;

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
    constructor(options: {
        innerType: Expression;
        leftBracket?: Token;
        rightBracket?: Token;
    }) {
        super();
        this.tokens = {
            leftBracket: options.leftBracket,
            rightBracket: options.rightBracket
        };
        this.innerType = options.innerType;
        this.range = util.createBoundingRange(
            this.innerType,
            this.tokens.leftBracket,
            this.tokens.rightBracket
        );
    }

    public tokens: {
        leftBracket?: Token;
        rightBracket?: Token;
    };

    public innerType: Expression;

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
