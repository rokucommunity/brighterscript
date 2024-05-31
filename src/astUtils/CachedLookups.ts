import type { AALiteralExpression, CallExpression, CallfuncExpression, DottedGetExpression, FunctionExpression, VariableExpression } from '../parser/Expression';
import type { AliasStatement, AssignmentStatement, AugmentedAssignmentStatement, ClassStatement, ConstStatement, EnumStatement, FunctionStatement, ImportStatement, InterfaceStatement, LibraryStatement, NamespaceStatement, TypecastStatement } from '../parser/Statement';
import { Cache } from '../Cache';
import { WalkMode, createVisitor } from './visitors';
import type { Expression } from '../parser/AstNode';
import { isAAMemberExpression, isBinaryExpression, isCallExpression, isDottedGetExpression, isFunctionExpression, isIndexedGetExpression, isLiteralExpression, isMethodStatement, isNamespaceStatement, isNewExpression, isVariableExpression } from './reflection';
import type { Parser } from '../parser/Parser';
import { ParseMode } from '../parser/Parser';
import type { Token } from '../lexer/Token';
import { isToken } from '../lexer/Token';
import type { Program } from '../Program';
import util from '../util';


export interface BscFileLike {
    program: Program;
    _parser: Parser;
}

export class CachedLookups {

    private cache = new Cache();

    constructor(private file: BscFileLike) { }

    get namespaceStatements(): NamespaceStatement[] {
        return this.getFromCache<Array<NamespaceStatement>>('namespaceStatements');
    }

    get functionStatements(): FunctionStatement[] {
        return this.getFromCache<Array<FunctionStatement>>('functionStatements');
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
        return this.getFromCache<Array<FunctionExpression>>('functionExpressions');
    }

    get libraryStatements(): LibraryStatement[] {
        return this.getFromCache<Array<LibraryStatement>>('libraryStatements');
    }

    get importStatements(): ImportStatement[] {
        return this.getFromCache<Array<ImportStatement>>('importStatements');
    }

    get typecastStatements(): TypecastStatement[] {
        return this.getFromCache<Array<TypecastStatement>>('typecastStatements');
    }

    get aliasStatements(): AliasStatement[] {
        return this.getFromCache<Array<AliasStatement>>('aliasStatements');
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
        return this.getFromCache<Set<Expression>>('expressions');
    }

    get classStatements(): ClassStatement[] {
        return this.getFromCache<Array<ClassStatement>>('classStatements');
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
        return this.getFromCache<Array<AssignmentStatement>>('assignmentStatements');
    }

    get augmentedAssignmentStatements(): AugmentedAssignmentStatement[] {
        return this.getFromCache<Array<AugmentedAssignmentStatement>>('augmentedAssignmentStatements');
    }

    get enumStatements(): EnumStatement[] {
        return this.getFromCache<Array<EnumStatement>>('enumStatements');
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
        return this.getFromCache<Array<ConstStatement>>('constStatements');
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
        return this.getFromCache<Array<InterfaceStatement>>('interfaceStatements');
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

    get propertyHints(): Record<string, string> {
        return this.getFromCache<Record<string, string>>('propertyHints');
    }


    invalidate() {
        this.cache.clear();
    }


    private getFromCache<T>(cacheKey: string): T {
        if (!this.cache.has(cacheKey)) {
            this.rehydrate();
        }
        if (!this.cache.has(cacheKey)) {
            this.file.program.logger.info('Unable to get cached lookup', cacheKey);
        }
        return this.cache.get(cacheKey);
    }

    private rehydrate() {
        const expressions = new Set<Expression>();
        const classStatements: ClassStatement[] = [];
        const namespaceStatements: NamespaceStatement[] = [];
        const enumStatements: EnumStatement[] = [];
        const constStatements: ConstStatement[] = [];
        const interfaceStatements: InterfaceStatement[] = [];
        const assignmentStatements: AssignmentStatement[] = [];
        const libraryStatements: LibraryStatement[] = [];
        const importStatements: ImportStatement[] = [];
        const typecastStatements: TypecastStatement[] = [];
        const aliasStatements: AliasStatement[] = [];
        const functionStatements: FunctionStatement[] = [];
        const functionExpressions: FunctionExpression[] = [];

        const augmentedAssignmentStatements: AugmentedAssignmentStatement[] = [];

        const propertyHints: Record<string, string> = {};
        const addPropertyHints = (item: Token | AALiteralExpression) => {
            if (isToken(item)) {
                const name = item.text;
                propertyHints[name.toLowerCase()] = name;
            } else {
                for (const member of item.elements) {
                    const name = member.tokens.key.text;
                    if (!name.startsWith('"')) {
                        propertyHints[name.toLowerCase()] = name;
                    }

                }
            }
        };

        const excludedExpressions = new Set<Expression>();
        const visitCallExpression = (e: CallExpression | CallfuncExpression) => {
            for (const p of e.args) {
                expressions.add(p);
            }
            //add calls that were not excluded (from loop below)
            if (!excludedExpressions.has(e)) {
                expressions.add(e);
            }

            //if this call is part of a longer expression that includes a call higher up, find that higher one and remove it
            if (e.callee) {
                let node: Expression = e.callee;
                while (node) {
                    //the primary goal for this loop. If we found a parent call expression, remove it from `references`
                    if (isCallExpression(node)) {
                        expressions.delete(node);
                        excludedExpressions.add(node);
                        //stop here. even if there are multiple calls in the chain, each child will find and remove its closest parent, so that reduces excess walking.
                        break;

                        //when we hit a variable expression, we're definitely at the leftmost expression so stop
                    } else if (isVariableExpression(node) || isLiteralExpression(node)) {
                        break;
                        //if

                    } else if (isDottedGetExpression(node) || isIndexedGetExpression(node)) {
                        node = node.obj;
                    } else {
                        //some expression we don't understand. log it and quit the loop
                        this.file.program.logger.info('Encountered unknown expression while calculating function expression chain', node);
                        break;
                    }
                }
            }
        };
        const visitVariableNameExpression = (e: VariableExpression | DottedGetExpression) => {
            if (!isDottedGetExpression(e.parent) && // not last expression in a dotted-get chain
                !isFunctionExpression(e) && // don't include function expressions
                !isNamespaceStatement(e.parent) && // don't include the name of namespace
                !isNewExpression(e.parent) && // don't include the inside of a new expression
                !(isCallExpression(e.parent) && e.parent?.callee === e) && // don't include the callee
                !util.isInTypeExpression(e)) {
                expressions.add(e);
            }
        };

        // eslint-disable-next-line @typescript-eslint/dot-notation
        this.file['_parser']?.ast.walk(createVisitor({
            AssignmentStatement: s => {
                assignmentStatements.push(s);
                expressions.add(s.value);
            },
            ClassStatement: s => {
                classStatements.push(s);
            },
            InterfaceStatement: s => {
                interfaceStatements.push(s);
            },
            FieldStatement: s => {
                if (s.initialValue) {
                    expressions.add(s.initialValue);
                }
            },
            NamespaceStatement: s => {
                namespaceStatements.push(s);
            },
            FunctionStatement: s => {
                functionStatements.push(s);
            },
            ImportStatement: s => {
                importStatements.push(s);
            },
            TypecastStatement: s => {
                typecastStatements.push(s);
            },
            LibraryStatement: s => {
                libraryStatements.push(s);
            },
            AliasStatement: s => {
                aliasStatements.push(s);
            },
            FunctionExpression: (expression, parent) => {
                if (!isMethodStatement(parent)) {
                    functionExpressions.push(expression);
                }
            },
            ExpressionStatement: s => {
                expressions.add(s.expression);
            },
            CallfuncExpression: e => {
                visitCallExpression(e);
            },
            CallExpression: e => {
                visitCallExpression(e);
            },
            AALiteralExpression: e => {
                addPropertyHints(e);
                expressions.add(e);
                for (const member of e.elements) {
                    if (isAAMemberExpression(member)) {
                        expressions.add(member.value);
                    }
                }
            },
            BinaryExpression: (e, parent) => {
                //walk the chain of binary expressions and add each one to the list of expressions
                const expressionsParts: Expression[] = [e];
                let expression: Expression;
                while ((expression = expressionsParts.pop())) {
                    if (isBinaryExpression(expression)) {
                        expressionsParts.push(expression.left, expression.right);
                    } else {
                        expressions.add(expression);
                    }
                }
            },
            ArrayLiteralExpression: e => {
                for (const element of e.elements) {
                    //keep everything except comments
                    expressions.add(element);
                }
            },
            DottedGetExpression: e => {
                visitVariableNameExpression(e);
                addPropertyHints(e.tokens.name);
            },
            DottedSetStatement: e => {
                addPropertyHints(e.tokens.name);
            },
            EnumStatement: e => {
                enumStatements.push(e);
            },
            ConstStatement: s => {
                constStatements.push(s);
            },
            UnaryExpression: e => {
                expressions.add(e);
            },
            IncrementStatement: e => {
                expressions.add(e);
            },
            VariableExpression: e => {
                visitVariableNameExpression(e);
            },
            AugmentedAssignmentStatement: e => {
                augmentedAssignmentStatements.push(e);
            }
        }), {
            walkMode: WalkMode.visitAllRecursive
        });

        this.cache.set('expressions', expressions);
        this.cache.set('classStatements', classStatements);
        this.cache.set('namespaceStatements', namespaceStatements);
        this.cache.set('namespaceStatements', namespaceStatements);
        this.cache.set('enumStatements', enumStatements);
        this.cache.set('constStatements', constStatements);
        this.cache.set('interfaceStatements', interfaceStatements);
        this.cache.set('assignmentStatements', assignmentStatements);
        this.cache.set('libraryStatements', libraryStatements);
        this.cache.set('importStatements', importStatements);
        this.cache.set('typecastStatements', typecastStatements);
        this.cache.set('aliasStatements', aliasStatements);
        this.cache.set('functionStatements', functionStatements);
        this.cache.set('functionExpressions', functionExpressions);
        this.cache.set('propertyHints', propertyHints);
        this.cache.set('augmentedAssignmentStatements', augmentedAssignmentStatements);
    }
}
