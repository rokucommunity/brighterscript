/* eslint-disable no-bitwise */
import type { Token, Identifier } from '../lexer/Token';
import { TokenKind } from '../lexer/TokenKind';
import type { Block, FunctionStatement, NamespaceStatement } from './Statement';
import type { Location } from 'vscode-languageserver';
import util from '../util';
import type { BrsTranspileState } from './BrsTranspileState';
import { ParseMode } from './Parser';
import * as fileUrl from 'file-url';
import type { WalkOptions, WalkVisitor } from '../astUtils/visitors';
import { WalkMode } from '../astUtils/visitors';
import { walk, InternalWalkMode, walkArray } from '../astUtils/visitors';
import { isAALiteralExpression, isAAMemberExpression, isArrayLiteralExpression, isArrayType, isCallExpression, isCallableType, isCallfuncExpression, isComponentType, isDottedGetExpression, isEscapedCharCodeLiteralExpression, isFunctionExpression, isFunctionStatement, isIntegerType, isInterfaceMethodStatement, isLiteralBoolean, isLiteralExpression, isLiteralNumber, isLiteralString, isLongIntegerType, isMethodStatement, isNamespaceStatement, isNewExpression, isPrimitiveType, isReferenceType, isStringType, isTemplateStringExpression, isTypecastExpression, isUnaryExpression, isVariableExpression } from '../astUtils/reflection';
import type { GetTypeOptions, TranspileResult, TypedefProvider } from '../interfaces';
import { TypeChainEntry } from '../interfaces';
import { VoidType } from '../types/VoidType';
import { DynamicType } from '../types/DynamicType';
import type { BscType } from '../types/BscType';
import type { AstNode } from './AstNode';
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
import { TypedFunctionType } from '../types';
import { SymbolTypeFlag } from '../SymbolTypeFlag';
import { FunctionType } from '../types/FunctionType';
import type { BaseFunctionType } from '../types/BaseFunctionType';

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
        this.location = util.createBoundingLocation(this.left, this.tokens.operator, this.right);
    }
    readonly tokens: {
        readonly operator: Token;
    };

    public readonly left: Expression;
    public readonly right: Expression;

    public readonly kind = AstNodeKind.BinaryExpression;

    public readonly location: Location | undefined;

    transpile(state: BrsTranspileState): TranspileResult {
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

    get leadingTrivia(): Token[] {
        return this.left.leadingTrivia;
    }
}


export class CallExpression extends Expression {
    /**
     * Number of parameters that can be defined on a function
     *
     * Prior to Roku OS 11.5, this was 32
     * As of Roku OS 11.5, this is 63
     */
    static MaximumArguments = 63;

    constructor(options: {
        callee: Expression;
        openingParen?: Token;
        args?: Expression[];
        closingParen?: Token;
    }) {
        super();
        this.tokens = {
            openingParen: options.openingParen,
            closingParen: options.closingParen
        };
        this.callee = options.callee;
        this.args = options.args ?? [];
        this.location = util.createBoundingLocation(this.callee, this.tokens.openingParen, ...this.args, this.tokens.closingParen);
    }

    readonly callee: Expression;
    readonly args: Expression[];
    readonly tokens: {
        /**
         * Can either be `(`, or `?(` for optional chaining - defaults to '('
         */
        readonly openingParen?: Token;
        readonly closingParen?: Token;
    };

    public readonly kind = AstNodeKind.CallExpression;

    public readonly location: Location | undefined;

    transpile(state: BrsTranspileState, nameOverride?: string) {
        let result: TranspileResult = [];

        //transpile the name
        if (nameOverride) {
            result.push(
                //transpile leading comments since we're bypassing callee.transpile (which would normally do this)
                ...state.transpileLeadingCommentsForAstNode(this),
                state.sourceNode(this.callee, nameOverride)
            );
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
        const specialCaseReturnType = util.getSpecialCaseCallExpressionReturnType(this);
        if (specialCaseReturnType) {
            return specialCaseReturnType;
        }
        if (isCallableType(calleeType) && (!isReferenceType(calleeType.returnType) || calleeType.returnType?.isResolvable())) {
            return calleeType.returnType;
        }
        if (!isReferenceType(calleeType) && (calleeType as BaseFunctionType)?.returnType?.isResolvable()) {
            return (calleeType as BaseFunctionType).returnType;
        }
        return new TypePropertyReferenceType(calleeType, 'returnType');
    }

    get leadingTrivia(): Token[] {
        return this.callee.leadingTrivia;
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
        if (this.body) {
            if (!this.body.symbolTable) {
                this.body.symbolTable = new SymbolTable(`Block`, () => this.getSymbolTable());
            } else {
                this.body.symbolTable.pushParentProvider(() => this.getSymbolTable());
            }
            this.body.parent = this;
        }
        this.symbolTable = new SymbolTable('FunctionExpression', () => this.parent?.getSymbolTable());
    }

    public readonly kind = AstNodeKind.FunctionExpression;

    readonly parameters: FunctionParameterExpression[];
    public readonly body: Block;
    public readonly returnTypeExpression?: TypeExpression;

    readonly tokens: {
        readonly functionType?: Token;
        readonly endFunctionType?: Token;
        readonly leftParen?: Token;
        readonly rightParen?: Token;
        readonly as?: Token;
    };

    /**
     * If this function is part of a FunctionStatement, this will be set. Otherwise this will be undefined
     */
    public functionStatement?: FunctionStatement;

    public get leadingTrivia(): Token[] {
        return this.tokens.functionType?.leadingTrivia;
    }

    public get endTrivia(): Token[] {
        return this.tokens.endFunctionType?.leadingTrivia;
    }

    /**
     * The range of the function, starting at the 'f' in function or 's' in sub (or the open paren if the keyword is missing),
     * and ending with the last n' in 'end function' or 'b' in 'end sub'
     */
    public get location(): Location {
        return util.createBoundingLocation(
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
        let results = [] as TranspileResult;
        //'function'|'sub'
        results.push(
            state.transpileToken(this.tokens.functionType, 'function', false, state.skipLeadingComments)
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
        let hasBody = false;
        if (includeBody) {
            state.lineage.unshift(this);
            let body = this.body.transpile(state);
            hasBody = body.length > 0;
            state.lineage.shift();
            results.push(...body);
        }

        const lastLocatable = hasBody ? this.body : this.returnTypeExpression ?? this.tokens.leftParen ?? this.tokens.functionType;
        results.push(
            ...state.transpileEndBlockToken(lastLocatable, this.tokens.endFunctionType, `end ${this.tokens.functionType ?? 'function'}`)
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
        options.typeChain?.push(new TypeChainEntry({ name: funcName, type: resultType, data: options.data, astNode: this }));
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

    readonly tokens: {
        readonly name: Identifier;
        readonly equals?: Token;
        readonly as?: Token;
    };

    public readonly defaultValue?: Expression;
    public readonly typeExpression?: TypeExpression;

    public getType(options: GetTypeOptions) {
        const paramType = this.typeExpression?.getType({ ...options, flags: SymbolTypeFlag.typetime, typeChain: undefined }) ??
            this.defaultValue?.getType({ ...options, flags: SymbolTypeFlag.runtime, typeChain: undefined }) ??
            DynamicType.instance;
        options.typeChain?.push(new TypeChainEntry({ name: this.tokens.name.text, type: paramType, data: options.data, astNode: this }));
        return paramType;
    }

    public get location(): Location | undefined {
        return util.createBoundingLocation(
            this.tokens.name,
            this.tokens.as,
            this.typeExpression,
            this.tokens.equals,
            this.defaultValue
        );
    }

    public transpile(state: BrsTranspileState) {
        let result: TranspileResult = [
            //name
            state.transpileToken(this.tokens.name)
        ];
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
        const results = [this.tokens.name.text] as TranspileResult;

        if (this.defaultValue) {
            results.push(' = ', ...this.defaultValue.transpile(state));
        }

        if (this.tokens.as) {
            results.push(' as ');

            // TODO: Is this conditional needed? Will typeToken always exist
            // so long as `asToken` exists?
            if (this.typeExpression) {
                results.push(...(this.typeExpression?.getTypedef(state) ?? ['']));
            }
        }

        return results;
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        // eslint-disable-next-line no-bitwise
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'defaultValue', visitor, options);
            walk(this, 'typeExpression', visitor, options);
        }
    }

    get leadingTrivia(): Token[] {
        return this.tokens.name.leadingTrivia;
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

        this.location = util.createBoundingLocation(this.obj, this.tokens.dot, this.tokens.name);
    }

    readonly tokens: {
        readonly name: Identifier;
        readonly dot?: Token;
    };
    readonly obj: Expression;

    public readonly kind = AstNodeKind.DottedGetExpression;

    public readonly location: Location | undefined;

    transpile(state: BrsTranspileState) {
        //if the callee starts with a namespace name, transpile the name
        if (state.file.calleeStartsWithNamespace(this)) {
            return [
                ...state.transpileLeadingCommentsForAstNode(this),
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
        let result = objType?.getMemberType(this.tokens.name?.text, options);

        if (util.isClassUsedAsFunction(result, this, options)) {
            // treat this class constructor as a function
            result = FunctionType.instance;
        }
        options.typeChain?.push(new TypeChainEntry({
            name: this.tokens.name?.text,
            type: result,
            data: options.data,
            location: this.tokens.name?.location ?? this.location,
            astNode: this
        }));
        if (result ||
            options.flags & SymbolTypeFlag.typetime ||
            (isPrimitiveType(objType) || isCallableType(objType))) {
            // All types should be known at typeTime, or the obj is well known
            return result;
        }
        // It is possible at runtime that a value has been added dynamically to an object, or something
        // TODO: maybe have a strict flag on this?
        return DynamicType.instance;
    }

    getName(parseMode: ParseMode) {
        return util.getAllDottedGetPartsAsString(this, parseMode);
    }

    get leadingTrivia(): Token[] {
        return this.obj.leadingTrivia;
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
        this.location = util.createBoundingLocation(this.obj, this.tokens.at, this.tokens.name);
    }

    public readonly kind = AstNodeKind.XmlAttributeGetExpression;

    public readonly tokens: {
        name: Identifier;
        at?: Token;
    };

    public readonly obj: Expression;

    public readonly location: Location | undefined;

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

    get leadingTrivia(): Token[] {
        return this.obj.leadingTrivia;
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
        this.location = util.createBoundingLocation(this.obj, this.tokens.openingSquare, this.tokens.questionDot, this.tokens.openingSquare, ...this.indexes, this.tokens.closingSquare);
    }

    public readonly kind = AstNodeKind.IndexedGetExpression;

    public readonly obj: Expression;
    public readonly indexes: Expression[];

    readonly tokens: {
        /**
         * Can either be `[` or `?[`. If `?.[` is used, this will be `[` and `optionalChainingToken` will be `?.` - defaults to '[' in transpile
         */
        readonly openingSquare?: Token;
        readonly closingSquare?: Token;
        readonly questionDot?: Token; //  ? or ?.
    };

    public readonly location: Location | undefined;

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

    get leadingTrivia(): Token[] {
        return this.obj.leadingTrivia;
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
        this.location = util.createBoundingLocation(this.tokens.leftParen, this.expression, this.tokens.rightParen);
    }

    public readonly tokens: {
        readonly leftParen?: Token;
        readonly rightParen?: Token;
    };
    public readonly expression: Expression;

    public readonly kind = AstNodeKind.GroupingExpression;

    public readonly location: Location | undefined;

    transpile(state: BrsTranspileState) {
        if (isTypecastExpression(this.expression)) {
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

    get leadingTrivia(): Token[] {
        return this.tokens.leftParen?.leadingTrivia;
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

    public readonly tokens: {
        readonly value: Token;
    };

    public readonly kind = AstNodeKind.LiteralExpression;

    public get location() {
        return this.tokens.value.location;
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
            state.transpileToken({ ...this.tokens.value, text: text })
        ];
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        //nothing to walk
    }

    get leadingTrivia(): Token[] {
        return this.tokens.value.leadingTrivia;
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
        this.location = this.tokens.value.location;
    }

    public readonly kind = AstNodeKind.EscapedCharCodeLiteralExpression;

    public readonly tokens: {
        readonly value: Token & { charCode: number };
    };

    public readonly location: Location;

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
        elements: Array<Expression>;
        open?: Token;
        close?: Token;
    }) {
        super();
        this.tokens = {
            open: options.open,
            close: options.close
        };
        this.elements = options.elements;
        this.location = util.createBoundingLocation(this.tokens.open, ...this.elements, this.tokens.close);
    }

    public readonly elements: Array<Expression>;

    public readonly tokens: {
        readonly open?: Token;
        readonly close?: Token;
    };

    public readonly kind = AstNodeKind.ArrayLiteralExpression;

    public readonly location: Location | undefined;

    transpile(state: BrsTranspileState) {
        let result: TranspileResult = [];
        result.push(
            state.transpileToken(this.tokens.open, '[')
        );
        let hasChildren = this.elements.length > 0;
        state.blockDepth++;

        for (let i = 0; i < this.elements.length; i++) {
            let previousElement = this.elements[i - 1];
            let element = this.elements[i];

            if (util.isLeadingCommentOnSameLine(previousElement ?? this.tokens.open, element)) {
                result.push(' ');
            } else {
                result.push(
                    '\n',
                    state.indent()
                );
            }
            result.push(
                ...element.transpile(state)
            );
        }
        state.blockDepth--;
        //add a newline between open and close if there are elements
        const lastLocatable = this.elements[this.elements.length - 1] ?? this.tokens.open;
        result.push(...state.transpileEndBlockToken(lastLocatable, this.tokens.close, ']', hasChildren));

        return result;
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walkArray(this.elements, visitor, options, this);
        }
    }

    getType(options: GetTypeOptions): BscType {
        const innerTypes = this.elements.map(expr => expr.getType(options));
        return new ArrayType(...innerTypes);
    }
    get leadingTrivia(): Token[] {
        return this.tokens.open?.leadingTrivia;
    }

    get endTrivia(): Token[] {
        return this.tokens.close?.leadingTrivia;
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
        this.location = util.createBoundingLocation(this.tokens.key, this.tokens.colon, this.value);
    }

    public readonly kind = AstNodeKind.AAMemberExpression;

    public readonly location: Location | undefined;

    public readonly tokens: {
        readonly key: Token;
        readonly colon?: Token;
        readonly comma?: Token;
    };

    /** The expression evaluated to determine the member's initial value. */
    public readonly value: Expression;

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

    get leadingTrivia(): Token[] {
        return this.tokens.key.leadingTrivia;
    }

}

export class AALiteralExpression extends Expression {
    constructor(options: {
        elements: Array<AAMemberExpression>;
        open?: Token;
        close?: Token;
    }) {
        super();
        this.tokens = {
            open: options.open,
            close: options.close
        };
        this.elements = options.elements;
        this.location = util.createBoundingLocation(this.tokens.open, ...this.elements, this.tokens.close);
    }

    public readonly elements: Array<AAMemberExpression>;
    public readonly tokens: {
        readonly open?: Token;
        readonly close?: Token;
    };

    public readonly kind = AstNodeKind.AALiteralExpression;

    public readonly location: Location | undefined;

    transpile(state: BrsTranspileState) {
        let result: TranspileResult = [];
        //open curly
        result.push(
            state.transpileToken(this.tokens.open, '{')
        );
        let hasChildren = this.elements.length > 0;
        //add newline if the object has children and the first child isn't a comment starting on the same line as opening curly
        if (hasChildren && !util.isLeadingCommentOnSameLine(this.tokens.open, this.elements[0])) {
            result.push('\n');
        }
        state.blockDepth++;
        for (let i = 0; i < this.elements.length; i++) {
            let element = this.elements[i];
            let previousElement = this.elements[i - 1];
            let nextElement = this.elements[i + 1];

            //don't indent if comment is same-line
            if (util.isLeadingCommentOnSameLine(this.tokens.open, element) ||
                util.isLeadingCommentOnSameLine(previousElement, element)) {
                result.push(' ');
            } else {
                //indent line
                result.push(state.indent());
            }

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

            //if next element is a same-line comment, skip the newline
            if (nextElement && !util.isLeadingCommentOnSameLine(element, nextElement)) {
                //add a newline between statements
                result.push('\n');
            }
        }
        state.blockDepth--;

        const lastElement = this.elements[this.elements.length - 1] ?? this.tokens.open;
        result.push(...state.transpileEndBlockToken(lastElement, this.tokens.close, '}', hasChildren));

        return result;
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walkArray(this.elements, visitor, options, this);
        }
    }

    getType(options: GetTypeOptions): BscType {
        const resultType = new AssociativeArrayType();
        resultType.addBuiltInInterfaces();
        for (const element of this.elements) {
            if (isAAMemberExpression(element)) {
                resultType.addMember(element.tokens.key.text, { definingNode: element }, element.getType(options), SymbolTypeFlag.runtime);
            }
        }
        return resultType;
    }

    public get leadingTrivia(): Token[] {
        return this.tokens.open?.leadingTrivia;
    }

    public get endTrivia(): Token[] {
        return this.tokens.close?.leadingTrivia;
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
        this.location = util.createBoundingLocation(this.tokens.operator, this.right);
    }

    public readonly kind = AstNodeKind.UnaryExpression;

    public readonly location: Location | undefined;

    public readonly tokens: {
        readonly operator: Token;
    };
    public readonly right: Expression;

    transpile(state: BrsTranspileState) {
        let separatingWhitespace: string | undefined;
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

    public get leadingTrivia(): Token[] {
        return this.tokens.operator.leadingTrivia;
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
        this.location = this.tokens.name?.location;
    }

    public readonly tokens: {
        readonly name: Identifier;
    };

    public readonly kind = AstNodeKind.VariableExpression;

    public readonly location: Location;

    public getName(parseMode?: ParseMode) {
        return this.tokens.name.text;
    }

    transpile(state: BrsTranspileState) {
        let result: TranspileResult = [];
        const namespace = this.findAncestor<NamespaceStatement>(isNamespaceStatement);
        //if the callee is the name of a known namespace function
        if (namespace && util.isCalleeMemberOfNamespace(this.tokens.name.text, this, namespace)) {
            result.push(
                //transpile leading comments since the token isn't being transpiled directly
                ...state.transpileLeadingCommentsForAstNode(this),
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

            if (util.isClassUsedAsFunction(resultType, this, options)) {
                resultType = FunctionType.instance;
            }

        }
        options?.typeChain?.push(new TypeChainEntry({ name: nameKey, type: resultType, data: options.data, astNode: this }));
        return resultType;
    }

    get leadingTrivia(): Token[] {
        return this.tokens.name.leadingTrivia;
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
        this.location = this.tokens.value?.location;
    }

    public readonly location: Location;

    public readonly kind = AstNodeKind.SourceLiteralExpression;

    public readonly tokens: {
        readonly value: Token;
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
        let func = this.findAncestor<FunctionExpression>(isFunctionExpression);
        let nameParts = [] as TranspileResult;
        let parentFunction: FunctionExpression;
        while ((parentFunction = func.findAncestor<FunctionExpression>(isFunctionExpression))) {
            let index = this.findFunctionIndex(parentFunction, func);
            nameParts.unshift(`anon${index}`);
            func = parentFunction;
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
            if (node.location?.range) {
                return node.location.range.start.line + 1;
            }
            node = node.parent;
        }
        return -1;
    }

    transpile(state: BrsTranspileState) {
        let text: string;
        switch (this.tokens.value.kind) {
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

    get leadingTrivia(): Token[] {
        return this.tokens.value.leadingTrivia;
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
        this.location = util.createBoundingLocation(this.tokens.new, this.call);
    }

    public readonly kind = AstNodeKind.NewExpression;

    public readonly location: Location | undefined;

    public readonly tokens: {
        readonly new?: Token;
    };
    public readonly call: CallExpression;

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
        const result = this.call.getType(options);
        if (options.typeChain) {
            // modify last typechain entry to show it is a new ...()
            const lastEntry = options.typeChain[options.typeChain.length - 1];
            if (lastEntry) {
                lastEntry.astNode = this;
            }
        }
        return result;
    }

    get leadingTrivia(): Token[] {
        return this.tokens.new.leadingTrivia;
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

        this.location = util.createBoundingLocation(
            this.callee,
            this.tokens.operator,
            this.tokens.methodName,
            this.tokens.openingParen,
            ...this.args,
            this.tokens.closingParen
        );
    }

    public readonly callee: Expression;
    public readonly args: Expression[];

    public readonly tokens: {
        readonly operator: Token;
        readonly methodName: Identifier;
        readonly openingParen?: Token;
        readonly closingParen?: Token;
    };

    public readonly kind = AstNodeKind.CallfuncExpression;

    public readonly location: Location | undefined;

    public transpile(state: BrsTranspileState) {
        let result = [] as TranspileResult;
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
                options.typeChain?.push(new TypeChainEntry({
                    name: this.tokens.methodName.text,
                    type: funcType,
                    data: options.data,
                    location: this.tokens.methodName.location,
                    separatorToken: createToken(TokenKind.Callfunc),
                    astNode: this
                }));
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

    get leadingTrivia(): Token[] {
        return this.callee.leadingTrivia;
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
        this.location = util.createBoundingLocation(
            ...this.expressions
        );
    }

    public readonly expressions: Array<LiteralExpression | EscapedCharCodeLiteralExpression>;
    public readonly kind = AstNodeKind.TemplateStringQuasiExpression;

    readonly location: Location | undefined;

    transpile(state: BrsTranspileState, skipEmptyStrings = true) {
        let result = [] as TranspileResult;
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
        this.location = util.createBoundingLocation(
            this.tokens.openingBacktick,
            this.quasis[0],
            this.quasis[this.quasis.length - 1],
            this.tokens.closingBacktick
        );
    }

    public readonly kind = AstNodeKind.TemplateStringExpression;

    public readonly tokens: {
        readonly openingBacktick?: Token;
        readonly closingBacktick?: Token;
    };
    public readonly quasis: TemplateStringQuasiExpression[];
    public readonly expressions: Expression[];

    public readonly location: Location | undefined;

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

        this.location = util.createBoundingLocation(
            this.tokens.tagName,
            this.tokens.openingBacktick,
            this.quasis[0],
            this.quasis[this.quasis.length - 1],
            this.tokens.closingBacktick
        );
    }

    public readonly kind = AstNodeKind.TaggedTemplateStringExpression;

    public readonly tokens: {
        readonly tagName: Identifier;
        readonly openingBacktick?: Token;
        readonly closingBacktick?: Token;
    };

    public readonly quasis: TemplateStringQuasiExpression[];
    public readonly expressions: Expression[];

    public readonly location: Location | undefined;

    transpile(state: BrsTranspileState) {
        let result = [] as TranspileResult;
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

    public readonly tokens: {
        readonly at: Token;
        readonly name: Token;
    };

    public get location(): Location | undefined {
        return util.createBoundingLocation(
            this.tokens.at,
            this.tokens.name,
            this.call
        );
    }

    public readonly name: string;

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

    public get leadingTrivia(): Token[] {
        return this.tokens.at?.leadingTrivia;
    }

    transpile(state: BrsTranspileState) {
        //transpile only our leading comments
        return state.transpileComments(this.leadingTrivia);
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
        this.location = util.createBoundingLocation(
            this.test,
            this.tokens.questionMark,
            this.consequent,
            this.tokens.colon,
            this.alternate
        );
    }

    public readonly kind = AstNodeKind.TernaryExpression;

    public readonly location: Location | undefined;

    public readonly tokens: {
        readonly questionMark?: Token;
        readonly colon?: Token;
    };

    public readonly test: Expression;
    public readonly consequent?: Expression;
    public readonly alternate?: Expression;

    transpile(state: BrsTranspileState) {
        let result = [] as TranspileResult;
        const file = state.file;
        let consequentInfo = util.getExpressionInfo(this.consequent!, file);
        let alternateInfo = util.getExpressionInfo(this.alternate!, file);

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
                    `(function(${['__bsCondition', ...allUniqueVarNames].join(', ')})`
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
                state.sourceNode(this.tokens.questionMark, `${['', ...allUniqueVarNames].join(', ')})`)
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

    get leadingTrivia(): Token[] {
        return this.test.leadingTrivia;
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
        this.location = util.createBoundingLocation(
            this.consequent,
            this.tokens.questionQuestion,
            this.alternate
        );
    }

    public readonly kind = AstNodeKind.NullCoalescingExpression;

    public readonly location: Location | undefined;

    public readonly tokens: {
        readonly questionQuestion?: Token;
    };

    public readonly consequent: Expression;
    public readonly alternate: Expression;

    transpile(state: BrsTranspileState) {
        let result = [] as TranspileResult;
        let consequentInfo = util.getExpressionInfo(this.consequent, state.file);
        let alternateInfo = util.getExpressionInfo(this.alternate, state.file);

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

    get leadingTrivia(): Token[] {
        return this.consequent.leadingTrivia;
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
    public readonly tokens: {
        readonly regexLiteral: Token;
    };

    public get location(): Location {
        return this.tokens?.regexLiteral?.location;
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

    get leadingTrivia(): Token[] {
        return this.tokens.regexLiteral?.leadingTrivia;
    }
}

// eslint-disable-next-line @typescript-eslint/consistent-indexed-object-style
type ExpressionValue = string | number | boolean | Expression | ExpressionValue[] | { [key: string]: ExpressionValue } | null;

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
            .map(e => expressionToValue(e, strict));
    }
    if (isAALiteralExpression(expr)) {
        return expr.elements.reduce((acc, e) => {
            acc[e.tokens.key.text] = expressionToValue(e.value, strict);
            return acc;
        }, {});
    }
    //for annotations, we only support serializing pure string values
    if (isTemplateStringExpression(expr)) {
        if (expr.quasis?.length === 1 && expr.expressions.length === 0) {
            return expr.quasis[0].expressions.map(x => x.tokens.value.text).join('');
        }
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
        this.location = this.expression?.location;
    }

    public readonly kind = AstNodeKind.TypeExpression;

    /**
     * The standard AST expression that represents the type for this TypeExpression.
     */
    public readonly expression: Expression;

    public readonly location: Location;

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

    getTypedef(state: TranspileState): TranspileResult {
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

export class TypecastExpression extends Expression {
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
        this.location = util.createBoundingLocation(
            this.obj,
            this.tokens.as,
            this.typeExpression
        );
    }

    public readonly kind = AstNodeKind.TypecastExpression;

    public readonly obj: Expression;

    public readonly tokens: {
        readonly as?: Token;
    };

    public typeExpression?: TypeExpression;

    public readonly location: Location;

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
        const result = this.typeExpression.getType(options);
        if (options.typeChain) {
            // modify last typechain entry to show it is a typecast
            const lastEntry = options.typeChain[options.typeChain.length - 1];
            if (lastEntry) {
                lastEntry.astNode = this;
            }
        }
        return result;
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
        this.location = util.createBoundingLocation(
            this.innerType,
            this.tokens.leftBracket,
            this.tokens.rightBracket
        );
    }

    public readonly tokens: {
        readonly leftBracket?: Token;
        readonly rightBracket?: Token;
    };

    public readonly innerType: Expression;

    public readonly kind = AstNodeKind.TypedArrayExpression;

    public readonly location: Location;

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
