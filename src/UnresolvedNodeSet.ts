import type { GetSymbolTypeOptions, SymbolTypeFlag } from './SymbolTable';
import type { AstNode } from './parser/AstNode';
import type { BscType } from './types/BscType';


//export const RecommendedFileSegmentationWalkMode = WalkMode.walkStatements;

export class UnresolvedNodeSet {

    constructor(public root: AstNode) { }

    private data = new Map<AstNode, Map<SymbolTypeFlag, BscType[]>>();

    reset() {
        this.data.clear();
    }

    get nodes() {
        return this.data.keys();
    }


    private getMap(node: AstNode) {
        if (!this.data.has(node)) {
            this.data.set(node, new Map<SymbolTypeFlag, BscType[]>());
        }
        return this.data.get(node);
    }
    addExpression(node: AstNode, options: GetSymbolTypeOptions) {
        const listOfResolvedTypes: BscType[] = [];
        this.getMap(node).set(options.flags, listOfResolvedTypes);
        return listOfResolvedTypes;
    }

    addTypeForExpression(node: AstNode, options: GetSymbolTypeOptions, incomingType: BscType) {
        if (!incomingType.isResolvable()) {
            return true;
        }
        const resolvedTypesList = this.getMap(node).get(options.flags) ?? this.addExpression(node, options);

        let newTypeToCheck = true;
        for (const resolvedType of resolvedTypesList) {
            if (resolvedType.isTypeCompatible(incomingType)) {
                newTypeToCheck = false;
                break;
            }
        }
        if (newTypeToCheck) {
            resolvedTypesList.push(incomingType);
        }
        return newTypeToCheck;
    }
}
