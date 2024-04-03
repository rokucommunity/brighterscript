import type { UnresolvedSymbol } from './AstValidationSegmenter';
import type { Scope } from './Scope';
import type { BrsFile } from './files/BrsFile';
import { DiagnosticMessages } from './DiagnosticMessages';
import type { Program } from './Program';
import util from './util';
import { DiagnosticOrigin } from './interfaces';
import type { SymbolTypeFlag } from './SymbolTypeFlag';
import type { BscSymbol } from './SymbolTable';
import { isNamespaceType } from './astUtils/reflection';

export interface UnresolvedSymbolInfo {
    incompatibleScopes: Set<Scope>;
    missingInScopes: Set<Scope>;
}


export class CrossScopeValidator {

    // targetFile.pkgPath -> source.pkgPath -> unresolvedSymbol (in targetFile) -> info
    public crossScopeValidation = new Map<string, Map<string, Map<UnresolvedSymbol, UnresolvedSymbolInfo>>>();

    constructor(public program: Program) { }

    private symbolMapKey(symbol: UnresolvedSymbol) {
        return [...(symbol.containingNamespaces ?? []), ...symbol.typeChain.map(tce => tce.name)].join('.').toLowerCase();
    }

    resolutionsMap = new Map<UnresolvedSymbol, Set<{ scope: Scope; sourceFile: BrsFile; providedSymbol: BscSymbol }>>();


    getRequiredMap(scope: Scope) {
        const map = new Map<string, UnresolvedSymbol>();
        scope.enumerateBrsFiles((file) => {
            for (const symbol of file.requiredSymbols) {
                map.set(this.symbolMapKey(symbol), symbol);
            }
        });
        return map;
    }

    getProvidedMap(scope: Scope) {
        const providedMap = new Map<SymbolTypeFlag, Map<string, { file: BrsFile; symbol: BscSymbol }>>();
        const duplicatesMap = new Map<string, Set<{ file: BrsFile; symbol: BscSymbol }>>();
        scope.enumerateBrsFiles((file) => {
            for (const [flags, nameMap] of file.providedSymbols.symbolMap.entries()) {
                let fileMapForFlag = providedMap.get(flags);
                if (!fileMapForFlag) {
                    fileMapForFlag = new Map<string, { file: BrsFile; symbol: BscSymbol }>();
                    providedMap.set(flags, fileMapForFlag);
                }
                for (const [symbolName, symbol] of nameMap.entries()) {
                    if (isNamespaceType(symbol.type)) {
                        continue;
                    }
                    if (fileMapForFlag.has(symbolName)) {
                        let dupes = duplicatesMap.get(symbolName);
                        if (!dupes) {
                            dupes = new Set<{ file: BrsFile; symbol: BscSymbol }>();
                            duplicatesMap.set(symbolName, dupes);
                        }
                        dupes.add(fileMapForFlag.get(symbolName));
                        dupes.add({ file: file, symbol: symbol });
                    }
                    fileMapForFlag.set(symbolName, { file: file, symbol: symbol });
                }
            }
        });
        return { providedMap: providedMap, duplicatesMap: duplicatesMap };
    }

    getIssuesForScope(scope: Scope) {
        const requiredMap = this.getRequiredMap(scope);
        const { providedMap, duplicatesMap } = this.getProvidedMap(scope);

        const missingSymbols = new Set<UnresolvedSymbol>();

        for (const [symbolKey, unresolvedSymbol] of requiredMap.entries()) {

            // check global scope for components
            if (unresolvedSymbol.typeChain.length === 1 && this.program.globalScope.symbolTable.getSymbol(unresolvedSymbol.typeChain[0].name, unresolvedSymbol.flags)) {
                //symbol is available in global scope. ignore it
                continue;
            }
            const foundSymbol = providedMap.get(unresolvedSymbol.endChainFlags)?.get(symbolKey);
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

    addDiagnosticsForScopes(scopes: Scope[]) {

        //this.resolutionsMap.clear();
        const addDuplicateSymbolDiagnostics = false;
        const missingSymbolInScope = new Map<BrsFile, Map<UnresolvedSymbol, Set<Scope>>>();

        this.clearResolutionsForScopes(scopes);

        // Check scope for duplicates and missing symbols
        for (const scope of scopes) {

            scope.clearCrossScopeDiagnostics();


            const { missingSymbols, duplicatesMap } = this.getIssuesForScope(scope);
            if (addDuplicateSymbolDiagnostics) {
                for (const [_flag, dupeSet] of duplicatesMap.entries()) {
                    for (const dupe of dupeSet.values()) {
                        if (dupe.symbol.data?.definingNode?.range) {
                            scope.addDiagnostics([{
                                ...DiagnosticMessages.duplicateSymbolInScope(dupe.symbol.name, scope.name),
                                origin: DiagnosticOrigin.CrossScope,
                                file: dupe.file,
                                range: dupe.symbol.data?.definingNode.range
                            }]);
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
            const scopesForFile = this.program.getScopesForFile(file.srcPath);
            for (const [symbol, scopeList] of missingSymbolPerFile) {
                const typeChainResult = util.processTypeChain(symbol.typeChain);
                if (scopeList.size >= scopesForFile.length) {
                    // do not add diagnostic if thing is not in ANY scopes
                    continue;
                }
                for (const scope of scopeList) {
                    scope.addDiagnostics([{
                        ...DiagnosticMessages.symbolNotDefinedInScope(typeChainResult.fullNameOfItem, scope.name),
                        origin: DiagnosticOrigin.CrossScope,
                        file: file,
                        range: typeChainResult.range
                    }]);
                }
            }
        }


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
                const typeChainResult = util.processTypeChain(symbol.typeChain);
                const scopeListName = [...incompatibleScopes.values()].map(s => s.name).join(', ');
                this.program.addDiagnostics([{
                    ...DiagnosticMessages.incompatibleSymbolDefinition(typeChainResult.fullChainName, scopeListName),
                    file: symbol.file,
                    range: typeChainResult.range,
                    origin: DiagnosticOrigin.CrossScope
                }]);

            }

        }
    }

}


