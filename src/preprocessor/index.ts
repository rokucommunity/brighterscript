import { EventEmitter } from 'events';

import { BrsError, ParseError } from '../parser/Error';
import { Token } from '../lexer/Token';
import * as Chunk from './Chunk';
import { getBsConst, Manifest } from './Manifest';
import { PreprocessorParser } from './PreprocessorParser';
import { FilterResults, Preprocessor as InternalPreprocessor } from './Preprocessor';
import { Diagnostic } from 'vscode-languageserver';

export class Preprocessor {
    private parser = new PreprocessorParser();
    private preprocessor = new InternalPreprocessor();

    public readonly events = new EventEmitter();

    /**
     * Convenience function to subscribe to the `err` events emitted by `preprocessor.events`.
     * @param errorHandler the function to call for every preprocessing error emitted after subscribing
     * @returns an object with a `dispose` function, used to unsubscribe from errors
     */
    public onError(errorHandler: (diagnostic: Diagnostic) => void) {
        this.events.on('err', errorHandler);
        return {
            dispose: () => {
                this.events.removeListener('err', errorHandler);
            }
        };
    }

    /**
     * Convenience function to subscribe to a single `err` event emitted by `preprocessor.events`.
     * @param errorHandler the function to call for the first preprocessing error emitted after subscribing
     */
    public onErrorOnce(errorHandler: (err: BrsError | ParseError) => void) {
        this.events.once('err', errorHandler);
    }

    constructor() {
        // plumb errors from the internal parser and preprocessor out to the public interface for convenience
        this.parser.events.on('err', err => this.events.emit('err', err));
        this.preprocessor.events.on('err', err => this.events.emit('err', err));
    }

    /**
     * Pre-processes a set of tokens, evaluating any conditional compilation directives encountered.
     * @param tokens the set of tokens to process. Must not contain any whitespace tokens.
     * @param manifest the data stored in the found manifest file
     * @returns an array of processed tokens representing a subset of the provided ones
     */
    public preprocess(tokens: ReadonlyArray<Token>, manifest: Manifest): FilterResults {
        let parserResults = this.parser.parse(tokens);
        if (parserResults.diagnostics.length > 0) {
            return {
                processedTokens: [],
                diagnostics: parserResults.diagnostics
            };
        }

        return this.preprocessor.filter(parserResults.chunks, getBsConst(manifest));
    }
}

export { Chunk };
export { PreprocessorParser as Parser } from './PreprocessorParser';
export { getManifest, getManifestSync, getBsConst, Manifest } from './Manifest';
