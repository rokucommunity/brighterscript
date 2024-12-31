/* eslint-disable no-bitwise */
import type { Token, Identifier } from '../lexer/Token';
import { TokenKind } from '../lexer/TokenKind';
import type { DottedGetExpression, FunctionExpression, FunctionParameterExpression, LiteralExpression, TypeExpression, TypecastExpression } from './Expression';
import { CallExpression, VariableExpression } from './Expression';
import { util } from '../util';
import type { Location } from 'vscode-languageserver';
import type { BrsTranspileState } from './BrsTranspileState';
import { ParseMode } from './Parser';
import type { WalkVisitor, WalkOptions } from '../astUtils/visitors';
import { InternalWalkMode, walk, createVisitor, WalkMode, walkArray } from '../astUtils/visitors';
import { isCallExpression, isCatchStatement, isConditionalCompileStatement, isEnumMemberStatement, isExpression, isExpressionStatement, isFieldStatement, isForEachStatement, isForStatement, isFunctionExpression, isFunctionStatement, isIfStatement, isInterfaceFieldStatement, isInterfaceMethodStatement, isInvalidType, isLiteralExpression, isMethodStatement, isNamespaceStatement, isTryCatchStatement, isTypedefProvider, isUnaryExpression, isUninitializedType, isVoidType, isWhileStatement } from '../astUtils/reflection';
import { TypeChainEntry, type GetTypeOptions, type TranspileResult, type TypedefProvider } from '../interfaces';
import { createInvalidLiteral, createMethodStatement, createToken } from '../astUtils/creators';
import { DynamicType } from '../types/DynamicType';
import type { BscType } from '../types/BscType';
import { SymbolTable } from '../SymbolTable';
import type { AstNode, Expression } from './AstNode';
import { AstNodeKind, Statement } from './AstNode';
import { ClassType } from '../types/ClassType';
import { EnumMemberType, EnumType } from '../types/EnumType';
import { NamespaceType } from '../types/NamespaceType';
import { InterfaceType } from '../types/InterfaceType';
import { VoidType } from '../types/VoidType';
import { TypedFunctionType } from '../types/TypedFunctionType';
import { ArrayType } from '../types/ArrayType';
import { SymbolTypeFlag } from '../SymbolTypeFlag';
import brsDocParser from './BrightScriptDocParser';

export class EmptyStatement extends Statement {
    constructor(options?: { range?: Location }
    ) {
        super();
        this.location = undefined;
    }
    /**
     * Create a negative range to indicate this is an interpolated location
     */
    public readonly location?: Location;

    public readonly kind = AstNodeKind.EmptyStatement;

    transpile(state: BrsTranspileState) {
        return [];
    }
    walk(visitor: WalkVisitor, options: WalkOptions) {
        //nothing to walk
    }

    public clone() {
        return this.finalizeClone(
            new EmptyStatement({
                range: util.cloneLocation(this.location)
            })
        );
    }
}

/**
 * This is a top-level statement. Consider this the root of the AST
 */
export class Body extends Statement implements TypedefProvider {
    constructor(options?: {
        statements?: Statement[];
    }) {
        super();
        this.statements = options?.statements ?? [];
    }

    public readonly statements: Statement[] = [];
    public readonly kind = AstNodeKind.Body;

    public readonly symbolTable = new SymbolTable('Body', () => this.parent?.getSymbolTable());

    public get location() {
        if (!this._location) {
            //this needs to be a getter because the body has its statements pushed to it after being constructed
            this._location = util.createBoundingLocation(
                ...(this.statements ?? [])
            );
        }
        return this._location;
    }
    public set location(value) {
        this._location = value;
    }
    private _location: Location;

    transpile(state: BrsTranspileState) {
        let result: TranspileResult = state.transpileAnnotations(this);
        for (let i = 0; i < this.statements.length; i++) {
            let statement = this.statements[i];
            let previousStatement = this.statements[i - 1];
            let nextStatement = this.statements[i + 1];

            if (!previousStatement) {
                //this is the first statement. do nothing related to spacing and newlines

                //if comment is on same line as prior sibling
            } else if (util.hasLeadingComments(statement) && previousStatement && util.getLeadingComments(statement)?.[0]?.location?.range?.start.line === previousStatement.location?.range?.end.line) {
                result.push(
                    ' '
                );
                //add double newline if this is a comment, and next is a function
            } else if (util.hasLeadingComments(statement) && nextStatement && isFunctionStatement(nextStatement)) {
                result.push(state.newline, state.newline);

                //add double newline if is function not preceeded by a comment
            } else if (isFunctionStatement(statement) && previousStatement && !util.hasLeadingComments(statement)) {
                result.push(state.newline, state.newline);
            } else {
                //separate statements by a single newline
                result.push(state.newline);
            }

            result.push(...statement.transpile(state));
        }
        return result;
    }

    getTypedef(state: BrsTranspileState): TranspileResult {
        let result = [] as TranspileResult;
        for (const statement of this.statements) {
            //if the current statement supports generating typedef, call it
            if (isTypedefProvider(statement)) {
                result.push(
                    state.indent(),
                    ...statement.getTypedef(state),
                    state.newline
                );
            }
        }
        return result;
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkStatements) {
            walkArray(this.statements, visitor, options, this);
        }
    }

    public clone() {
        return this.finalizeClone(
            new Body({
                statements: this.statements?.map(s => s?.clone())
            }),
            ['statements']
        );
    }
}

export class AssignmentStatement extends Statement {
    constructor(options: {
        name: Identifier;
        equals?: Token;
        value: Expression;
        as?: Token;
        typeExpression?: TypeExpression;
    }) {
        super();
        this.value = options.value;
        this.tokens = {
            equals: options.equals,
            name: options.name,
            as: options.as
        };
        this.typeExpression = options.typeExpression;
        this.location = util.createBoundingLocation(util.createBoundingLocationFromTokens(this.tokens), this.value);
    }

    public readonly tokens: {
        readonly equals?: Token;
        readonly name: Identifier;
        readonly as?: Token;
    };

    public readonly value: Expression;

    public readonly typeExpression?: TypeExpression;

    public readonly kind = AstNodeKind.AssignmentStatement;

    public readonly location: Location | undefined;

    transpile(state: BrsTranspileState) {
        return [
            state.transpileToken(this.tokens.name),
            ' ',
            state.transpileToken(this.tokens.equals ?? createToken(TokenKind.Equal), '='),
            ' ',
            ...this.value.transpile(state)
        ];
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'typeExpression', visitor, options);
            walk(this, 'value', visitor, options);
        }
    }

    getType(options: GetTypeOptions) {
        const variableTypeFromCode = this.typeExpression?.getType({ ...options, typeChain: undefined });
        const docs = brsDocParser.parseNode(this);
        const variableTypeFromDocs = docs?.getTypeTagBscType(options);
        const variableType = util.chooseTypeFromCodeOrDocComment(variableTypeFromCode, variableTypeFromDocs, options) ?? this.value.getType({ ...options, typeChain: undefined });

        // Note: compound assignments (eg. +=) are internally dealt with via the RHS being a BinaryExpression
        // so this.value will be a BinaryExpression, and BinaryExpressions can figure out their own types
        options.typeChain?.push(new TypeChainEntry({ name: this.tokens.name.text, type: variableType, data: options.data, location: this.tokens.name?.location, astNode: this }));
        return variableType;
    }

    get leadingTrivia(): Token[] {
        return this.tokens.name.leadingTrivia;
    }

    public clone() {
        return this.finalizeClone(
            new AssignmentStatement({
                name: util.cloneToken(this.tokens.name),
                value: this.value?.clone(),
                as: util.cloneToken(this.tokens.as),
                equals: util.cloneToken(this.tokens.equals),
                typeExpression: this.typeExpression?.clone()
            }),
            ['value', 'typeExpression']
        );
    }
}

export class AugmentedAssignmentStatement extends Statement {
    constructor(options: {
        item: Expression;
        operator: Token;
        value: Expression;
    }) {
        super();
        this.value = options.value;
        this.tokens = {
            operator: options.operator
        };
        this.item = options.item;
        this.value = options.value;
        this.location = util.createBoundingLocation(this.item, util.createBoundingLocationFromTokens(this.tokens), this.value);
    }

    public readonly tokens: {
        readonly operator?: Token;
    };

    public readonly item: Expression;

    public readonly value: Expression;

    public readonly kind = AstNodeKind.AugmentedAssignmentStatement;

    public readonly location: Location | undefined;

    transpile(state: BrsTranspileState) {
        return [
            this.item.transpile(state),
            ' ',
            state.transpileToken(this.tokens.operator),
            ' ',
            this.value.transpile(state)
        ];
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'item', visitor, options);
            walk(this, 'value', visitor, options);
        }
    }

    getType(options: GetTypeOptions) {
        const variableType = util.binaryOperatorResultType(this.item.getType(options), this.tokens.operator, this.value.getType(options));

        //const variableType = this.typeExpression?.getType({ ...options, typeChain: undefined }) ?? this.value.getType({ ...options, typeChain: undefined });

        // Note: compound assignments (eg. +=) are internally dealt with via the RHS being a BinaryExpression
        // so this.value will be a BinaryExpression, and BinaryExpressions can figure out their own types
        // options.typeChain?.push(new TypeChainEntry({ name: this.tokens.name.text, type: variableType, data: options.data, range: this.tokens.name.range, astNode: this }));
        return variableType;
    }

    get leadingTrivia(): Token[] {
        return this.item.leadingTrivia;
    }

    public clone() {
        return this.finalizeClone(
            new AugmentedAssignmentStatement({
                item: this.item?.clone(),
                operator: util.cloneToken(this.tokens.operator),
                value: this.value?.clone()
            }),
            ['item', 'value']
        );
    }
}

export class Block extends Statement {
    constructor(options: {
        statements: Statement[];
    }) {
        super();
        this.statements = options.statements;
    }

    public readonly statements: Statement[];

    public readonly kind = AstNodeKind.Block;

    private buildLocation(): Location {
        if (this.statements?.length > 0) {
            return util.createBoundingLocation(...this.statements ?? []);
        }
        let lastBitBefore: Location;
        let firstBitAfter: Location;

        if (isFunctionExpression(this.parent)) {
            lastBitBefore = util.createBoundingLocation(
                this.parent.tokens.functionType,
                this.parent.tokens.leftParen,
                ...(this.parent.parameters ?? []),
                this.parent.tokens.rightParen,
                this.parent.tokens.as,
                this.parent.returnTypeExpression
            );
            firstBitAfter = this.parent.tokens.endFunctionType?.location;
        } else if (isIfStatement(this.parent)) {
            if (this.parent.thenBranch === this) {
                lastBitBefore = util.createBoundingLocation(
                    this.parent.tokens.then,
                    this.parent.condition
                );
                firstBitAfter = util.createBoundingLocation(
                    this.parent.tokens.else,
                    this.parent.elseBranch,
                    this.parent.tokens.endIf
                );
            } else if (this.parent.elseBranch === this) {
                lastBitBefore = this.parent.tokens.else?.location;
                firstBitAfter = this.parent.tokens.endIf?.location;
            }
        } else if (isConditionalCompileStatement(this.parent)) {
            if (this.parent.thenBranch === this) {
                lastBitBefore = util.createBoundingLocation(
                    this.parent.tokens.condition,
                    this.parent.tokens.not,
                    this.parent.tokens.hashIf
                );
                firstBitAfter = util.createBoundingLocation(
                    this.parent.tokens.hashElse,
                    this.parent.elseBranch,
                    this.parent.tokens.hashEndIf
                );
            } else if (this.parent.elseBranch === this) {
                lastBitBefore = this.parent.tokens.hashElse?.location;
                firstBitAfter = this.parent.tokens.hashEndIf?.location;
            }
        } else if (isForStatement(this.parent)) {
            lastBitBefore = util.createBoundingLocation(
                this.parent.increment,
                this.parent.tokens.step,
                this.parent.finalValue,
                this.parent.tokens.to,
                this.parent.counterDeclaration,
                this.parent.tokens.for
            );
            firstBitAfter = this.parent.tokens.endFor?.location;
        } else if (isForEachStatement(this.parent)) {
            lastBitBefore = util.createBoundingLocation(
                this.parent.target,
                this.parent.tokens.in,
                this.parent.tokens.item,
                this.parent.tokens.forEach
            );
            firstBitAfter = this.parent.tokens.endFor?.location;
        } else if (isWhileStatement(this.parent)) {
            lastBitBefore = util.createBoundingLocation(
                this.parent.condition,
                this.parent.tokens.while
            );
            firstBitAfter = this.parent.tokens.endWhile?.location;
        } else if (isTryCatchStatement(this.parent)) {
            lastBitBefore = util.createBoundingLocation(
                this.parent.tokens.try
            );
            firstBitAfter = util.createBoundingLocation(
                this.parent.tokens.endTry,
                this.parent.catchStatement
            );
        } else if (isCatchStatement(this.parent) && isTryCatchStatement(this.parent?.parent)) {
            lastBitBefore = util.createBoundingLocation(
                this.parent.tokens.catch,
                this.parent.exceptionVariableExpression
            );
            firstBitAfter = this.parent.parent.tokens.endTry?.location;
        }
        if (lastBitBefore?.range && firstBitAfter?.range) {
            return util.createLocation(
                lastBitBefore.range.end.line,
                lastBitBefore.range.end.character,
                firstBitAfter.range.start.line,
                firstBitAfter.range.start.character,
                lastBitBefore.uri ?? firstBitAfter.uri
            );
        }
    }

    public get location() {
        if (!this._location) {
            //this needs to be a getter because the body has its statements pushed to it after being constructed
            this._location = this.buildLocation();
        }
        return this._location;
    }
    public set location(value) {
        this._location = value;
    }
    private _location: Location;

    transpile(state: BrsTranspileState) {
        state.blockDepth++;
        let results = [] as TranspileResult;
        for (let i = 0; i < this.statements.length; i++) {
            let previousStatement = this.statements[i - 1];
            let statement = this.statements[i];
            //is not a comment
            //if comment is on same line as parent
            if (util.isLeadingCommentOnSameLine(state.lineage[0]?.location, statement) ||
                util.isLeadingCommentOnSameLine(previousStatement?.location, statement)
            ) {
                results.push(' ');

                //is not a comment
            } else {
                //add a newline and indent
                results.push(
                    state.newline,
                    state.indent()
                );
            }

            //push block onto parent list
            state.lineage.unshift(this);
            results.push(
                ...statement.transpile(state)
            );
            state.lineage.shift();
        }
        state.blockDepth--;
        return results;
    }

    public get leadingTrivia(): Token[] {
        return this.statements[0]?.leadingTrivia ?? [];
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkStatements) {
            walkArray(this.statements, visitor, options, this);
        }
    }

    public clone() {
        return this.finalizeClone(
            new Block({
                statements: this.statements?.map(s => s?.clone())
            }),
            ['statements']
        );
    }
}

export class ExpressionStatement extends Statement {
    constructor(options: {
        expression: Expression;
    }) {
        super();
        this.expression = options.expression;
        this.location = this.expression?.location;
    }
    public readonly expression: Expression;
    public readonly kind = AstNodeKind.ExpressionStatement;

    public readonly location: Location | undefined;

    transpile(state: BrsTranspileState) {
        return [
            state.transpileAnnotations(this),
            this.expression.transpile(state)
        ];
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'expression', visitor, options);
        }
    }

    get leadingTrivia(): Token[] {
        return this.expression.leadingTrivia;
    }

    public clone() {
        return this.finalizeClone(
            new ExpressionStatement({
                expression: this.expression?.clone()
            }),
            ['expression']
        );
    }
}

export class ExitStatement extends Statement {
    constructor(options?: {
        exit?: Token;
        loopType: Token;
    }) {
        super();
        this.tokens = {
            exit: options?.exit,
            loopType: options.loopType
        };
        this.location = util.createBoundingLocation(
            this.tokens.exit,
            this.tokens.loopType
        );
    }

    public readonly tokens: {
        readonly exit: Token;
        readonly loopType?: Token;
    };

    public readonly kind = AstNodeKind.ExitStatement;

    public readonly location?: Location;

    transpile(state: BrsTranspileState) {
        return [
            state.transpileToken(this.tokens.exit, 'exit'),
            this.tokens.loopType?.leadingWhitespace ?? ' ',
            state.transpileToken(this.tokens.loopType)
        ];
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        //nothing to walk
    }

    get leadingTrivia(): Token[] {
        return this.tokens.exit?.leadingTrivia;
    }

    public clone() {
        return this.finalizeClone(
            new ExitStatement({
                loopType: util.cloneToken(this.tokens.loopType),
                exit: util.cloneToken(this.tokens.exit)
            })
        );
    }
}

export class FunctionStatement extends Statement implements TypedefProvider {
    constructor(options: {
        name: Identifier;
        func: FunctionExpression;
    }) {
        super();
        this.tokens = {
            name: options.name
        };
        this.func = options.func;
        if (this.func) {
            this.func.symbolTable.name += `: '${this.tokens.name?.text}'`;
        }

        this.location = this.func?.location;
    }

    public readonly tokens: {
        readonly name: Identifier;
    };
    public readonly func: FunctionExpression;

    public readonly kind = AstNodeKind.FunctionStatement as AstNodeKind;

    public readonly location: Location | undefined;

    /**
     * Get the name of this expression based on the parse mode
     */
    public getName(parseMode: ParseMode) {
        const namespace = this.findAncestor<NamespaceStatement>(isNamespaceStatement);
        if (namespace) {
            let delimiter = parseMode === ParseMode.BrighterScript ? '.' : '_';
            let namespaceName = namespace.getName(parseMode);
            return namespaceName + delimiter + this.tokens.name?.text;
        } else {
            return this.tokens.name.text;
        }
    }

    public get leadingTrivia(): Token[] {
        return this.func.leadingTrivia;
    }

    transpile(state: BrsTranspileState): TranspileResult {
        //create a fake token using the full transpiled name
        let nameToken = {
            ...this.tokens.name,
            text: this.getName(ParseMode.BrightScript)
        };

        return [
            ...state.transpileAnnotations(this),
            ...this.func.transpile(state, nameToken)
        ];
    }

    getTypedef(state: BrsTranspileState) {
        let result: TranspileResult = [];
        for (let comment of util.getLeadingComments(this) ?? []) {
            result.push(
                comment.text,
                state.newline,
                state.indent()
            );
        }
        for (let annotation of this.annotations ?? []) {
            result.push(
                ...annotation.getTypedef(state),
                state.newline,
                state.indent()
            );
        }

        result.push(
            ...this.func.getTypedef(state)
        );
        return result;
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'func', visitor, options);
        }
    }

    getType(options: GetTypeOptions) {
        const funcExprType = this.func.getType(options);
        funcExprType.setName(this.getName(ParseMode.BrighterScript));
        return funcExprType;
    }

    public clone() {
        return this.finalizeClone(
            new FunctionStatement({
                func: this.func?.clone(),
                name: util.cloneToken(this.tokens.name)
            }),
            ['func']
        );
    }
}

export class IfStatement extends Statement {
    constructor(options: {
        if?: Token;
        then?: Token;
        else?: Token;
        endIf?: Token;

        condition: Expression;
        thenBranch: Block;
        elseBranch?: IfStatement | Block;
    }) {
        super();
        this.condition = options.condition;
        this.thenBranch = options.thenBranch;
        this.elseBranch = options.elseBranch;

        this.tokens = {
            if: options.if,
            then: options.then,
            else: options.else,
            endIf: options.endIf
        };

        this.location = util.createBoundingLocation(
            util.createBoundingLocationFromTokens(this.tokens),
            this.condition,
            this.thenBranch,
            this.elseBranch
        );
    }

    readonly tokens: {
        readonly if?: Token;
        readonly then?: Token;
        readonly else?: Token;
        readonly endIf?: Token;
    };
    public readonly condition: Expression;
    public readonly thenBranch: Block;
    public readonly elseBranch?: IfStatement | Block;

    public readonly kind = AstNodeKind.IfStatement;

    public readonly location: Location | undefined;

    get isInline() {
        const allLeadingTrivia = [
            ...this.thenBranch.leadingTrivia,
            ...this.thenBranch.statements.map(s => s.leadingTrivia).flat(),
            ...(this.tokens.else?.leadingTrivia ?? []),
            ...(this.tokens.endIf?.leadingTrivia ?? [])
        ];

        const hasNewline = allLeadingTrivia.find(t => t.kind === TokenKind.Newline);
        return !hasNewline;
    }

    transpile(state: BrsTranspileState) {
        let results = [] as TranspileResult;
        //if   (already indented by block)
        results.push(state.transpileToken(this.tokens.if ?? createToken(TokenKind.If)));
        results.push(' ');
        //conditions
        results.push(...this.condition.transpile(state));
        //then
        if (this.tokens.then) {
            results.push(' ');
            results.push(
                state.transpileToken(this.tokens.then, 'then')
            );
        }
        state.lineage.unshift(this);

        //if statement body
        let thenNodes = this.thenBranch.transpile(state);
        state.lineage.shift();
        if (thenNodes.length > 0) {
            results.push(thenNodes);
        }
        //else branch
        if (this.elseBranch) {
            //else
            results.push(...state.transpileEndBlockToken(this.thenBranch, this.tokens.else, 'else'));

            if (isIfStatement(this.elseBranch)) {
                //chained elseif
                state.lineage.unshift(this.elseBranch);
                let body = this.elseBranch.transpile(state);
                state.lineage.shift();

                if (body.length > 0) {
                    //zero or more spaces between the `else` and the `if`
                    results.push(this.elseBranch.tokens.if.leadingWhitespace!);
                    results.push(...body);

                    // stop here because chained if will transpile the rest
                    return results;
                } else {
                    results.push('\n');
                }

            } else {
                //else body
                state.lineage.unshift(this.tokens.else!);
                let body = this.elseBranch.transpile(state);
                state.lineage.shift();

                if (body.length > 0) {
                    results.push(...body);
                }
            }
        }

        //end if
        results.push(...state.transpileEndBlockToken(this.elseBranch ?? this.thenBranch, this.tokens.endIf, 'end if'));

        return results;
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'condition', visitor, options);
        }
        if (options.walkMode & InternalWalkMode.walkStatements) {
            walk(this, 'thenBranch', visitor, options);
        }
        if (this.elseBranch && options.walkMode & InternalWalkMode.walkStatements) {
            walk(this, 'elseBranch', visitor, options);
        }
    }

    get leadingTrivia(): Token[] {
        return this.tokens.if?.leadingTrivia ?? [];
    }

    get endTrivia(): Token[] {
        return this.tokens.endIf?.leadingTrivia ?? [];
    }

    public clone() {
        return this.finalizeClone(
            new IfStatement({
                if: util.cloneToken(this.tokens.if),
                else: util.cloneToken(this.tokens.else),
                endIf: util.cloneToken(this.tokens.endIf),
                then: util.cloneToken(this.tokens.then),
                condition: this.condition?.clone(),
                thenBranch: this.thenBranch?.clone(),
                elseBranch: this.elseBranch?.clone()
            }),
            ['condition', 'thenBranch', 'elseBranch']
        );
    }
}

export class IncrementStatement extends Statement {
    constructor(options: {
        value: Expression;
        operator: Token;
    }) {
        super();
        this.value = options.value;
        this.tokens = {
            operator: options.operator
        };
        this.location = util.createBoundingLocation(
            this.value,
            this.tokens.operator
        );
    }

    public readonly value: Expression;
    public readonly tokens: {
        readonly operator: Token;
    };

    public readonly kind = AstNodeKind.IncrementStatement;

    public readonly location: Location | undefined;

    transpile(state: BrsTranspileState) {
        return [
            ...this.value.transpile(state),
            state.transpileToken(this.tokens.operator)
        ];
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'value', visitor, options);
        }
    }

    get leadingTrivia(): Token[] {
        return this.value?.leadingTrivia ?? [];
    }

    public clone() {
        return this.finalizeClone(
            new IncrementStatement({
                value: this.value?.clone(),
                operator: util.cloneToken(this.tokens.operator)
            }),
            ['value']
        );
    }
}

/** Used to indent the current `print` position to the next 16-character-width output zone. */
export interface PrintSeparatorTab extends Token {
    kind: TokenKind.Comma;
}

/** Used to insert a single whitespace character at the current `print` position. */
export interface PrintSeparatorSpace extends Token {
    kind: TokenKind.Semicolon;
}

/**
 * Represents a `print` statement within BrightScript.
 */
export class PrintStatement extends Statement {
    /**
     * Creates a new internal representation of a BrightScript `print` statement.
     * @param options the options for this statement
     * @param options.print a print token
     * @param options.expressions an array of expressions or `PrintSeparator`s to be evaluated and printed.
     */
    constructor(options: {
        print?: Token;
        expressions: Array<Expression | PrintSeparatorTab | PrintSeparatorSpace>;
    }) {
        super();
        this.tokens = {
            print: options.print
        };
        this.expressions = options.expressions;
        this.location = util.createBoundingLocation(
            this.tokens.print,
            ...(this.expressions ?? [])
        );
    }
    public readonly tokens: {
        readonly print?: Token;
    };
    public readonly expressions: Array<Expression | PrintSeparatorTab | PrintSeparatorSpace>;
    public readonly kind = AstNodeKind.PrintStatement;

    public readonly location: Location | undefined;

    transpile(state: BrsTranspileState) {
        let result = [
            state.transpileToken(this.tokens.print, 'print'),
            ' '
        ] as TranspileResult;
        for (let i = 0; i < this.expressions.length; i++) {
            const expressionOrSeparator: any = this.expressions[i];
            if (expressionOrSeparator.transpile) {
                result.push(...(expressionOrSeparator as ExpressionStatement).transpile(state));
            } else {
                result.push(
                    state.tokenToSourceNode(expressionOrSeparator)
                );
            }
            //if there's an expression after us, add a space
            if ((this.expressions[i + 1] as any)?.transpile) {
                result.push(' ');
            }
        }
        return result;
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            //sometimes we have semicolon Tokens in the expressions list (should probably fix that...), so only walk the actual expressions
            walkArray(this.expressions as AstNode[], visitor, options, this, (item) => isExpression(item as any));
        }
    }

    get leadingTrivia(): Token[] {
        return this.tokens.print?.leadingTrivia ?? [];
    }

    public clone() {
        return this.finalizeClone(
            new PrintStatement({
                print: util.cloneToken(this.tokens.print),
                expressions: this.expressions?.map(e => {
                    if (isExpression(e as any)) {
                        return (e as Expression).clone();
                    } else {
                        return util.cloneToken(e as Token);
                    }
                })
            }),
            ['expressions' as any]
        );
    }
}

export class DimStatement extends Statement {
    constructor(options: {
        dim?: Token;
        name: Identifier;
        openingSquare?: Token;
        dimensions: Expression[];
        closingSquare?: Token;
    }) {
        super();
        this.tokens = {
            dim: options?.dim,
            name: options.name,
            openingSquare: options.openingSquare,
            closingSquare: options.closingSquare
        };
        this.dimensions = options.dimensions;
        this.location = util.createBoundingLocation(
            options.dim,
            options.name,
            options.openingSquare,
            ...(this.dimensions ?? []),
            options.closingSquare
        );
    }

    public readonly tokens: {
        readonly dim?: Token;
        readonly name: Identifier;
        readonly openingSquare?: Token;
        readonly closingSquare?: Token;
    };
    public readonly dimensions: Expression[];

    public readonly kind = AstNodeKind.DimStatement;

    public readonly location: Location | undefined;

    public transpile(state: BrsTranspileState) {
        let result: TranspileResult = [
            state.transpileToken(this.tokens.dim, 'dim'),
            ' ',
            state.transpileToken(this.tokens.name),
            state.transpileToken(this.tokens.openingSquare, '[')
        ];
        for (let i = 0; i < this.dimensions.length; i++) {
            if (i > 0) {
                result.push(', ');
            }
            result.push(
                ...this.dimensions![i].transpile(state)
            );
        }
        result.push(state.transpileToken(this.tokens.closingSquare, ']'));
        return result;
    }

    public walk(visitor: WalkVisitor, options: WalkOptions) {
        if (this.dimensions?.length !== undefined && this.dimensions?.length > 0 && options.walkMode & InternalWalkMode.walkExpressions) {
            walkArray(this.dimensions, visitor, options, this);

        }
    }

    public getType(options: GetTypeOptions): BscType {
        const numDimensions = this.dimensions?.length ?? 1;
        let type = new ArrayType();
        for (let i = 0; i < numDimensions - 1; i++) {
            type = new ArrayType(type);
        }
        return type;
    }

    get leadingTrivia(): Token[] {
        return this.tokens.dim?.leadingTrivia ?? [];
    }

    public clone() {
        return this.finalizeClone(
            new DimStatement({
                dim: util.cloneToken(this.tokens.dim),
                name: util.cloneToken(this.tokens.name),
                openingSquare: util.cloneToken(this.tokens.openingSquare),
                dimensions: this.dimensions?.map(e => e?.clone()),
                closingSquare: util.cloneToken(this.tokens.closingSquare)
            }),
            ['dimensions']
        );
    }
}

export class GotoStatement extends Statement {
    constructor(options: {
        goto?: Token;
        label: Token;
    }) {
        super();
        this.tokens = {
            goto: options.goto,
            label: options.label
        };
        this.location = util.createBoundingLocation(
            this.tokens.goto,
            this.tokens.label
        );
    }

    public readonly tokens: {
        readonly goto?: Token;
        readonly label: Token;
    };

    public readonly kind = AstNodeKind.GotoStatement;

    public readonly location: Location | undefined;

    transpile(state: BrsTranspileState) {
        return [
            state.transpileToken(this.tokens.goto, 'goto'),
            ' ',
            state.transpileToken(this.tokens.label)
        ];
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        //nothing to walk
    }

    get leadingTrivia(): Token[] {
        return this.tokens.goto?.leadingTrivia ?? [];
    }

    public clone() {
        return this.finalizeClone(
            new GotoStatement({
                goto: util.cloneToken(this.tokens.goto),
                label: util.cloneToken(this.tokens.label)
            })
        );
    }
}

export class LabelStatement extends Statement {
    constructor(options: {
        name: Token;
        colon?: Token;
    }) {
        super();
        this.tokens = {
            name: options.name,
            colon: options.colon
        };
        this.location = util.createBoundingLocation(
            this.tokens.name,
            this.tokens.colon
        );
    }
    public readonly tokens: {
        readonly name: Token;
        readonly colon: Token;
    };
    public readonly kind = AstNodeKind.LabelStatement;

    public readonly location: Location | undefined;

    public get leadingTrivia(): Token[] {
        return this.tokens.name.leadingTrivia;
    }

    transpile(state: BrsTranspileState) {
        return [
            state.transpileToken(this.tokens.name),
            state.transpileToken(this.tokens.colon, ':')

        ];
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        //nothing to walk
    }

    public clone() {
        return this.finalizeClone(
            new LabelStatement({
                name: util.cloneToken(this.tokens.name),
                colon: util.cloneToken(this.tokens.colon)
            })
        );
    }
}

export class ReturnStatement extends Statement {
    constructor(options?: {
        return?: Token;
        value?: Expression;
    }) {
        super();
        this.tokens = {
            return: options?.return
        };
        this.value = options?.value;
        this.location = util.createBoundingLocation(
            this.tokens.return,
            this.value
        );
    }

    public readonly tokens: {
        readonly return?: Token;
    };
    public readonly value?: Expression;
    public readonly kind = AstNodeKind.ReturnStatement;

    public readonly location: Location | undefined;

    transpile(state: BrsTranspileState) {
        let result = [] as TranspileResult;
        result.push(
            state.transpileToken(this.tokens.return, 'return')
        );
        if (this.value) {
            result.push(' ');
            result.push(...this.value.transpile(state));
        }
        return result;
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'value', visitor, options);
        }
    }

    get leadingTrivia(): Token[] {
        return this.tokens.return?.leadingTrivia ?? [];
    }

    public clone() {
        return this.finalizeClone(
            new ReturnStatement({
                return: util.cloneToken(this.tokens.return),
                value: this.value?.clone()
            }),
            ['value']
        );
    }
}

export class EndStatement extends Statement {
    constructor(options?: {
        end?: Token;
    }) {
        super();
        this.tokens = {
            end: options?.end
        };
        this.location = this.tokens.end?.location;
    }
    public readonly tokens: {
        readonly end?: Token;
    };
    public readonly kind = AstNodeKind.EndStatement;

    public readonly location: Location;

    transpile(state: BrsTranspileState) {
        return [
            state.transpileToken(this.tokens.end, 'end')
        ];
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        //nothing to walk
    }

    get leadingTrivia(): Token[] {
        return this.tokens.end?.leadingTrivia ?? [];
    }

    public clone() {
        return this.finalizeClone(
            new EndStatement({
                end: util.cloneToken(this.tokens.end)
            })
        );
    }
}

export class StopStatement extends Statement {
    constructor(options?: {
        stop?: Token;
    }) {
        super();
        this.tokens = { stop: options?.stop };
        this.location = this.tokens?.stop?.location;
    }
    public readonly tokens: {
        readonly stop?: Token;
    };

    public readonly kind = AstNodeKind.StopStatement;

    public readonly location: Location;

    transpile(state: BrsTranspileState) {
        return [
            state.transpileToken(this.tokens.stop, 'stop')
        ];
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        //nothing to walk
    }

    get leadingTrivia(): Token[] {
        return this.tokens.stop?.leadingTrivia ?? [];
    }

    public clone() {
        return this.finalizeClone(
            new StopStatement({
                stop: util.cloneToken(this.tokens.stop)
            })
        );
    }
}

export class ForStatement extends Statement {
    constructor(options: {
        for?: Token;
        counterDeclaration: AssignmentStatement;
        to?: Token;
        finalValue: Expression;
        body: Block;
        endFor?: Token;
        step?: Token;
        increment?: Expression;
    }) {
        super();
        this.tokens = {
            for: options.for,
            to: options.to,
            endFor: options.endFor,
            step: options.step
        };
        this.counterDeclaration = options.counterDeclaration;
        this.finalValue = options.finalValue;
        this.body = options.body;
        this.increment = options.increment;

        this.location = util.createBoundingLocation(
            this.tokens.for,
            this.counterDeclaration,
            this.tokens.to,
            this.finalValue,
            this.tokens.step,
            this.increment,
            this.body,
            this.tokens.endFor
        );
    }

    public readonly tokens: {
        readonly for?: Token;
        readonly to?: Token;
        readonly endFor?: Token;
        readonly step?: Token;
    };

    public readonly counterDeclaration: AssignmentStatement;
    public readonly finalValue: Expression;
    public readonly body: Block;
    public readonly increment?: Expression;

    public readonly kind = AstNodeKind.ForStatement;

    public readonly location: Location | undefined;

    transpile(state: BrsTranspileState) {
        let result = [] as TranspileResult;
        //for
        result.push(
            state.transpileToken(this.tokens.for, 'for'),
            ' '
        );
        //i=1
        result.push(
            ...this.counterDeclaration.transpile(state),
            ' '
        );
        //to
        result.push(
            state.transpileToken(this.tokens.to, 'to'),
            ' '
        );
        //final value
        result.push(this.finalValue.transpile(state));
        //step
        if (this.increment) {
            result.push(
                ' ',
                state.transpileToken(this.tokens.step, 'step'),
                ' ',
                this.increment!.transpile(state)
            );
        }
        //loop body
        state.lineage.unshift(this);
        result.push(...this.body.transpile(state));
        state.lineage.shift();

        //end for
        result.push(...state.transpileEndBlockToken(this.body, this.tokens.endFor, 'end for'));

        return result;
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkStatements) {
            walk(this, 'counterDeclaration', visitor, options);
        }
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'finalValue', visitor, options);
            walk(this, 'increment', visitor, options);
        }
        if (options.walkMode & InternalWalkMode.walkStatements) {
            walk(this, 'body', visitor, options);
        }
    }

    get leadingTrivia(): Token[] {
        return this.tokens.for?.leadingTrivia ?? [];
    }

    public get endTrivia(): Token[] {
        return this.tokens.endFor?.leadingTrivia ?? [];
    }

    public clone() {
        return this.finalizeClone(
            new ForStatement({
                for: util.cloneToken(this.tokens.for),
                counterDeclaration: this.counterDeclaration?.clone(),
                to: util.cloneToken(this.tokens.to),
                finalValue: this.finalValue?.clone(),
                body: this.body?.clone(),
                endFor: util.cloneToken(this.tokens.endFor),
                step: util.cloneToken(this.tokens.step),
                increment: this.increment?.clone()
            }),
            ['counterDeclaration', 'finalValue', 'body', 'increment']
        );
    }
}

export class ForEachStatement extends Statement {
    constructor(options: {
        forEach?: Token;
        item: Token;
        in?: Token;
        target: Expression;
        body: Block;
        endFor?: Token;
    }) {
        super();
        this.tokens = {
            forEach: options.forEach,
            item: options.item,
            in: options.in,
            endFor: options.endFor
        };
        this.body = options.body;
        this.target = options.target;

        this.location = util.createBoundingLocation(
            this.tokens.forEach,
            this.tokens.item,
            this.tokens.in,
            this.target,
            this.body,
            this.tokens.endFor
        );
    }

    public readonly tokens: {
        readonly forEach?: Token;
        readonly item: Token;
        readonly in?: Token;
        readonly endFor?: Token;
    };
    public readonly body: Block;
    public readonly target: Expression;

    public readonly kind = AstNodeKind.ForEachStatement;

    public readonly location: Location | undefined;

    transpile(state: BrsTranspileState) {
        let result = [] as TranspileResult;
        //for each
        result.push(
            state.transpileToken(this.tokens.forEach, 'for each'),
            ' '
        );
        //item
        result.push(
            state.transpileToken(this.tokens.item),
            ' '
        );
        //in
        result.push(
            state.transpileToken(this.tokens.in, 'in'),
            ' '
        );
        //target
        result.push(...this.target.transpile(state));
        //body
        state.lineage.unshift(this);
        result.push(...this.body.transpile(state));
        state.lineage.shift();

        //end for
        result.push(...state.transpileEndBlockToken(this.body, this.tokens.endFor, 'end for'));

        return result;
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'target', visitor, options);
        }
        if (options.walkMode & InternalWalkMode.walkStatements) {
            walk(this, 'body', visitor, options);
        }
    }

    getType(options: GetTypeOptions): BscType {
        return this.getSymbolTable().getSymbolType(this.tokens.item.text, options);
    }

    get leadingTrivia(): Token[] {
        return this.tokens.forEach?.leadingTrivia ?? [];
    }

    public get endTrivia(): Token[] {
        return this.tokens.endFor?.leadingTrivia ?? [];
    }

    public clone() {
        return this.finalizeClone(
            new ForEachStatement({
                forEach: util.cloneToken(this.tokens.forEach),
                in: util.cloneToken(this.tokens.in),
                endFor: util.cloneToken(this.tokens.endFor),
                item: util.cloneToken(this.tokens.item),
                target: this.target?.clone(),
                body: this.body?.clone()
            }),
            ['target', 'body']
        );
    }
}

export class WhileStatement extends Statement {
    constructor(options: {
        while?: Token;
        endWhile?: Token;
        condition: Expression;
        body: Block;
    }) {
        super();
        this.tokens = {
            while: options.while,
            endWhile: options.endWhile
        };
        this.body = options.body;
        this.condition = options.condition;
        this.location = util.createBoundingLocation(
            this.tokens.while,
            this.condition,
            this.body,
            this.tokens.endWhile
        );
    }

    public readonly tokens: {
        readonly while?: Token;
        readonly endWhile?: Token;
    };
    public readonly condition: Expression;
    public readonly body: Block;

    public readonly kind = AstNodeKind.WhileStatement;

    public readonly location: Location | undefined;

    transpile(state: BrsTranspileState) {
        let result = [] as TranspileResult;
        //while
        result.push(
            state.transpileToken(this.tokens.while, 'while'),
            ' '
        );
        //condition
        result.push(
            ...this.condition.transpile(state)
        );
        state.lineage.unshift(this);
        //body
        result.push(...this.body.transpile(state));
        state.lineage.shift();

        //end while
        result.push(...state.transpileEndBlockToken(this.body, this.tokens.endWhile, 'end while'));

        return result;
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'condition', visitor, options);
        }
        if (options.walkMode & InternalWalkMode.walkStatements) {
            walk(this, 'body', visitor, options);
        }
    }

    get leadingTrivia(): Token[] {
        return this.tokens.while?.leadingTrivia ?? [];
    }

    public get endTrivia(): Token[] {
        return this.tokens.endWhile?.leadingTrivia ?? [];
    }

    public clone() {
        return this.finalizeClone(
            new WhileStatement({
                while: util.cloneToken(this.tokens.while),
                endWhile: util.cloneToken(this.tokens.endWhile),
                condition: this.condition?.clone(),
                body: this.body?.clone()
            }),
            ['condition', 'body']
        );
    }
}

export class DottedSetStatement extends Statement {
    constructor(options: {
        obj: Expression;
        name: Identifier;
        value: Expression;
        dot?: Token;
        equals?: Token;
    }) {
        super();
        this.tokens = {
            name: options.name,
            dot: options.dot,
            equals: options.equals
        };
        this.obj = options.obj;
        this.value = options.value;
        this.location = util.createBoundingLocation(
            this.obj,
            this.tokens.dot,
            this.tokens.equals,
            this.tokens.name,
            this.value
        );
    }
    public readonly tokens: {
        readonly name: Identifier;
        readonly equals?: Token;
        readonly dot?: Token;
    };

    public readonly obj: Expression;
    public readonly value: Expression;

    public readonly kind = AstNodeKind.DottedSetStatement;

    public readonly location: Location | undefined;

    transpile(state: BrsTranspileState) {
        //if the value is a compound assignment, don't add the obj, dot, name, or operator...the expression will handle that
        return [
            //object
            ...this.obj.transpile(state),
            this.tokens.dot ? state.tokenToSourceNode(this.tokens.dot) : '.',
            //name
            state.transpileToken(this.tokens.name),
            ' ',
            state.transpileToken(this.tokens.equals, '='),
            ' ',
            //right-hand-side of assignment
            ...this.value.transpile(state)
        ];

    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'obj', visitor, options);
            walk(this, 'value', visitor, options);
        }
    }

    getType(options: GetTypeOptions) {
        const objType = this.obj?.getType(options);
        const result = objType?.getMemberType(this.tokens.name?.text, options);
        options.typeChain?.push(new TypeChainEntry({
            name: this.tokens.name?.text,
            type: result, data: options.data,
            location: this.tokens.name?.location,
            astNode: this
        }));
        return result;
    }

    get leadingTrivia(): Token[] {
        return this.obj.leadingTrivia;
    }

    public clone() {
        return this.finalizeClone(
            new DottedSetStatement({
                obj: this.obj?.clone(),
                dot: util.cloneToken(this.tokens.dot),
                name: util.cloneToken(this.tokens.name),
                equals: util.cloneToken(this.tokens.equals),
                value: this.value?.clone()
            }),
            ['obj', 'value']
        );
    }
}

export class IndexedSetStatement extends Statement {
    constructor(options: {
        obj: Expression;
        indexes: Expression[];
        value: Expression;
        openingSquare?: Token;
        closingSquare?: Token;
        equals?: Token;
    }) {
        super();
        this.tokens = {
            openingSquare: options.openingSquare,
            closingSquare: options.closingSquare,
            equals: options.equals
        };
        this.obj = options.obj;
        this.indexes = options.indexes ?? [];
        this.value = options.value;
        this.location = util.createBoundingLocation(
            this.obj,
            this.tokens.openingSquare,
            ...this.indexes,
            this.tokens.closingSquare,
            this.value
        );
    }

    public readonly tokens: {
        readonly openingSquare?: Token;
        readonly closingSquare?: Token;
        readonly equals?: Token;
    };
    public readonly obj: Expression;
    public readonly indexes: Expression[];
    public readonly value: Expression;

    public readonly kind = AstNodeKind.IndexedSetStatement;

    public readonly location: Location | undefined;

    transpile(state: BrsTranspileState) {
        const result = [];
        result.push(
            //obj
            ...this.obj.transpile(state),
            //   [
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
            state.transpileToken(this.tokens.closingSquare, ']'),
            ' ',
            state.transpileToken(this.tokens.equals, '='),
            ' ',
            ...this.value.transpile(state)
        );
        return result;

    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'obj', visitor, options);
            walkArray(this.indexes, visitor, options, this);
            walk(this, 'value', visitor, options);
        }
    }

    get leadingTrivia(): Token[] {
        return this.obj.leadingTrivia;
    }

    public clone() {
        return this.finalizeClone(
            new IndexedSetStatement({
                obj: this.obj?.clone(),
                openingSquare: util.cloneToken(this.tokens.openingSquare),
                indexes: this.indexes?.map(x => x?.clone()),
                closingSquare: util.cloneToken(this.tokens.closingSquare),
                equals: util.cloneToken(this.tokens.equals),
                value: this.value?.clone()
            }),
            ['obj', 'indexes', 'value']
        );
    }
}

export class LibraryStatement extends Statement implements TypedefProvider {
    constructor(options: {
        library: Token;
        filePath?: Token;
    }) {
        super();
        this.tokens = {
            library: options?.library,
            filePath: options?.filePath
        };
        this.location = util.createBoundingLocation(
            this.tokens.library,
            this.tokens.filePath
        );
    }
    public readonly tokens: {
        readonly library: Token;
        readonly filePath?: Token;
    };

    public readonly kind = AstNodeKind.LibraryStatement;

    public readonly location: Location | undefined;

    transpile(state: BrsTranspileState) {
        let result = [] as TranspileResult;
        result.push(
            state.transpileToken(this.tokens.library)
        );
        //there will be a parse error if file path is missing, but let's prevent a runtime error just in case
        if (this.tokens.filePath) {
            result.push(
                ' ',
                state.transpileToken(this.tokens.filePath)
            );
        }
        return result;
    }

    getTypedef(state: BrsTranspileState) {
        return this.transpile(state);
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        //nothing to walk
    }

    get leadingTrivia(): Token[] {
        return this.tokens.library?.leadingTrivia ?? [];
    }

    public clone() {
        return this.finalizeClone(
            new LibraryStatement({
                library: util.cloneToken(this.tokens?.library),
                filePath: util.cloneToken(this.tokens?.filePath)
            })
        );
    }
}

export class NamespaceStatement extends Statement implements TypedefProvider {
    constructor(options: {
        namespace?: Token;
        nameExpression: VariableExpression | DottedGetExpression;
        body: Body;
        endNamespace?: Token;
    }) {
        super();
        this.tokens = {
            namespace: options.namespace,
            endNamespace: options.endNamespace
        };
        this.nameExpression = options.nameExpression;
        this.body = options.body;
        this.symbolTable = new SymbolTable(`NamespaceStatement: '${this.name}'`, () => this.getRoot()?.getSymbolTable());
    }

    public readonly tokens: {
        readonly namespace?: Token;
        readonly endNamespace?: Token;
    };

    public readonly nameExpression: VariableExpression | DottedGetExpression;
    public readonly body: Body;

    public readonly kind = AstNodeKind.NamespaceStatement;

    /**
     * The string name for this namespace
     */
    public get name(): string {
        return this.getName(ParseMode.BrighterScript);
    }

    public get location() {
        return this.cacheLocation();
    }
    private _location: Location | undefined;

    public cacheLocation() {
        if (!this._location) {
            this._location = util.createBoundingLocation(
                this.tokens.namespace,
                this.nameExpression,
                this.body,
                this.tokens.endNamespace
            );
        }
        return this._location;
    }

    public getName(parseMode: ParseMode) {
        const sep = parseMode === ParseMode.BrighterScript ? '.' : '_';
        let name = util.getAllDottedGetPartsAsString(this.nameExpression, parseMode);
        if ((this.parent as Body)?.parent?.kind === AstNodeKind.NamespaceStatement) {
            name = (this.parent.parent as NamespaceStatement).getName(parseMode) + sep + name;
        }
        return name;
    }

    public get leadingTrivia(): Token[] {
        return this.tokens.namespace?.leadingTrivia;
    }

    public get endTrivia(): Token[] {
        return this.tokens.endNamespace?.leadingTrivia;
    }

    public getNameParts() {
        let parts = util.getAllDottedGetParts(this.nameExpression);

        if ((this.parent as Body)?.parent?.kind === AstNodeKind.NamespaceStatement) {
            parts = (this.parent.parent as NamespaceStatement).getNameParts().concat(parts);
        }
        return parts;
    }

    transpile(state: BrsTranspileState) {
        //namespaces don't actually have any real content, so just transpile their bodies
        return [
            state.transpileAnnotations(this),
            state.transpileLeadingComments(this.tokens.namespace),
            this.body.transpile(state),
            state.transpileLeadingComments(this.tokens.endNamespace)
        ];
    }

    getTypedef(state: BrsTranspileState) {
        let result: TranspileResult = [];
        for (let comment of util.getLeadingComments(this) ?? []) {
            result.push(
                comment.text,
                state.newline,
                state.indent()
            );
        }

        result.push('namespace ',
            ...this.getName(ParseMode.BrighterScript),
            state.newline
        );
        state.blockDepth++;
        result.push(
            ...this.body.getTypedef(state)
        );
        state.blockDepth--;

        result.push(
            state.indent(),
            'end namespace'
        );
        return result;
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'nameExpression', visitor, options);
        }

        if (this.body.statements.length > 0 && options.walkMode & InternalWalkMode.walkStatements) {
            walk(this, 'body', visitor, options);
        }
    }

    getType(options: GetTypeOptions) {
        const resultType = new NamespaceType(this.name);
        return resultType;
    }

    public clone() {
        const clone = this.finalizeClone(
            new NamespaceStatement({
                namespace: util.cloneToken(this.tokens.namespace),
                nameExpression: this.nameExpression?.clone(),
                body: this.body?.clone(),
                endNamespace: util.cloneToken(this.tokens.endNamespace)
            }),
            ['nameExpression', 'body']
        );
        clone.cacheLocation();
        return clone;
    }
}

export class ImportStatement extends Statement implements TypedefProvider {
    constructor(options: {
        import?: Token;
        path?: Token;
    }) {
        super();
        this.tokens = {
            import: options.import,
            path: options.path
        };
        this.location = util.createBoundingLocation(
            this.tokens.import,
            this.tokens.path
        );
        if (this.tokens.path) {
            //remove quotes
            this.filePath = this.tokens.path.text.replace(/"/g, '');
            if (this.tokens.path?.location?.range) {
                //adjust the range to exclude the quotes
                this.tokens.path.location = util.createLocation(
                    this.tokens.path.location.range.start.line,
                    this.tokens.path.location.range.start.character + 1,
                    this.tokens.path.location.range.end.line,
                    this.tokens.path.location.range.end.character - 1,
                    this.tokens.path.location.uri
                );
            }
        }
    }

    public readonly tokens: {
        readonly import?: Token;
        readonly path: Token;
    };

    public readonly kind = AstNodeKind.ImportStatement;

    public readonly location: Location;

    public readonly filePath: string;

    transpile(state: BrsTranspileState) {
        //The xml files are responsible for adding the additional script imports, but
        //add the import statement as a comment just for debugging purposes
        return [
            state.transpileToken(this.tokens.import, 'import', true),
            ' ',
            state.transpileToken(this.tokens.path)
        ];
    }

    /**
     * Get the typedef for this statement
     */
    public getTypedef(state: BrsTranspileState) {
        return [
            this.tokens.import?.text ?? 'import',
            ' ',
            //replace any `.bs` extension with `.brs`
            this.tokens.path.text.replace(/\.bs"?$/i, '.brs"')
        ];
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        //nothing to walk
    }

    get leadingTrivia(): Token[] {
        return this.tokens.import?.leadingTrivia ?? [];
    }

    public clone() {
        return this.finalizeClone(
            new ImportStatement({
                import: util.cloneToken(this.tokens.import),
                path: util.cloneToken(this.tokens.path)
            })
        );
    }
}

export class InterfaceStatement extends Statement implements TypedefProvider {
    constructor(options: {
        interface: Token;
        name: Identifier;
        extends?: Token;
        parentInterfaceName?: TypeExpression;
        body: Statement[];
        endInterface?: Token;
    }) {
        super();
        this.tokens = {
            interface: options.interface,
            name: options.name,
            extends: options.extends,
            endInterface: options.endInterface
        };
        this.parentInterfaceName = options.parentInterfaceName;
        this.body = options.body;
        this.location = util.createBoundingLocation(
            this.tokens.interface,
            this.tokens.name,
            this.tokens.extends,
            this.parentInterfaceName,
            ...this.body ?? [],
            this.tokens.endInterface
        );
    }
    public readonly parentInterfaceName?: TypeExpression;
    public readonly body: Statement[];

    public readonly kind = AstNodeKind.InterfaceStatement;

    public readonly tokens = {} as {
        readonly interface?: Token;
        readonly name: Identifier;
        readonly extends?: Token;
        readonly endInterface?: Token;
    };

    public readonly location: Location | undefined;

    public get fields(): InterfaceFieldStatement[] {
        return this.body.filter(x => isInterfaceFieldStatement(x)) as InterfaceFieldStatement[];
    }

    public get methods(): InterfaceMethodStatement[] {
        return this.body.filter(x => isInterfaceMethodStatement(x)) as InterfaceMethodStatement[];
    }


    public hasParentInterface() {
        return !!this.parentInterfaceName;
    }

    public get leadingTrivia(): Token[] {
        return this.tokens.interface?.leadingTrivia;
    }

    public get endTrivia(): Token[] {
        return this.tokens.endInterface?.leadingTrivia;
    }


    /**
     * The name of the interface WITH its leading namespace (if applicable)
     */
    public get fullName() {
        const name = this.tokens.name?.text;
        if (name) {
            const namespace = this.findAncestor<NamespaceStatement>(isNamespaceStatement);
            if (namespace) {
                let namespaceName = namespace.getName(ParseMode.BrighterScript);
                return `${namespaceName}.${name}`;
            } else {
                return name;
            }
        } else {
            //return undefined which will allow outside callers to know that this interface doesn't have a name
            return undefined;
        }
    }

    /**
     * The name of the interface (without the namespace prefix)
     */
    public get name() {
        return this.tokens.name?.text;
    }

    /**
     * Get the name of this expression based on the parse mode
     */
    public getName(parseMode: ParseMode) {
        const namespace = this.findAncestor<NamespaceStatement>(isNamespaceStatement);
        if (namespace) {
            let delimiter = parseMode === ParseMode.BrighterScript ? '.' : '_';
            let namespaceName = namespace.getName(parseMode);
            return namespaceName + delimiter + this.name;
        } else {
            return this.name;
        }
    }

    public transpile(state: BrsTranspileState): TranspileResult {
        //interfaces should completely disappear at runtime
        return [
            state.transpileLeadingComments(this.tokens.interface)
        ];
    }

    getTypedef(state: BrsTranspileState) {
        const result = [] as TranspileResult;
        for (let comment of util.getLeadingComments(this) ?? []) {
            result.push(
                comment.text,
                state.newline,
                state.indent()
            );
        }
        for (let annotation of this.annotations ?? []) {
            result.push(
                ...annotation.getTypedef(state),
                state.newline,
                state.indent()
            );
        }
        result.push(
            this.tokens.interface.text,
            ' ',
            this.tokens.name.text
        );
        const parentInterfaceName = this.parentInterfaceName?.getName();
        if (parentInterfaceName) {
            result.push(
                ' extends ',
                parentInterfaceName
            );
        }
        const body = this.body ?? [];
        if (body.length > 0) {
            state.blockDepth++;
        }
        for (const statement of body) {
            if (isInterfaceMethodStatement(statement) || isInterfaceFieldStatement(statement)) {
                result.push(
                    state.newline,
                    state.indent(),
                    ...statement.getTypedef(state)
                );
            } else {
                result.push(
                    state.newline,
                    state.indent(),
                    ...statement.transpile(state)
                );
            }
        }
        if (body.length > 0) {
            state.blockDepth--;
        }
        result.push(
            state.newline,
            state.indent(),
            'end interface',
            state.newline
        );
        return result;
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        //visitor-less walk function to do parent linking
        walk(this, 'parentInterfaceName', null, options);

        if (options.walkMode & InternalWalkMode.walkStatements) {
            walkArray(this.body, visitor, options, this);
        }
    }

    getType(options: GetTypeOptions) {
        const superIface = this.parentInterfaceName?.getType(options) as InterfaceType;

        const resultType = new InterfaceType(this.getName(ParseMode.BrighterScript), superIface);
        for (const statement of this.methods) {
            const memberType = statement?.getType({ ...options, typeChain: undefined }); // no typechain info needed
            const flag = statement.isOptional ? SymbolTypeFlag.runtime | SymbolTypeFlag.optional : SymbolTypeFlag.runtime;
            resultType.addMember(statement?.tokens.name?.text, { definingNode: statement }, memberType, flag);
        }
        for (const statement of this.fields) {
            const memberType = statement?.getType({ ...options, typeChain: undefined }); // no typechain info needed
            const flag = statement.isOptional ? SymbolTypeFlag.runtime | SymbolTypeFlag.optional : SymbolTypeFlag.runtime;
            resultType.addMember(statement?.tokens.name?.text, { definingNode: statement, isInstance: true }, memberType, flag);
        }
        options.typeChain?.push(new TypeChainEntry({
            name: this.getName(ParseMode.BrighterScript),
            type: resultType,
            data: options.data,
            astNode: this
        }));
        return resultType;
    }

    public clone() {
        return this.finalizeClone(
            new InterfaceStatement({
                interface: util.cloneToken(this.tokens.interface),
                name: util.cloneToken(this.tokens.name),
                extends: util.cloneToken(this.tokens.extends),
                parentInterfaceName: this.parentInterfaceName?.clone(),
                body: this.body?.map(x => x?.clone()),
                endInterface: util.cloneToken(this.tokens.endInterface)
            }),
            ['parentInterfaceName', 'body']
        );
    }
}

export class InterfaceFieldStatement extends Statement implements TypedefProvider {
    public transpile(state: BrsTranspileState): TranspileResult {
        throw new Error('Method not implemented.');
    }
    constructor(options: {
        name: Identifier;
        as?: Token;
        typeExpression?: TypeExpression;
        optional?: Token;
    }) {
        super();
        this.tokens = {
            optional: options.optional,
            name: options.name,
            as: options.as
        };
        this.typeExpression = options.typeExpression;
        this.location = util.createBoundingLocation(
            this.tokens.optional,
            this.tokens.name,
            this.tokens.as,
            this.typeExpression
        );
    }

    public readonly kind = AstNodeKind.InterfaceFieldStatement;

    public readonly typeExpression?: TypeExpression;

    public readonly location: Location | undefined;

    public readonly tokens: {
        readonly name: Identifier;
        readonly as: Token;
        readonly optional?: Token;
    };

    public get leadingTrivia(): Token[] {
        return this.tokens.optional?.leadingTrivia ?? this.tokens.name.leadingTrivia;
    }

    public get name() {
        return this.tokens.name.text;
    }

    public get isOptional() {
        return !!this.tokens.optional;
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'typeExpression', visitor, options);
        }
    }

    getTypedef(state: BrsTranspileState): TranspileResult {
        const result = [] as TranspileResult;
        for (let comment of util.getLeadingComments(this) ?? []) {
            result.push(
                comment.text,
                state.newline,
                state.indent()
            );
        }
        for (let annotation of this.annotations ?? []) {
            result.push(
                ...annotation.getTypedef(state),
                state.newline,
                state.indent()
            );
        }
        if (this.isOptional) {
            result.push(
                this.tokens.optional!.text,
                ' '
            );
        }
        result.push(
            this.tokens.name.text
        );

        if (this.typeExpression) {
            result.push(
                ' as ',
                ...this.typeExpression.getTypedef(state)
            );
        }
        return result;
    }

    public getType(options: GetTypeOptions): BscType {
        return this.typeExpression?.getType(options) ?? DynamicType.instance;
    }

    public clone() {
        return this.finalizeClone(
            new InterfaceFieldStatement({
                name: util.cloneToken(this.tokens.name),
                as: util.cloneToken(this.tokens.as),
                typeExpression: this.typeExpression?.clone(),
                optional: util.cloneToken(this.tokens.optional)
            })
        );
    }

}

//TODO: there is much that is similar with this and FunctionExpression.
//It would be nice to refactor this so there is less duplicated code
export class InterfaceMethodStatement extends Statement implements TypedefProvider {
    public transpile(state: BrsTranspileState): TranspileResult {
        throw new Error('Method not implemented.');
    }
    constructor(options: {
        functionType?: Token;
        name: Identifier;
        leftParen?: Token;
        params?: FunctionParameterExpression[];
        rightParen?: Token;
        as?: Token;
        returnTypeExpression?: TypeExpression;
        optional?: Token;
    }) {
        super();
        this.tokens = {
            optional: options.optional,
            functionType: options.functionType,
            name: options.name,
            leftParen: options.leftParen,
            rightParen: options.rightParen,
            as: options.as
        };
        this.params = options.params ?? [];
        this.returnTypeExpression = options.returnTypeExpression;
    }

    public readonly kind = AstNodeKind.InterfaceMethodStatement;

    public get location() {
        return util.createBoundingLocation(
            this.tokens.optional,
            this.tokens.functionType,
            this.tokens.name,
            this.tokens.leftParen,
            ...(this.params ?? []),
            this.tokens.rightParen,
            this.tokens.as,
            this.returnTypeExpression
        );
    }
    /**
     * Get the name of this method.
     */
    public getName(parseMode: ParseMode) {
        return this.tokens.name.text;
    }

    public readonly tokens: {
        readonly optional?: Token;
        readonly functionType: Token;
        readonly name: Identifier;
        readonly leftParen?: Token;
        readonly rightParen?: Token;
        readonly as?: Token;
    };

    public readonly params: FunctionParameterExpression[];
    public readonly returnTypeExpression?: TypeExpression;

    public get isOptional() {
        return !!this.tokens.optional;
    }

    public get leadingTrivia(): Token[] {
        return this.tokens.optional?.leadingTrivia ?? this.tokens.functionType.leadingTrivia;
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'returnTypeExpression', visitor, options);
        }
    }

    getTypedef(state: BrsTranspileState) {
        const result = [] as TranspileResult;
        for (let comment of util.getLeadingComments(this) ?? []) {
            result.push(
                comment.text,
                state.newline,
                state.indent()
            );
        }
        for (let annotation of this.annotations ?? []) {
            result.push(
                ...annotation.getTypedef(state),
                state.newline,
                state.indent()
            );
        }
        if (this.isOptional) {
            result.push(
                this.tokens.optional!.text,
                ' '
            );
        }
        result.push(
            this.tokens.functionType?.text ?? 'function',
            ' ',
            this.tokens.name.text,
            '('
        );
        const params = this.params ?? [];
        for (let i = 0; i < params.length; i++) {
            if (i > 0) {
                result.push(', ');
            }
            const param = params[i];
            result.push(param.tokens.name.text);
            if (param.typeExpression) {
                result.push(
                    ' as ',
                    ...param.typeExpression.getTypedef(state)
                );
            }
        }
        result.push(
            ')'
        );
        if (this.returnTypeExpression) {
            result.push(
                ' as ',
                ...this.returnTypeExpression.getTypedef(state)
            );
        }
        return result;
    }

    public getType(options: GetTypeOptions): TypedFunctionType {
        //if there's a defined return type, use that
        let returnType = this.returnTypeExpression?.getType(options);
        const isSub = this.tokens.functionType?.kind === TokenKind.Sub || !returnType;
        //if we don't have a return type and this is a sub, set the return type to `void`. else use `dynamic`
        if (!returnType) {
            returnType = isSub ? VoidType.instance : DynamicType.instance;
        }

        const resultType = new TypedFunctionType(returnType);
        resultType.isSub = isSub;
        for (let param of this.params) {
            resultType.addParameter(param.tokens.name.text, param.getType(options), !!param.defaultValue);
        }
        if (options.typeChain) {
            // need Interface type for type chain
            this.parent?.getType(options);
        }
        let funcName = this.getName(ParseMode.BrighterScript);
        resultType.setName(funcName);
        options.typeChain?.push(new TypeChainEntry({ name: resultType.name, type: resultType, data: options.data, astNode: this }));
        return resultType;
    }

    public clone() {
        return this.finalizeClone(
            new InterfaceMethodStatement({
                optional: util.cloneToken(this.tokens.optional),
                functionType: util.cloneToken(this.tokens.functionType),
                name: util.cloneToken(this.tokens.name),
                leftParen: util.cloneToken(this.tokens.leftParen),
                params: this.params?.map(p => p?.clone()),
                rightParen: util.cloneToken(this.tokens.rightParen),
                as: util.cloneToken(this.tokens.as),
                returnTypeExpression: this.returnTypeExpression?.clone()
            }),
            ['params']
        );
    }
}

export class ClassStatement extends Statement implements TypedefProvider {
    constructor(options: {
        class?: Token;
        /**
         * The name of the class (without namespace prefix)
         */
        name: Identifier;
        body: Statement[];
        endClass?: Token;
        extends?: Token;
        parentClassName?: TypeExpression;
    }) {
        super();
        this.body = options.body ?? [];
        this.tokens = {
            name: options.name,
            class: options.class,
            endClass: options.endClass,
            extends: options.extends
        };
        this.parentClassName = options.parentClassName;
        this.symbolTable = new SymbolTable(`ClassStatement: '${this.tokens.name?.text}'`, () => this.parent?.getSymbolTable());

        for (let statement of this.body) {
            if (isMethodStatement(statement)) {
                this.methods.push(statement);
                this.memberMap[statement?.tokens.name?.text.toLowerCase()] = statement;
            } else if (isFieldStatement(statement)) {
                this.fields.push(statement);
                this.memberMap[statement?.tokens.name?.text.toLowerCase()] = statement;
            }
        }

        this.location = util.createBoundingLocation(
            this.parentClassName,
            ...(this.body ?? []),
            util.createBoundingLocationFromTokens(this.tokens)
        );
    }

    public readonly kind = AstNodeKind.ClassStatement;


    public readonly tokens: {
        readonly class?: Token;
        /**
         * The name of the class (without namespace prefix)
         */
        readonly name: Identifier;
        readonly endClass?: Token;
        readonly extends?: Token;
    };
    public readonly body: Statement[];
    public readonly parentClassName: TypeExpression;


    public getName(parseMode: ParseMode) {
        const name = this.tokens.name?.text;
        if (name) {
            const namespace = this.findAncestor<NamespaceStatement>(isNamespaceStatement);
            if (namespace) {
                let namespaceName = namespace.getName(parseMode);
                let separator = parseMode === ParseMode.BrighterScript ? '.' : '_';
                return namespaceName + separator + name;
            } else {
                return name;
            }
        } else {
            //return undefined which will allow outside callers to know that this class doesn't have a name
            return undefined;
        }
    }

    public get leadingTrivia(): Token[] {
        return this.tokens.class?.leadingTrivia;
    }

    public get endTrivia(): Token[] {
        return this.tokens.endClass?.leadingTrivia ?? [];
    }

    public readonly memberMap = {} as Record<string, MemberStatement>;
    public readonly methods = [] as MethodStatement[];
    public readonly fields = [] as FieldStatement[];

    public readonly location: Location | undefined;

    transpile(state: BrsTranspileState) {
        let result = [] as TranspileResult;
        //make the builder
        result.push(...this.getTranspiledBuilder(state));
        result.push(
            '\n',
            state.indent()
        );
        //make the class assembler (i.e. the public-facing class creator method)
        result.push(...this.getTranspiledClassFunction(state));
        return result;
    }

    getTypedef(state: BrsTranspileState) {
        const result = [] as TranspileResult;
        for (let comment of util.getLeadingComments(this) ?? []) {
            result.push(
                comment.text,
                state.newline,
                state.indent()
            );
        }
        for (let annotation of this.annotations ?? []) {
            result.push(
                ...annotation.getTypedef(state),
                state.newline,
                state.indent()
            );
        }
        result.push(
            'class ',
            this.tokens.name.text
        );
        if (this.parentClassName) {
            const namespace = this.findAncestor<NamespaceStatement>(isNamespaceStatement);
            const fqName = util.getFullyQualifiedClassName(
                this.parentClassName.getName(),
                namespace?.getName(ParseMode.BrighterScript)
            );
            result.push(
                ` extends ${fqName}`
            );
        }
        result.push(state.newline);
        state.blockDepth++;

        let body = this.body;
        //inject an empty "new" method if missing
        if (!this.getConstructorFunction()) {
            const constructor = createMethodStatement('new', TokenKind.Sub);
            constructor.parent = this;
            //walk the constructor to set up parent links
            constructor.link();
            body = [
                constructor,
                ...this.body
            ];
        }

        for (const member of body) {
            if (isTypedefProvider(member)) {
                result.push(
                    state.indent(),
                    ...member.getTypedef(state),
                    state.newline
                );
            }
        }
        state.blockDepth--;
        result.push(
            state.indent(),
            'end class'
        );
        return result;
    }

    /**
     * Find the parent index for this class's parent.
     * For class inheritance, every class is given an index.
     * The base class is index 0, its child is index 1, and so on.
     */
    public getParentClassIndex(state: BrsTranspileState) {
        let myIndex = 0;
        let stmt = this as ClassStatement;
        while (stmt) {
            if (stmt.parentClassName) {
                const namespace = stmt.findAncestor<NamespaceStatement>(isNamespaceStatement);
                //find the parent class
                stmt = state.file.getClassFileLink(
                    stmt.parentClassName.getName(),
                    namespace?.getName(ParseMode.BrighterScript)
                )?.item;
                myIndex++;
            } else {
                break;
            }
        }
        const result = myIndex - 1;
        if (result >= 0) {
            return result;
        } else {
            return null;
        }
    }

    public hasParentClass() {
        return !!this.parentClassName;
    }

    /**
     * Get all ancestor classes, in closest-to-furthest order (i.e. 0 is parent, 1 is grandparent, etc...).
     * This will return an empty array if no ancestors were found
     */
    public getAncestors(state: BrsTranspileState) {
        let ancestors = [] as ClassStatement[];
        let stmt = this as ClassStatement;
        while (stmt) {
            if (stmt.parentClassName) {
                const namespace = this.findAncestor<NamespaceStatement>(isNamespaceStatement);
                stmt = state.file.getClassFileLink(
                    stmt.parentClassName.getName(),
                    namespace?.getName(ParseMode.BrighterScript)
                )?.item;
                ancestors.push(stmt);
            } else {
                break;
            }
        }
        return ancestors;
    }

    private getBuilderName(name: string) {
        if (name.includes('.')) {
            name = name.replace(/\./gi, '_');
        }
        return `__${name}_builder`;
    }

    public getConstructorType() {
        const constructorType = this.getConstructorFunction()?.getType({ flags: SymbolTypeFlag.runtime }) ?? new TypedFunctionType(null);
        constructorType.returnType = this.getType({ flags: SymbolTypeFlag.runtime });
        return constructorType;
    }

    /**
     * Get the constructor function for this class (if exists), or undefined if not exist
     */
    private getConstructorFunction() {
        return this.body.find((stmt) => {
            return (stmt as MethodStatement)?.tokens.name?.text?.toLowerCase() === 'new';
        }) as MethodStatement;
    }

    /**
     * Determine if the specified field was declared in one of the ancestor classes
     */
    public isFieldDeclaredByAncestor(fieldName: string, ancestors: ClassStatement[]) {
        let lowerFieldName = fieldName.toLowerCase();
        for (let ancestor of ancestors) {
            if (ancestor.memberMap[lowerFieldName]) {
                return true;
            }
        }
        return false;
    }

    /**
     * The builder is a function that assigns all of the methods and property names to a class instance.
     * This needs to be a separate function so that child classes can call the builder from their parent
     * without instantiating the parent constructor at that point in time.
     */
    private getTranspiledBuilder(state: BrsTranspileState) {
        let result = [] as TranspileResult;
        result.push(`function ${this.getBuilderName(this.getName(ParseMode.BrightScript)!)}()\n`);
        state.blockDepth++;
        //indent
        result.push(state.indent());

        /**
         * The lineage of this class. index 0 is a direct parent, index 1 is index 0's parent, etc...
         */
        let ancestors = this.getAncestors(state);

        //construct parent class or empty object
        if (ancestors[0]) {
            const ancestorNamespace = ancestors[0].findAncestor<NamespaceStatement>(isNamespaceStatement);
            let fullyQualifiedClassName = util.getFullyQualifiedClassName(
                ancestors[0].getName(ParseMode.BrighterScript)!,
                ancestorNamespace?.getName(ParseMode.BrighterScript)
            );
            result.push(
                'instance = ',
                this.getBuilderName(fullyQualifiedClassName), '()');
        } else {
            //use an empty object.
            result.push('instance = {}');
        }
        result.push(
            state.newline,
            state.indent()
        );
        let parentClassIndex = this.getParentClassIndex(state);

        let body = this.body;
        //inject an empty "new" method if missing
        if (!this.getConstructorFunction()) {
            body = [
                createMethodStatement('new', TokenKind.Sub),
                ...this.body
            ];
        }

        for (let statement of body) {
            //is field statement
            if (isFieldStatement(statement)) {
                //do nothing with class fields in this situation, they are handled elsewhere
                continue;

                //methods
            } else if (isMethodStatement(statement)) {

                //store overridden parent methods as super{parentIndex}_{methodName}
                if (
                    //is override method
                    statement.tokens.override ||
                    //is constructor function in child class
                    (statement.tokens.name.text.toLowerCase() === 'new' && ancestors[0])
                ) {
                    result.push(
                        `instance.super${parentClassIndex}_${statement.tokens.name.text} = instance.${statement.tokens.name.text}`,
                        state.newline,
                        state.indent()
                    );
                }

                state.classStatement = this;
                state.skipLeadingComments = true;
                //add leading comments
                if (statement.leadingTrivia.filter(token => token.kind === TokenKind.Comment).length > 0) {
                    result.push(
                        ...state.transpileComments(statement.leadingTrivia),
                        state.indent()
                    );
                }
                result.push(
                    'instance.',
                    state.transpileToken(statement.tokens.name),
                    ' = ',
                    ...statement.transpile(state),
                    state.newline,
                    state.indent()
                );
                state.skipLeadingComments = false;
                delete state.classStatement;
            } else {
                //other random statements (probably just comments)
                result.push(
                    ...statement.transpile(state),
                    state.newline,
                    state.indent()
                );
            }
        }
        //return the instance
        result.push('return instance\n');
        state.blockDepth--;
        result.push(state.indent());
        result.push(`end function`);
        return result;
    }

    /**
     * The class function is the function with the same name as the class. This is the function that
     * consumers should call to create a new instance of that class.
     * This invokes the builder, gets an instance of the class, then invokes the "new" function on that class.
     */
    private getTranspiledClassFunction(state: BrsTranspileState) {
        let result: TranspileResult = state.transpileAnnotations(this);
        const constructorFunction = this.getConstructorFunction();
        const constructorParams = constructorFunction ? constructorFunction.func.parameters : [];

        result.push(
            state.transpileLeadingComments(this.tokens.class),
            state.sourceNode(this.tokens.class, 'function'),
            state.sourceNode(this.tokens.class, ' '),
            state.sourceNode(this.tokens.name, this.getName(ParseMode.BrightScript)),
            `(`
        );
        let i = 0;
        for (let param of constructorParams) {
            if (i > 0) {
                result.push(', ');
            }
            result.push(
                param.transpile(state)
            );
            i++;
        }
        result.push(
            ')',
            '\n'
        );

        state.blockDepth++;
        result.push(state.indent());
        result.push(`instance = ${this.getBuilderName(this.getName(ParseMode.BrightScript)!)}()\n`);

        result.push(state.indent());
        result.push(`instance.new(`);

        //append constructor arguments
        i = 0;
        for (let param of constructorParams) {
            if (i > 0) {
                result.push(', ');
            }
            result.push(
                state.transpileToken(param.tokens.name)
            );
            i++;
        }
        result.push(
            ')',
            '\n'
        );

        result.push(state.indent());
        result.push(`return instance\n`);

        state.blockDepth--;
        result.push(state.indent());
        result.push(`end function`);
        return result;
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        //visitor-less walk function to do parent linking
        walk(this, 'parentClassName', null, options);

        if (options.walkMode & InternalWalkMode.walkStatements) {
            walkArray(this.body, visitor, options, this);
        }
    }

    getType(options: GetTypeOptions) {
        const superClass = this.parentClassName?.getType(options) as ClassType;

        const resultType = new ClassType(this.getName(ParseMode.BrighterScript), superClass);

        for (const statement of this.methods) {
            const funcType = statement?.func.getType({ ...options, typeChain: undefined }); //no typechain needed
            let flag = SymbolTypeFlag.runtime;
            if (statement.accessModifier?.kind === TokenKind.Private) {
                flag |= SymbolTypeFlag.private;
            }
            if (statement.accessModifier?.kind === TokenKind.Protected) {
                flag |= SymbolTypeFlag.protected;
            }
            resultType.addMember(statement?.tokens.name?.text, { definingNode: statement }, funcType, flag);
        }
        for (const statement of this.fields) {
            const fieldType = statement.getType({ ...options, typeChain: undefined }); //no typechain needed
            let flag = SymbolTypeFlag.runtime;
            if (statement.isOptional) {
                flag |= SymbolTypeFlag.optional;
            }
            if (statement.tokens.accessModifier?.kind === TokenKind.Private) {
                flag |= SymbolTypeFlag.private;
            }
            if (statement.tokens.accessModifier?.kind === TokenKind.Protected) {
                flag |= SymbolTypeFlag.protected;
            }
            resultType.addMember(statement?.tokens.name?.text, { definingNode: statement, isInstance: true }, fieldType, flag);
        }
        options.typeChain?.push(new TypeChainEntry({ name: resultType.name, type: resultType, data: options.data, astNode: this }));
        return resultType;
    }

    public clone() {
        return this.finalizeClone(
            new ClassStatement({
                class: util.cloneToken(this.tokens.class),
                name: util.cloneToken(this.tokens.name),
                body: this.body?.map(x => x?.clone()),
                endClass: util.cloneToken(this.tokens.endClass),
                extends: util.cloneToken(this.tokens.extends),
                parentClassName: this.parentClassName?.clone()
            }),
            ['body', 'parentClassName']
        );
    }
}

const accessModifiers = [
    TokenKind.Public,
    TokenKind.Protected,
    TokenKind.Private
];
export class MethodStatement extends FunctionStatement {
    constructor(
        options: {
            modifiers?: Token | Token[];
            name: Identifier;
            func: FunctionExpression;
            override?: Token;
        }
    ) {
        super(options);
        if (options.modifiers) {
            if (Array.isArray(options.modifiers)) {
                this.modifiers.push(...options.modifiers);
            } else {
                this.modifiers.push(options.modifiers);
            }
        }
        this.tokens = {
            ...this.tokens,
            override: options.override
        };
        this.location = util.createBoundingLocation(
            ...(this.modifiers),
            util.createBoundingLocationFromTokens(this.tokens),
            this.func
        );
    }

    public readonly kind = AstNodeKind.MethodStatement as AstNodeKind;

    public readonly modifiers: Token[] = [];

    public readonly tokens: {
        readonly name: Identifier;
        readonly override?: Token;
    };

    public get accessModifier() {
        return this.modifiers.find(x => accessModifiers.includes(x.kind));
    }

    public readonly location: Location | undefined;

    /**
     * Get the name of this method.
     */
    public getName(parseMode: ParseMode) {
        return this.tokens.name.text;
    }

    public get leadingTrivia(): Token[] {
        return this.func.leadingTrivia;
    }

    transpile(state: BrsTranspileState) {
        if (this.tokens.name.text.toLowerCase() === 'new') {
            this.ensureSuperConstructorCall(state);
            //TODO we need to undo this at the bottom of this method
            this.injectFieldInitializersForConstructor(state);
        }
        //TODO - remove type information from these methods because that doesn't work
        //convert the `super` calls into the proper methods
        const parentClassIndex = state.classStatement.getParentClassIndex(state);
        const visitor = createVisitor({
            VariableExpression: e => {
                if (e.tokens.name.text.toLocaleLowerCase() === 'super') {
                    state.editor.setProperty(e.tokens.name, 'text', `m.super${parentClassIndex}_new`);
                }
            },
            DottedGetExpression: e => {
                const beginningVariable = util.findBeginningVariableExpression(e);
                const lowerName = beginningVariable?.getName(ParseMode.BrighterScript).toLowerCase();
                if (lowerName === 'super') {
                    state.editor.setProperty(beginningVariable.tokens.name, 'text', 'm');
                    state.editor.setProperty(e.tokens.name, 'text', `super${parentClassIndex}_${e.tokens.name.text}`);
                }
            }
        });
        const walkOptions: WalkOptions = { walkMode: WalkMode.visitExpressions };
        for (const statement of this.func.body.statements) {
            visitor(statement, undefined);
            statement.walk(visitor, walkOptions);
        }
        return this.func.transpile(state);
    }

    getTypedef(state: BrsTranspileState) {
        const result: TranspileResult = [];
        for (let comment of util.getLeadingComments(this) ?? []) {
            result.push(
                comment.text,
                state.newline,
                state.indent()
            );
        }
        for (let annotation of this.annotations ?? []) {
            result.push(
                ...annotation.getTypedef(state),
                state.newline,
                state.indent()
            );
        }
        if (this.accessModifier) {
            result.push(
                this.accessModifier.text,
                ' '
            );
        }
        if (this.tokens.override) {
            result.push('override ');
        }
        result.push(
            ...this.func.getTypedef(state)
        );
        return result;
    }

    /**
     * All child classes must call the parent constructor. The type checker will warn users when they don't call it in their own class,
     * but we still need to call it even if they have omitted it. This injects the super call if it's missing
     */
    private ensureSuperConstructorCall(state: BrsTranspileState) {
        //if this class doesn't extend another class, quit here
        if (state.classStatement!.getAncestors(state).length === 0) {
            return;
        }

        //check whether any calls to super exist
        let containsSuperCall =
            this.func.body.statements.findIndex((x) => {
                //is a call statement
                return isExpressionStatement(x) && isCallExpression(x.expression) &&
                    //is a call to super
                    util.findBeginningVariableExpression(x.expression.callee as any).tokens.name?.text.toLowerCase() === 'super';
            }) !== -1;

        //if a call to super exists, quit here
        if (containsSuperCall) {
            return;
        }

        //this is a child class, and the constructor doesn't contain a call to super. Inject one
        const superCall = new ExpressionStatement({
            expression: new CallExpression({
                callee: new VariableExpression({
                    name: {
                        kind: TokenKind.Identifier,
                        text: 'super',
                        isReserved: false,
                        location: state.classStatement.tokens.name.location,
                        leadingWhitespace: '',
                        leadingTrivia: []
                    }
                }),
                openingParen: {
                    kind: TokenKind.LeftParen,
                    text: '(',
                    isReserved: false,
                    location: state.classStatement.tokens.name.location,
                    leadingWhitespace: '',
                    leadingTrivia: []
                },
                closingParen: {
                    kind: TokenKind.RightParen,
                    text: ')',
                    isReserved: false,
                    location: state.classStatement.tokens.name.location,
                    leadingWhitespace: '',
                    leadingTrivia: []
                },
                args: []
            })
        });
        state.editor.arrayUnshift(this.func.body.statements, superCall);
    }

    /**
     * Inject field initializers at the top of the `new` function (after any present `super()` call)
     */
    private injectFieldInitializersForConstructor(state: BrsTranspileState) {
        let startingIndex = state.classStatement!.hasParentClass() ? 1 : 0;

        let newStatements = [] as Statement[];
        //insert the field initializers in order
        for (let field of state.classStatement!.fields) {
            let thisQualifiedName = { ...field.tokens.name };
            thisQualifiedName.text = 'm.' + field.tokens.name?.text;
            const fieldAssignment = field.initialValue
                ? new AssignmentStatement({
                    equals: field.tokens.equals,
                    name: thisQualifiedName,
                    value: field.initialValue
                })
                : new AssignmentStatement({
                    equals: createToken(TokenKind.Equal, '=', field.tokens.name.location),
                    name: thisQualifiedName,
                    //if there is no initial value, set the initial value to `invalid`
                    value: createInvalidLiteral('invalid', field.tokens.name.location)
                });
            // Add parent so namespace lookups work
            fieldAssignment.parent = state.classStatement;
            newStatements.push(fieldAssignment);
        }
        state.editor.arraySplice(this.func.body.statements, startingIndex, 0, ...newStatements);
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'func', visitor, options);
        }
    }

    public clone() {
        return this.finalizeClone(
            new MethodStatement({
                modifiers: this.modifiers?.map(m => util.cloneToken(m)),
                name: util.cloneToken(this.tokens.name),
                func: this.func?.clone(),
                override: util.cloneToken(this.tokens.override)
            }),
            ['func']
        );
    }
}

export class FieldStatement extends Statement implements TypedefProvider {
    constructor(options: {
        accessModifier?: Token;
        name: Identifier;
        as?: Token;
        typeExpression?: TypeExpression;
        equals?: Token;
        initialValue?: Expression;
        optional?: Token;
    }) {
        super();
        this.tokens = {
            accessModifier: options.accessModifier,
            name: options.name,
            as: options.as,
            equals: options.equals,
            optional: options.optional
        };
        this.typeExpression = options.typeExpression;
        this.initialValue = options.initialValue;

        this.location = util.createBoundingLocation(
            util.createBoundingLocationFromTokens(this.tokens),
            this.typeExpression,
            this.initialValue
        );
    }

    public readonly tokens: {
        readonly accessModifier?: Token;
        readonly name: Identifier;
        readonly as?: Token;
        readonly equals?: Token;
        readonly optional?: Token;
    };

    public readonly typeExpression?: TypeExpression;
    public readonly initialValue?: Expression;

    public readonly kind = AstNodeKind.FieldStatement;

    /**
     * Derive a ValueKind from the type token, or the initial value.
     * Defaults to `DynamicType`
     */
    getType(options: GetTypeOptions) {
        let initialValueType = this.initialValue?.getType({ ...options, flags: SymbolTypeFlag.runtime });

        if (isInvalidType(initialValueType) || isVoidType(initialValueType) || isUninitializedType(initialValueType)) {
            initialValueType = undefined;
        }

        return this.typeExpression?.getType({ ...options, flags: SymbolTypeFlag.typetime }) ??
            util.getDefaultTypeFromValueType(initialValueType) ??
            DynamicType.instance;
    }

    public readonly location: Location | undefined;

    public get leadingTrivia(): Token[] {
        return this.tokens.accessModifier?.leadingTrivia ?? this.tokens.optional?.leadingTrivia ?? this.tokens.name.leadingTrivia;
    }

    public get isOptional() {
        return !!this.tokens.optional;
    }

    transpile(state: BrsTranspileState): TranspileResult {
        throw new Error('transpile not implemented for ' + Object.getPrototypeOf(this).constructor.name);
    }

    getTypedef(state: BrsTranspileState) {
        const result = [];
        if (this.tokens.name) {
            for (let comment of util.getLeadingComments(this) ?? []) {
                result.push(
                    comment.text,
                    state.newline,
                    state.indent()
                );
            }
            for (let annotation of this.annotations ?? []) {
                result.push(
                    ...annotation.getTypedef(state),
                    state.newline,
                    state.indent()
                );
            }

            let type = this.getType({ flags: SymbolTypeFlag.typetime });
            if (isInvalidType(type) || isVoidType(type) || isUninitializedType(type)) {
                type = new DynamicType();
            }

            result.push(
                this.tokens.accessModifier?.text ?? 'public',
                ' '
            );
            if (this.isOptional) {
                result.push(this.tokens.optional.text, ' ');
            }
            result.push(this.tokens.name?.text,
                ' as ',
                type.toTypeString()
            );
        }
        return result;
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'typeExpression', visitor, options);
            walk(this, 'initialValue', visitor, options);
        }
    }

    public clone() {
        return this.finalizeClone(
            new FieldStatement({
                accessModifier: util.cloneToken(this.tokens.accessModifier),
                name: util.cloneToken(this.tokens.name),
                as: util.cloneToken(this.tokens.as),
                typeExpression: this.typeExpression?.clone(),
                equals: util.cloneToken(this.tokens.equals),
                initialValue: this.initialValue?.clone(),
                optional: util.cloneToken(this.tokens.optional)
            }),
            ['initialValue']
        );
    }
}

export type MemberStatement = FieldStatement | MethodStatement;

export class TryCatchStatement extends Statement {
    constructor(options?: {
        try?: Token;
        endTry?: Token;
        tryBranch?: Block;
        catchStatement?: CatchStatement;
    }) {
        super();
        this.tokens = {
            try: options.try,
            endTry: options.endTry
        };
        this.tryBranch = options.tryBranch;
        this.catchStatement = options.catchStatement;
        this.location = util.createBoundingLocation(
            this.tokens.try,
            this.tryBranch,
            this.catchStatement,
            this.tokens.endTry
        );
    }

    public readonly tokens: {
        readonly try?: Token;
        readonly endTry?: Token;
    };

    public readonly tryBranch: Block;
    public readonly catchStatement: CatchStatement;

    public readonly kind = AstNodeKind.TryCatchStatement;

    public readonly location: Location | undefined;

    public transpile(state: BrsTranspileState): TranspileResult {
        return [
            state.transpileToken(this.tokens.try, 'try'),
            ...this.tryBranch.transpile(state),
            state.newline,
            state.indent(),
            ...(this.catchStatement?.transpile(state) ?? ['catch']),
            state.newline,
            state.indent(),
            state.transpileToken(this.tokens.endTry!, 'end try')
        ];
    }

    public walk(visitor: WalkVisitor, options: WalkOptions) {
        if (this.tryBranch && options.walkMode & InternalWalkMode.walkStatements) {
            walk(this, 'tryBranch', visitor, options);
            walk(this, 'catchStatement', visitor, options);
        }
    }

    public get leadingTrivia(): Token[] {
        return this.tokens.try?.leadingTrivia ?? [];
    }

    public get endTrivia(): Token[] {
        return this.tokens.endTry?.leadingTrivia ?? [];
    }

    public clone() {
        return this.finalizeClone(
            new TryCatchStatement({
                try: util.cloneToken(this.tokens.try),
                endTry: util.cloneToken(this.tokens.endTry),
                tryBranch: this.tryBranch?.clone(),
                catchStatement: this.catchStatement?.clone()
            }),
            ['tryBranch', 'catchStatement']
        );
    }
}

export class CatchStatement extends Statement {
    constructor(options?: {
        catch?: Token;
        exceptionVariableExpression?: Expression;
        catchBranch?: Block;
    }) {
        super();
        this.tokens = {
            catch: options?.catch
        };
        this.exceptionVariableExpression = options?.exceptionVariableExpression;
        this.catchBranch = options?.catchBranch;
        this.location = util.createBoundingLocation(
            this.tokens.catch,
            this.exceptionVariableExpression,
            this.catchBranch
        );
    }

    public readonly tokens: {
        readonly catch?: Token;
    };

    public readonly exceptionVariableExpression?: Expression;

    public readonly catchBranch?: Block;

    public readonly kind = AstNodeKind.CatchStatement;

    public readonly location: Location | undefined;

    public transpile(state: BrsTranspileState): TranspileResult {
        return [
            state.transpileToken(this.tokens.catch, 'catch'),
            ' ',
            this.exceptionVariableExpression?.transpile(state) ?? [
                //use the variable named `e` if it doesn't exist in this function body. otherwise use '__bsc_error' just to make sure we're out of the way
                this.getSymbolTable()?.hasSymbol('e', SymbolTypeFlag.runtime)
                    ? '__bsc_error'
                    : 'e'
            ],
            ...(this.catchBranch?.transpile(state) ?? [])
        ];
    }

    public walk(visitor: WalkVisitor, options: WalkOptions) {
        if (this.catchBranch && options.walkMode & InternalWalkMode.walkStatements) {
            walk(this, 'catchBranch', visitor, options);
        }
    }

    public get leadingTrivia(): Token[] {
        return this.tokens.catch?.leadingTrivia ?? [];
    }

    public clone() {
        return this.finalizeClone(
            new CatchStatement({
                catch: util.cloneToken(this.tokens.catch),
                exceptionVariableExpression: this.exceptionVariableExpression?.clone(),
                catchBranch: this.catchBranch?.clone()
            }),
            ['catchBranch']
        );
    }
}

export class ThrowStatement extends Statement {
    constructor(options?: {
        throw?: Token;
        expression?: Expression;
    }) {
        super();
        this.tokens = {
            throw: options.throw
        };
        this.expression = options.expression;
        this.location = util.createBoundingLocation(
            this.tokens.throw,
            this.expression
        );
    }

    public readonly tokens: {
        readonly throw?: Token;
    };
    public readonly expression?: Expression;

    public readonly kind = AstNodeKind.ThrowStatement;

    public readonly location: Location | undefined;

    public transpile(state: BrsTranspileState) {
        const result = [
            state.transpileToken(this.tokens.throw, 'throw'),
            ' '
        ] as TranspileResult;

        //if we have an expression, transpile it
        if (this.expression) {
            result.push(
                ...this.expression.transpile(state)
            );

            //no expression found. Rather than emit syntax errors, provide a generic error message
        } else {
            result.push('"User-specified exception"');
        }
        return result;
    }

    public walk(visitor: WalkVisitor, options: WalkOptions) {
        if (this.expression && options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'expression', visitor, options);
        }
    }

    public get leadingTrivia(): Token[] {
        return this.tokens.throw?.leadingTrivia ?? [];
    }

    public clone() {
        return this.finalizeClone(
            new ThrowStatement({
                throw: util.cloneToken(this.tokens.throw),
                expression: this.expression?.clone()
            }),
            ['expression']
        );
    }
}


export class EnumStatement extends Statement implements TypedefProvider {
    constructor(options: {
        enum?: Token;
        name: Identifier;
        endEnum?: Token;
        body: Array<EnumMemberStatement>;
    }) {
        super();
        this.tokens = {
            enum: options.enum,
            name: options.name,
            endEnum: options.endEnum
        };
        this.symbolTable = new SymbolTable('Enum');
        this.body = options.body ?? [];
    }

    public readonly tokens: {
        readonly enum?: Token;
        readonly name: Identifier;
        readonly endEnum?: Token;
    };
    public readonly body: Array<EnumMemberStatement>;

    public readonly kind = AstNodeKind.EnumStatement;

    public get location(): Location | undefined {
        return util.createBoundingLocation(
            this.tokens.enum,
            this.tokens.name,
            ...this.body,
            this.tokens.endEnum
        );
    }

    public getMembers() {
        const result = [] as EnumMemberStatement[];
        for (const statement of this.body) {
            if (isEnumMemberStatement(statement)) {
                result.push(statement);
            }
        }
        return result;
    }

    public get leadingTrivia(): Token[] {
        return this.tokens.enum?.leadingTrivia;
    }

    public get endTrivia(): Token[] {
        return this.tokens.endEnum?.leadingTrivia ?? [];
    }

    /**
     * Get a map of member names and their values.
     * All values are stored as their AST LiteralExpression representation (i.e. string enum values include the wrapping quotes)
     */
    public getMemberValueMap() {
        const result = new Map<string, string>();
        const members = this.getMembers();
        let currentIntValue = 0;
        for (const member of members) {
            //if there is no value, assume an integer and increment the int counter
            if (!member.value) {
                result.set(member.name?.toLowerCase(), currentIntValue.toString());
                currentIntValue++;

                //if explicit integer value, use it and increment the int counter
            } else if (isLiteralExpression(member.value) && member.value.tokens.value.kind === TokenKind.IntegerLiteral) {
                //try parsing as integer literal, then as hex integer literal.
                let tokenIntValue = util.parseInt(member.value.tokens.value.text) ?? util.parseInt(member.value.tokens.value.text.replace(/&h/i, '0x'));
                if (tokenIntValue !== undefined) {
                    currentIntValue = tokenIntValue;
                    currentIntValue++;
                }
                result.set(member.name?.toLowerCase(), member.value.tokens.value.text);

                //simple unary expressions (like `-1`)
            } else if (isUnaryExpression(member.value) && isLiteralExpression(member.value.right)) {
                result.set(member.name?.toLowerCase(), member.value.tokens.operator.text + member.value.right.tokens.value.text);

                //all other values
            } else {
                result.set(member.name?.toLowerCase(), (member.value as LiteralExpression)?.tokens?.value?.text ?? 'invalid');
            }
        }
        return result;
    }

    public getMemberValue(name: string) {
        return this.getMemberValueMap().get(name.toLowerCase());
    }

    /**
     * The name of the enum (without the namespace prefix)
     */
    public get name() {
        return this.tokens.name?.text;
    }

    /**
     * The name of the enum WITH its leading namespace (if applicable)
     */
    public get fullName() {
        const name = this.tokens.name?.text;
        if (name) {
            const namespace = this.findAncestor<NamespaceStatement>(isNamespaceStatement);

            if (namespace) {
                let namespaceName = namespace.getName(ParseMode.BrighterScript);
                return `${namespaceName}.${name}`;
            } else {
                return name;
            }
        } else {
            //return undefined which will allow outside callers to know that this doesn't have a name
            return undefined;
        }
    }

    transpile(state: BrsTranspileState) {
        //enum declarations don't exist at runtime, so just transpile comments and trivia
        return [
            state.transpileAnnotations(this),
            state.transpileLeadingComments(this.tokens.enum)
        ];
    }

    getTypedef(state: BrsTranspileState) {
        const result = [] as TranspileResult;
        for (let comment of util.getLeadingComments(this) ?? []) {
            result.push(
                comment.text,
                state.newline,
                state.indent()
            );
        }
        for (let annotation of this.annotations ?? []) {
            result.push(
                ...annotation.getTypedef(state),
                state.newline,
                state.indent()
            );
        }
        result.push(
            this.tokens.enum?.text ?? 'enum',
            ' ',
            this.tokens.name.text
        );
        result.push(state.newline);
        state.blockDepth++;
        for (const member of this.body) {
            if (isTypedefProvider(member)) {
                result.push(
                    state.indent(),
                    ...member.getTypedef(state),
                    state.newline
                );
            }
        }
        state.blockDepth--;
        result.push(
            state.indent(),
            this.tokens.endEnum?.text ?? 'end enum'
        );
        return result;
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkStatements) {
            walkArray(this.body, visitor, options, this);

        }
    }

    getType(options: GetTypeOptions) {
        const members = this.getMembers();

        const resultType = new EnumType(
            this.fullName,
            members[0]?.getType(options).underlyingType
        );
        resultType.pushMemberProvider(() => this.getSymbolTable());
        for (const statement of members) {
            const memberType = statement.getType({ ...options, typeChain: undefined });
            memberType.parentEnumType = resultType;
            resultType.addMember(statement?.tokens?.name?.text, { definingNode: statement }, memberType, SymbolTypeFlag.runtime);
        }
        return resultType;
    }

    public clone() {
        return this.finalizeClone(
            new EnumStatement({
                enum: util.cloneToken(this.tokens.enum),
                name: util.cloneToken(this.tokens.name),
                endEnum: util.cloneToken(this.tokens.endEnum),
                body: this.body?.map(x => x?.clone())
            }),
            ['body']
        );
    }
}

export class EnumMemberStatement extends Statement implements TypedefProvider {
    public constructor(options: {
        name: Identifier;
        equals?: Token;
        value?: Expression;
    }) {
        super();
        this.tokens = {
            name: options.name,
            equals: options.equals
        };
        this.value = options.value;
    }

    public readonly tokens: {
        readonly name: Identifier;
        readonly equals?: Token;
    };
    public readonly value?: Expression;

    public readonly kind = AstNodeKind.EnumMemberStatement;

    public get location() {
        return util.createBoundingLocation(
            this.tokens.name,
            this.tokens.equals,
            this.value
        );
    }

    /**
     * The name of the member
     */
    public get name() {
        return this.tokens.name.text;
    }

    public get leadingTrivia(): Token[] {
        return this.tokens.name.leadingTrivia;
    }

    public transpile(state: BrsTranspileState): TranspileResult {
        return [];
    }

    getTypedef(state: BrsTranspileState): TranspileResult {
        const result: TranspileResult = [];
        for (let comment of util.getLeadingComments(this) ?? []) {
            result.push(
                comment.text,
                state.newline,
                state.indent()
            );
        }
        result.push(this.tokens.name.text);
        if (this.tokens.equals) {
            result.push(' ', this.tokens.equals.text, ' ');
            if (this.value) {
                result.push(
                    ...this.value.transpile(state)
                );
            }
        }
        return result;
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (this.value && options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'value', visitor, options);
        }
    }

    getType(options: GetTypeOptions) {
        return new EnumMemberType(
            (this.parent as EnumStatement)?.fullName,
            this.tokens?.name?.text,
            this.value?.getType(options)
        );
    }

    public clone() {
        return this.finalizeClone(
            new EnumMemberStatement({
                name: util.cloneToken(this.tokens.name),
                equals: util.cloneToken(this.tokens.equals),
                value: this.value?.clone()
            }),
            ['value']
        );
    }
}

export class ConstStatement extends Statement implements TypedefProvider {
    public constructor(options: {
        const?: Token;
        name: Identifier;
        equals?: Token;
        value: Expression;
    }) {
        super();
        this.tokens = {
            const: options.const,
            name: options.name,
            equals: options.equals
        };
        this.value = options.value;
        this.location = util.createBoundingLocation(this.tokens.const, this.tokens.name, this.tokens.equals, this.value);
    }

    public readonly tokens: {
        readonly const: Token;
        readonly name: Identifier;
        readonly equals: Token;
    };
    public readonly value: Expression;

    public readonly kind = AstNodeKind.ConstStatement;

    public readonly location: Location | undefined;

    public get name() {
        return this.tokens.name.text;
    }

    public get leadingTrivia(): Token[] {
        return this.tokens.const?.leadingTrivia;
    }

    /**
     * The name of the statement WITH its leading namespace (if applicable)
     */
    public get fullName() {
        const name = this.tokens.name?.text;
        if (name) {
            const namespace = this.findAncestor<NamespaceStatement>(isNamespaceStatement);
            if (namespace) {
                let namespaceName = namespace.getName(ParseMode.BrighterScript);
                return `${namespaceName}.${name}`;
            } else {
                return name;
            }
        } else {
            //return undefined which will allow outside callers to know that this doesn't have a name
            return undefined;
        }
    }

    public transpile(state: BrsTranspileState): TranspileResult {
        //const declarations don't exist at runtime, so just transpile comments and trivia
        return [
            state.transpileAnnotations(this),
            state.transpileLeadingComments(this.tokens.const)
        ];
    }

    getTypedef(state: BrsTranspileState): TranspileResult {
        const result: TranspileResult = [];
        for (let comment of util.getLeadingComments(this) ?? []) {
            result.push(
                comment.text,
                state.newline,
                state.indent()
            );
        }
        result.push(
            this.tokens.const ? state.tokenToSourceNode(this.tokens.const) : 'const',
            ' ',
            state.tokenToSourceNode(this.tokens.name),
            ' ',
            this.tokens.equals ? state.tokenToSourceNode(this.tokens.equals) : '=',
            ' ',
            ...this.value.transpile(state)
        );
        return result;
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (this.value && options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'value', visitor, options);
        }
    }

    getType(options: GetTypeOptions) {
        return this.value.getType(options);
    }

    public clone() {
        return this.finalizeClone(
            new ConstStatement({
                const: util.cloneToken(this.tokens.const),
                name: util.cloneToken(this.tokens.name),
                equals: util.cloneToken(this.tokens.equals),
                value: this.value?.clone()
            }),
            ['value']
        );
    }
}

export class ContinueStatement extends Statement {
    constructor(options: {
        continue?: Token;
        loopType: Token;
    }
    ) {
        super();
        this.tokens = {
            continue: options.continue,
            loopType: options.loopType
        };
        this.location = util.createBoundingLocation(
            this.tokens.continue,
            this.tokens.loopType
        );
    }

    public readonly tokens: {
        readonly continue?: Token;
        readonly loopType: Token;
    };

    public readonly kind = AstNodeKind.ContinueStatement;

    public readonly location: Location | undefined;

    transpile(state: BrsTranspileState) {
        return [
            state.sourceNode(this.tokens.continue, this.tokens.continue?.text ?? 'continue'),
            this.tokens.loopType?.leadingWhitespace ?? ' ',
            state.sourceNode(this.tokens.continue, this.tokens.loopType?.text)
        ];
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        //nothing to walk
    }

    public get leadingTrivia(): Token[] {
        return this.tokens.continue?.leadingTrivia ?? [];
    }

    public clone() {
        return this.finalizeClone(
            new ContinueStatement({
                continue: util.cloneToken(this.tokens.continue),
                loopType: util.cloneToken(this.tokens.loopType)
            })
        );
    }
}

export class TypecastStatement extends Statement {
    constructor(options: {
        typecast?: Token;
        typecastExpression: TypecastExpression;
    }
    ) {
        super();
        this.tokens = {
            typecast: options.typecast
        };
        this.typecastExpression = options.typecastExpression;
        this.location = util.createBoundingLocation(
            this.tokens.typecast,
            this.typecastExpression
        );
    }

    public readonly tokens: {
        readonly typecast?: Token;
    };

    public readonly typecastExpression: TypecastExpression;

    public readonly kind = AstNodeKind.TypecastStatement;

    public readonly location: Location;

    transpile(state: BrsTranspileState) {
        //the typecast statement is a comment just for debugging purposes
        return [
            state.transpileToken(this.tokens.typecast, 'typecast', true),
            ' ',
            this.typecastExpression.obj.transpile(state),
            ' ',
            state.transpileToken(this.typecastExpression.tokens.as, 'as'),
            ' ',
            this.typecastExpression.typeExpression.transpile(state)
        ];
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'typecastExpression', visitor, options);
        }
    }

    get leadingTrivia(): Token[] {
        return this.tokens.typecast?.leadingTrivia ?? [];
    }

    getType(options: GetTypeOptions): BscType {
        return this.typecastExpression.getType(options);
    }

    public clone() {
        return this.finalizeClone(
            new TypecastStatement({
                typecast: util.cloneToken(this.tokens.typecast),
                typecastExpression: this.typecastExpression?.clone()
            }),
            ['typecastExpression']
        );
    }
}

export class ConditionalCompileErrorStatement extends Statement {
    constructor(options: {
        hashError?: Token;
        message: Token;
    }) {
        super();
        this.tokens = {
            hashError: options.hashError,
            message: options.message
        };
        this.location = util.createBoundingLocation(util.createBoundingLocationFromTokens(this.tokens));
    }

    public readonly tokens: {
        readonly hashError?: Token;
        readonly message: Token;
    };


    public readonly kind = AstNodeKind.ConditionalCompileErrorStatement;

    public readonly location: Location | undefined;

    transpile(state: BrsTranspileState) {
        return [
            state.transpileToken(this.tokens.hashError, '#error'),
            ' ',
            state.transpileToken(this.tokens.message)

        ];
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        // nothing to walk
    }

    get leadingTrivia(): Token[] {
        return this.tokens.hashError.leadingTrivia ?? [];
    }

    public clone() {
        return this.finalizeClone(
            new ConditionalCompileErrorStatement({
                hashError: util.cloneToken(this.tokens.hashError),
                message: util.cloneToken(this.tokens.message)
            })
        );
    }
}

export class AliasStatement extends Statement {
    constructor(options: {
        alias?: Token;
        name: Token;
        equals?: Token;
        value: VariableExpression | DottedGetExpression;
    }
    ) {
        super();
        this.tokens = {
            alias: options.alias,
            name: options.name,
            equals: options.equals
        };
        this.value = options.value;
        this.location = util.createBoundingLocation(
            this.tokens.alias,
            this.tokens.name,
            this.tokens.equals,
            this.value
        );
    }

    public readonly tokens: {
        readonly alias?: Token;
        readonly name: Token;
        readonly equals?: Token;
    };

    public readonly value: Expression;

    public readonly kind = AstNodeKind.AliasStatement;

    public readonly location: Location;

    transpile(state: BrsTranspileState) {
        //the alias statement is a comment just for debugging purposes
        return [
            state.transpileToken(this.tokens.alias, 'alias', true),
            ' ',
            state.transpileToken(this.tokens.name),
            ' ',
            state.transpileToken(this.tokens.equals, '='),
            ' ',
            this.value.transpile(state)
        ];
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkExpressions) {
            walk(this, 'value', visitor, options);
        }
    }

    get leadingTrivia(): Token[] {
        return this.tokens.alias?.leadingTrivia ?? [];
    }

    getType(options: GetTypeOptions): BscType {
        return this.value.getType(options);
    }

    public clone() {
        return this.finalizeClone(
            new AliasStatement({
                alias: util.cloneToken(this.tokens.alias),
                name: util.cloneToken(this.tokens.name),
                equals: util.cloneToken(this.tokens.equals),
                value: this.value?.clone()
            }),
            ['value']
        );
    }
}

export class ConditionalCompileStatement extends Statement {
    constructor(options: {
        hashIf?: Token;
        not?: Token;
        condition: Token;
        hashElse?: Token;
        hashEndIf?: Token;
        thenBranch: Block;
        elseBranch?: ConditionalCompileStatement | Block;
    }) {
        super();
        this.thenBranch = options.thenBranch;
        this.elseBranch = options.elseBranch;

        this.tokens = {
            hashIf: options.hashIf,
            not: options.not,
            condition: options.condition,
            hashElse: options.hashElse,
            hashEndIf: options.hashEndIf
        };

        this.location = util.createBoundingLocation(
            util.createBoundingLocationFromTokens(this.tokens),
            this.thenBranch,
            this.elseBranch
        );
    }

    readonly tokens: {
        readonly hashIf?: Token;
        readonly not?: Token;
        readonly condition: Token;
        readonly hashElse?: Token;
        readonly hashEndIf?: Token;
    };
    public readonly thenBranch: Block;
    public readonly elseBranch?: ConditionalCompileStatement | Block;

    public readonly kind = AstNodeKind.ConditionalCompileStatement;

    public readonly location: Location | undefined;

    transpile(state: BrsTranspileState) {
        let results = [] as TranspileResult;
        //if   (already indented by block)
        if (!state.conditionalCompileStatement) {
            // only transpile the #if in the case when we're not in a conditionalCompileStatement already
            results.push(state.transpileToken(this.tokens.hashIf ?? createToken(TokenKind.HashIf)));
        }

        results.push(' ');
        //conditions
        if (this.tokens.not) {
            results.push('not');
            results.push(' ');
        }
        results.push(state.transpileToken(this.tokens.condition));
        state.lineage.unshift(this);

        //if statement body
        let thenNodes = this.thenBranch.transpile(state);
        state.lineage.shift();
        if (thenNodes.length > 0) {
            results.push(thenNodes);
        }
        //else branch
        if (this.elseBranch) {
            const elseIsCC = isConditionalCompileStatement(this.elseBranch);
            const endBlockToken = elseIsCC ? (this.elseBranch as ConditionalCompileStatement).tokens.hashIf ?? createToken(TokenKind.HashElseIf) : this.tokens.hashElse;
            //else

            results.push(...state.transpileEndBlockToken(this.thenBranch, endBlockToken, createToken(TokenKind.HashElse).text));

            if (elseIsCC) {
                //chained else if
                state.lineage.unshift(this.elseBranch);

                // transpile following #if with knowledge of current
                const existingCCStmt = state.conditionalCompileStatement;
                state.conditionalCompileStatement = this;
                let body = this.elseBranch.transpile(state);
                state.conditionalCompileStatement = existingCCStmt;

                state.lineage.shift();

                if (body.length > 0) {
                    //zero or more spaces between the `else` and the `if`
                    results.push(...body);

                    // stop here because chained if will transpile the rest
                    return results;
                } else {
                    results.push('\n');
                }

            } else {
                //else body
                state.lineage.unshift(this.tokens.hashElse!);
                let body = this.elseBranch.transpile(state);
                state.lineage.shift();

                if (body.length > 0) {
                    results.push(...body);
                }
            }
        }

        //end if
        results.push(...state.transpileEndBlockToken(this.elseBranch ?? this.thenBranch, this.tokens.hashEndIf, '#end if'));

        return results;
    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        if (options.walkMode & InternalWalkMode.walkStatements) {
            const bsConsts = options.bsConsts ?? this.getBsConsts();
            let conditionTrue = bsConsts?.get(this.tokens.condition.text.toLowerCase());
            if (this.tokens.not) {
                // flips the boolean value
                conditionTrue = !conditionTrue;
            }
            const walkFalseBlocks = options.walkMode & InternalWalkMode.visitFalseConditionalCompilationBlocks;
            if (conditionTrue || walkFalseBlocks) {
                walk(this, 'thenBranch', visitor, options);
            }
            if (this.elseBranch && (!conditionTrue || walkFalseBlocks)) {
                walk(this, 'elseBranch', visitor, options);
            }
        }
    }

    get leadingTrivia(): Token[] {
        return this.tokens.hashIf?.leadingTrivia ?? [];
    }

    public clone() {
        return this.finalizeClone(
            new ConditionalCompileStatement({
                hashIf: util.cloneToken(this.tokens.hashIf),
                not: util.cloneToken(this.tokens.not),
                condition: util.cloneToken(this.tokens.condition),
                hashElse: util.cloneToken(this.tokens.hashElse),
                hashEndIf: util.cloneToken(this.tokens.hashEndIf),
                thenBranch: this.thenBranch?.clone(),
                elseBranch: this.elseBranch?.clone()
            }),
            ['thenBranch', 'elseBranch']
        );
    }
}


export class ConditionalCompileConstStatement extends Statement {
    constructor(options: {
        hashConst?: Token;
        assignment: AssignmentStatement;
    }) {
        super();
        this.tokens = {
            hashConst: options.hashConst
        };
        this.assignment = options.assignment;
        this.location = util.createBoundingLocation(util.createBoundingLocationFromTokens(this.tokens), this.assignment);
    }

    public readonly tokens: {
        readonly hashConst?: Token;
    };

    public readonly assignment: AssignmentStatement;

    public readonly kind = AstNodeKind.ConditionalCompileConstStatement;

    public readonly location: Location | undefined;

    transpile(state: BrsTranspileState) {
        return [
            state.transpileToken(this.tokens.hashConst, '#const'),
            ' ',
            state.transpileToken(this.assignment.tokens.name),
            ' ',
            state.transpileToken(this.assignment.tokens.equals, '='),
            ' ',
            ...this.assignment.value.transpile(state)
        ];

    }

    walk(visitor: WalkVisitor, options: WalkOptions) {
        // nothing to walk
    }


    get leadingTrivia(): Token[] {
        return this.tokens.hashConst.leadingTrivia ?? [];
    }

    public clone() {
        return this.finalizeClone(
            new ConditionalCompileConstStatement({
                hashConst: util.cloneToken(this.tokens.hashConst),
                assignment: this.assignment?.clone()
            }),
            ['assignment']
        );
    }
}
