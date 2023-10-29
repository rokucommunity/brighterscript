import type { ExtraSymbolData } from '.';
import { SymbolTypeFlag } from './SymbolTable';
import { UnresolvedNodeSet } from './UnresolvedNodeSet';
import { isBody, isClassStatement, isInterfaceStatement, isNamespaceStatement } from './astUtils/reflection';
import { WalkMode } from './astUtils/visitors';
import type { GetTypeOptions } from './interfaces';
import type { AstNode } from './parser/AstNode';
import { util } from './util';

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


    checkExpressionForUnresolved(segment: AstNode, expression: AstNode) {
        if (!expression) {
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
        segment.walk((node) => {
            const expressionIsUnresolved = this.checkExpressionForUnresolved(segment, node);
            foundUnresolvedInSegment = expressionIsUnresolved || foundUnresolvedInSegment;
        }, {
            // eslint-disable-next-line no-bitwise
            walkMode: WalkMode.recurseChildFunctions | WalkMode.visitExpressions
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
                    } else {
                        segmentNeedsRevalidation = unresolvedNodeSet.addTypeForExpression(node, options, type);
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
