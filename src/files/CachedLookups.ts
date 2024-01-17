import type { FunctionExpression, NewExpression } from '../parser/Expression';
import type { AssignmentStatement, ClassStatement, ConstStatement, EnumStatement, FunctionStatement, ImportStatement, InterfaceStatement, LibraryStatement, NamespaceStatement } from '../parser/Statement';
import { Cache } from '../Cache';
import { WalkMode } from '../astUtils/visitors';
import type { BrsFile } from './BrsFile';
import type { AstNode, Expression } from '../parser/AstNode';
import type { CancellationTokenSource } from 'vscode-languageserver';
import { isAssignmentStatement, isClassStatement, isConstStatement, isDottedGetExpression, isEnumStatement, isExpression, isFunctionExpression, isFunctionStatement, isImportStatement, isInterfaceStatement, isLibraryStatement, isNamespaceStatement, isNewExpression } from '../astUtils/reflection';

export class CachedLookups {

    private cache = new Cache();

    constructor(public file: BrsFile) { }

    get namespaceStatements(): NamespaceStatement[] {
        return this.getAllCached<NamespaceStatement>('namespaceStatements', isNamespaceStatement);
    }

    get functionStatements(): FunctionStatement[] {
        return this.getAllCached<FunctionStatement>('functionStatements', isFunctionStatement);
    }

    get functionExpressions(): FunctionExpression[] {
        return this.getAllCached<FunctionExpression>('functionExpressions', isFunctionExpression, WalkMode.visitExpressionsRecursive);
    }

    get libraryStatements(): LibraryStatement[] {
        return this.getAllCached<LibraryStatement>('libraryStatements', isLibraryStatement);
    }

    get importStatements(): ImportStatement[] {
        return this.getAllCached<ImportStatement>('importStatements', isImportStatement);
    }

    /**
     * A collection of full expressions. This excludes intermediary expressions.
     *
     * Example 1:
     * `a.b.c` is composed of `a` (variableExpression)  `.b` (DottedGetExpression) `.c` (DottedGetExpression)
     * This will only contain the final `.c` DottedGetExpression because `.b` and `a` can both be derived by walking back from the `.c` DottedGetExpression.
     *
     * Example 2:
     * `name.space.doSomething(a.b.c)` will result in 2 entries in this list. the `CallExpression` for `doSomething`, and the `.c` DottedGetExpression.
     *
     * Example 3:
     * `value = SomeEnum.value > 2 or SomeEnum.otherValue < 10` will result in 4 entries. `SomeEnum.value`, `2`, `SomeEnum.otherValue`, `10`
     */
    get expressions(): Expression[] {
        return this.getAllCached<Expression>('expressions',
            (x: AstNode) => isExpression(x) && !isDottedGetExpression(x.parent) && !isFunctionExpression(x),
            WalkMode.visitExpressionsRecursive);
    }

    get newExpressions(): NewExpression[] {
        return this.getAllCached<NewExpression>('newExpressions', isNewExpression, WalkMode.visitExpressionsRecursive);
    }

    get classStatements(): ClassStatement[] {
        return this.getAllCached<ClassStatement>('classStatements', isClassStatement);
    }

    get assignmentStatements(): AssignmentStatement[] {
        return this.getAllCached<AssignmentStatement>('assignmentStatements', isAssignmentStatement);
    }

    get enumStatements(): EnumStatement[] {
        return this.getAllCached<EnumStatement>('enumStatements', isEnumStatement);
    }

    get constStatements(): ConstStatement[] {
        return this.getAllCached<ConstStatement>('constStatements', isConstStatement);
    }

    get interfaceStatements(): InterfaceStatement[] {
        return this.getAllCached<InterfaceStatement>('interfaceStatements', isInterfaceStatement);
    }

    invalidate() {
        this.cache.clear();
    }

    private getAllCached<T extends AstNode>(cacheKey: string, matcher: (node: AstNode, cancellationSource: CancellationTokenSource) => boolean | AstNode | undefined | void, walkMode: WalkMode = WalkMode.visitStatementsRecursive): T[] {
        return this.cache.getOrAdd(cacheKey, () => {
            // eslint-disable-next-line @typescript-eslint/dot-notation
            return this.file['_parser']?.ast.findChildren(matcher, { walkMode: walkMode });
        });
    }
}
