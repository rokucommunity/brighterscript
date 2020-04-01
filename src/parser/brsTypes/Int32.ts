import { ValueKind, Comparable, BrsBoolean } from './BrsType';
import { BrsNumber, Numeric } from './BrsNumber';
import { BrsType } from './';
import { Float } from './Float';
import { Double } from './Double';
import { Int64 } from './Int64';

export class Int32 implements Numeric, Comparable {
    readonly kind = ValueKind.Int32;
    private readonly value: number;

    getValue(): number {
        return this.value;
    }

    /**
     * Creates a new BrightScript 32-bit integer value representing the provided `value`.
     * @param value the value to store in the BrightScript number, rounded to the nearest 32-bit
     *              integer.
     */
    constructor(initialValue: number) {
        this.value = Math.round(initialValue);
    }

    /**
     * Creates a new BrightScript 32-bit integer value representing the integer contained in
     * `asString`.
     * @param asString the string representation of the value to store in the BrightScript 32-bit
     *                 int. Will be rounded to the nearest 32-bit integer.
     * @returns a BrightScript 32-bit integer value representing `asString`.
     */
    static fromString(asString: string): Int32 {
        if (asString.toLowerCase().startsWith('&h')) {
            asString = asString.slice(2); // remove "&h" from the string representation
            return new Int32(Number.parseInt(asString, 16));
        }
        return new Int32(Number.parseFloat(asString));
    }

    add(rhs: BrsNumber): BrsNumber {
        switch (rhs.kind) {
            case ValueKind.Int32:
                return new Int32(this.getValue() + rhs.getValue());
            case ValueKind.Int64:
                return new Int64(rhs.getValue().add(this.getValue()));
            case ValueKind.Float:
                return new Float(this.getValue() + rhs.getValue());
            case ValueKind.Double:
                return new Double(this.getValue() + rhs.getValue());
        }
    }

    subtract(rhs: BrsNumber): BrsNumber {
        switch (rhs.kind) {
            case ValueKind.Int32:
                return new Int32(this.getValue() - rhs.getValue());
            case ValueKind.Int64:
                return new Int64(this.getValue()).subtract(rhs);
            case ValueKind.Float:
                return new Float(this.getValue() - rhs.getValue());
            case ValueKind.Double:
                return new Double(this.getValue() - rhs.getValue());
        }
    }

    multiply(rhs: BrsNumber): BrsNumber {
        switch (rhs.kind) {
            case ValueKind.Int32:
                return new Int32(this.getValue() * rhs.getValue());
            case ValueKind.Int64:
                return new Int64(rhs.getValue().multiply(this.getValue()));
            case ValueKind.Float:
                return new Float(this.getValue() * rhs.getValue());
            case ValueKind.Double:
                return new Double(this.getValue() * rhs.getValue());
        }
    }

    divide(rhs: BrsNumber): Float | Double {
        switch (rhs.kind) {
            case ValueKind.Int32:
                return new Float(this.getValue() / rhs.getValue());
            case ValueKind.Int64:
                return new Float(this.getValue() / rhs.getValue().toNumber());
            case ValueKind.Float:
                return new Float(this.getValue() / rhs.getValue());
            case ValueKind.Double:
                return new Double(this.getValue() / rhs.getValue());
        }
    }

    modulo(rhs: BrsNumber): BrsNumber {
        switch (rhs.kind) {
            case ValueKind.Int32:
                return new Int32(this.getValue() % rhs.getValue());
            case ValueKind.Float:
                return new Float(this.getValue() % rhs.getValue());
            case ValueKind.Double:
                return new Double(this.getValue() % rhs.getValue());
            case ValueKind.Int64:
                return new Int64(this.getValue()).modulo(rhs);
        }
    }

    intDivide(rhs: BrsNumber): Int32 | Int64 {
        switch (rhs.kind) {
            case ValueKind.Int32:
            case ValueKind.Float:
            case ValueKind.Double:
                // TODO: Is 32-bit precision enough here?
                return new Int32(Math.trunc(this.getValue() / rhs.getValue()));
            case ValueKind.Int64:
                return new Int64(Math.trunc(this.getValue() / rhs.getValue().toNumber()));
        }
    }

    pow(exponent: BrsNumber): BrsNumber {
        switch (exponent.kind) {
            case ValueKind.Int32:
                return new Float(this.getValue() ** exponent.getValue());
            case ValueKind.Int64:
                return new Int64(this.getValue()).pow(exponent);
            case ValueKind.Float:
                return new Float(this.getValue() ** exponent.getValue());
            case ValueKind.Double:
                return new Double(this.getValue() ** exponent.getValue());
        }
    }

    and(rhs: BrsNumber): BrsNumber {
        switch (rhs.kind) {
            case ValueKind.Int32:
                return new Int32(this.getValue() & rhs.getValue());//eslint-disable-line
            case ValueKind.Int64:
                return new Int64(this.getValue()).and(rhs);
            case ValueKind.Float:
                return new Int32(this.getValue() & rhs.getValue());//eslint-disable-line
            case ValueKind.Double:
                return new Int32(this.getValue() & rhs.getValue());//eslint-disable-line
        }
    }

    or(rhs: BrsNumber): BrsNumber {
        switch (rhs.kind) {
            case ValueKind.Int32:
                return new Int32(this.getValue() | rhs.getValue());//eslint-disable-line
            case ValueKind.Int64:
                return new Int64(this.getValue()).or(rhs);
            case ValueKind.Float:
                return new Int32(this.getValue() | rhs.getValue());//eslint-disable-line
            case ValueKind.Double:
                return new Int32(this.getValue() | rhs.getValue());//eslint-disable-line
        }
    }

    lessThan(other: BrsType): BrsBoolean {
        switch (other.kind) {
            case ValueKind.Int32:
                return BrsBoolean.from(this.getValue() < other.getValue());
            case ValueKind.Int64:
                return new Int64(this.getValue()).lessThan(other);
            case ValueKind.Float:
                return new Float(this.getValue()).lessThan(other);
            case ValueKind.Double:
                return new Double(this.getValue()).lessThan(other);
            default:
                return BrsBoolean.False;
        }
    }

    greaterThan(other: BrsType): BrsBoolean {
        switch (other.kind) {
            case ValueKind.Int32:
                return BrsBoolean.from(this.getValue() > other.getValue());
            case ValueKind.Int64:
                return new Int64(this.getValue()).greaterThan(other);
            case ValueKind.Float:
                return new Float(this.getValue()).greaterThan(other);
            case ValueKind.Double:
                return new Double(this.getValue()).greaterThan(other);
            default:
                return BrsBoolean.False;
        }
    }

    equalTo(other: BrsType): BrsBoolean {
        switch (other.kind) {
            case ValueKind.Int32:
                return BrsBoolean.from(this.getValue() === other.getValue());
            case ValueKind.Int64:
                return new Int64(this.getValue()).equalTo(other);
            case ValueKind.Float:
                return new Float(this.getValue()).equalTo(other);
            case ValueKind.Double:
                return new Double(this.getValue()).equalTo(other);
            default:
                return BrsBoolean.False;
        }
    }

    toString(parent?: BrsType): string {
        return this.value.toString();
    }
}
