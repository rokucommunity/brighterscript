import type { Location } from 'vscode-languageserver';
import type { Identifier, Token } from './lexer/Token';
import type { PrintSeparatorToken } from './lexer/TokenKind';
import { TokenKind } from './lexer/TokenKind';
import type { Expression, Statement } from './parser/AstNode';
import type { BscType } from './types/BscType';
import type { SGToken } from './parser/SGTypes';
import { BinaryExpression, CallExpression, FunctionExpression, FunctionParameterExpression, DottedGetExpression, XmlAttributeGetExpression, IndexedGetExpression, GroupingExpression, LiteralExpression, PrintSeparatorExpression, EscapedCharCodeLiteralExpression, ArrayLiteralExpression, AAMemberExpression, AAIndexedMemberExpression, AALiteralExpression, UnaryExpression, VariableExpression, SourceLiteralExpression, NewExpression, CallfuncExpression, TemplateStringQuasiExpression, TemplateStringExpression, TaggedTemplateStringExpression, AnnotationExpression, TernaryExpression, NullCoalescingExpression, RegexLiteralExpression, TypeExpression, TypecastExpression, TypedArrayExpression, InlineInterfaceExpression, InlineInterfaceMemberExpression, TypedFunctionTypeExpression } from './parser/Expression';
import { EmptyStatement, Body, AssignmentStatement, AugmentedAssignmentStatement, Block, ExpressionStatement, ExitStatement, FunctionStatement, IfStatement, IncrementStatement, PrintStatement, DimStatement, GotoStatement, LabelStatement, ReturnStatement, EndStatement, StopStatement, ForStatement, ForEachStatement, WhileStatement, DottedSetStatement, IndexedSetStatement, LibraryStatement, NamespaceStatement, ImportStatement, InterfaceStatement, InterfaceFieldStatement, InterfaceMethodStatement, ClassStatement, MethodStatement, FieldStatement, TryCatchStatement, CatchStatement, ThrowStatement, EnumStatement, EnumMemberStatement, ConstStatement, ContinueStatement, TypecastStatement, ConditionalCompileErrorStatement, AliasStatement, ConditionalCompileStatement, ConditionalCompileConstStatement, TypeStatement } from './parser/Statement';
import { SGAttribute, SGElement, SGProlog, SGNode, SGChildren, SGCustomization, SGScript, SGInterfaceField, SGInterfaceFunction, SGInterface, SGComponent, SGAst } from './parser/SGTypes';
import { BrsFile } from './files/BrsFile';
import { XmlFile } from './files/XmlFile';
import { AssetFile } from './files/AssetFile';
import type { FileData } from './files/LazyFileData';
import type { Program } from './Program';

const tokenDefaults = {
    [TokenKind.BackTick]: '`',
    [TokenKind.Backslash]: '\\',
    [TokenKind.BackslashEqual]: '\\=',
    [TokenKind.Callfunc]: '@.',
    [TokenKind.Caret]: '^',
    [TokenKind.Colon]: ':',
    [TokenKind.Comma]: ',',
    [TokenKind.Comment]: '\'',
    [TokenKind.Dollar]: '$',
    [TokenKind.Dot]: '.',
    [TokenKind.EndClass]: 'end class',
    [TokenKind.EndEnum]: 'end enum',
    [TokenKind.EndFor]: 'end for',
    [TokenKind.EndFunction]: 'end function',
    [TokenKind.EndIf]: 'end if',
    [TokenKind.EndInterface]: 'end interface',
    [TokenKind.EndNamespace]: 'end namespace',
    [TokenKind.EndSub]: 'end sub',
    [TokenKind.EndTry]: 'end try',
    [TokenKind.EndWhile]: 'end while',
    [TokenKind.Equal]: '=',
    [TokenKind.Greater]: '>',
    [TokenKind.GreaterEqual]: '>=',
    [TokenKind.HashConst]: '#const',
    [TokenKind.HashElse]: '#else',
    [TokenKind.HashElseIf]: '#else if',
    [TokenKind.HashEndIf]: '#end if',
    [TokenKind.HashError]: '#error',
    [TokenKind.HashIf]: '#if',
    [TokenKind.LeftCurlyBrace]: '{',
    [TokenKind.LeftParen]: '(',
    [TokenKind.LeftShift]: '<<',
    [TokenKind.LeftShiftEqual]: '<<=',
    [TokenKind.LeftSquareBracket]: '[',
    [TokenKind.Less]: '<',
    [TokenKind.LessEqual]: '<=',
    [TokenKind.LessGreater]: '<>',
    [TokenKind.LineNumLiteral]: 'LINE_NUM',
    [TokenKind.Minus]: '-',
    [TokenKind.MinusEqual]: '-=',
    [TokenKind.MinusMinus]: '--',
    [TokenKind.Newline]: '\n',
    [TokenKind.PkgLocationLiteral]: 'PKG_LOCATION',
    [TokenKind.PkgPathLiteral]: 'PKG_PATH',
    [TokenKind.Plus]: '+',
    [TokenKind.PlusEqual]: '+=',
    [TokenKind.PlusPlus]: '++',
    [TokenKind.Question]: '?',
    [TokenKind.QuestionQuestion]: '??',
    [TokenKind.RightCurlyBrace]: '}',
    [TokenKind.RightParen]: ')',
    [TokenKind.RightShift]: '>>',
    [TokenKind.RightShiftEqual]: '>>=',
    [TokenKind.RightSquareBracket]: ']',
    [TokenKind.Semicolon]: ';',
    [TokenKind.SourceFilePathLiteral]: 'SOURCE_FILE_PATH',
    [TokenKind.SourceFunctionNameLiteral]: 'SOURCE_FUNCTION_NAME',
    [TokenKind.SourceNamespaceRootNameLiteral]: 'SOURCE_NAMESPACE_ROOT_NAME',
    [TokenKind.SourceNamespaceNameLiteral]: 'SOURCE_NAMESPACE_NAME',
    [TokenKind.SourceLineNumLiteral]: 'SOURCE_LINE_NUM',
    [TokenKind.SourceLocationLiteral]: 'SOURCE_LOCATION',
    [TokenKind.Star]: '*',
    [TokenKind.StarEqual]: '*=',
    [TokenKind.Tab]: '\t',
    [TokenKind.TemplateStringExpressionBegin]: '${',
    [TokenKind.TemplateStringExpressionEnd]: '}',
    [TokenKind.Whitespace]: ' '
};

/**
 * A token for SceneGraph xml nodes. Can be passed as a plain string, which will be converted to an `SGToken` with no location.
 */
export type SGTokenLike = SGToken | string;

/**
 * The options used to create any SceneGraph xml element
 */
export interface SGElementFactoryOptions {
    startTagOpen?: SGTokenLike;
    startTagName?: SGTokenLike;
    /**
     * The attributes for this element. Can be an array of `SGAttribute`, or an object whose keys are the attribute names and values are the attribute values
     */
    attributes?: SGAttribute[] | Record<string, string>;
    startTagClose?: SGTokenLike;
    elements?: SGElement[];
    endTagOpen?: SGTokenLike;
    endTagName?: SGTokenLike;
    endTagClose?: SGTokenLike;
}

/**
 * A factory for creating everything in BrighterScript: tokens, AST nodes, SceneGraph xml nodes, and files.
 *
 * Plugins should use the factory provided by the program (`program.factory`) instead of calling constructors directly
 * (i.e. `program.factory.createCallExpression(...)` instead of `new CallExpression(...)`). A plugin may be bundled with a
 * different version of brighterscript than the one actually running it (the cli or the language server). Objects created
 * from the plugin's own copy of brighterscript would miss any bug fixes or new fields from the running version, while objects
 * created through `program.factory` always come from the running version.
 *
 * The method signatures here are a stable contract. The constructors may change over time, but these methods will
 * continue to accept the same options. Methods may be added in future versions, so plugins that need to support older
 * versions of brighterscript can check for a method before calling it (i.e. `if (program.factory.createTypeStatement) {...}`).
 *
 * Every AST method is named `create` followed by the class name (i.e. `createCallExpression` creates a `CallExpression`).
 * SceneGraph xml nodes are prefixed with `SG` (i.e. `createSGComponent`). Most syntax tokens are optional and will be
 * given their default text when omitted, and identifier names may be passed as plain strings.
 */
export class BscFactory {
    public constructor(
        /**
         * The program that files created by this factory will belong to
         */
        public readonly program?: Program
    ) {
    }

    ////////////////////////////////
    // Tokens
    ////////////////////////////////

    /**
     * Create a token. If `text` is omitted, the default text for that token kind is used (i.e. `(` for `TokenKind.LeftParen`)
     */
    public createToken<T extends TokenKind>(kind: T, text?: string, location?: Location): Token & { kind: T } {
        return {
            kind: kind,
            text: text ?? tokenDefaults[kind as string] ?? kind.toString().toLowerCase(),
            isReserved: !text || text === kind.toString(),
            location: location,
            leadingTrivia: []
        };
    }

    /**
     * Create an identifier token
     */
    public createIdentifier(name: string, location?: Location): Identifier {
        return {
            kind: TokenKind.Identifier,
            text: name,
            isReserved: false,
            location: location,
            leadingTrivia: []
        };
    }

    /**
     * Convert a string to an identifier token. If an identifier is passed, it is returned unchanged
     */
    private toIdentifier(name: Identifier | string): Identifier {
        return typeof name === 'string' ? this.createIdentifier(name) : name;
    }

    /**
     * Create a token for a SceneGraph xml node
     */
    public createSGToken(text: string, location?: Location): SGToken {
        return {
            text: text,
            location: location
        };
    }

    /**
     * Convert a string to an `SGToken`. If an `SGToken` (or undefined) is passed, it is returned unchanged
     */
    private toSGToken(token: SGTokenLike): SGToken {
        return typeof token === 'string' ? this.createSGToken(token) : token;
    }

    ////////////////////////////////
    // Files
    ////////////////////////////////

    /**
     * Create a new `BrsFile` (for `.brs`, `.bs`, and `.d.bs` files)
     */
    public createBrsFile(options: { srcPath: string; destPath: string; pkgPath?: string; program?: Program }): BrsFile {
        return new BrsFile({ ...options, program: options.program ?? this.program });
    }

    /**
     * Create a new `XmlFile`
     */
    public createXmlFile(options: { srcPath: string; destPath: string; pkgPath?: string; program?: Program }): XmlFile {
        return new XmlFile({ ...options, program: options.program ?? this.program });
    }

    /**
     * Create a new `AssetFile` (for any file that brighterscript does not handle directly, like images or fonts)
     */
    public createAssetFile(options: { srcPath: string; destPath: string; pkgPath?: string; data?: FileData }): AssetFile {
        return new AssetFile(options);
    }

    ////////////////////////////////
    // Literal helpers
    ////////////////////////////////

    /**
     * Create a string `LiteralExpression`. The TokenKind.StringLiteral token value includes the leading and trailing doublequote during lexing.
     * Since brightscript doesn't support strings with quotes in them, we can safely auto-detect and wrap the value in quotes in this function.
     * @param value - the string value. (value will be wrapped in quotes if they are missing)
     */
    public createStringLiteral(value: string, location?: Location): LiteralExpression {
        //wrap the value in double quotes
        if (!value.startsWith('"') && !value.endsWith('"')) {
            value = '"' + value + '"';
        }
        return new LiteralExpression({ value: this.createToken(TokenKind.StringLiteral, value, location) });
    }

    public createIntegerLiteral(value: string, location?: Location): LiteralExpression {
        return new LiteralExpression({ value: this.createToken(TokenKind.IntegerLiteral, value, location) });
    }

    public createFloatLiteral(value: string, location?: Location): LiteralExpression {
        return new LiteralExpression({ value: this.createToken(TokenKind.FloatLiteral, value, location) });
    }

    public createDoubleLiteral(value: string, location?: Location): LiteralExpression {
        return new LiteralExpression({ value: this.createToken(TokenKind.DoubleLiteral, value, location) });
    }

    public createLongIntegerLiteral(value: string, location?: Location): LiteralExpression {
        return new LiteralExpression({ value: this.createToken(TokenKind.LongIntegerLiteral, value, location) });
    }

    public createInvalidLiteral(value?: string, location?: Location): LiteralExpression {
        return new LiteralExpression({ value: this.createToken(TokenKind.Invalid, value, location) });
    }

    public createBooleanLiteral(value: string, location?: Location): LiteralExpression {
        return new LiteralExpression({ value: this.createToken(value === 'true' ? TokenKind.True : TokenKind.False, value, location) });
    }

    /**
     * Create a `VariableExpression` or `DottedGetExpression` chain from a list of names (i.e. `['alpha', 'beta', 'charlie']` produces `alpha.beta.charlie`)
     */
    public createDottedIdentifier(path: string[], location?: Location): VariableExpression | DottedGetExpression {
        let result: VariableExpression | DottedGetExpression = this.createVariableExpression({ name: this.createIdentifier(path[0], location) });
        for (let i = 1; i < path.length; i++) {
            result = new DottedGetExpression({
                obj: result,
                name: this.createIdentifier(path[i], location),
                dot: this.createToken(TokenKind.Dot, '.', location)
            });
        }
        return result;
    }

    ////////////////////////////////
    // BrightScript expressions
    ////////////////////////////////

    public createBinaryExpression(options: {
        left: Expression;
        operator: Token;
        right: Expression;
    }): BinaryExpression {
        return new BinaryExpression(options);
    }

    public createCallExpression(options: {
        callee: Expression;
        openingParen?: Token;
        args?: Expression[];
        closingParen?: Token;
    }): CallExpression {
        return new CallExpression({
            callee: options.callee,
            openingParen: options.openingParen ?? this.createToken(TokenKind.LeftParen),
            args: options.args,
            closingParen: options.closingParen ?? this.createToken(TokenKind.RightParen)
        });
    }

    /**
     * Create a `FunctionExpression`. Defaults to an empty `function` with no parameters. If `functionType` is a `sub` token,
     * the default `endFunctionType` will be `end sub`.
     */
    public createFunctionExpression(options?: {
        functionType?: Token;
        leftParen?: Token;
        parameters?: FunctionParameterExpression[];
        rightParen?: Token;
        as?: Token;
        returnTypeExpression?: TypeExpression;
        body?: Block;
        endFunctionType?: Token;
    }): FunctionExpression {
        const functionType = options?.functionType ?? this.createToken(TokenKind.Function);
        return new FunctionExpression({
            functionType: functionType,
            leftParen: options?.leftParen ?? this.createToken(TokenKind.LeftParen),
            parameters: options?.parameters ?? [],
            rightParen: options?.rightParen ?? this.createToken(TokenKind.RightParen),
            as: options?.as,
            returnTypeExpression: options?.returnTypeExpression,
            body: options?.body ?? this.createBlock(),
            endFunctionType: options?.endFunctionType ?? this.createToken(functionType.kind === TokenKind.Sub ? TokenKind.EndSub : TokenKind.EndFunction)
        });
    }

    public createFunctionParameterExpression(options: {
        name: Identifier;
        equals?: Token;
        defaultValue?: Expression;
        as?: Token;
        typeExpression?: TypeExpression;
    }): FunctionParameterExpression {
        return new FunctionParameterExpression(options);
    }

    public createDottedGetExpression(options: {
        obj: Expression;
        name: Identifier;
        /**
         * Can either be `.`, or `?.` for optional chaining - defaults in transpile to '.'
         */
        dot?: Token;
    }): DottedGetExpression {
        return new DottedGetExpression(options);
    }

    public createXmlAttributeGetExpression(options: {
        obj: Expression;
        /**
         * Can either be `@`, or `?@` for optional chaining - defaults to '@'
         */
        at?: Token;
        name: Identifier;
    }): XmlAttributeGetExpression {
        return new XmlAttributeGetExpression(options);
    }

    public createIndexedGetExpression(options: {
        obj: Expression;
        indexes: Expression[];
        /**
         * Can either be `[` or `?[`. If `?.[` is used, this will be `[` and `optionalChainingToken` will be `?.` - defaults to '[' in transpile
         */
        openingSquare?: Token;
        closingSquare?: Token;
        questionDot?: Token;//  ? or ?.
    }): IndexedGetExpression {
        return new IndexedGetExpression(options);
    }

    public createGroupingExpression(options: {
        leftParen?: Token;
        rightParen?: Token;
        expression: Expression;
    }): GroupingExpression {
        return new GroupingExpression(options);
    }

    public createLiteralExpression(options: {
        value: Token;
    }): LiteralExpression {
        return new LiteralExpression(options);
    }

    public createPrintSeparatorExpression(options: {
        separator: PrintSeparatorToken;
    }): PrintSeparatorExpression {
        return new PrintSeparatorExpression(options);
    }

    public createEscapedCharCodeLiteralExpression(options: {
        value: Token & { charCode: number };
    }): EscapedCharCodeLiteralExpression {
        return new EscapedCharCodeLiteralExpression(options);
    }

    public createArrayLiteralExpression(options: {
        elements: Array<Expression>;
        open?: Token;
        close?: Token;
    }): ArrayLiteralExpression {
        return new ArrayLiteralExpression(options);
    }

    public createAAMemberExpression(options: {
        key: Token;
        colon?: Token;
        /** The expression evaluated to determine the member's initial value. */
        value: Expression;
        comma?: Token;
    }): AAMemberExpression {
        return new AAMemberExpression(options);
    }

    public createAAIndexedMemberExpression(options: {
        leftBracket?: Token;
        key: Expression;
        rightBracket?: Token;
        colon?: Token;
        /** The expression evaluated to determine the member's initial value. */
        value: Expression;
        comma?: Token;
    }): AAIndexedMemberExpression {
        return new AAIndexedMemberExpression(options);
    }

    public createAALiteralExpression(options: {
        elements: Array<AAMemberExpression | AAIndexedMemberExpression>;
        open?: Token;
        close?: Token;
    }): AALiteralExpression {
        return new AALiteralExpression(options);
    }

    public createUnaryExpression(options: {
        operator: Token;
        right: Expression;
    }): UnaryExpression {
        return new UnaryExpression(options);
    }

    public createVariableExpression(options: {
        name: Identifier | string;
    }): VariableExpression {
        return new VariableExpression({ name: this.toIdentifier(options.name) });
    }

    public createSourceLiteralExpression(options: {
        value: Token;
    }): SourceLiteralExpression {
        return new SourceLiteralExpression(options);
    }

    public createNewExpression(options: {
        new?: Token;
        call: CallExpression;
    }): NewExpression {
        return new NewExpression(options);
    }

    public createCallfuncExpression(options: {
        callee: Expression;
        operator?: Token;
        methodName: Identifier;
        openingParen?: Token;
        args?: Expression[];
        closingParen?: Token;
    }): CallfuncExpression {
        return new CallfuncExpression(options);
    }

    public createTemplateStringQuasiExpression(options: {
        expressions: Array<LiteralExpression | EscapedCharCodeLiteralExpression>;
    }): TemplateStringQuasiExpression {
        return new TemplateStringQuasiExpression(options);
    }

    public createTemplateStringExpression(options: {
        openingBacktick?: Token;
        quasis: TemplateStringQuasiExpression[];
        expressions: Expression[];
        closingBacktick?: Token;
    }): TemplateStringExpression {
        return new TemplateStringExpression(options);
    }

    public createTaggedTemplateStringExpression(options: {
        tagName: Identifier;
        openingBacktick?: Token;
        quasis: TemplateStringQuasiExpression[];
        expressions: Expression[];
        closingBacktick?: Token;
    }): TaggedTemplateStringExpression {
        return new TaggedTemplateStringExpression(options);
    }

    public createAnnotationExpression(options: {
        at?: Token;
        name: Token;
        call?: CallExpression;
    }): AnnotationExpression {
        return new AnnotationExpression(options);
    }

    public createTernaryExpression(options: {
        test: Expression;
        questionMark?: Token;
        consequent?: Expression;
        colon?: Token;
        alternate?: Expression;
    }): TernaryExpression {
        return new TernaryExpression(options);
    }

    public createNullCoalescingExpression(options: {
        consequent: Expression;
        questionQuestion?: Token;
        alternate: Expression;
    }): NullCoalescingExpression {
        return new NullCoalescingExpression(options);
    }

    public createRegexLiteralExpression(options: {
        regexLiteral: Token;
    }): RegexLiteralExpression {
        return new RegexLiteralExpression(options);
    }

    public createTypeExpression(options: {
        /**
         * The standard AST expression that represents the type for this TypeExpression.
         */
        expression: Expression;
        /**
         * An already-known type for this TypeExpression, bypassing resolution of `expression`
         * via symbol table lookup. Useful when `expression` is not attached to (or can't resolve
         * against) a real symbol table - e.g. a type reference synthesized for a detached AST node.
         */
        resolvedType?: BscType;
    }): TypeExpression {
        return new TypeExpression(options);
    }

    public createTypecastExpression(options: {
        obj: Expression;
        as?: Token;
        typeExpression?: TypeExpression;
    }): TypecastExpression {
        return new TypecastExpression(options);
    }

    public createTypedArrayExpression(options: {
        innerType: Expression;
        leftBracket?: Token;
        rightBracket?: Token;
    }): TypedArrayExpression {
        return new TypedArrayExpression(options);
    }

    public createInlineInterfaceExpression(options: {
        open?: Token;
        members: InlineInterfaceMemberExpression[];
        close?: Token;
    }): InlineInterfaceExpression {
        return new InlineInterfaceExpression(options);
    }

    public createInlineInterfaceMemberExpression(options: {
        optional?: Token;
        name: Token;
        as?: Token;
        typeExpression?: TypeExpression;
    }): InlineInterfaceMemberExpression {
        return new InlineInterfaceMemberExpression(options);
    }

    public createTypedFunctionTypeExpression(options: {
        functionType?: Token;
        leftParen?: Token;
        params?: FunctionParameterExpression[];
        rightParen?: Token;
        as?: Token;
        returnType?: TypeExpression;
    }): TypedFunctionTypeExpression {
        return new TypedFunctionTypeExpression(options);
    }

    ////////////////////////////////
    // BrightScript statements
    ////////////////////////////////

    public createEmptyStatement(options?: {
        range?: Location;
    }): EmptyStatement {
        return new EmptyStatement(options);
    }

    public createBody(options?: {
        statements?: Statement[];
    }): Body {
        return new Body(options);
    }

    public createAssignmentStatement(options: {
        name: Identifier | string;
        equals?: Token;
        value: Expression;
        as?: Token;
        typeExpression?: TypeExpression;
    }): AssignmentStatement {
        return new AssignmentStatement({
            name: this.toIdentifier(options.name),
            equals: options.equals ?? this.createToken(TokenKind.Equal),
            value: options.value,
            as: options.as,
            typeExpression: options.typeExpression
        });
    }

    public createAugmentedAssignmentStatement(options: {
        item: Expression;
        operator: Token;
        value: Expression;
    }): AugmentedAssignmentStatement {
        return new AugmentedAssignmentStatement(options);
    }

    public createBlock(options?: {
        statements?: Statement[];
    }): Block {
        return new Block({ statements: options?.statements ?? [] });
    }

    public createExpressionStatement(options: {
        expression: Expression;
    }): ExpressionStatement {
        return new ExpressionStatement(options);
    }

    public createExitStatement(options?: {
        exit?: Token;
        loopType: Token;
    }): ExitStatement {
        return new ExitStatement(options);
    }

    public createFunctionStatement(options: {
        name: Identifier;
        func: FunctionExpression;
    }): FunctionStatement {
        return new FunctionStatement(options);
    }

    public createIfStatement(options: {
        if?: Token;
        then?: Token;
        else?: Token;
        endIf?: Token;
        condition: Expression;
        thenBranch: Block;
        elseBranch?: IfStatement | Block;
    }): IfStatement {
        return new IfStatement({
            if: options.if ?? this.createToken(TokenKind.If),
            condition: options.condition,
            then: options.then ?? this.createToken(TokenKind.Then),
            thenBranch: options.thenBranch,
            else: options.else ?? (options.elseBranch ? this.createToken(TokenKind.Else) : undefined),
            elseBranch: options.elseBranch,
            endIf: options.endIf ?? this.createToken(TokenKind.EndIf)
        });
    }

    public createIncrementStatement(options: {
        value: Expression;
        operator: Token;
    }): IncrementStatement {
        return new IncrementStatement(options);
    }

    public createPrintStatement(options: {
        print?: Token;
        expressions: Array<Expression>;
    }): PrintStatement {
        return new PrintStatement(options);
    }

    public createDimStatement(options: {
        dim?: Token;
        name: Identifier;
        openingSquare?: Token;
        dimensions: Expression[];
        closingSquare?: Token;
    }): DimStatement {
        return new DimStatement(options);
    }

    public createGotoStatement(options: {
        goto?: Token;
        label: Token;
    }): GotoStatement {
        return new GotoStatement(options);
    }

    public createLabelStatement(options: {
        name: Token;
        colon?: Token;
    }): LabelStatement {
        return new LabelStatement(options);
    }

    public createReturnStatement(options?: {
        return?: Token;
        value?: Expression;
    }): ReturnStatement {
        return new ReturnStatement(options);
    }

    public createEndStatement(options?: {
        end?: Token;
    }): EndStatement {
        return new EndStatement(options);
    }

    public createStopStatement(options?: {
        stop?: Token;
    }): StopStatement {
        return new StopStatement(options);
    }

    public createForStatement(options: {
        for?: Token;
        counterDeclaration: AssignmentStatement;
        to?: Token;
        finalValue: Expression;
        body: Block;
        endFor?: Token;
        step?: Token;
        increment?: Expression;
    }): ForStatement {
        return new ForStatement(options);
    }

    public createForEachStatement(options: {
        forEach?: Token;
        item: Token;
        as?: Token;
        typeExpression?: TypeExpression;
        in?: Token;
        target: Expression;
        body: Block;
        endFor?: Token;
    }): ForEachStatement {
        return new ForEachStatement(options);
    }

    public createWhileStatement(options: {
        while?: Token;
        endWhile?: Token;
        condition: Expression;
        body: Block;
    }): WhileStatement {
        return new WhileStatement(options);
    }

    public createDottedSetStatement(options: {
        obj: Expression;
        name: Identifier | string;
        value: Expression;
        dot?: Token;
        equals?: Token;
    }): DottedSetStatement {
        return new DottedSetStatement({
            obj: options.obj,
            name: this.toIdentifier(options.name),
            value: options.value,
            dot: options.dot ?? this.createToken(TokenKind.Dot),
            equals: options.equals ?? this.createToken(TokenKind.Equal)
        });
    }

    public createIndexedSetStatement(options: {
        obj: Expression;
        indexes: Expression[];
        value: Expression;
        openingSquare?: Token;
        closingSquare?: Token;
        equals?: Token;
    }): IndexedSetStatement {
        return new IndexedSetStatement({
            obj: options.obj,
            indexes: options.indexes,
            value: options.value,
            openingSquare: options.openingSquare ?? this.createToken(TokenKind.LeftSquareBracket),
            closingSquare: options.closingSquare ?? this.createToken(TokenKind.RightSquareBracket),
            equals: options.equals ?? this.createToken(TokenKind.Equal)
        });
    }

    public createLibraryStatement(options: {
        library: Token;
        filePath?: Token;
    }): LibraryStatement {
        return new LibraryStatement(options);
    }

    public createNamespaceStatement(options: {
        namespace?: Token;
        nameExpression: VariableExpression | DottedGetExpression;
        body: Body;
        endNamespace?: Token;
    }): NamespaceStatement {
        return new NamespaceStatement(options);
    }

    public createImportStatement(options: {
        import?: Token;
        path?: Token;
    }): ImportStatement {
        return new ImportStatement(options);
    }

    public createInterfaceStatement(options: {
        interface: Token;
        name: Identifier;
        extends?: Token;
        parentInterfaceName?: TypeExpression;
        body: Statement[];
        endInterface?: Token;
    }): InterfaceStatement {
        return new InterfaceStatement(options);
    }

    public createInterfaceFieldStatement(options: {
        name: Identifier;
        as?: Token;
        typeExpression?: TypeExpression;
        optional?: Token;
    }): InterfaceFieldStatement {
        return new InterfaceFieldStatement(options);
    }

    public createInterfaceMethodStatement(options: {
        functionType?: Token;
        name: Identifier;
        leftParen?: Token;
        params?: FunctionParameterExpression[];
        rightParen?: Token;
        as?: Token;
        returnTypeExpression?: TypeExpression;
        optional?: Token;
    }): InterfaceMethodStatement {
        return new InterfaceMethodStatement(options);
    }

    public createClassStatement(options: {
        class?: Token;
        /**
         * The name of the class (without namespace prefix)
         */
        name: Identifier;
        body: Statement[];
        endClass?: Token;
        extends?: Token;
        parentClassName?: TypeExpression;
    }): ClassStatement {
        return new ClassStatement(options);
    }

    /**
     * Create a `MethodStatement`. Defaults to an empty `function` body
     */
    public createMethodStatement(options: {
        modifiers?: Token | Token[];
        name: Identifier | string;
        func?: FunctionExpression;
        override?: Token;
    }): MethodStatement {
        return new MethodStatement({
            modifiers: options.modifiers,
            name: this.toIdentifier(options.name),
            func: options.func ?? this.createFunctionExpression(),
            override: options.override
        });
    }

    public createFieldStatement(options: {
        accessModifier?: Token;
        name: Identifier;
        as?: Token;
        typeExpression?: TypeExpression;
        equals?: Token;
        initialValue?: Expression;
        optional?: Token;
    }): FieldStatement {
        return new FieldStatement(options);
    }

    public createTryCatchStatement(options?: {
        try?: Token;
        endTry?: Token;
        tryBranch?: Block;
        catchStatement?: CatchStatement;
    }): TryCatchStatement {
        return new TryCatchStatement(options);
    }

    public createCatchStatement(options?: {
        catch?: Token;
        exceptionVariableExpression?: Expression;
        catchBranch?: Block;
    }): CatchStatement {
        return new CatchStatement(options);
    }

    public createThrowStatement(options?: {
        throw?: Token;
        expression?: Expression;
    }): ThrowStatement {
        return new ThrowStatement(options);
    }

    public createEnumStatement(options: {
        enum?: Token;
        name: Identifier;
        endEnum?: Token;
        body: Array<EnumMemberStatement>;
    }): EnumStatement {
        return new EnumStatement(options);
    }

    public createEnumMemberStatement(options: {
        name: Identifier;
        equals?: Token;
        value?: Expression;
    }): EnumMemberStatement {
        return new EnumMemberStatement(options);
    }

    public createConstStatement(options: {
        const?: Token;
        name: Identifier;
        equals?: Token;
        value: Expression;
    }): ConstStatement {
        return new ConstStatement(options);
    }

    public createContinueStatement(options: {
        continue?: Token;
        loopType: Token;
    }): ContinueStatement {
        return new ContinueStatement(options);
    }

    public createTypecastStatement(options: {
        typecast?: Token;
        typecastExpression: TypecastExpression;
    }): TypecastStatement {
        return new TypecastStatement(options);
    }

    public createConditionalCompileErrorStatement(options: {
        hashError?: Token;
        message: Token;
    }): ConditionalCompileErrorStatement {
        return new ConditionalCompileErrorStatement(options);
    }

    public createAliasStatement(options: {
        alias?: Token;
        name: Token;
        equals?: Token;
        value: VariableExpression | DottedGetExpression;
    }): AliasStatement {
        return new AliasStatement(options);
    }

    public createConditionalCompileStatement(options: {
        hashIf?: Token;
        not?: Token;
        condition: Token;
        hashElse?: Token;
        hashEndIf?: Token;
        thenBranch: Block;
        elseBranch?: ConditionalCompileStatement | Block;
    }): ConditionalCompileStatement {
        return new ConditionalCompileStatement(options);
    }

    public createConditionalCompileConstStatement(options: {
        hashConst?: Token;
        assignment: AssignmentStatement;
    }): ConditionalCompileConstStatement {
        return new ConditionalCompileConstStatement(options);
    }

    public createTypeStatement(options: {
        type?: Token;
        name: Token;
        equals?: Token;
        value: TypeExpression;
    }): TypeStatement {
        return new TypeStatement(options);
    }

    ////////////////////////////////
    // SceneGraph xml
    ////////////////////////////////

    /**
     * Build the constructor options for an SG element, filling in default tokens.
     * @param options the options passed by the caller
     * @param defaultTagName the tag name to use when `options.startTagName` is not provided
     * @param defaultSelfClosing if true, the element will be self-closing (i.e. `<field />`) when it has no child elements
     */
    private getSGElementOptions(options: SGElementFactoryOptions | undefined, defaultTagName: string | undefined, defaultSelfClosing: boolean) {
        const startTagName = this.toSGToken(options?.startTagName ?? defaultTagName);
        const selfClosing = defaultSelfClosing && !options?.elements?.length;

        let attributes: SGAttribute[];
        if (Array.isArray(options?.attributes)) {
            attributes = options.attributes;
        } else {
            attributes = Object.entries(options?.attributes ?? {}).map(([key, value]) => this.createSGAttribute({ key: key, value: value }));
        }
        return {
            startTagOpen: this.toSGToken(options?.startTagOpen ?? '<'),
            startTagName: startTagName,
            attributes: attributes,
            startTagClose: this.toSGToken(options?.startTagClose ?? (selfClosing ? '/>' : '>')),
            elements: options?.elements ?? [],
            endTagOpen: selfClosing ? undefined : this.toSGToken(options?.endTagOpen ?? '</'),
            endTagName: selfClosing ? undefined : this.toSGToken(options?.endTagName ?? startTagName?.text),
            endTagClose: selfClosing ? undefined : this.toSGToken(options?.endTagClose ?? '>')
        };
    }

    /**
     * Create an `SGAttribute` (i.e. `name="value"`). The `=` and quotes default to their standard text
     */
    public createSGAttribute(options: {
        key: SGTokenLike;
        equals?: SGTokenLike;
        openingQuote?: SGTokenLike;
        value?: SGTokenLike;
        closingQuote?: SGTokenLike;
    }): SGAttribute {
        return new SGAttribute({
            key: this.toSGToken(options.key),
            equals: this.toSGToken(options.equals ?? '='),
            openingQuote: this.toSGToken(options.openingQuote ?? '"'),
            value: this.toSGToken(options.value ?? ''),
            closingQuote: this.toSGToken(options.closingQuote ?? '"')
        });
    }

    /**
     * Create a generic SceneGraph xml element. `startTagName` is required
     */
    public createSGElement(options: SGElementFactoryOptions & { startTagName: SGTokenLike }): SGElement {
        return new SGElement(this.getSGElementOptions(options, undefined, true));
    }

    /**
     * Create the xml prolog (i.e. `<?xml version="1.0" encoding="utf-8" ?>`)
     */
    public createSGProlog(options?: SGElementFactoryOptions): SGProlog {
        return new SGProlog(this.getSGElementOptions({ startTagOpen: '<?', startTagClose: '?>', ...options }, 'xml', true));
    }

    /**
     * Create a SceneGraph node element (i.e. `<Label />`). `startTagName` is required
     */
    public createSGNode(options: SGElementFactoryOptions & { startTagName: SGTokenLike }): SGNode {
        return new SGNode(this.getSGElementOptions(options, undefined, true));
    }

    /**
     * Create a `<children>` element
     */
    public createSGChildren(options?: SGElementFactoryOptions): SGChildren {
        return new SGChildren(this.getSGElementOptions(options, 'children', false));
    }

    /**
     * Create a `<customization>` element
     */
    public createSGCustomization(options?: SGElementFactoryOptions): SGCustomization {
        return new SGCustomization(this.getSGElementOptions(options, 'customization', false));
    }

    /**
     * Create a `<script>` element
     */
    public createSGScript(options?: SGElementFactoryOptions): SGScript {
        return new SGScript(this.getSGElementOptions(options, 'script', true));
    }

    /**
     * Create an interface `<field>` element
     */
    public createSGInterfaceField(options?: SGElementFactoryOptions): SGInterfaceField {
        return new SGInterfaceField(this.getSGElementOptions(options, 'field', true));
    }

    /**
     * Create an interface `<function>` element
     */
    public createSGInterfaceFunction(options?: SGElementFactoryOptions): SGInterfaceFunction {
        return new SGInterfaceFunction(this.getSGElementOptions(options, 'function', true));
    }

    /**
     * Create an `<interface>` element
     */
    public createSGInterface(options?: SGElementFactoryOptions): SGInterface {
        return new SGInterface(this.getSGElementOptions(options, 'interface', false));
    }

    /**
     * Create a `<component>` element
     */
    public createSGComponent(options?: SGElementFactoryOptions): SGComponent {
        return new SGComponent(this.getSGElementOptions(options, 'component', false));
    }

    public createSGAst(options?: {
        prologElement?: SGProlog;
        rootElement?: SGElement;
        componentElement?: SGComponent;
    }): SGAst {
        return new SGAst(options);
    }
}

/**
 * A shared factory used internally by brighterscript.
 *
 * Plugins should NOT use this. Use `program.factory` instead, which ensures that objects are created by the version of
 * brighterscript that is actually running the plugin.
 */
export const bscFactory = new BscFactory();
