import { Token } from '../lexer';
import { Range } from 'vscode-languageserver';
import util from '../util';

/**
 * A set of operations that must be implemented to properly handle conditional compilation chunks.
 *
 */
export interface Visitor {
    visitBrightScript(chunk: BrightScriptChunk): Token[];
    visitDeclaration(chunk: DeclarationChunk): Token[];
    visitIf(chunk: HashIfStatement): Token[];
    visitError(chunk: ErrorChunk): never;
}

/**
 * The base construct of the conditional-compilation preprocessor. Represents one of many things,
 * but typically has a one-to-many relationship with tokens in the input BrightScript files.
 */
export interface Chunk {
    accept(visitor: Visitor): Token[];
}

/** A series of BrightScript tokens that will be parsed and interpreted directly. */
export class BrightScriptChunk implements Chunk {
    constructor(readonly tokens: Token[]) { }

    accept(visitor: Visitor) {
        return visitor.visitBrightScript(this);
    }
}

/**
 * A conditional compilation directive that declares a constant value that's in-scope only during
 * preprocessing.
 *
 * Typically takes the form of:
 *
 * @example
 * #const foo = true
 */
export class DeclarationChunk implements Chunk {
    constructor(readonly name: Token, readonly value: Token) { }

    accept(visitor: Visitor) {
        return visitor.visitDeclaration(this);
    }
}

/**
 * The combination of a conditional compilation value (or identifier) and the chunk to include if
 * `condition` evaluates to `true`.
 */
export interface HashElseIfStatement {
    condition: Token;
    thenChunks: Chunk[];
}

/**
 * A directive that adds the "conditional" to "conditional compilation". Typically takes the form
 * of:
 *
 * @example
 * #if foo
 *     someBrightScriptGoesHere()
 * #else if bar
 *     compileSomeOtherCode()
 * #else
 *     otherwise("compile this!")
 * #end if
 */
export class HashIfStatement implements Chunk {
    constructor(
        readonly condition: Token,
        readonly thenChunks: Chunk[],
        readonly elseIfs: HashElseIfStatement[],
        readonly elseChunks?: Chunk[]
    ) { }

    accept(visitor: Visitor) {
        return visitor.visitIf(this);
    }
}

/**
 * A forced BrightScript compilation error with a message attached.  Typically takes the form of:
 *
 * @example
 * #error Some message describing the error goes here.
 */
export class ErrorChunk implements Chunk {
    constructor(
        readonly hashError: Token,
        readonly message: Token
    ) {
        this.range = util.createRangeFromPositions(
            this.hashError.range.start,
            (this.message ?? this.hashError).range.end
        );
    }
    public readonly range: Range;

    accept(visitor: Visitor) {
        return visitor.visitError(this);
    }
}
