import type { WalkVisitor, WalkOptions } from '../astUtils/visitors';
import type { Range } from 'vscode-languageserver';
import { InternalWalkMode } from '../astUtils/visitors';
import type { SymbolTable } from '../SymbolTable';
import type { BrsTranspileState } from './BrsTranspileState';
import type { TranspileResult } from '../interfaces';
import type { AnnotationExpression } from './Expression';

/**
 * A BrightScript AST node
 */
export abstract class AstNode {
    /**
     *  The starting and ending location of the node.
     **/
    public abstract range: Range;

    public abstract transpile(state: BrsTranspileState): TranspileResult;

    /**
     * When being considered by the walk visitor, this describes what type of element the current class is.
     */
    public visitMode = InternalWalkMode.visitStatements;

    public abstract walk(visitor: WalkVisitor, options: WalkOptions);

    /**
     * The parent node for this statement. This is set dynamically during `onFileValidate`, and should not be set directly.
     */
    public parent?: AstNode;

    /**
     * Certain expressions or statements can have a symbol table (such as blocks, functions, namespace bodies, etc).
     * If you're interested in getting the closest SymbolTable, use `getSymbolTable` instead.
     */
    public symbolTable?: SymbolTable;

    /**
     * Get the closest symbol table for this node. Should be overridden in children that directly contain a symbol table
     */
    public getSymbolTable(): SymbolTable {
        if (this.symbolTable) {
            return this.symbolTable;
        } else {
            return this.parent?.getSymbolTable();
        }
    }
}

export abstract class Statement extends AstNode {
    /**
     * When being considered by the walk visitor, this describes what type of element the current class is.
     */
    public visitMode = InternalWalkMode.visitStatements;
    /**
     * Annotations for this statement
     */
    public annotations: AnnotationExpression[];
}


/** A BrightScript expression */
export abstract class Expression extends AstNode {
    /**
     * When being considered by the walk visitor, this describes what type of element the current class is.
     */
    public visitMode = InternalWalkMode.visitExpressions;
}
