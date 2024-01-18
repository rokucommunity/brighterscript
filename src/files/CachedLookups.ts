import type { FunctionExpression, NewExpression } from '../parser/Expression';
import type { AssignmentStatement, ClassStatement, ConstStatement, EnumStatement, FunctionStatement, ImportStatement, InterfaceStatement, LibraryStatement, NamespaceStatement } from '../parser/Statement';
import { Cache } from '../Cache';
import { WalkMode } from '../astUtils/visitors';
import type { BrsFile } from './BrsFile';
import type { AstNode, Expression } from '../parser/AstNode';
import type { CancellationTokenSource } from 'vscode-languageserver';
import { isAssignmentStatement, isCallExpression, isClassStatement, isConstStatement, isDottedGetExpression, isEnumStatement, isExpression, isFunctionExpression, isFunctionParameterExpression, isFunctionStatement, isImportStatement, isInterfaceStatement, isLibraryStatement, isNamespaceStatement, isNewExpression } from '../astUtils/reflection';
import { ParseMode } from '../parser/Parser';
import util from '../util';

export class CachedLookups {

    private cache = new Cache();

    constructor(public file: BrsFile) { }

    get namespaceStatements(): NamespaceStatement[] {
        return this.getAllCached<NamespaceStatement>('namespaceStatements', isNamespaceStatement);
    }

    get functionStatements(): FunctionStatement[] {
        return this.getAllCached<FunctionStatement>('functionStatements', isFunctionStatement);
    }

    get functionStatementMap() {
        return this.cache.getOrAdd('functionStatementMap', () => {
            const funcMap = new Map<string, FunctionStatement>();
            for (const stmt of this.functionStatements) {
                funcMap.set(stmt.getName(ParseMode.BrighterScript).toLowerCase(), stmt);
            }
            return funcMap;
        });
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
    get expressions(): Set<Expression> {
        return this.getAllCachedAsSet<Expression>('expressions',
            (x: AstNode) => {
                return isExpression(x) &&
                    !isDottedGetExpression(x.parent) && // not last expression in a dotted-get chain
                    !isFunctionExpression(x) && // don't include function expressions
                    !isNewExpression(x.parent) && // don't include the inside of a new expression
                    !(isCallExpression(x.parent) && x.parent?.callee === x) && // don't include the callee
                    !isNamespaceStatement(x.parent) && // don't include the name of namespace
                    !isFunctionParameterExpression(x) && // don't include function parameters
                    !util.isInTypeExpression(x);
            },
            WalkMode.visitExpressionsRecursive);
    }

    get newExpressions(): NewExpression[] {
        return this.getAllCached<NewExpression>('newExpressions', isNewExpression, WalkMode.visitExpressionsRecursive);
    }

    get classStatements(): ClassStatement[] {
        return this.getAllCached<ClassStatement>('classStatements', isClassStatement);
    }

    get classStatementMap() {
        return this.cache.getOrAdd('classStatementMap', () => {
            const classMap = new Map<string, ClassStatement>();
            for (const stmt of this.classStatements) {
                classMap.set(stmt.getName(ParseMode.BrighterScript).toLowerCase(), stmt);
            }
            return classMap;
        });
    }

    get assignmentStatements(): AssignmentStatement[] {
        return this.getAllCached<AssignmentStatement>('assignmentStatements', isAssignmentStatement);
    }

    get enumStatements(): EnumStatement[] {
        return this.getAllCached<EnumStatement>('enumStatements', isEnumStatement);
    }

    get enumStatementMap() {
        return this.cache.getOrAdd('enumStatementMap', () => {
            const enumMap = new Map<string, EnumStatement>();
            for (const stmt of this.enumStatements) {
                enumMap.set(stmt.fullName.toLowerCase(), stmt);
            }
            return enumMap;
        });
    }

    get constStatements(): ConstStatement[] {
        return this.getAllCached<ConstStatement>('constStatements', isConstStatement);
    }

    get constStatementMap() {
        return this.cache.getOrAdd('constStatementMap', () => {
            const constMap = new Map<string, ConstStatement>();
            for (const stmt of this.constStatements) {
                constMap.set(stmt.fullName.toLowerCase(), stmt);
            }
            return constMap;
        });
    }

    get interfaceStatements(): InterfaceStatement[] {
        return this.getAllCached<InterfaceStatement>('interfaceStatements', isInterfaceStatement);
    }

    get interfaceStatementMap() {
        return this.cache.getOrAdd('interfaceStatementMap', () => {
            const ifaceMap = new Map<string, InterfaceStatement>();
            for (const stmt of this.interfaceStatements) {
                ifaceMap.set(stmt.fullName.toLowerCase(), stmt);
            }
            return ifaceMap;
        });
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

    private getAllCachedAsSet<T extends AstNode>(cacheKey: string, matcher: (node: AstNode, cancellationSource: CancellationTokenSource) => boolean | AstNode | undefined | void, walkMode: WalkMode = WalkMode.visitStatementsRecursive): Set<T> {
        return this.cache.getOrAdd(cacheKey, () => {
            // eslint-disable-next-line @typescript-eslint/dot-notation
            return new Set<T>(this.file['_parser']?.ast.findChildren(matcher, { walkMode: walkMode }));
        });
    }
}
