import type { DottedGetExpression, TypeExpression, VariableExpression } from './parser/Expression';
import { isBinaryExpression, isBody, isClassStatement, isDottedGetExpression, isInterfaceStatement, isNamespaceStatement, isTypeExpression, isVariableExpression } from './astUtils/reflection';
import { ChildrenSkipper, WalkMode, createVisitor } from './astUtils/visitors';
import type { ExtraSymbolData, GetTypeOptions, TypeChainEntry } from './interfaces';
import type { AstNode, Expression } from './parser/AstNode';
import { util } from './util';
import type { ClassStatement, NamespaceStatement } from './parser/Statement';
import { SymbolTypeFlag } from './SymbolTypeFlag';
import type { Token } from './lexer/Token';
import type { BrsFile } from './files/BrsFile';
import { TokenKind } from './lexer/TokenKind';

// eslint-disable-next-line no-bitwise
export const InsideSegmentWalkMode = WalkMode.visitStatements | WalkMode.visitExpressions | WalkMode.recurseChildFunctions;

export interface UnresolvedSymbol {
    typeChain: TypeChainEntry[];
    flags: SymbolTypeFlag;
    endChainFlags: SymbolTypeFlag;
    containingNamespaces: string[];
    file: BrsFile;
}

export interface AssignedSymbol {
    token: Token;
    node: AstNode;
}

export class AstValidationSegmenter {

    public validatedSegments = new Map<AstNode, boolean>();
    public segmentsForValidation = new Array<AstNode>();
    public singleValidationSegments = new Set<AstNode>();
    public unresolvedSegmentsSymbols = new Map<AstNode, Set<UnresolvedSymbol>>();
    public assignedTokensInSegment = new Map<AstNode, Set<AssignedSymbol>>();
    public ast: AstNode;

    constructor(public file: BrsFile) { }

    reset() {
        this.validatedSegments.clear();
        this.singleValidationSegments.clear();
        this.unresolvedSegmentsSymbols.clear();
        this.segmentsForValidation = [];
    }

    processTree(ast: AstNode) {
        this.reset();

        ast?.walk((segment) => {
            this.checkSegmentWalk(segment);
        }, {
            walkMode: WalkMode.visitStatements
        });
    }

    checkExpressionForUnresolved(segment: AstNode, expression: VariableExpression | DottedGetExpression | TypeExpression, assignedSymbolsNames?: Set<string>) {
        if (!expression) {
            return false;
        }
        let startOfDottedGet = expression as Expression;
        while (isDottedGetExpression(startOfDottedGet)) {
            startOfDottedGet = startOfDottedGet.obj;
        }
        if (isVariableExpression(startOfDottedGet)) {
            const firstTokenTextLower = startOfDottedGet.tokens.name.text.toLowerCase();
            if (firstTokenTextLower === 'm' || (this.currentClassStatement && firstTokenTextLower === 'super')) {
                return false;
            }
        }
        if (isTypeExpression(expression) && isBinaryExpression(expression.expression)) {
            return this.checkExpressionForUnresolved(segment, expression.expression.left as VariableExpression, assignedSymbolsNames) ||
                this.checkExpressionForUnresolved(segment, expression.expression.right as VariableExpression, assignedSymbolsNames);
        }

        const flag = util.isInTypeExpression(expression) ? SymbolTypeFlag.typetime : SymbolTypeFlag.runtime;
        const typeChain: TypeChainEntry[] = [];
        const extraData = {} as ExtraSymbolData;
        const options: GetTypeOptions = { flags: flag, onlyCacheResolvedTypes: true, typeChain: typeChain, data: extraData };

        const nodeType = expression.getType(options);
        if (!nodeType?.isResolvable() && !extraData.isAlias) {
            let symbolsSet: Set<UnresolvedSymbol>;
            if (!assignedSymbolsNames?.has(typeChain[0].name.toLowerCase())) {
                if (!this.unresolvedSegmentsSymbols.has(segment)) {
                    symbolsSet = new Set<UnresolvedSymbol>();
                    this.unresolvedSegmentsSymbols.set(segment, symbolsSet);
                } else {
                    symbolsSet = this.unresolvedSegmentsSymbols.get(segment);
                }
                this.validatedSegments.set(segment, false);
                symbolsSet.add({
                    typeChain: typeChain,
                    flags: typeChain[0].data.flags,
                    endChainFlags: flag,
                    containingNamespaces: this.currentNamespaceStatement?.getNameParts()?.map(t => t.text),
                    file: this.file
                });
            }
            return true;
        }
        return false;
    }

    private currentNamespaceStatement: NamespaceStatement;
    private currentClassStatement: ClassStatement;

    checkSegmentWalk(segment: AstNode) {
        if (isNamespaceStatement(segment) || isBody(segment)) {
            return;
        }
        this.currentNamespaceStatement = segment.findAncestor(isNamespaceStatement);

        if (isClassStatement(segment)) {
            if (segment.parentClassName) {
                this.segmentsForValidation.push(segment.parentClassName);
                this.validatedSegments.set(segment.parentClassName, false);
                let foundUnresolvedInSegment = this.checkExpressionForUnresolved(segment.parentClassName, segment.parentClassName);
                if (!foundUnresolvedInSegment) {
                    this.singleValidationSegments.add(segment.parentClassName);
                }
            }
            return;
        }
        if (isInterfaceStatement(segment)) {
            if (segment.parentInterfaceName) {
                this.segmentsForValidation.push(segment.parentInterfaceName);
                this.validatedSegments.set(segment.parentInterfaceName, false);
                let foundUnresolvedInSegment = this.checkExpressionForUnresolved(segment.parentInterfaceName, segment.parentInterfaceName);
                if (!foundUnresolvedInSegment) {
                    this.singleValidationSegments.add(segment.parentInterfaceName);
                }
            }
            return;
        }

        this.segmentsForValidation.push(segment);
        this.validatedSegments.set(segment, false);
        let foundUnresolvedInSegment = false;
        const skipper = new ChildrenSkipper();
        const assignedSymbols = new Set<AssignedSymbol>();
        const assignedSymbolsNames = new Set<string>();
        this.currentClassStatement = segment.findAncestor(isClassStatement);

        segment.walk(createVisitor({
            AssignmentStatement: (stmt) => {
                if (stmt.tokens.equals.kind === TokenKind.Equal) {
                    // this is a straight assignment, not a compound assignment
                    assignedSymbols.add({ token: stmt.tokens.name, node: stmt });
                    assignedSymbolsNames.add(stmt.tokens.name.text.toLowerCase());
                }
            },
            FunctionParameterExpression: (expr) => {
                assignedSymbols.add({ token: expr.tokens.name, node: expr });
                assignedSymbolsNames.add(expr.tokens.name.text.toLowerCase());
            },
            ForEachStatement: (stmt) => {
                assignedSymbols.add({ token: stmt.tokens.item, node: stmt });
                assignedSymbolsNames.add(stmt.tokens.item.text.toLowerCase());
            },
            VariableExpression: (expr) => {
                if (!assignedSymbolsNames.has(expr.tokens.name.text.toLowerCase())) {
                    const expressionIsUnresolved = this.checkExpressionForUnresolved(segment, expr, assignedSymbolsNames);
                    foundUnresolvedInSegment = expressionIsUnresolved || foundUnresolvedInSegment;
                }
                skipper.skip();
            },
            DottedGetExpression: (expr) => {
                const expressionIsUnresolved = this.checkExpressionForUnresolved(segment, expr, assignedSymbolsNames);
                foundUnresolvedInSegment = expressionIsUnresolved || foundUnresolvedInSegment;
                skipper.skip();
            },
            TypeExpression: (expr) => {
                const expressionIsUnresolved = this.checkExpressionForUnresolved(segment, expr, assignedSymbolsNames);
                foundUnresolvedInSegment = expressionIsUnresolved || foundUnresolvedInSegment;
                skipper.skip();
            }
        }), {
            walkMode: InsideSegmentWalkMode,
            skipChildren: skipper
        });
        this.assignedTokensInSegment.set(segment, assignedSymbols);
        if (!foundUnresolvedInSegment) {
            this.singleValidationSegments.add(segment);
        }
        this.currentClassStatement = undefined;
        this.currentClassStatement = undefined;

    }


    getSegments(changedSymbols: Map<SymbolTypeFlag, Set<string>>): AstNode[] {
        const segmentsToWalkForValidation: AstNode[] = [];
        const allChangedSymbolNames = [...changedSymbols.get(SymbolTypeFlag.runtime), ...changedSymbols.get(SymbolTypeFlag.typetime)];
        for (const segment of this.segmentsForValidation) {
            const symbolsRequired = this.unresolvedSegmentsSymbols.get(segment);

            const isSingleValidationSegment = this.singleValidationSegments.has(segment);
            const singleValidationSegmentAlreadyValidated = isSingleValidationSegment ? this.validatedSegments.get(segment) : false;
            let segmentNeedsRevalidation = !singleValidationSegmentAlreadyValidated;

            if (symbolsRequired) {
                for (const requiredSymbol of symbolsRequired.values()) {
                    for (const flagType of [SymbolTypeFlag.runtime, SymbolTypeFlag.typetime]) {
                        // eslint-disable-next-line no-bitwise
                        const runTimeOrTypeTimeSymbolFlag = requiredSymbol.flags & flagType;
                        const changeSymbolSetForFlag = changedSymbols.get(runTimeOrTypeTimeSymbolFlag);
                        if (!changeSymbolSetForFlag) {
                            // This symbol has no flag - it is of unknown usage
                            // This can happen when testing if a function exists
                        } else if (util.setContainsUnresolvedSymbol(changeSymbolSetForFlag, requiredSymbol)) {
                            segmentsToWalkForValidation.push(segment);
                            break;
                        }
                    }
                }
            } else if (segmentNeedsRevalidation) {
                segmentsToWalkForValidation.push(segment);
            } else {
                for (let assignedToken of this.assignedTokensInSegment?.get(segment)?.values() ?? []) {
                    if (allChangedSymbolNames.includes(assignedToken.token.text.toLowerCase())) {
                        segmentsToWalkForValidation.push(segment);
                        break;
                    }
                }
            }
        }
        return segmentsToWalkForValidation;
    }

    markSegmentAsValidated(segment: AstNode) {
        this.validatedSegments.set(segment, true);
    }

    unValidateAllSegments() {
        for (const segment of this.validatedSegments.keys()) {
            this.validatedSegments.set(segment, false);
        }
    }


    hasUnvalidatedSegments() {
        return Array.from(this.validatedSegments.values()).includes(false);
    }


    checkIfSegmentNeedRevalidation(segment: AstNode) {
        if (!this.validatedSegments.get(segment)) {
            return true;
        }
        const unresolved = this.unresolvedSegmentsSymbols.get(segment);
        if (unresolved?.size > 0) {
            return true;
        } /*
         const assignedTokens = this.assignedTokensInSegment.get(segment);
         if (assignedTokens?.size > 0) {
             return true;
         }*/
        return false;
    }

    markSegmentsInvalidatedBySymbol(symbolName: string, flag: SymbolTypeFlag) {
        for (let [segment, unresolvedSet] of this.unresolvedSegmentsSymbols) {
            for (let unresolvedSymbol of unresolvedSet.values()) {
                if (unresolvedSymbol.typeChain.join('.').toLowerCase() === symbolName) {
                    this.validatedSegments.set(segment, false);
                    break;
                }
            }
        }
    }
}
