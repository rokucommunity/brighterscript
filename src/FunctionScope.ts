import type { LabelDeclaration, VariableDeclaration } from './interfaces';
import type { FunctionExpression } from './parser/Expression';

//TODO I think this class can be eliminated in favor of moving some of these onto the FunctionExpression AST node
export class FunctionScope {
    constructor(
        public func: FunctionExpression
    ) {
    }

    /**
     * The full range of this function. Starts at the position of the `f` in function or `s` in sub,
     * and ends after the final `n` in `end function` or `b` in end sub.
     */
    public get range() {
        return this.func?.range;
    }
    /**
     * The scopes that are children of this scope
     */
    public childrenScopes = [] as FunctionScope[];
    /**
     * The parent scope of this scope
     */
    public parentScope: FunctionScope;
    public variableDeclarations = [] as VariableDeclaration[];
    public labelStatements = [] as LabelDeclaration[];

    public get symbolTable() {
        return this.func?.body?.getSymbolTable();
    }

    /**
     * Find all variable declarations above the given line index
     * @param lineIndex the 0-based line number
     */
    public getVariablesAbove(lineIndex: number) {
        let results = [] as VariableDeclaration[];
        for (let variableDeclaration of this.variableDeclarations) {
            if (variableDeclaration.lineIndex < lineIndex) {
                results.push(variableDeclaration);
            } else {
                break;
            }
        }
        return results;
    }

    public getVariableByName(name: string) {
        name = name.toLowerCase();
        for (let variableDeclaration of this.variableDeclarations) {
            if (variableDeclaration.name.toLowerCase() === name) {
                return variableDeclaration;
            }
        }
    }

}
