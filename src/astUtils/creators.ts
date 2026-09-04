import type { Range } from 'vscode-languageserver';
import type { Identifier, Token } from '../lexer/Token';
import { TokenKind } from '../lexer/TokenKind';
import type { Expression, Statement } from '../parser/AstNode';
import { LiteralExpression, CallExpression, DottedGetExpression, VariableExpression, FunctionExpression } from '../parser/Expression';
import type { SGAttribute } from '../parser/SGTypes';
import { AssignmentStatement, Block, DottedSetStatement, IfStatement, IndexedSetStatement, MethodStatement } from '../parser/Statement';

/**
 * A range that points to the beginning of the file. Used to give non-null ranges to programmatically-added source code.
 * (Hardcoded range to prevent circular dependency issue in `../util.ts`)
 * @deprecated don't use this, it screws up sourcemaps. Just set range to null
 */
export const interpolatedRange = {
    start: {
        line: 0,
        character: 0
    },
    end: {
        line: 0,
        character: 0
    }
} as Range;

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

export function createToken<T extends TokenKind>(kind: T, text?: string, range?: Range): Token & { kind: T } {
    return {
        kind: kind,
        text: text ?? tokenDefaults[kind as string] ?? kind.toString().toLowerCase(),
        isReserved: !text || text === kind.toString(),
        range: range,
        leadingWhitespace: ''
    };
}

export function createIdentifier(name: string, range?: Range): Identifier {
    return {
        kind: TokenKind.Identifier,
        text: name,
        isReserved: false,
        range: range,
        leadingWhitespace: ''
    };
}

export function createVariableExpression(ident: string, range?: Range): VariableExpression {
    return new VariableExpression(createToken(TokenKind.Identifier, ident, range));
}

export function createDottedIdentifier(path: string[], range?: Range): DottedGetExpression {
    const ident = path.pop();
    const obj = path.length > 1 ? createDottedIdentifier(path, range) : createVariableExpression(path[0], range);
    return new DottedGetExpression(obj, createToken(TokenKind.Identifier, ident, range), createToken(TokenKind.Dot, '.', range));
}

/**
 * Create a StringLiteralExpression. The TokenKind.StringLiteral token value includes the leading and trailing doublequote during lexing.
 * Since brightscript doesn't support strings with quotes in them, we can safely auto-detect and wrap the value in quotes in this function.
 * @param value - the string value. (value will be wrapped in quotes if they are missing)
 */
export function createStringLiteral(value: string, range?: Range) {
    //wrap the value in double quotes
    if (!value.startsWith('"') && !value.endsWith('"')) {
        value = '"' + value + '"';
    }
    return new LiteralExpression(createToken(TokenKind.StringLiteral, value, range));
}
export function createIntegerLiteral(value: string, range?: Range) {
    return new LiteralExpression(createToken(TokenKind.IntegerLiteral, value, range));
}
export function createFloatLiteral(value: string, range?: Range) {
    return new LiteralExpression(createToken(TokenKind.FloatLiteral, value, range));
}
export function createInvalidLiteral(value?: string, range?: Range) {
    return new LiteralExpression(createToken(TokenKind.Invalid, value, range));
}
export function createBooleanLiteral(value: 'true' | 'false', range?: Range) {
    return new LiteralExpression(createToken(value === 'true' ? TokenKind.True : TokenKind.False, value, range));
}
export function createFunctionExpression(kind: TokenKind.Sub | TokenKind.Function) {
    return new FunctionExpression(
        [],
        new Block([]),
        createToken(kind),
        kind === TokenKind.Sub ? createToken(TokenKind.EndSub) : createToken(TokenKind.EndFunction),
        createToken(TokenKind.LeftParen),
        createToken(TokenKind.RightParen)
    );
}

export function createMethodStatement(name: string, kind: TokenKind.Sub | TokenKind.Function = TokenKind.Function, modifiers?: Token[]) {
    return new MethodStatement(
        modifiers,
        createIdentifier(name),
        createFunctionExpression(kind),
        null
    );
}

/**
 * @deprecated use `createMethodStatement`
 */
export function createClassMethodStatement(name: string, kind: TokenKind.Sub | TokenKind.Function = TokenKind.Function, accessModifier?: Token) {
    return createMethodStatement(name, kind, [accessModifier]);
}

export function createCall(callee: Expression, args?: Expression[]) {
    return new CallExpression(
        callee,
        createToken(TokenKind.LeftParen, '('),
        createToken(TokenKind.RightParen, ')'),
        args || []
    );
}

/**
 * Create an SGAttribute without any ranges
 */
export function createSGAttribute(keyName: string, value: string) {
    return {
        key: {
            text: keyName
        },
        value: {
            text: value
        }
    } as SGAttribute;
}

export function createIfStatement(options: {
    if?: Token;
    condition: Expression;
    then?: Token;
    thenBranch: Block;
    else?: Token;
    elseBranch?: IfStatement | Block;
    endIf?: Token;
}) {
    return new IfStatement(
        {
            if: options.if ?? createToken(TokenKind.If),
            then: options.then ?? createToken(TokenKind.Then),
            else: options.else ?? createToken(TokenKind.Else),
            endIf: options.endIf ?? createToken(TokenKind.EndIf)
        },
        options.condition,
        options.thenBranch,
        options.elseBranch
    );
}

export function createBlock(options: { statements: Statement[] }) {
    return new Block(options.statements);
}

export function createAssignmentStatement(options: {
    name: Identifier | string;
    equals?: Token;
    value: Expression;
}) {
    return new AssignmentStatement(
        options.equals ?? createToken(TokenKind.Equal),
        typeof options.name === 'string' ? createIdentifier(options.name) : options.name,
        options.value
    );
}

export function createDottedSetStatement(options: {
    obj: Expression;
    dot?: Token;
    name: Identifier | string;
    equals?: Token;
    value: Expression;
}) {
    return new DottedSetStatement(
        options.obj,
        typeof options.name === 'string' ? createIdentifier(options.name) : options.name,
        options.value,
        options.dot,
        options.equals ?? createToken(TokenKind.Equal)
    );
}

export function createIndexedSetStatement(options: {
    obj: Expression;
    openingSquare?: Token;
    index: Expression;
    closingSquare?: Token;
    equals?: Token;
    value: Expression;
    additionalIndexes?: Expression[];
}) {
    return new IndexedSetStatement(
        options.obj,
        options.index,
        options.value,
        options.openingSquare ?? createToken(TokenKind.LeftSquareBracket),
        options.closingSquare ?? createToken(TokenKind.RightSquareBracket),
        options.additionalIndexes || [],
        options.equals ?? createToken(TokenKind.Equal)
    );
}
