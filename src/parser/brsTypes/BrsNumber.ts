/* eslint-disable */
import Long from "long";
import { BrsValue } from "./BrsType";
import { Int32 } from "./Int32";
import { Int64 } from "./Int64";
import { Float } from "./Float";
import { Double } from "./Double";

/** The set of operations available on a BrightScript numeric variable. */
export interface Numeric extends BrsValue {
    /**
     * Returns the current value this instance represents.
     * @returns the current value contained in this instance.
     */
    getValue(): number | Long;

    /**
     * Adds `rhs` to the current number and returns the result.
     * @param rhs The right-hand side value to add to the current value.
     * @returns The current value + `rhs`, with precision matching `max(current, rhs)`.
     */
    add(rhs: BrsNumber): BrsNumber;

    /**
     * Subtracts `rhs` from the current number and returns the result.
     * @param rhs The right-hand side value to subtract from the current value.
     * @returns The current value - `rhs`, with precision matching `max(current, rhs)`.
     */
    subtract(rhs: BrsNumber): BrsNumber;

    /**
     * Multiplies the current number by `rhs` and returns the result.
     * @param rhs The right-hand side value to multiply the current value by.
     * @returns The current value * `rhs`, with precision matching `max(current, rhs)`.
     */
    multiply(rhs: BrsNumber): BrsNumber;

    /**
     * Divides the current number by `rhs` and returns the result.
     * @param rhs The right-hand side value to divide the current value by.
     * @returns The current value / `rhs`, with floating-point precision matching `max(current, rhs)`.
     */
    divide(rhs: BrsNumber): Float | Double;

    /**
     * Modulos the current number by `rhs`. I.e. divides the current number by `rhs` and returns
     * the *whole-number remainder* of the result.
     * @param rhs The right-hand side value to modulo the current value by.
     * @returns The current value MOD `rhs` with 64-bit integer precision if `rhs` is an Int64,
     *          otherwise 32-bit integer precision.
     */
    modulo(rhs: BrsNumber): BrsNumber;

    /**
     * Integer-divides the current number by `rhs`. I.e. divides the current number by `rhs` and
     * returns the *integral part* of the result.
     * @param rhs The right-hand side value to integer-divide the current value by.
     * @returns The current value \ `rhs` with 64-bit integer precision if `rhs` is an Int64,
     *          otherwise 32-bit integer precision.
     */
    intDivide(rhs: BrsNumber): Int32 | Int64;

    /**
     * Calculates the current value to the power of `exponent`.
     * @param exponent The exponent to take the current value to the power of.
     * @returns The current value ^ `exponent`, with precision matching `max(current, rhs)`.
     */
    pow(exponent: BrsNumber): BrsNumber;

    /**
     * Bitwise ANDs the current value with `rhs`.
     * @param rhs The right-hand side value to bitwise AND the current value with.
     * @returns The current value ANDed with `rhs`.
     */
    and(rhs: BrsNumber): BrsNumber;

    /**
     * Bitwise ORs the current value with `rhs`.
     * @param rhs The right-hand side value to bitwise OR the current value with.
     * @returns The current value ORed with `rhs`.
     */
    or(rhs: BrsNumber): BrsNumber;
}

/** The union of all supported BrightScript number types. */
export type BrsNumber = Int32 | Int64 | Float | Double;
