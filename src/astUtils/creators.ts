import type { Location } from 'vscode-languageserver';
import type { Identifier, Token } from '../lexer/Token';
import type { SGToken } from '../parser/SGTypes';
import { SGAttribute, SGComponent, SGInterface, SGInterfaceField, SGInterfaceFunction, SGScript } from '../parser/SGTypes';
import { TokenKind } from '../lexer/TokenKind';
import type { Expression } from '../parser/AstNode';
import { CallExpression, DottedGetExpression, FunctionExpression, LiteralExpression, VariableExpression } from '../parser/Expression';
import { Block, MethodStatement } from '../parser/Statement';

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
    [TokenKind.SourceLineNumLiteral]: 'SOURCE_LINE_NUM',
    [TokenKind.SourceLocationLiteral]: 'SOURCE_LOCATION',
    [TokenKind.Star]: '*',
    [TokenKind.StarEqual]: '*=',
    [TokenKind.Tab]: '\t',
    [TokenKind.TemplateStringExpressionBegin]: '${',
    [TokenKind.TemplateStringExpressionEnd]: '}',
    [TokenKind.Whitespace]: ' '
};

export function createToken<T extends TokenKind>(kind: T, text?: string, location?: Location): Token & { kind: T } {
    return {
        kind: kind,
        text: text ?? tokenDefaults[kind as string] ?? kind.toString().toLowerCase(),
        isReserved: !text || text === kind.toString(),
        location: location,
        leadingWhitespace: '',
        leadingTrivia: []
    };
}

export function createIdentifier(name: string, location?: Location): Identifier {
    return {
        kind: TokenKind.Identifier,
        text: name,
        isReserved: false,
        location: location,
        leadingWhitespace: '',
        leadingTrivia: []
    };
}

export function createVariableExpression(ident: string, location?: Location): VariableExpression {
    return new VariableExpression({ name: createToken(TokenKind.Identifier, ident, location) });
}

export function createDottedIdentifier(path: string[], location?: Location): DottedGetExpression {
    const ident = path.pop();
    const obj = path.length > 1 ? createDottedIdentifier(path, location) : createVariableExpression(path[0], location);
    return new DottedGetExpression({
        obj: obj,
        name: createToken(TokenKind.Identifier, ident, location),
        dot: createToken(TokenKind.Dot, '.', location)
    });
}

/**
 * Create a StringLiteralExpression. The TokenKind.StringLiteral token value includes the leading and trailing doublequote during lexing.
 * Since brightscript doesn't support strings with quotes in them, we can safely auto-detect and wrap the value in quotes in this function.
 * @param value - the string value. (value will be wrapped in quotes if they are missing)
 */
export function createStringLiteral(value: string, location?: Location) {
    //wrap the value in double quotes
    if (!value.startsWith('"') && !value.endsWith('"')) {
        value = '"' + value + '"';
    }
    return new LiteralExpression({ value: createToken(TokenKind.StringLiteral, value, location) });
}
export function createIntegerLiteral(value: string, location?: Location) {
    return new LiteralExpression({ value: createToken(TokenKind.IntegerLiteral, value, location) });
}
export function createFloatLiteral(value: string, location?: Location) {
    return new LiteralExpression({ value: createToken(TokenKind.FloatLiteral, value, location) });
}
export function createDoubleLiteral(value: string, location?: Location) {
    return new LiteralExpression({ value: createToken(TokenKind.DoubleLiteral, value, location) });
}
export function createLongIntegerLiteral(value: string, location?: Location) {
    return new LiteralExpression({ value: createToken(TokenKind.LongIntegerLiteral, value, location) });
}
export function createInvalidLiteral(value?: string, location?: Location) {
    return new LiteralExpression({ value: createToken(TokenKind.Invalid, value, location) });
}
export function createBooleanLiteral(value: string, location?: Location) {
    return new LiteralExpression({ value: createToken(value === 'true' ? TokenKind.True : TokenKind.False, value, location) });
}
export function createFunctionExpression(kind: TokenKind.Sub | TokenKind.Function) {
    return new FunctionExpression({
        parameters: [],
        body: new Block({ statements: [] }),
        functionType: createToken(kind),
        endFunctionType: kind === TokenKind.Sub ? createToken(TokenKind.EndSub) : createToken(TokenKind.EndFunction),
        leftParen: createToken(TokenKind.LeftParen),
        rightParen: createToken(TokenKind.RightParen)
    });
}

export function createMethodStatement(name: string, kind: TokenKind.Sub | TokenKind.Function = TokenKind.Function, modifiers?: Token[]) {
    return new MethodStatement({
        modifiers: modifiers,
        name: createIdentifier(name),
        func: createFunctionExpression(kind)
    });
}

export function createCall(callee: Expression, args?: Expression[]) {
    return new CallExpression({
        callee: callee,
        openingParen: createToken(TokenKind.LeftParen, '('),
        closingParen: createToken(TokenKind.RightParen, ')'),
        args: args
    });
}

export function createSGToken(text: string, location?: Location) {
    return {
        text: text,
        range: location
    } as SGToken;
}

/**
 * Create an SGAttribute without any ranges
 */
export function createSGAttribute(keyName: string, value: string) {
    return new SGAttribute({
        key: { text: keyName },
        equals: { text: '=' },
        openingQuote: { text: '"' },
        value: { text: value },
        closingQuote: { text: '"' }
    });
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
    return new SGInterfaceField({
        startTagOpen: { text: '<' },
        startTagName: { text: 'field' },
        attributes: attrs,
        startTagClose: { text: '/>' }
    });
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
    return new SGComponent({
        startTagOpen: { text: '<' },
        startTagName: { text: 'component' },
        attributes: attributes,
        startTagClose: { text: '>' },
        elements: [],
        endTagOpen: { text: '</' },
        endTagName: { text: 'component' },
        endTagClose: { text: '>' }
    });
}

export function createSGInterfaceFunction(functionName: string) {
    return new SGInterfaceFunction({
        startTagOpen: { text: '<' },
        startTagName: { text: 'function' },
        attributes: [createSGAttribute('name', functionName)],
        startTagClose: { text: '/>' }
    });
}

export function createSGInterface() {
    return new SGInterface({
        startTagOpen: { text: '<' },
        startTagName: { text: 'interface' },
        attributes: [],
        startTagClose: { text: '>' },
        elements: [],
        endTagOpen: { text: '</' },
        endTagName: { text: 'interface' },
        endTagClose: { text: '>' }
    });
}

export function createSGScript(attributes: { type?: string; uri?: string }) {
    const attrs = [] as SGAttribute[];
    for (let key in attributes) {
        attrs.push(
            createSGAttribute(key, attributes[key])
        );
    }
    return new SGScript({
        startTagOpen: { text: '<' },
        startTagName: { text: 'script' },
        attributes: attrs,
        startTagClose: { text: '/>' }
    });
}
