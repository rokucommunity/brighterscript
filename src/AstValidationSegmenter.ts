import type { DottedGetExpression, TypeExpression, VariableExpression } from './parser/Expression';
import { isBody, isClassStatement, isInterfaceStatement, isNamespaceStatement, isVariableExpression } from './astUtils/reflection';
import { ChildrenSkipper, WalkMode, createVisitor } from './astUtils/visitors';
import type { GetTypeOptions, TypeChainEntry } from './interfaces';
import type { AstNode } from './parser/AstNode';
import { util } from './util';
import type { NamespaceStatement } from './parser/Statement';
import { SymbolTypeFlag } from './SymbolTypeFlag';
import type { Token } from './lexer/Token';

// eslint-disable-next-line no-bitwise
export const InsideSegmentWalkMode = WalkMode.visitStatements | WalkMode.visitExpressions | WalkMode.recurseChildFunctions;

export interface UnresolvedSymbol {
    typeChain: TypeChainEntry[];
    flags: SymbolTypeFlag;
    endChainFlags: SymbolTypeFlag;
    containingNamespaces: string[];
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
        if (isVariableExpression(expression) && expression.tokens.name.text.toLowerCase() === 'm') {
            return false;
        }
        const flag = util.isInTypeExpression(expression) ? SymbolTypeFlag.typetime : SymbolTypeFlag.runtime;
        const typeChain: TypeChainEntry[] = [];
        const options: GetTypeOptions = { flags: flag, onlyCacheResolvedTypes: true, typeChain: typeChain, data: {} };

        const nodeType = expression.getType(options);
        if (!nodeType?.isResolvable()) {
            let symbolsSet: Set<UnresolvedSymbol>;
            if (!assignedSymbolsNames?.has(typeChain[0].name.toLowerCase())) {
                if (!this.unresolvedSegmentsSymbols.has(segment)) {
                    symbolsSet = new Set<UnresolvedSymbol>();
                    this.unresolvedSegmentsSymbols.set(segment, symbolsSet);
                } else {
                    symbolsSet = this.unresolvedSegmentsSymbols.get(segment);
                }

                symbolsSet.add({ typeChain: typeChain, flags: typeChain[0].data.flags, endChainFlags: flag, containingNamespaces: this.currentNamespaceStatement?.getNameParts()?.map(t => t.text) });
            }
            return true;
        }
        return false;
    }

    private currentNamespaceStatement: NamespaceStatement;

    checkSegmentWalk(segment: AstNode) {
        if (isNamespaceStatement(segment) || isBody(segment)) {
            return;
        }
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
        this.currentNamespaceStatement = segment.findAncestor(isNamespaceStatement);

        segment.walk(createVisitor({
            AssignmentStatement: (stmt) => {
                assignedSymbols.add({ token: stmt.tokens.name, node: stmt });
                assignedSymbolsNames.add(stmt.tokens.name.text.toLowerCase());
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
                        if (util.setContainsUnresolvedSymbol(changeSymbolSetForFlag, requiredSymbol)) {
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
}
