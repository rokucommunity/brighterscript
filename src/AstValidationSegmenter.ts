import type { DottedGetExpression, TypeExpression, VariableExpression } from './parser/Expression';
import { isAliasStatement, isBinaryExpression, isBlock, isBody, isClassStatement, isConditionalCompileStatement, isDottedGetExpression, isInterfaceStatement, isNamespaceStatement, isTypeExpression, isVariableExpression } from './astUtils/reflection';
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
    lookups: string[];
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
        let typeChain: TypeChainEntry[] = [];
        const extraData = {} as ExtraSymbolData;
        const options: GetTypeOptions = { flags: flag, onlyCacheResolvedTypes: true, typeChain: typeChain, data: extraData };

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
                this.validatedSegments.set(segment, false);

                if (extraData.isAlias && isAliasStatement(extraData.definingNode)) {
                    //set the non-aliased version of this symbol as required.
                    const aliasTypeChain = [];
                    // eslint-disable-next-line no-bitwise
                    extraData.definingNode.value.getType({ ...options, flags: SymbolTypeFlag.runtime | SymbolTypeFlag.typetime, typeChain: aliasTypeChain });
                    typeChain = [...aliasTypeChain, ...typeChain.slice(1)];
                }
                const possibleNamespace = this.currentNamespaceStatement?.getNameParts()?.map(t => t.text)?.join('.').toLowerCase() ?? '';
                const fullChainName = util.processTypeChain(typeChain).fullChainName?.toLowerCase();
                const possibleNamesLower = [] as string[];
                let lastSymbol = '';
                for (const chainPart of fullChainName.split('.')) {
                    lastSymbol += (lastSymbol ? `.${chainPart}` : chainPart);
                    possibleNamesLower.push(lastSymbol);
                    if (possibleNamespace) {
                        possibleNamesLower.push(possibleNamespace + '.' + lastSymbol);
                    }
                }

                symbolsSet.add({
                    typeChain: typeChain,
                    flags: typeChain[0].data.flags,
                    endChainFlags: flag,
                    containingNamespaces: this.currentNamespaceStatement?.getNameParts()?.map(t => t.text),
                    file: this.file,
                    lookups: possibleNamesLower
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
            // skip namespaces and namespace bodies - no symbols to verify in those
            return;
        }
        if (isConditionalCompileStatement(segment) || isBlock(segment)) {
            // skip conditional compile statements and blocks - no symbols to verify in those
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

    getAllUnvalidatedSegments() {
        const segmentsToWalkForValidation: AstNode[] = [];
        for (const segment of this.segmentsForValidation) {
            if (this.validatedSegments.get(segment)) {
                continue;
            }
            segmentsToWalkForValidation.push(segment);
        }
        return segmentsToWalkForValidation;
    }

    getSegmentsWithChangedSymbols(changedSymbols: Map<SymbolTypeFlag, Set<string>>): AstNode[] {
        const segmentsToWalkForValidation: AstNode[] = [];
        for (const segment of this.segmentsForValidation) {
            if (this.validatedSegments.get(segment)) {
                continue;
            }
            const symbolsRequired = this.unresolvedSegmentsSymbols.get(segment);
            if (symbolsRequired) {
                if (util.hasAnyRequiredSymbolChanged([...symbolsRequired], changedSymbols)) {
                    segmentsToWalkForValidation.push(segment);
                    continue;
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


    checkIfSegmentNeedsRevalidation(segment: AstNode, changedSymbols: Map<SymbolTypeFlag, Set<string>>) {
        if (!this.validatedSegments.get(segment)) {
            return true;
        }
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
