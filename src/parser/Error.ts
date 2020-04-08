import { BrsType, ValueKind, valueKindToString } from '../brsTypes';
import { TokenKind, Token } from '../lexer';
import { Range } from 'vscode-languageserver';

export class BrsError {
    constructor(readonly message: string, readonly range: Range, readonly code: number = 100) {
    }
}

/** Wraps up the metadata associated with a type mismatch error. */
export interface TypeMismatchMetadata {
    /**
     * The base message to use for this error. Should be as helpful as possible, e.g.
     * "Attempting to subtract non-numeric values".
     */
    message: string;
    /** The value on the left-hand side of a binary operator, or the *only* value for a unary operator. */
    left: TypeAndRange;
    /** The value on the right-hand side of a binary operator. */
    right?: TypeAndRange;
}

export interface TypeAndRange {
    /** The type of a value involved in a type mismatch. */
    type: BrsType | ValueKind;
    /** The location at which the offending value was resolved. */
    range: Range;
}

/**
 * Creates a "type mismatch"-like error message, but with the appropriate types specified.
 * @return a type mismatch error that will be tracked by this module.
 */
export class TypeMismatch extends BrsError {
    constructor(mismatchMetadata: TypeMismatchMetadata) {
        let messageLines = [
            mismatchMetadata.message,
            `    left: ${valueKindToString(getKind(mismatchMetadata.left.type))}`
        ];
        let location = mismatchMetadata.left.range;

        if (mismatchMetadata.right) {
            messageLines.push(
                `    right: ${valueKindToString(getKind(mismatchMetadata.right.type))}`
            );

            location.end = mismatchMetadata.right.range.end;
        }

        super(messageLines.join('\n'), location);
    }
}

/**
 * Returns the `.kind` property of a `BrsType`, otherwise returns the provided `ValueKind`.
 * @param maybeType the `BrsType` to extract a `.kind` field from, or the `ValueKind` to return directly
 * @returns the `ValueKind` for `maybeType`
 */
export function getKind(maybeType: BrsType | ValueKind): ValueKind {
    if (typeof maybeType === 'number') {
        return maybeType;
    } else {
        return maybeType.kind;
    }
}

export class ParseError extends BrsError {
    constructor(token: Token, message: string, code = 1000) {
        let m = message;
        if (token.kind === TokenKind.Eof) {
            m = '(At end of file) ' + message;
        }

        super(m, token.range, code);
    }
}
