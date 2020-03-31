/* eslint-disable */
import { BrsType } from "../brsTypes";
import { BrsError } from "../Error";
import { Location } from "../lexer";

/** Marker class for errors thrown to exit block execution early. */
export class BlockEnd extends BrsError {}

/** An error thrown to exit a for loop early. */
export class ExitForReason extends BlockEnd {
    constructor(location: Location) {
        super("`exit for` encountered", location);
    }
}

/** An error thrown to exit a while loop early. */
export class ExitWhileReason extends BlockEnd {
    constructor(location: Location) {
        super("`exit while` encountered", location);
    }
}

/** An error thrown to handle a `return` statement. */
export class ReturnValue extends BlockEnd {
    constructor(readonly location: Location, readonly value?: BrsType) {
        super("`return` encountered", location);
    }
}

/** An error thrown when a BrightScript runtime error is encountered. */
export class Runtime extends BlockEnd {}
