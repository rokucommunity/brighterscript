/* eslint-disable */
import { BrsBoolean, BrsString, BrsValue, ValueKind } from "../BrsType";
import { BrsComponent } from "./BrsComponent";
import { BrsType } from "..";
import { Callable, StdlibArgument } from "../Callable";
declare type Interpreter = any;
import { RoArray } from "./RoArray";

export class RoRegex extends BrsComponent implements BrsValue {
    readonly kind = ValueKind.Object;
    readonly supportedFlags = "ims";
    private jsRegex: RegExp;

    constructor(expression: BrsString, flags = new BrsString("")) {
        super("roRegex");
        this.jsRegex = new RegExp(expression.value, this.parseFlags(flags.value));

        this.registerMethods([
            this.isMatch,
            this.match,
            this.replace,
            this.replaceAll,
            this.split,
            this.matchAll,
        ]);
    }

    toString(parent?: BrsType) {
        return "<Component: roRegex>";
    }

    equalTo(other: BrsType) {
        return BrsBoolean.False;
    }

    /**
     * Checks and parses the flags to avoid passing flags
     * that are not supported
     * @param inputFlags Flags passed to constructor
     * @returns parsed flags
     */
    private parseFlags(inputFlags: string): string {
        let parsedFlags = "";
        if (inputFlags.length === 0) {
            return parsedFlags;
        }

        for (const flag of inputFlags) {
            if (flag === "x") {
                console.warn("'x' flag is not implemented yet, ignoring flag.");
            } else if (!this.supportedFlags.includes(flag)) {
                throw new Error(`${flag} is not supported.`);
            } else {
                parsedFlags += flag;
            }
        }

        return parsedFlags;
    }

    /**
     * Transforms positional pattern replacements to javascript syntax
     * by replacing backslashes with dollar symbols
     * @param pattern Pattern to replace
     * @returns Replaced string
     */
    private parseReplacementPattern(pattern: string): string {
        return pattern.replace(/\\/g, "$");
    }

    /** Returns whether the string matched the regex or not */
    private isMatch = new Callable("ismatch", {
        signature: {
            args: [new StdlibArgument("str", ValueKind.String)],
            returns: ValueKind.Boolean,
        },
        impl: (interpreter: Interpreter, str: BrsString) => {
            return BrsBoolean.from(this.jsRegex.test(str.value));
        },
    });

    /** Returns an array of matches */
    private match = new Callable("match", {
        signature: {
            args: [new StdlibArgument("str", ValueKind.String)],
            returns: ValueKind.Object,
        },
        impl: (interpreter: Interpreter, str: BrsString) => {
            const result = this.jsRegex.exec(str.value);
            let arr: BrsString[] = [];
            if (result !== null) {
                arr = result.map(match => new BrsString(match || ""));
            }

            return new RoArray(arr);
        },
    });

    /** Returns a new string with first match replaced */
    private replace = new Callable("replace", {
        signature: {
            args: [
                new StdlibArgument("str", ValueKind.String),
                new StdlibArgument("replacement", ValueKind.String),
            ],
            returns: ValueKind.String,
        },
        impl: (interpreter: Interpreter, str: BrsString, replacement: BrsString) => {
            let replacementPattern = this.parseReplacementPattern(replacement.value);
            const newStr = this.jsRegex[Symbol.replace](str.value, replacementPattern);
            return new BrsString(newStr);
        },
    });

    /** Returns a new string with all matches replaced */
    private replaceAll = new Callable("replaceall", {
        signature: {
            args: [
                new StdlibArgument("str", ValueKind.String),
                new StdlibArgument("replacement", ValueKind.String),
            ],
            returns: ValueKind.String,
        },
        impl: (interpreter: Interpreter, str: BrsString, replacement: BrsString) => {
            const source = this.jsRegex.source;
            const flags = this.jsRegex.flags + "g";
            this.jsRegex = new RegExp(source, flags);
            const newStr = this.jsRegex[Symbol.replace](str.value, replacement.value);

            return new BrsString(newStr);
        },
    });

    /** Returns an array of strings split by match */
    private split = new Callable("split", {
        signature: {
            args: [new StdlibArgument("str", ValueKind.String)],
            returns: ValueKind.Object,
        },
        impl: (interpreter: Interpreter, str: BrsString) => {
            let items = this.jsRegex[Symbol.split](str.value);
            let brsItems = items.map(item => new BrsString(item));
            return new RoArray(brsItems);
        },
    });

    /** Returns an array of array with all matches found */
    private matchAll = new Callable("matchall", {
        signature: {
            args: [new StdlibArgument("str", ValueKind.String)],
            returns: ValueKind.Object,
        },
        impl: (interpreter: Interpreter, str: BrsString) => {
            const source = this.jsRegex.source;
            const flags = this.jsRegex.flags + "g";
            this.jsRegex = new RegExp(source, flags);
            let arr = [];
            let matches: string[] | null;

            while ((matches = this.jsRegex.exec(str.value)) !== null) {
                let item = new BrsString(matches[0] || "");
                arr.push(new RoArray([item]));
            }
            return new RoArray(arr);
        },
    });
}
