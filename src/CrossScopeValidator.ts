import type { UnresolvedSymbol } from './AstValidationSegmenter';
import type { Scope } from './Scope';
import type { BrsFile } from './files/BrsFile';
import { DiagnosticMessages } from './DiagnosticMessages';
import type { Program } from './Program';
import util from './util';
import { SymbolTypeFlag } from './SymbolTypeFlag';
import type { BscSymbol } from './SymbolTable';
import { isAnyReferenceType, isNamespaceType, isReferenceType, isTypedFunctionType } from './astUtils/reflection';
import { getAllRequiredSymbolNames } from './types';


interface FileSymbolPair {
    file: BrsFile;
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
            for (const namePart of rest) {
                let memberTable = result.symbol.type.getMemberTable();
                if (isTypedFunctionType(result.symbol.type)) {
                    const returnType = result.symbol.type.returnType;
                    if (returnType.isResolvable()) {
                        memberTable = returnType.getMemberTable();
                    } else if (isReferenceType(returnType)) {
                        const fullName = returnType.fullName;
                        if (fullName.includes('.')) {
                            memberTable = root.getSymbol(fullName)?.symbol?.type?.getMemberTable();
                        } else {
                            memberTable = this.getSymbol(fullName)?.symbol.type.getMemberTable() ??
                                root.getSymbol(fullName)?.symbol?.type?.getMemberTable();
                        }
                    }
                }
                const memberSymbol = memberTable?.getSymbol(namePart, SymbolTypeFlag.runtime);
                if (!memberSymbol) {
                    return;
                }
                // get specific member
                result = { ...result, symbol: memberSymbol[0] };
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

    private symbolMapKeys(symbol: UnresolvedSymbol): SymbolLookupKeys {
        const unnamespacedNameLower = symbol.typeChain.map(tce => tce.name).join('.').toLowerCase();
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

        return {
            potentialTypeKey: lowerFirst, // first entry in type chain (useful for enum types, typecasts, etc.)
            key: unnamespacedNameLower, //full name used in code (useful for namespaced symbols)
            namespacedKey: namespacedName, // full name including namespaces (useful for relative symbols in a namespace)
            namespacedPotentialTypeKey: namespacedPotentialTypeKey //first entry in chain, prefixed with current namespace
        };
    }

    resolutionsMap = new Map<UnresolvedSymbol, Set<{ scope: Scope; sourceFile: BrsFile; providedSymbol: BscSymbol }>>();

    getRequiredMap(scope: Scope) {
        const map = new Map<SymbolLookupKeys, UnresolvedSymbol>();
        scope.enumerateBrsFiles((file) => {
            for (const symbol of file.requiredSymbols) {
                const symbolKeys = this.symbolMapKeys(symbol);
                map.set(symbolKeys, symbol);
            }
        });
        return map;
    }

    getProvidedTree(scope: Scope) {
        const providedTree = new ProvidedNode();
        const duplicatesMap = new Map<string, Set<FileSymbolPair>>();

        const referenceTypesMap = new Map<{ symbolName: string; file: BrsFile; symbol: BscSymbol }, Set<string>>();


        function addSymbolWithDuplicates(symbolName: string, file: BrsFile, symbol: BscSymbol) {
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

        return { duplicatesMap: duplicatesMap, providedTree: providedTree };
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
            } else {
                // did not find symbol!
                const missing = { ...unresolvedSymbol };
                let namespaceNode = providedTree;
                for (const chainEntry of missing.typeChain) {
                    if (!chainEntry.isResolved) {
                        namespaceNode = namespaceNode?.getNamespaceByNameParts([chainEntry.name]);
                        if (namespaceNode) {
                            chainEntry.isResolved = true;
                        } else {
                            break;
                        }
                    }
                }
                missingSymbols.add(unresolvedSymbol);
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

    addDiagnosticsForScopes(scopes: Scope[], changedFiles: BrsFile[]) {
        const addDuplicateSymbolDiagnostics = false;
        const missingSymbolInScope = new Map<BrsFile, Map<UnresolvedSymbol, Set<Scope>>>();

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
                        ...DiagnosticMessages.cannotFindName(typeChainResult.itemName, typeChainResult.fullNameOfItem),
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

}
