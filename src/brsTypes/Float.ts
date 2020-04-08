import { BrsType, BrsBoolean } from '.';
import { ValueKind, Comparable } from './BrsType';
import { BrsNumber, Numeric } from './BrsNumber';
import { Int32 } from './Int32';
import { Double } from './Double';
import { Int64 } from './Int64';

/**
 * Number of significant digits represented in an IEEE 32-bit floating point number.
 * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Typed_arrays#Typed_array_views
 */
const IEEE_FLOAT_SIGFIGS = 7;

export class Float implements Numeric, Comparable {
    readonly kind = ValueKind.Float;
    private readonly value: number;

    getValue(): number {
        return this.value;
    }

    /**
     * Creates a new BrightScript floating-point value representing the provided `value`.
     * @param value the value to store in the BrightScript float, rounded to 32-bit floating point
     *              precision and maintaining only seven significant digits of accuracy.
     */
    constructor(value: number) {
        this.value = parseFloat(Math.fround(value).toPrecision(IEEE_FLOAT_SIGFIGS));
    }

    /**
     * Creates a new BrightScript floating-point value representing the floating point value
     * contained in `asString`.
     * @param asString the string representation of the value to store in the BrightScript float.
     *                 Will be rounded to 32-bit floating point precision.
     * @returns a BrightScript floating-point value representing `asString`.
     */
    static fromString(asString: string): Float {
        return new Float(Number.parseFloat(asString));
    }

    add(rhs: BrsNumber): BrsNumber {
        switch (rhs.kind) {
            case ValueKind.Int64:
                // TODO: Confirm that (double) + (int64) -> (double)
                return new Float(this.getValue() + rhs.getValue().toNumber());
            case ValueKind.Int32:
            case ValueKind.Float:
                return new Float(this.getValue() + rhs.getValue());
            case ValueKind.Double:
                return new Double(this.getValue() + rhs.getValue());
        }
    }

    subtract(rhs: BrsNumber): BrsNumber {
        switch (rhs.kind) {
            case ValueKind.Int64:
                // TODO: Confirm that (float) - (int64) -> (float)
                return new Float(this.getValue() - rhs.getValue().toNumber());
            case ValueKind.Int32:
            case ValueKind.Float:
                return new Float(this.getValue() - rhs.getValue());
            case ValueKind.Double:
                return new Double(this.getValue() - rhs.getValue());
        }
    }

    multiply(rhs: BrsNumber): BrsNumber {
        switch (rhs.kind) {
            case ValueKind.Int64:
                // TODO: Confirm that (float) * (int64) -> (float)
                return new Float(this.getValue() * rhs.getValue().toNumber());
            case ValueKind.Int32:
            case ValueKind.Float:
                return new Float(this.getValue() * rhs.getValue());
            case ValueKind.Double:
                return new Double(this.getValue() * rhs.getValue());
        }
    }

    divide(rhs: BrsNumber): Float | Double {
        switch (rhs.kind) {
            case ValueKind.Int64:
                // TODO: Confirm that (float) / (int64) -> (float)
                return new Float(this.getValue() / rhs.getValue().toNumber());
            case ValueKind.Int32:
            case ValueKind.Float:
                return new Float(this.getValue() / rhs.getValue());
            case ValueKind.Double:
                return new Double(this.getValue() / rhs.getValue());
        }
    }

    modulo(rhs: BrsNumber): BrsNumber {
        switch (rhs.kind) {
            case ValueKind.Int32:
            case ValueKind.Float:
                return new Float(this.getValue() % rhs.getValue());
            case ValueKind.Double:
                return new Double(this.getValue() % rhs.getValue());
            case ValueKind.Int64:
                return new Float(this.getValue() % rhs.getValue().toNumber());
        }
    }

    intDivide(rhs: BrsNumber): Int32 | Int64 {
        switch (rhs.kind) {
            case ValueKind.Int64:
                return new Int64(Math.trunc(this.getValue() / rhs.getValue().toNumber()));
            case ValueKind.Int32:
            case ValueKind.Float:
            case ValueKind.Double:
                return new Int32(Math.trunc(this.getValue() / rhs.getValue()));
        }
    }

    pow(exponent: BrsNumber): BrsNumber {
        switch (exponent.kind) {
            case ValueKind.Int32:
                return new Float(this.getValue() ** exponent.getValue());
            case ValueKind.Int64:
                return new Float(this.getValue() ** exponent.getValue().toNumber());
            case ValueKind.Float:
                return new Float(this.getValue() ** exponent.getValue());
            case ValueKind.Double:
                return new Double(this.getValue() ** exponent.getValue());
        }
    }

    and(rhs: BrsNumber): BrsNumber {
        switch (rhs.kind) {
            case ValueKind.Int64:
                return new Int64(this.getValue()).and(rhs);
            case ValueKind.Int32:
            case ValueKind.Float:
            case ValueKind.Double:
                return new Int32(this.getValue() & rhs.getValue()); //eslint-disable-line
        }
    }

    or(rhs: BrsNumber): BrsNumber {
        switch (rhs.kind) {
            case ValueKind.Int64:
                return new Int64(this.getValue()).or(rhs);
            case ValueKind.Int32:
            case ValueKind.Float:
            case ValueKind.Double:
                return new Int32(this.getValue() | rhs.getValue()); //eslint-disable-line
        }
    }

    lessThan(other: BrsType): BrsBoolean {
        switch (other.kind) {
            case ValueKind.Int64:
                return BrsBoolean.from(this.getValue() < other.getValue().toNumber());
            case ValueKind.Int32:
            case ValueKind.Float:
                return BrsBoolean.from(this.getValue() < other.getValue());
            case ValueKind.Double:
                return new Double(this.getValue()).lessThan(other);
            default:
                return BrsBoolean.False;
        }
    }

    greaterThan(other: BrsType): BrsBoolean {
        switch (other.kind) {
            case ValueKind.Int64:
                return BrsBoolean.from(this.getValue() > other.getValue().toNumber());
            case ValueKind.Int32:
            case ValueKind.Float:
                return BrsBoolean.from(this.getValue() > other.getValue());
            case ValueKind.Double:
                return new Double(this.getValue()).greaterThan(other);
            default:
                return BrsBoolean.False;
        }
    }

    equalTo(other: BrsType): BrsBoolean {
        switch (other.kind) {
            case ValueKind.Int64:
                return BrsBoolean.from(this.getValue() === other.getValue().toNumber());
            case ValueKind.Int32:
            case ValueKind.Float:
                return BrsBoolean.from(this.getValue() === other.getValue());
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
