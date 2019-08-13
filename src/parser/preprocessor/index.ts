//tslint:disable
import { EventEmitter } from "events";

import { Token } from "../lexer";

import { Parser } from "./Parser";
import { Preprocessor as InternalPreprocessor, FilterResults } from "./Preprocessor";
import { Manifest, getBsConst } from "./Manifest";

export class Preprocessor {
    private parser = new Parser();
    private _preprocessor = new InternalPreprocessor();

    readonly events = new EventEmitter();

    /**
     * Convenience function to subscribe to the `err` events emitted by `preprocessor.events`.
     * @param errorHandler the function to call for every preprocessing error emitted after subscribing
     * @returns an object with a `dispose` function, used to unsubscribe from errors
     */
    public onError(errorHandler: (err: BrsError | ParseError) => void) {
        this.events.on("err", errorHandler);
        return {
            dispose: () => {
                this.events.removeListener("err", errorHandler);
            },
        };
    }

    /**
     * Convenience function to subscribe to a single `err` event emitted by `preprocessor.events`.
     * @param errorHandler the function to call for the first preprocessing error emitted after subscribing
     */
    public onErrorOnce(errorHandler: (err: BrsError | ParseError) => void) {
        this.events.once("err", errorHandler);
    }

    constructor() {
        // plumb errors from the internal parser and preprocessor out to the public interface for convenience
        this.parser.events.on("err", err => this.events.emit("err", err));
        this._preprocessor.events.on("err", err => this.events.emit("err", err));
    }

    /**
     * Pre-processes a set of tokens, evaluating any conditional compilation directives encountered.
     * @param tokens the set of tokens to process
     * @param manifest the data stored in the found manifest file
     * @returns an array of processed tokens representing a subset of the provided ones
     */
    preprocess(tokens: ReadonlyArray<Token>, manifest: Manifest): FilterResults {
        let parserResults = this.parser.parse(tokens);
        if (parserResults.errors.length > 0) {
            return {
                processedTokens: [],
                errors: parserResults.errors,
            };
        }

        return this._preprocessor.filter(parserResults.chunks, getBsConst(manifest));
    }
}

import * as Chunk from "./Chunk";
import { BrsError } from "../Error";
import { ParseError } from "../parser";
export { Chunk };
export { Parser } from "./Parser";
export { getManifest, getManifestSync, getBsConst, Manifest } from "./Manifest";
