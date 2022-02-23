import type { Range } from 'vscode-languageserver';
import type { Identifier, Token } from '../lexer/Token';
import { SGAttribute, SGComponent, SGInterface, SGInterfaceField, SGInterfaceFunction, SGScript } from '../parser/SGTypes';
import { TokenKind } from '../lexer/TokenKind';
import type { Expression, NamespacedVariableNameExpression } from '../parser/Expression';
import { LiteralExpression, CallExpression, DottedGetExpression, VariableExpression, FunctionExpression } from '../parser/Expression';
import { Block, ClassMethodStatement } from '../parser/Statement';

/**
 * A range that points to nowhere. Used to give non-null ranges to programmatically-added source code.
 * (Hardcoded range to prevent circular dependency issue in `../util.ts`
 */
export const interpolatedRange = {
    start: {
        line: -1,
        character: -1
    },
    end: {
        line: -1,
        character: -1
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
    [TokenKind.SourceLineNumLiteral]: 'SOURCE_LINE_NUM',
    [TokenKind.SourceLocationLiteral]: 'SOURCE_LOCATION',
    [TokenKind.Star]: '*',
    [TokenKind.StarEqual]: '*=',
    [TokenKind.Tab]: '\t',
    [TokenKind.TemplateStringExpressionBegin]: '${',
    [TokenKind.TemplateStringExpressionEnd]: '}',
    [TokenKind.Whitespace]: ' '
};

export function createToken<T extends TokenKind>(kind: T, text?: string, range = interpolatedRange): Token & { kind: T } {
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

export function createVariableExpression(ident: string, range?: Range, namespaceName?: NamespacedVariableNameExpression): VariableExpression {
    return new VariableExpression(createToken(TokenKind.Identifier, ident, range), namespaceName);
}

export function createDottedIdentifier(path: string[], range?: Range, namespaceName?: NamespacedVariableNameExpression): DottedGetExpression {
    const ident = path.pop();
    const obj = path.length > 1 ? createDottedIdentifier(path, range, namespaceName) : createVariableExpression(path[0], range, namespaceName);
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
        new Block([], interpolatedRange),
        createToken(kind),
        kind === TokenKind.Sub ? createToken(TokenKind.EndSub) : createToken(TokenKind.EndFunction),
        createToken(TokenKind.LeftParen),
        createToken(TokenKind.RightParen)
    );
}

export function createClassMethodStatement(name: string, kind: TokenKind.Sub | TokenKind.Function = TokenKind.Function) {
    return new ClassMethodStatement(
        createToken(TokenKind.Class),
        createIdentifier(name),
        createFunctionExpression(kind),
        null
    );
}

export function createCall(callee: Expression, args?: Expression[], namespaceName?: NamespacedVariableNameExpression) {
    return new CallExpression(
        callee,
        createToken(TokenKind.LeftParen, '('),
        createToken(TokenKind.RightParen, ')'),
        args || [],
        namespaceName
    );
}

/**
 * Create an SGAttribute without any ranges
 */
export function createSGAttribute(keyName: string, value: string) {
    return new SGAttribute(
        { text: keyName },
        { text: '=' },
        { text: '"' },
        { text: value },
        { text: '"' }
    );
}

export function createSGInterfaceField(id: string, attributes: { type?: string; alias?: string; value?: string; onChange?: string; alwaysNotify?: string } = {}) {
    const attrs = [
        createSGAttribute('id', id)
    ];
    for (let key in attributes) {
        attrs.push(
            createSGAttribute(key, attributes[key])
        );
    }
    return new SGInterfaceField(
        { text: '<' },
        { text: 'field' },
        attrs,
        { text: '/>' }
    );
}

export function createSGComponent(name: string, parentName?: string) {
    const attributes = [
        createSGAttribute('name', name)
    ];
    if (parentName) {
        attributes.push(
            createSGAttribute('extends', parentName)
        );
    }
    return new SGComponent(
        { text: '<' },
        { text: 'component' },
        attributes,
        { text: '>' },
        [],
        { text: '</' },
        { text: 'component' },
        { text: '>' }
    );
}

export function createSGInterfaceFunction(functionName: string) {
    return new SGInterfaceFunction(
        { text: '<' },
        { text: 'function' },
        [createSGAttribute('name', functionName)],
        { text: '/>' }
    );
}

export function createSGInterface() {
    return new SGInterface(
        { text: '<' },
        { text: 'interface' },
        [],
        { text: '>' },
        [],
        { text: '</' },
        { text: 'interface' },
        { text: '>' }
    );
}

export function createSGScript(attributes: { type?: string; uri?: string }) {
    const attrs = [] as SGAttribute[];
    for (let key in attributes) {
        attrs.push(
            createSGAttribute(key, attributes[key])
        );
    }
    return new SGScript(
        { text: '<' },
        { text: 'script' },
        attrs,
        { text: '/>' }
    );
}
