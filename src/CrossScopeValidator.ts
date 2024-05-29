import type { UnresolvedSymbol } from './AstValidationSegmenter';
import type { Scope } from './Scope';
import type { BrsFile } from './files/BrsFile';
import { DiagnosticMessages } from './DiagnosticMessages';
import type { Program } from './Program';
import util from './util';
import { SymbolTypeFlag } from './SymbolTypeFlag';
import type { BscSymbol } from './SymbolTable';
import { isCallExpression, isEnumType, isInheritableType, isNamespaceType, isReferenceType, isTypedFunctionType, isUnionType } from './astUtils/reflection';
import type { ReferenceType } from './types/ReferenceType';
import { getAllRequiredSymbolNames } from './types/ReferenceType';
import type { TypeChainEntry, TypeChainProcessResult } from './interfaces';
import { BscTypeKind } from './types/BscTypeKind';
import { getAllTypesFromUnionType } from './types/helpers';
import type { BscType } from './types/BscType';
import type { BscFile } from './files/BscFile';


interface FileSymbolPair {
    file: BscFile;
    symbol: BscSymbol;
}

interface SymbolLookupKeys {
    potentialTypeKey: string;
    key: string;
    namespacedKey: string;
    namespacedPotentialTypeKey: string;
}

const CrossScopeValidatorDiagnosticTag = 'CrossScopeValidator';

export class ProvidedNode {

    namespaces = new Map<string, ProvidedNode>();
    symbols = new Map<string, FileSymbolPair>();

    constructor(public key: string = '') { }


    getSymbolByKey(symbolKeys: SymbolLookupKeys): FileSymbolPair {
        return this.getSymbol(symbolKeys.namespacedKey) ??
            this.getSymbol(symbolKeys.key) ??
            this.getSymbol(symbolKeys.namespacedPotentialTypeKey) ??
            this.getSymbol(symbolKeys.potentialTypeKey);
    }

    getSymbol(symbolName: string): FileSymbolPair {
        let lowerSymbolNameParts = symbolName.toLowerCase().split('.');
        return this.getSymbolByNameParts(lowerSymbolNameParts, this);
    }

    getNamespace(namespaceName: string): ProvidedNode {
        let lowerSymbolNameParts = namespaceName.toLowerCase().split('.');
        return this.getNamespaceByNameParts(lowerSymbolNameParts);
    }

    getSymbolByNameParts(lowerSymbolNameParts: string[], root: ProvidedNode): FileSymbolPair {
        const first = lowerSymbolNameParts?.[0];
        const rest = lowerSymbolNameParts.slice(1);
        if (!first) {
            return;
        }
        if (this.symbols.has(first)) {
            let result = this.symbols.get(first);
            let currentType = result.symbol.type;

            for (const namePart of rest) {
                if (isTypedFunctionType(currentType)) {
                    const returnType = currentType.returnType;
                    if (returnType.isResolvable()) {
                        currentType = returnType;
                    } else if (isReferenceType(returnType)) {
                        const fullName = returnType.fullName;
                        if (fullName.includes('.')) {
                            currentType = root.getSymbol(fullName)?.symbol?.type;
                        } else {
                            currentType = this.getSymbol(fullName)?.symbol?.type ??
                                root.getSymbol(fullName)?.symbol?.type;
                        }
                    }
                }
                let typesToTry = [currentType];
                if (isEnumType(currentType)) {
                    typesToTry.push(currentType.defaultMemberType);
                }
                if (isInheritableType(currentType)) {
                    let inheritableType = currentType as any;
                    while (inheritableType?.parentType) {
                        let parentType = inheritableType.parentType;
                        if (isReferenceType(inheritableType.parentType)) {
                            const fullName = inheritableType.parentType.fullName;
                            if (fullName.includes('.')) {
                                parentType = root.getSymbol(fullName)?.symbol?.type;
                            } else {
                                parentType = this.getSymbol(fullName)?.symbol?.type ??
                                    root.getSymbol(fullName)?.symbol?.type;
                            }
                        }
                        typesToTry.push(parentType);
                        inheritableType = parentType;
                    }

                }
                const extraData = {};

                for (const curType of typesToTry) {
                    currentType = curType?.getMemberType(namePart, { flags: SymbolTypeFlag.runtime, data: extraData });
                    if (isReferenceType(currentType)) {
                        const memberLookup = currentType.fullName;
                        currentType = this.getSymbol(memberLookup.toLowerCase())?.symbol?.type ?? root.getSymbol(memberLookup.toLowerCase())?.symbol?.type;
                    }
                    if (currentType) {
                        break;
                    }
                }

                if (!currentType) {
                    return;
                }
                // get specific member
                result = {
                    ...result, symbol: { name: namePart, type: currentType, data: extraData, flags: SymbolTypeFlag.runtime }
                };
            }
            return result;

        } else if (rest && this.namespaces.has(first)) {
            const node = this.namespaces.get(first);
            const parts = node.getSymbolByNameParts(rest, root);

            return parts;
        }
    }

    getNamespaceByNameParts(lowerSymbolNameParts: string[]): ProvidedNode {
        const first = lowerSymbolNameParts?.[0]?.toLowerCase();
        const rest = lowerSymbolNameParts.slice(1);
        if (!first) {
            return;
        }
        if (this.namespaces.has(first)) {
            const node = this.namespaces.get(first);
            const result = rest?.length > 0 ? node.getNamespaceByNameParts(rest) : node;
            return result;
        }
    }

    addSymbol(symbolName: string, symbolPair: FileSymbolPair) {
        let lowerSymbolNameParts = symbolName.toLowerCase().split('.');
        return this.addSymbolByNameParts(lowerSymbolNameParts, symbolPair);
    }

    private addSymbolByNameParts(lowerSymbolNameParts: string[], symbolPair: FileSymbolPair) {
        const first = lowerSymbolNameParts?.[0];
        const rest = lowerSymbolNameParts?.slice(1);
        let isDuplicate = false;
        if (!first) {
            return;
        }
        if (rest?.length > 0) {
            // first must be a namespace
            let namespaceNode = this.namespaces.get(first);
            if (!namespaceNode) {
                namespaceNode = new ProvidedNode(first);
                this.namespaces.set(first, namespaceNode);
            }
            return namespaceNode.addSymbolByNameParts(rest, symbolPair);
        } else {
            // just add it to the symbols
            if (!this.symbols.get(first)) {
                this.symbols.set(first, symbolPair);
            } else {
                isDuplicate = true;
            }
        }
        return isDuplicate;
    }
}


export class CrossScopeValidator {

    constructor(public program: Program) { }

    private symbolMapKeys(symbol: UnresolvedSymbol): SymbolLookupKeys[] {
        let keysArray = new Array<SymbolLookupKeys>();
        let unnamespacedNameLowers: string[] = [];

        function joinTypeChainForKey(typeChain: TypeChainEntry[], firstType?: BscType) {
            firstType ||= typeChain[0].type;
            const unnamespacedNameLower = typeChain.map((tce, i) => {
                if (i === 0) {
                    if (isReferenceType(firstType)) {
                        return firstType.fullName;
                    } else if (isInheritableType(firstType)) {
                        return tce.type.toString();
                    }
                    return tce.name;
                }
                return tce.name;
            }).join('.').toLowerCase();
            return unnamespacedNameLower;
        }

        if (isUnionType(symbol.typeChain[0].type) && symbol.typeChain[0].data.isInstance) {
            const allUnifiedTypes = getAllTypesFromUnionType(symbol.typeChain[0].type);
            for (const unifiedType of allUnifiedTypes) {
                unnamespacedNameLowers.push(joinTypeChainForKey(symbol.typeChain, unifiedType));
            }

        } else {
            unnamespacedNameLowers.push(joinTypeChainForKey(symbol.typeChain));
        }

        for (const unnamespacedNameLower of unnamespacedNameLowers) {
            const lowerFirst = symbol.typeChain[0]?.name?.toLowerCase() ?? '';
            let namespacedName = '';
            let lowerNamespacePrefix = '';
            let namespacedPotentialTypeKey = '';
            if (symbol.containingNamespaces?.length > 0 && symbol.typeChain[0]?.name.toLowerCase() !== symbol.containingNamespaces[0].toLowerCase()) {
                lowerNamespacePrefix = `${(symbol.containingNamespaces ?? []).join('.')}`.toLowerCase();
            }
            if (lowerNamespacePrefix) {
                namespacedName = `${lowerNamespacePrefix}.${unnamespacedNameLower}`;
                namespacedPotentialTypeKey = `${lowerNamespacePrefix}.${lowerFirst}`;
            }

            keysArray.push({
                potentialTypeKey: lowerFirst, // first entry in type chain (useful for enum types, typecasts, etc.)
                key: unnamespacedNameLower, //full name used in code (useful for namespaced symbols)
                namespacedKey: namespacedName, // full name including namespaces (useful for relative symbols in a namespace)
                namespacedPotentialTypeKey: namespacedPotentialTypeKey //first entry in chain, prefixed with current namespace
            });
        }
        return keysArray;
    }

    resolutionsMap = new Map<UnresolvedSymbol, Set<{ scope: Scope; sourceFile: BscFile; providedSymbol: BscSymbol }>>();
    providedTreeMap = new Map<Scope, { duplicatesMap: Map<string, Set<FileSymbolPair>>; providedTree: ProvidedNode }>();

    getRequiredMap(scope: Scope) {
        const map = new Map<SymbolLookupKeys, UnresolvedSymbol>();
        scope.enumerateBrsFiles((file) => {
            for (const symbol of file.requiredSymbols) {
                const symbolKeysArray = this.symbolMapKeys(symbol);
                for (const symbolKeys of symbolKeysArray) {
                    map.set(symbolKeys, symbol);
                }
            }
        });
        return map;
    }

    getProvidedTree(scope: Scope) {
        if (this.providedTreeMap.has(scope)) {
            return this.providedTreeMap.get(scope);
        }
        const providedTree = new ProvidedNode();
        const duplicatesMap = new Map<string, Set<FileSymbolPair>>();

        const referenceTypesMap = new Map<{ symbolName: string; file: BscFile; symbol: BscSymbol }, Set<string>>();


        function addSymbolWithDuplicates(symbolName: string, file: BscFile, symbol: BscSymbol) {
            const isDupe = providedTree.addSymbol(symbolName, { file: file, symbol: symbol });
            if (isDupe) {
                let dupes = duplicatesMap.get(symbolName);
                if (!dupes) {
                    dupes = new Set<{ file: BrsFile; symbol: BscSymbol }>();
                    duplicatesMap.set(symbolName, dupes);
                    dupes.add(providedTree.getSymbol(symbolName));
                }
                dupes.add({ file: file, symbol: symbol });
            }
        }

        scope.enumerateBrsFiles((file) => {
            for (const [_, nameMap] of file.providedSymbols.symbolMap.entries()) {

                for (const [symbolName, symbol] of nameMap.entries()) {
                    if (isNamespaceType(symbol.type)) {
                        continue;
                    }
                    addSymbolWithDuplicates(symbolName, file, symbol);
                }
            }

            // find all "provided symbols" that are reference types
            for (const [_, nameMap] of file.providedSymbols.referenceSymbolMap.entries()) {
                for (const [symbolName, symbol] of nameMap.entries()) {
                    const symbolType = symbol.type;
                    const allNames = getAllRequiredSymbolNames(symbolType);

                    referenceTypesMap.set({ symbolName: symbolName, file: file, symbol: symbol }, new Set(allNames));
                }
            }
        });

        // Add custom components
        for (let componentName of this.program.getSortedComponentNames()) {
            const typeName = 'rosgnode' + componentName;
            const componentSymbol = this.program.globalScope.symbolTable.getSymbol(typeName, SymbolTypeFlag.typetime)?.[0];
            const component = this.program.getComponent(componentName);
            if (componentSymbol && component) {
                addSymbolWithDuplicates(typeName, component?.file, componentSymbol);
            }
        }

        // check provided reference types to see if they exist yet!
        while (referenceTypesMap.size > 0) {
            let addedSymbol = false;
            for (const [refTypeDetails, neededNames] of referenceTypesMap.entries()) {
                for (const neededName of neededNames) {
                    if (providedTree.getSymbol(neededName)) {
                        neededNames.delete(neededName);
                    }
                }
                if (neededNames.size === 0) {
                    //found all that were needed
                    addSymbolWithDuplicates(refTypeDetails.symbolName, refTypeDetails.file, refTypeDetails.symbol);
                    referenceTypesMap.delete(refTypeDetails);
                    addedSymbol = true;
                }
            }
            if (!addedSymbol) {
                break;
            }
        }

        const result = { duplicatesMap: duplicatesMap, providedTree: providedTree };
        this.providedTreeMap.set(scope, result);
        return result;
    }

    getIssuesForScope(scope: Scope) {
        const requiredMap = this.getRequiredMap(scope);
        const { providedTree, duplicatesMap } = this.getProvidedTree(scope);

        const missingSymbols = new Set<UnresolvedSymbol>();

        for (const [symbolKeys, unresolvedSymbol] of requiredMap.entries()) {

            // check global scope for components
            if (unresolvedSymbol.typeChain.length === 1 && this.program.globalScope.symbolTable.getSymbol(unresolvedSymbol.typeChain[0].name, unresolvedSymbol.flags)) {
                //symbol is available in global scope. ignore it
                continue;
            }
            let foundSymbol = providedTree.getSymbolByKey(symbolKeys);

            if (foundSymbol) {
                if (!unresolvedSymbol.typeChain[0].data?.isInstance) {
                    let resolvedListForSymbol = this.resolutionsMap.get(unresolvedSymbol);
                    if (!resolvedListForSymbol) {
                        resolvedListForSymbol = new Set<{ scope: Scope; sourceFile: BrsFile; providedSymbol: BscSymbol }>();
                        this.resolutionsMap.set(unresolvedSymbol, resolvedListForSymbol);
                    }
                    resolvedListForSymbol.add({
                        scope: scope,
                        sourceFile: foundSymbol.file,
                        providedSymbol: foundSymbol.symbol
                    });
                }
            } else {
                let foundNamespace = providedTree.getNamespace(symbolKeys.key);

                if (foundNamespace) {
                    // this symbol turned out to be a namespace. This is allowed for alias statements
                    // TODO: add check to make sure this usage is from an alias statement
                } else {
                    // did not find symbol!
                    const missing = { ...unresolvedSymbol };
                    let namespaceNode = providedTree;
                    let currentKnownType;
                    for (const chainEntry of missing.typeChain) {
                        if (!chainEntry.isResolved) {
                            const lookupName = (chainEntry.type as ReferenceType)?.fullName ?? chainEntry.name;
                            if (!currentKnownType) {
                                namespaceNode = namespaceNode?.getNamespaceByNameParts([chainEntry.name]);

                            }
                            if (namespaceNode) {
                                chainEntry.isResolved = true;
                            } else {
                                if (currentKnownType) {
                                    currentKnownType = currentKnownType.getMemberType(chainEntry.name, { flags: SymbolTypeFlag.runtime });
                                } else {
                                    currentKnownType = providedTree.getSymbol(lookupName.toLowerCase())?.symbol?.type;
                                }

                                if (currentKnownType?.isResolvable()) {
                                    chainEntry.isResolved = true;
                                } else {
                                    break;
                                }
                            }
                        }
                    }
                    missingSymbols.add(unresolvedSymbol);
                }
            }
        }
        return { missingSymbols: missingSymbols, duplicatesMap: duplicatesMap };
    }

    clearResolutionsForFile(file: BrsFile) {
        for (const symbol of this.resolutionsMap.keys()) {
            if (symbol.file === file) {
                this.resolutionsMap.delete(symbol);
            }
        }
    }

    clearResolutionsForScopes(scopes: Scope[]) {
        for (const [symbol, resolutionInfos] of this.resolutionsMap.entries()) {
            for (const info of resolutionInfos.values()) {
                if (scopes.includes(info.scope)) {
                    resolutionInfos.delete(info);
                }
            }
            if (resolutionInfos.size === 0) {
                this.resolutionsMap.delete(symbol);
            }
        }
    }

    getFilesRequiringChangedSymbol(scopes: Scope[], changedSymbols: Map<SymbolTypeFlag, Set<string>>) {
        const filesThatNeedRevalidation = new Set<BscFile>();
        const filesThatDoNotNeedRevalidation = new Set<BscFile>();

        for (const scope of scopes) {
            scope.enumerateBrsFiles((file) => {
                if (filesThatNeedRevalidation.has(file) || filesThatDoNotNeedRevalidation.has(file)) {
                    return;
                }
                if (util.hasAnyRequiredSymbolChanged(file.requiredSymbols, changedSymbols)) {
                    filesThatNeedRevalidation.add(file);
                    return;
                }
                filesThatDoNotNeedRevalidation.add(file);
            });
        }
        return filesThatNeedRevalidation;
    }

    addDiagnosticsForScopes(scopes: Scope[]) { //, changedFiles: BrsFile[]) {
        const addDuplicateSymbolDiagnostics = false;
        const missingSymbolInScope = new Map<BrsFile, Map<UnresolvedSymbol, Set<Scope>>>();
        this.providedTreeMap.clear();
        this.clearResolutionsForScopes(scopes);

        // Check scope for duplicates and missing symbols
        for (const scope of scopes) {
            this.program.diagnostics.clearByFilter({
                scope: scope,
                tag: CrossScopeValidatorDiagnosticTag
            });

            const { missingSymbols, duplicatesMap } = this.getIssuesForScope(scope);
            if (addDuplicateSymbolDiagnostics) {
                for (const [_flag, dupeSet] of duplicatesMap.entries()) {
                    for (const dupe of dupeSet.values()) {
                        if (dupe.symbol.data?.definingNode?.range) {
                            this.program.diagnostics.register({
                                ...DiagnosticMessages.duplicateSymbolInScope(dupe.symbol.name, scope.name),
                                file: dupe.file,
                                range: dupe.symbol.data?.definingNode.range
                            }, {
                                scope: scope,
                                tags: [CrossScopeValidatorDiagnosticTag]
                            });
                        }
                    }
                }
            }
            // build map of the symbols and scopes where the symbols are missing per file
            for (const missingSymbol of missingSymbols) {
                let missingSymbolPerFile = missingSymbolInScope.get(missingSymbol.file);
                if (!missingSymbolPerFile) {
                    missingSymbolPerFile = new Map<UnresolvedSymbol, Set<Scope>>();
                    missingSymbolInScope.set(missingSymbol.file, missingSymbolPerFile);
                }
                let scopesWithMissingSymbol = missingSymbolPerFile.get(missingSymbol);
                if (!scopesWithMissingSymbol) {
                    scopesWithMissingSymbol = new Set<Scope>();
                    missingSymbolPerFile.set(missingSymbol, scopesWithMissingSymbol);
                }
                scopesWithMissingSymbol.add(scope);
            }
        }

        // Check each file for missing symbols - if they are missing in SOME scopes, add diagnostic
        for (let [file, missingSymbolPerFile] of missingSymbolInScope.entries()) {
            for (const [symbol, scopeList] of missingSymbolPerFile) {
                const typeChainResult = util.processTypeChain(symbol.typeChain);

                for (const scope of scopeList) {
                    this.program.diagnostics.register({

                        ...this.getCannotFindDiagnostic(scope, typeChainResult),
                        file: file,
                        range: typeChainResult.range
                    }, {
                        scope: scope,
                        tags: [CrossScopeValidatorDiagnosticTag]
                    });
                }
            }
        }

        for (const resolution of this.getIncompatibleSymbolResolutions()) {
            const symbol = resolution.symbol;
            const incompatibleScopes = resolution.incompatibleScopes;
            if (incompatibleScopes.size > 1) {
                const typeChainResult = util.processTypeChain(symbol.typeChain);
                const scopeListName = [...incompatibleScopes.values()].map(s => s.name).join(', ');
                this.program.diagnostics.register({
                    ...DiagnosticMessages.incompatibleSymbolDefinition(typeChainResult.fullChainName, scopeListName),
                    file: symbol.file,
                    range: typeChainResult.range
                }, {
                    tags: [CrossScopeValidatorDiagnosticTag]
                });
            }
        }
    }

    getIncompatibleSymbolResolutions() {
        const incompatibleResolutions = new Array<{ symbol: UnresolvedSymbol; incompatibleScopes: Set<Scope> }>();
        // check all resolutions and check if there are resolutions that are not compatible across scopes
        for (const [symbol, resolutionDetails] of this.resolutionsMap.entries()) {
            if (resolutionDetails.size < 2) {
                // there is only one resolution... no worries
                continue;
            }
            const resolutionsList = [...resolutionDetails];
            const prime = resolutionsList[0];
            let incompatibleScopes = new Set<Scope>();
            let addedPrime = false;
            for (let i = 1; i < resolutionsList.length; i++) {
                let providedSymbolType = prime.providedSymbol.type;
                const symbolInThisScope = resolutionsList[i].providedSymbol;

                //get more general type
                if (providedSymbolType.isEqual(symbolInThisScope.type)) {
                    //type in this scope is the same as one we're already checking
                } else if (providedSymbolType.isTypeCompatible(symbolInThisScope.type)) {
                    //type in this scope is compatible with one we're storing. use most generic
                    providedSymbolType = symbolInThisScope.type;
                } else if (symbolInThisScope.type.isTypeCompatible(providedSymbolType)) {
                    // type we're storing is more generic that the type in this scope
                } else {
                    // type in this scope is not compatible with other types for this symbol
                    if (!addedPrime) {
                        incompatibleScopes.add(prime.scope);
                        addedPrime = true;
                    }
                    incompatibleScopes.add(resolutionsList[i].scope);
                }
            }

            if (incompatibleScopes.size > 1) {
                incompatibleResolutions.push({
                    symbol: symbol,
                    incompatibleScopes: incompatibleScopes
                });
            }
        }
        return incompatibleResolutions;
    }

    private getCannotFindDiagnostic(scope: Scope, typeChainResult: TypeChainProcessResult) {
        const parentDescriptor = this.getParentTypeDescriptor(this.getProvidedTree(scope)?.providedTree, typeChainResult);
        if (isCallExpression(typeChainResult.astNode?.parent) && typeChainResult.astNode?.parent.callee === typeChainResult.astNode) {
            return DiagnosticMessages.cannotFindFunction(typeChainResult.itemName, typeChainResult.fullNameOfItem, typeChainResult.itemParentTypeName, parentDescriptor);
        }
        return DiagnosticMessages.cannotFindName(typeChainResult.itemName, typeChainResult.fullNameOfItem, typeChainResult.itemParentTypeName, parentDescriptor);
    }

    private getParentTypeDescriptor(provided: ProvidedNode, typeChainResult: TypeChainProcessResult) {
        if (typeChainResult.itemParentTypeKind === BscTypeKind.NamespaceType || provided?.getNamespace(typeChainResult.itemParentTypeName)) {
            return 'namespace';
        }
        return 'type';
    }

}
