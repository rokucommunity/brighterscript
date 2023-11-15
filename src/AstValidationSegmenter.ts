import type { DottedGetExpression, TypeExpression, VariableExpression } from '.';
import { SymbolTypeFlag } from './SymbolTable';
import { UnresolvedNodeSet } from './UnresolvedNodeSet';
import { isBody, isClassStatement, isCommentStatement, isInterfaceStatement, isNamespaceStatement } from './astUtils/reflection';
import { ChildrenSkipper, WalkMode, createVisitor } from './astUtils/visitors';
import type { ExtraSymbolData, GetTypeOptions } from './interfaces';
import type { AstNode } from './parser/AstNode';
import { util } from './util';

// eslint-disable-next-line no-bitwise
export const InsideSegmentWalkMode = WalkMode.visitStatements | WalkMode.visitExpressions | WalkMode.recurseChildFunctions;

export class AstValidationSegmenter {

    public unresolvedSegments = new Map<AstNode, UnresolvedNodeSet>();
    public validatedSegments = new Map<AstNode, boolean>();
    public segmentsForValidation = new Array<AstNode>();
    public singleValidationSegments = new Set<AstNode>();
    public ast: AstNode;


    reset() {
        this.unresolvedSegments.clear();
        this.validatedSegments.clear();
        this.singleValidationSegments.clear();
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


    checkExpressionForUnresolved(segment: AstNode, expression: VariableExpression | DottedGetExpression | TypeExpression) {
        if (!expression || isCommentStatement(expression)) {
            return false;
        }
        const flag = util.isInTypeExpression(expression) ? SymbolTypeFlag.typetime : SymbolTypeFlag.runtime;
        const options: GetTypeOptions = { flags: flag, onlyCacheResolvedTypes: true };
        const nodeType = expression.getType(options);
        if (!nodeType.isResolvable()) {
            let nodeSet: UnresolvedNodeSet;
            if (!this.unresolvedSegments.has(segment)) {
                nodeSet = new UnresolvedNodeSet(segment);
                this.unresolvedSegments.set(segment, nodeSet);
            } else {
                nodeSet = this.unresolvedSegments.get(segment);
            }
            nodeSet.addExpression(expression, options);
            return true;
        }
        return false;
    }

    checkSegmentWalk = (segment: AstNode) => {
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
        segment.walk(createVisitor({
            VariableExpression: (expr) => {
                const expressionIsUnresolved = this.checkExpressionForUnresolved(segment, expr);
                foundUnresolvedInSegment = expressionIsUnresolved || foundUnresolvedInSegment;
                skipper.skip();
            },
            DottedGetExpression: (expr) => {
                const expressionIsUnresolved = this.checkExpressionForUnresolved(segment, expr);
                foundUnresolvedInSegment = expressionIsUnresolved || foundUnresolvedInSegment;
                skipper.skip();
            },
            TypeExpression: (expr) => {
                const expressionIsUnresolved = this.checkExpressionForUnresolved(segment, expr);
                foundUnresolvedInSegment = expressionIsUnresolved || foundUnresolvedInSegment;
                skipper.skip();
            }
        }), {
            walkMode: InsideSegmentWalkMode,
            skipChildren: skipper
        });
        if (!foundUnresolvedInSegment) {
            this.singleValidationSegments.add(segment);
        }
    };


    getSegments(): AstNode[] {
        const segmentsToWalkForValidation: AstNode[] = [];
        for (const segment of this.segmentsForValidation) {
            const unresolvedNodeSet = this.unresolvedSegments.get(segment);
            const isSingleValidationSegment = this.singleValidationSegments.has(segment);
            const singleValidationSegmentAlreadyValidated = isSingleValidationSegment ? this.validatedSegments.get(segment) : false;
            let segmentNeedsRevalidation = !singleValidationSegmentAlreadyValidated;
            if (unresolvedNodeSet) {
                for (let node of unresolvedNodeSet.nodes) {
                    const data: ExtraSymbolData = {};
                    const options: GetTypeOptions = { flags: util.isInTypeExpression(node) ? SymbolTypeFlag.typetime : SymbolTypeFlag.runtime, data: data };
                    const type = node.getType(options);
                    if (!type || !type.isResolvable()) {
                        // the type that we're checking here is not found - force validation
                        segmentNeedsRevalidation = true;
                        break;
                    } else {
                        const newTypeToCheck = unresolvedNodeSet.addTypeForExpression(node, options, type);
                        segmentNeedsRevalidation = segmentNeedsRevalidation || newTypeToCheck;
                    }
                }
                if (segmentNeedsRevalidation) {
                    segmentsToWalkForValidation.push(segment);
                    continue;
                }
            } else if (segmentNeedsRevalidation) {
                segmentsToWalkForValidation.push(segment);
            }
        }
        return segmentsToWalkForValidation;
    }

    markSegmentAsValidated(segment: AstNode) {
        this.validatedSegments.set(segment, true);
    }
}
