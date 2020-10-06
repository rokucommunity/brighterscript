import { Range } from 'vscode-languageserver';
import { Token } from '../lexer/Token';
import { TokenKind } from '../lexer/TokenKind';
import { LiteralExpression, Expression, CallExpression, NamespacedVariableNameExpression, DottedGetExpression, VariableExpression } from '../parser/Expression';

export const interpolatedRange = Range.create(-1, -1, -1, -1);

export function createToken<T extends TokenKind>(kind: T, text?: string, range = interpolatedRange): Token & { kind: T } {
    return {
        kind: kind,
        text: text || kind.toString(),
        isReserved: !text || text === kind.toString(),
        range: range,
        leadingWhitespace: ''
    };
}

export function createIdentifier(ident: string, range?: Range, namespaceName?: NamespacedVariableNameExpression): VariableExpression {
    return new VariableExpression(createToken(TokenKind.Identifier, ident, range), namespaceName);
}
export function createDottedIdentifier(path: string[], range?: Range, namespaceName?: NamespacedVariableNameExpression): DottedGetExpression {
    const ident = path.pop();
    const obj = path.length > 1 ? createDottedIdentifier(path, range, namespaceName) : createIdentifier(path[0], range, namespaceName);
    return new DottedGetExpression(obj, createToken(TokenKind.Identifier, ident, range), createToken(TokenKind.Dot, '.', range));
}

export function createStringLiteral(value: string, range?: Range) {
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

export function createCall(callee: Expression, args?: Expression[], namespaceName?: NamespacedVariableNameExpression) {
    return new CallExpression(
        callee,
        createToken(TokenKind.LeftParen, '('),
        createToken(TokenKind.RightParen, ')'),
        args || [],
        namespaceName
    );
}
