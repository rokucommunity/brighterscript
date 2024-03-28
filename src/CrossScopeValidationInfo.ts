import type { UnresolvedSymbol } from './AstValidationSegmenter';
import type { Scope } from './Scope';
import type { BrsFile } from './files/BrsFile';
import { DiagnosticMessages } from './DiagnosticMessages';
import type { Program } from './Program';
import util from './util';
import { DiagnosticOrigin } from './interfaces';

export interface UnresolvedSymbolInfo {
    incompatibleScopes: Set<Scope>;
    missingInScopes: Set<Scope>;
}


export class CrossScopeValidationInfo {

    // targetFile.pkgPath -> source.pkgPath -> unresolvedSymbol (in targetFile) -> info
    public crossScopeValidation = new Map<string, Map<string, Map<UnresolvedSymbol, UnresolvedSymbolInfo>>>();

    constructor(public program: Program) { }


    private getSymbolInfo(targetFile: BrsFile, sourceFile: BrsFile, symbol: UnresolvedSymbol) {
        const targetFilePathLower = targetFile.pkgPath.toLowerCase();
        const sourceFilePathLower = sourceFile.pkgPath.toLowerCase();

        let sourceFileMap = this.crossScopeValidation.get(targetFilePathLower);
        if (!sourceFileMap) {
            sourceFileMap = new Map<string, Map<UnresolvedSymbol, UnresolvedSymbolInfo>>();
            this.crossScopeValidation.set(targetFilePathLower, sourceFileMap);
        }

        let symbolMap = sourceFileMap.get(sourceFilePathLower);

        if (!symbolMap) {
            symbolMap = new Map<UnresolvedSymbol, UnresolvedSymbolInfo>();
            sourceFileMap.set(sourceFilePathLower, symbolMap);
        }

        let symbolInfo = symbolMap.get(symbol);
        if (!symbolInfo) {
            symbolInfo = {
                incompatibleScopes: new Set<Scope>(),
                missingInScopes: new Set<Scope>()
            };
            symbolMap.set(symbol, symbolInfo);
        }
        return symbolInfo;
    }

    addIncompatibleScope(file: BrsFile, symbol: UnresolvedSymbol, scope: Scope, sourceFile: BrsFile) {
        this.getSymbolInfo(file, sourceFile, symbol).incompatibleScopes.add(scope);
    }

    addMissingInScope(file: BrsFile, symbol: UnresolvedSymbol, scope: Scope, sourceFile: BrsFile) {
        this.getSymbolInfo(file, sourceFile, symbol).missingInScopes.add(scope);
    }

    clearInfoForFile(file: BrsFile) {
        const filePathLower = file.pkgPath.toLowerCase();
        this.crossScopeValidation.delete(filePathLower);
    }

    clearInfoFromSourceFile(sourceFile: BrsFile) {
        const filePathLower = sourceFile.pkgPath.toLowerCase();
        for (const sourceFileMap of this.crossScopeValidation.values()) {
            sourceFileMap.delete(filePathLower);
        }
    }

    cleanUpOldSymbols(targetFile: BrsFile) {
        const filePathLower = targetFile.pkgPath.toLowerCase();
        for (const sourceFileMap of this.crossScopeValidation.get(filePathLower)?.values() ?? []) {
            for (const unresolvedSymbol of sourceFileMap.keys() ?? []) {
                if (!targetFile.requiredSymbols.includes(unresolvedSymbol)) {
                    sourceFileMap.delete(unresolvedSymbol);
                }
            }
        }
    }


    addDiagnostics() {
        for (const [filePath, sourceFileMap] of this.crossScopeValidation.entries()) {
            const file = this.program.getFile(filePath);
            const scopesForFile = this.program.getScopesForFile(filePath);

            const mergedMissingScopes = new Map<UnresolvedSymbol, Set<Scope>>();
            const mergedIncompatibleScopes = new Map<UnresolvedSymbol, Set<Scope>>();

            for (const symbolMap of sourceFileMap.values()) {
                for (const [unresolvedSymbol, symbolInfo] of symbolMap.entries()) {
                    let missingScopes = mergedMissingScopes.get(unresolvedSymbol);
                    if (!missingScopes) {
                        missingScopes = new Set<Scope>();

                    }
                    missingScopes = new Set([...missingScopes, ...symbolInfo.missingInScopes]);
                    mergedMissingScopes.set(unresolvedSymbol, missingScopes);

                    let incompatibleScopes = mergedIncompatibleScopes.get(unresolvedSymbol);
                    if (!incompatibleScopes) {
                        incompatibleScopes = new Set<Scope>();
                    }
                    incompatibleScopes = new Set([...incompatibleScopes, ...symbolInfo.incompatibleScopes]);
                    mergedIncompatibleScopes.set(unresolvedSymbol, incompatibleScopes);
                }
            }

            for (const [symbol, scopeList] of mergedMissingScopes) {
                const typeChainResult = util.processTypeChain(symbol.typeChain);
                if (scopeList.size === scopesForFile.length) {
                    // do not add diagnostic if thing is not in ANY scopes
                    continue;
                }
                for (const scope of scopeList) {
                    scope.addDiagnostics([{
                        ...DiagnosticMessages.symbolNotDefinedInScope(typeChainResult.fullNameOfItem),
                        origin: DiagnosticOrigin.CrossScope,
                        file: file,
                        range: typeChainResult.range
                    }]);
                }
            }

            for (const [symbol, scopeList] of mergedIncompatibleScopes) {
                const typeChainResult = util.processTypeChain(symbol.typeChain);
                const scopeListName = [...scopeList.values()].map(s => s.name).join(', ');
                this.program.addDiagnostics([{
                    ...DiagnosticMessages.incompatibleSymbolDefinition(typeChainResult.fullNameOfItem, scopeListName),
                    file: file,
                    range: typeChainResult.range
                }]);
            }
        }
    }

}


