import { Position } from 'vscode-languageserver';
import { Token } from '../lexer/Token';
import { TokenKind } from '../lexer/TokenKind';
import { LiteralExpression, Expression, CallExpression, NamespacedVariableNameExpression, DottedGetExpression, VariableExpression } from '../parser/Expression';
import { BrsType, BrsString, BrsInvalid, Int32, Float } from '../brsTypes';
import util from '../util';

export function createRange(pos: Position) {
    return util.createRange(pos.line, pos.character, pos.line, pos.character);
}

export function createToken<T extends TokenKind>(kind: T, pos: Position, text?: string, literal?: BrsType): Token & { kind: T } {
    return {
        kind: kind,
        text: text || kind.toString(),
        isReserved: !text || text === kind.toString(),
        range: createRange(pos),
        literal: literal
    };
}

export function createIdentifier(ident: string, pos: Position, namespaceName?: NamespacedVariableNameExpression): VariableExpression {
    return new VariableExpression(createToken(TokenKind.Identifier, pos, ident), namespaceName);
}
export function createDottedIdentifier(path: string[], pos: Position, namespaceName?: NamespacedVariableNameExpression): DottedGetExpression {
    const ident = path.pop();
    const obj = path.length > 1 ? createDottedIdentifier(path, pos, namespaceName) : createIdentifier(path[0], pos, namespaceName);
    return new DottedGetExpression(obj, createToken(TokenKind.Identifier, pos, ident), createToken(TokenKind.Dot, pos, '.'));
}

export function createStringLiteral(value: string, pos: Position) {
    return new LiteralExpression(new BrsString(value), createRange(pos));
}
export function createIntegerLiteral(value: number, pos: Position) {
    return new LiteralExpression(new Int32(value), createRange(pos));
}
export function createFloatLiteral(value: number, pos: Position) {
    return new LiteralExpression(new Float(value), createRange(pos));
}
export function createInvalidLiteral(pos: Position) {
    return new LiteralExpression(new BrsInvalid(), createRange(pos));
}

export function createCall(callee: Expression, args?: Expression[], namespaceName?: NamespacedVariableNameExpression) {
    return new CallExpression(
        callee,
        createToken(TokenKind.LeftParen, callee.range.end, '('),
        createToken(TokenKind.RightParen, callee.range.end, ')'),
        args || [],
        namespaceName
    );
}
