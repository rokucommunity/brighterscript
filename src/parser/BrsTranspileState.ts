import type { Range } from 'vscode-languageserver';
import * as semver from 'semver';
import { AstEditor } from '../astUtils/AstEditor';
import type { BrsFile } from '../files/BrsFile';
import { CONTINUE_MIN_FIRMWARE_VERSION } from '../RokuConstants';
import type { ClassStatement } from './Statement';
import { TranspileState } from './TranspileState';

export class BrsTranspileState extends TranspileState {
    public constructor(
        public file: BrsFile
    ) {
        super(file.srcPath, file.program.options);
        this.bslibPrefix = this.file.program.bslibPrefix;
    }

    /**
     * The prefix to use in front of all bslib functions
     */
    public bslibPrefix: string;

    /**
     * the tree of parents, with the first index being direct parent, and the last index being the furthest removed ancestor.
     * Used to assist blocks in knowing when to add a comment statement to the same line as the first line of the parent
     */
    lineage = [] as Array<{
        range?: Range;
    }>;

    /**
     * Used by ClassMethodStatements to determine information about their enclosing class
     */
    public classStatement?: ClassStatement;

    /**
     * An AST editor that can be used by the AST nodes to do various transformations to the AST which will be reverted at the end of the transpile cycle
     */
    public editor = new AstEditor();

    /**
     * True when `continue` statements must be rewritten into `goto` label jumps because the
     * project targets firmware older than the version that introduced native `continue` support.
     * Computed lazily and cached, since it is checked once per loop and per continue statement.
     */
    public get shouldDownlevelContinue() {
        if (this._shouldDownlevelContinue === undefined) {
            this._shouldDownlevelContinue = semver.lt(
                this.file.program.getMinFirmwareVersion(),
                CONTINUE_MIN_FIRMWARE_VERSION
            );
        }
        return this._shouldDownlevelContinue;
    }
    private _shouldDownlevelContinue: boolean | undefined;

    /**
     * Stack of loop-label trackers, one per enclosing loop currently being transpiled. Only used
     * when `continue` must be downleveled for firmware older than CONTINUE_MIN_FIRMWARE_VERSION.
     */
    private loopLabels = [] as Array<{ label: string; wasAccessed: boolean; blockDepth: number }>;

    private loopLabelSequence = 0;

    /**
     * Begin tracking a loop label for the loop about to be transpiled. The label is allocated
     * eagerly but only emitted if a nested `continue` actually asks for it via `getLoopLabel()`.
     * `blockDepth` records the depth the loop's own body block will occupy, so the block that
     * emits the label can tell whether the label belongs to it or to a nested loop.
     */
    public pushLoopLabel() {
        this.loopLabels.push({
            label: `BRIGHTERSCRIPT_CONTINUE_${this.loopLabelSequence++}`,
            wasAccessed: false,
            //the loop body block increments blockDepth before emitting its statements
            blockDepth: this.blockDepth + 1
        });
    }

    /**
     * Look at the innermost loop label without removing it. Used by Block.transpile to decide
     * whether it owns the pending label.
     */
    public peekLoopLabel() {
        return this.loopLabels[this.loopLabels.length - 1];
    }

    /**
     * Stop tracking the innermost loop label. Returns the tracker so the loop can decide whether
     * it needs to emit the end-of-body label (i.e. when `wasAccessed` is true).
     */
    public popLoopLabel() {
        return this.loopLabels.pop();
    }

    /**
     * Get the label marking the end of the innermost loop body, flagging it as needed so the
     * enclosing loop knows to emit the label itself. Returns undefined when there is no enclosing
     * loop (a `continue` outside a loop, which validation already flags as an error).
     */
    public getLoopLabel() {
        const loopLabel = this.loopLabels[this.loopLabels.length - 1];
        if (!loopLabel) {
            return undefined;
        }
        loopLabel.wasAccessed = true;
        return loopLabel.label;
    }
}
