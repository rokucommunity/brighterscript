//tslint:disable
declare type Interpreter = any;
import * as Brs from ".";
import * as Expr from "../parser/Expression";
declare var Scope: any;
import { Location } from "../lexer";

/** An argument to a BrightScript `function` or `sub`. */
export interface Argument {
    /** Where the argument exists in the parsed source file(s). */
    readonly location: Location;

    /** The argument's name. */
    readonly name: {
        text: string;
        location: Location;
    };

    /** The type of the argument expected by the BrightScript runtime. */
    readonly type: {
        kind: Brs.ValueKind;
        location: Location;
    };

    /** The default value to use for the argument if none is provided. */
    readonly defaultValue?: Expr.Expression;
}

/**
 * A variant of the `Argument` interface intended for use only when creating standard library
 * functions.
 */
export class StdlibArgument implements Argument {
    readonly location: Argument["location"];
    readonly name: Argument["name"];
    readonly type: Argument["type"];
    readonly defaultValue: Argument["defaultValue"];

    /**
     * Creates an `Argument` without requiring locations to be specified.
     * @param name the name of the argument, used for presentation to users
     * @param type the type of value accepted at runtime
     * @param defaultValue the optional default value to use for this argument if one isn't
     *                     provided at runtime
     */
    constructor(name: string, type: Brs.ValueKind, defaultValue?: Brs.BrsType) {
        this.location = StdlibArgument.InternalLocation;
        this.name = { text: name, location: StdlibArgument.InternalLocation };
        this.type = { kind: type, location: StdlibArgument.InternalLocation };
        if (defaultValue) {
            this.defaultValue = new Expr.Literal(defaultValue, StdlibArgument.InternalLocation);
        }
    }

    /** A fake location exists only within the BRS runtime. */
    static InternalLocation = {
        file: "(stdlib)",
        start: { line: -1, column: -1 },
        end: { line: -1, column: -1 },
    };
}

/** A BrightScript `function` or `sub`'s signature. */
export interface Signature {
    /** The set of arguments a function accepts. */
    readonly args: ReadonlyArray<Argument>;
    /** The type of BrightScript value the function will return. `sub`s must use `ValueKind.Void`. */
    readonly returns: Brs.ValueKind;
}

/** A BrightScript function signature paired with its implementation. */
export type SignatureAndImplementation = {
    /** A BrightScript function's signature. */
    signature: Signature;
    /** The implementation corresponding to `signature`. */
    impl: CallableImplementation;
};

type SignatureMismatch = AnonymousMismatch | ArgumentMismatch;

/** A mismatch between a BrightScript function's signature and its received arguments. */
export interface AnonymousMismatch {
    /** The type of mismatch that was received. */
    reason: MismatchReason.TooFewArguments | MismatchReason.TooManyArguments;
    /** The number of arguments that was expected. */
    expected: string;
    /** The number of arguments that was actually received. */
    received: string;
}

/** A mismatch between a function argument's expected type and its runtime type. */
export interface ArgumentMismatch {
    /** The type of mismatch that was received. */
    reason: MismatchReason.ArgumentTypeMismatch;
    /** The BrightScript type that was expected for argument `argName`. */
    expected: string;
    /** The BrightScript type that was actually received. */
    received: string;
    /** The name of the argument that had a type mismatch. */
    argName: string;
}

/** The set of possible reasons why a signature and runtime arguments don't match. */
export enum MismatchReason {
    /** Not enough arguments were provided to satisfy a signature. */
    TooFewArguments,
    /** Too many arguments were provided to satisfy a signature. */
    TooManyArguments,
    /** An argument's type didn't match the signature's type. */
    ArgumentTypeMismatch,
}

/** A BrightScript function's signature, paired with a set of detected signature mismatches. */
export type SignatureAndMismatches = {
    /** A BrightScript function's signature. */
    signature: Signature;
    /** The set of mismatches between `signature` and the detected mismatches. */
    mismatches: SignatureMismatch[];
};

/*
 * Note that TypeScript's `--strictFunctionTypes` compiler argument prevents the `args` parameter
 * from being typed as `...args: Brs.BrsType[]` here. See
 * https://www.stephanboyer.com/post/132/what-are-covariance-and-contravariance for a wonderful
 * description of why.
 */
/** The function type required for all concrete Callables to provide. */
export type CallableImplementation = (interpreter: Interpreter, ...args: any[]) => Brs.BrsType;

/** A `function` or `sub` (either "native" or implemented in BrightScript) that can be called in a BrightScript file. */
export class Callable implements Brs.BrsValue {
    readonly kind = Brs.ValueKind.Callable;

    /** The name of this function within the BrightScript runtime. */
    readonly name: string | undefined;

    /** The signature of this callable within the BrightScript runtime. */
    readonly signatures: SignatureAndImplementation[];

    /**
     * Calls the function this `Callable` represents with the provided `arg`uments using the
     * provided `Interpreter` instance.
     *
     * @param interpreter the interpreter to execute this callable in.
     * @param args the arguments to pass to the callable routine.
     *
     * @returns the return value of the function, or `invalid` if nothing is explicitly returned.
     */
    call(interpreter: Interpreter, ...args: Brs.BrsType[]) {
        let satisfiedSignature = this.getFirstSatisfiedSignature(args);
        if (satisfiedSignature == null) {
            throw new Error(
                "BrightScript function called without first checking for satisfied signatures. " +
                    "Ensure `Callable#getAllSignatureMismatches` is called before `Callable#call`."
            );
        }

        let { signature, impl } = satisfiedSignature;

        let mutableArgs = args.slice();

        return interpreter.inSubEnv(subInterpreter => {
            // first, we need to evaluate all of the parameter default values
            // and define them in a new environment
            signature.args.forEach((param, index) => {
                if (param.defaultValue && mutableArgs[index] == null) {
                    mutableArgs[index] = subInterpreter.evaluate(param.defaultValue);
                }

                subInterpreter.environment.define(
                    Scope.Function,
                    param.name.text,
                    mutableArgs[index]
                );
            });

            // then return whatever the selected implementation would return
            return impl(subInterpreter, ...mutableArgs);
        });
    }

    /**
     * Creates a new BrightScript `function` or `sub`.
     * @param name the name this callable should have within the BrightScript runtime.
     * @param signatures the signatures and associated (JavaScript) implementations this callable should
     *                   have within the BrightScript runtime.
     */
    constructor(name: string | undefined, ...signatures: SignatureAndImplementation[]) {
        this.name = name;
        this.signatures = signatures;
    }

    lessThan(other: Brs.BrsType): Brs.BrsBoolean {
        return Brs.BrsBoolean.False;
    }

    greaterThan(other: Brs.BrsType): Brs.BrsBoolean {
        return Brs.BrsBoolean.False;
    }

    equalTo(other: Brs.BrsType): Brs.BrsBoolean {
        return Brs.BrsBoolean.from(this === other);
    }

    toString(parent?: Brs.BrsType): string {
        if (this.name) {
            return `[Function ${this.name}]`;
        } else {
            return "[anonymous function]";
        }
    }

    getName(): string {
        return this.name || "";
    }

    getFirstSatisfiedSignature(args: Brs.BrsType[]): SignatureAndImplementation | undefined {
        return this.signatures.filter(
            sigAndImpl => this.getSignatureMismatches(sigAndImpl.signature, args).length === 0
        )[0];
    }

    getAllSignatureMismatches(args: Brs.BrsType[]): SignatureAndMismatches[] {
        return this.signatures.map(sigAndImpl => ({
            signature: sigAndImpl.signature,
            mismatches: this.getSignatureMismatches(sigAndImpl.signature, args),
        }));
    }

    private getSignatureMismatches(sig: Signature, args: Brs.BrsType[]): SignatureMismatch[] {
        let reasons: SignatureMismatch[] = [];
        let requiredArgCount = sig.args.filter(arg => !arg.defaultValue).length;

        if (args.length < requiredArgCount) {
            reasons.push({
                reason: MismatchReason.TooFewArguments,
                expected: sig.args.length.toString(),
                received: args.length.toString(),
            });
        } else if (args.length > sig.args.length) {
            reasons.push({
                reason: MismatchReason.TooManyArguments,
                expected: sig.args.length.toString(),
                received: args.length.toString(),
            });
        }

        sig.args.slice(0, Math.min(sig.args.length, args.length)).forEach((_value, index) => {
            let expected = sig.args[index];
            let received = args[index];

            if (
                expected.type.kind === Brs.ValueKind.Dynamic ||
                expected.type.kind === Brs.ValueKind.Object
            ) {
                return;
            }

            if (expected.type.kind !== received.kind) {
                reasons.push({
                    reason: MismatchReason.ArgumentTypeMismatch,
                    expected: Brs.ValueKind.toString(expected.type.kind),
                    received: Brs.ValueKind.toString(received.kind),
                    argName: expected.name.text,
                });
            }
        });

        return reasons;
    }
}
