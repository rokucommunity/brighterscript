import type { Range } from 'vscode-languageserver';
import { AstEditor } from '../astUtils/AstEditor';
import type { BrsFile } from '../files/BrsFile';
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
        range: Range;
    }>;

    /**
     * Used by ClassMethodStatements to determine information about their enclosing class
     */
    public classStatement?: ClassStatement;

    /**
     * An AST editor that can be used by the AST nodes to do various transformations to the AST which will be reverted at the end of the transpile cycle
     */
    public editor = new AstEditor();
}
