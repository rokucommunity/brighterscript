//tslint:disable
import { BrsType, ValueKind } from "./brsTypes";
import { Location } from "./lexer";

export class BrsError extends Error {
    constructor(message: string, readonly location: Location) {
        super(message);
        Object.setPrototypeOf(this, BrsError.prototype);
    }

    /**
     * Formats the error into a human-readable string including filename, starting and ending line
     * and column, and the message associated with the error, e.g.:
     *
     * `lorem.brs(1,1-3): Expected '(' after sub name`
     * ```
     */
    format() {
        let location = this.location;

        let formattedLocation: string;

        if (location.start.line === location.end.line) {
            let columns = `${location.start.column}`;
            if (location.start.column !== location.end.column) {
                columns += `-${location.end.column}`;
            }
            formattedLocation = `${location.file}(${location.start.line},${columns})`;
        } else {
            formattedLocation = `${location.file}(${location.start.line},${location.start.column},${location.end.line},${location.end.line})`;
        }

        return `${formattedLocation}: ${this.message}`;
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
    left: TypeAndLocation;
    /** The value on the right-hand side of a binary operator. */
    right?: TypeAndLocation;
}

export type TypeAndLocation = {
    /** The type of a value involved in a type mismatch. */
    type: BrsType | ValueKind;
    /** The location at which the offending value was resolved. */
    location: Location;
};

/**
 * Creates a "type mismatch"-like error message, but with the appropriate types specified.
 * @return a type mismatch error that will be tracked by this module.
 */
export class TypeMismatch extends BrsError {
    constructor(mismatchMetadata: TypeMismatchMetadata) {
        let messageLines = [
            mismatchMetadata.message,
            `    left: ${ValueKind.toString(getKind(mismatchMetadata.left.type))}`,
        ];
        let location = mismatchMetadata.left.location;

        if (mismatchMetadata.right) {
            messageLines.push(
                `    right: ${ValueKind.toString(getKind(mismatchMetadata.right.type))}`
            );

            location.end = mismatchMetadata.right.location.end;
        }

        super(messageLines.join("\n"), location);
    }
}

/**
 * Returns the `.kind` property of a `BrsType`, otherwise returns the provided `ValueKind`.
 * @param maybeType the `BrsType` to extract a `.kind` field from, or the `ValueKind` to return directly
 * @returns the `ValueKind` for `maybeType`
 */
export function getKind(maybeType: BrsType | ValueKind): ValueKind {
    if (typeof maybeType === "number") {
        return maybeType;
    } else {
        return maybeType.kind;
    }
}
