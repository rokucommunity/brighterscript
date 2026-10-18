import type { UnresolvedSymbol } from './AstValidationSegmenter';
import type { Scope } from './Scope';
import type { BrsFile, ProvidedSymbol, ProvidedSymbolInfo } from './files/BrsFile';
import { DiagnosticMessages } from './DiagnosticMessages';
import type { Program } from './Program';
import { util } from './util';
import { SymbolTypeFlag } from './SymbolTypeFlag';
import type { BscSymbol } from './SymbolTable';
import { isCallExpression, isConstStatement, isEnumStatement, isEnumType, isFunctionStatement, isInheritableType, isInterfaceStatement, isNamespaceStatement, isNamespaceType, isReferenceType, isTypedFunctionType, isUnionType } from './astUtils/reflection';
import type { ReferenceType } from './types/ReferenceType';
import { getAllRequiredSymbolNames } from './types/ReferenceType';
import type { TypeChainEntry, TypeChainProcessResult } from './interfaces';
import { BscTypeKind } from './types/BscTypeKind';
import { getAllTypesFromCompoundType } from './types/helpers';
import type { BscType } from './types/BscType';
import type { BscFile } from './files/BscFile';
import type { ClassStatement, ConstStatement, EnumMemberStatement, EnumStatement, InterfaceStatement, NamespaceStatement } from './parser/Statement';
import { ParseMode } from './parser/Parser';
import { globalFile } from './globalCallables';
import type { DottedGetExpression, VariableExpression } from './parser/Expression';
import type { InheritableType } from './types';


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

/**
 * Where a symbol gets added to a scope's provided symbols: the file, and its order within that file
 * (runtime symbols first, then typetime, in insertion order - same order the scope used to add them in)
 */
interface ProvidedSymbolEvent {
    file: BscFile;
    order: number;
    symbolName: string;
    symbolObj: ProvidedSymbol;
}

interface IndexedFile {
    providedSymbols: ProvidedSymbolInfo;
    symbolNames: string[];
    namespaceNames: string[];
}

/**
 * Program-wide index of every provided symbol and namespace, so each scope doesn't have to rebuild its own tree
 * out of every file's provided symbols. Only updated when a file's provided symbols change
 */
export class ProvidedSymbolIndex {
    private files = new Map<BscFile, IndexedFile>();

    /**
     * lower full symbol name -> every place it gets provided
     */
    public symbolEvents = new Map<string, ProvidedSymbolEvent[]>();

    /**
     * lower full namespace name -> the order of the first symbol in each file that creates it
     */
    public namespaceEvents = new Map<string, Map<BscFile, number>>();

    /**
     * (re)index a file, if its provided symbols changed since last time
     */
    public update(file: BrsFile) {
        const providedSymbols = file.providedSymbols;
        const existing = this.files.get(file);
        if (existing?.providedSymbols === providedSymbols) {
            return;
        }
        if (existing) {
            this.remove(file);
        }
        const indexed: IndexedFile = { providedSymbols: providedSymbols, symbolNames: [], namespaceNames: [] };
        let order = 0;
        for (const nameMap of providedSymbols.symbolMap.values()) {
            for (const [symbolName, symbolObj] of nameMap) {
                if (isNamespaceType(symbolObj.symbol.type)) {
                    continue;
                }
                let events = this.symbolEvents.get(symbolName);
                if (!events) {
                    events = [];
                    this.symbolEvents.set(symbolName, events);
                }
                events.push({ file: file, order: order, symbolName: symbolName, symbolObj: symbolObj });
                indexed.symbolNames.push(symbolName);

                //adding `a.b.c` creates the `a` and `a.b` namespaces
                let dotIndex = symbolName.indexOf('.');
                while (dotIndex > 0) {
                    const namespaceName = symbolName.substring(0, dotIndex);
                    let namespaceFiles = this.namespaceEvents.get(namespaceName);
                    if (!namespaceFiles) {
                        namespaceFiles = new Map();
                        this.namespaceEvents.set(namespaceName, namespaceFiles);
                    }
                    if (!namespaceFiles.has(file)) {
                        namespaceFiles.set(file, order);
                        indexed.namespaceNames.push(namespaceName);
                    }
                    dotIndex = symbolName.indexOf('.', dotIndex + 1);
                }
                order++;
            }
        }
        this.files.set(file, indexed);
    }

    public remove(file: BscFile) {
        const indexed = this.files.get(file);
        if (!indexed) {
            return;
        }
        for (const symbolName of new Set(indexed.symbolNames)) {
            const events = this.symbolEvents.get(symbolName).filter(x => x.file !== file);
            if (events.length > 0) {
                this.symbolEvents.set(symbolName, events);
            } else {
                this.symbolEvents.delete(symbolName);
            }
        }
        for (const namespaceName of indexed.namespaceNames) {
            const namespaceFiles = this.namespaceEvents.get(namespaceName);
            namespaceFiles.delete(file);
            if (namespaceFiles.size === 0) {
                this.namespaceEvents.delete(namespaceName);
            }
        }
        this.files.delete(file);
    }

    /**
     * Drop files that aren't in the program anymore
     */
    public prune(program: Program) {
        for (const file of [...this.files.keys()]) {
            if (program.getFile(file.srcPath) !== file) {
                this.remove(file);
            }
        }
    }

    /**
     * Could this name end up as a duplicate in some scope? If not, there's no need to look at it per scope
     */
    public couldBeDuplicate(symbolName: string, isGlobal: (name: string) => boolean) {
        const events = this.symbolEvents.get(symbolName);
        return events?.length > 1 ||
            this.namespaceEvents.has(symbolName) ||
            events?.[0]?.symbolObj.duplicates.length > 0 ||
            isGlobal(symbolName);
    }

    public getSymbolNames(file: BscFile) {
        return this.files.get(file)?.symbolNames ?? [];
    }
}

const positionsPerFile = 1e6;
const referenceSymbolPositionStart = 1e15;

interface PositionedSymbol {
    position: number;
    pair: FileSymbolPair;
}

/**
 * The provided symbols of one scope, answered from the program-wide index. A position is when a symbol would have been
 * added to the scope's tree: the file's index in the scope, then the symbol's order in the file. Reference type symbols
 * that pass the fixpoint check get added after everything else
 */
export class ScopeProvidedSymbols {
    constructor(
        private index: ProvidedSymbolIndex,
        public componentsMap: Map<string, FileSymbolPair>
    ) { }

    public fileIndex = new Map<BscFile, number>();

    private referenceSymbols = new Map<string, PositionedSymbol>();
    private referenceNamespaces = new Map<string, number>();
    private nextReferencePosition = referenceSymbolPositionStart;

    private storedSymbolCache = new Map<string, PositionedSymbol | null>();
    private namespacePositionCache = new Map<string, number>();

    public getPosition(event: ProvidedSymbolEvent) {
        return (this.fileIndex.get(event.file) * positionsPerFile) + event.order;
    }

    /**
     * The events for this name in this scope, in the order they'd be added
     */
    public getEvents(symbolName: string) {
        const events = this.index.symbolEvents.get(symbolName)?.filter(x => this.fileIndex.has(x.file)) ?? [];
        return events.sort((a, b) => this.getPosition(a) - this.getPosition(b));
    }

    /**
     * When does this namespace first exist in this scope? (Infinity if never)
     */
    public getNamespacePosition(namespaceName: string) {
        let position = this.namespacePositionCache.get(namespaceName);
        if (position === undefined) {
            position = Infinity;
            for (const [file, order] of this.index.namespaceEvents.get(namespaceName) ?? []) {
                const fileIndex = this.fileIndex.get(file);
                if (fileIndex !== undefined) {
                    position = Math.min(position, (fileIndex * positionsPerFile) + order);
                }
            }
            this.namespacePositionCache.set(namespaceName, position);
        }
        return Math.min(position, this.referenceNamespaces.get(namespaceName) ?? Infinity);
    }

    /**
     * The first non-reference symbol that actually got stored for this name - a symbol isn't stored if a namespace
     * with the same name already exists when it's added
     */
    private getStoredSymbol(symbolName: string) {
        let stored = this.storedSymbolCache.get(symbolName);
        if (stored === undefined) {
            stored = null;
            //only the first one can be stored - once a symbol is stored, later ones are duplicates
            const first = this.getEvents(symbolName)[0];
            if (first && this.getPosition(first) < this.getNamespacePosition(symbolName)) {
                stored = { position: this.getPosition(first), pair: { file: first.file, symbol: first.symbolObj.symbol } };
            }
            this.storedSymbolCache.set(symbolName, stored);
        }
        return stored;
    }

    /**
     * The symbol stored for this name before the given position
     */
    public getSymbolAt(symbolName: string, time: number): FileSymbolPair {
        const stored = this.getStoredSymbol(symbolName) ?? this.referenceSymbols.get(symbolName);
        return stored && stored.position < time ? stored.pair : undefined;
    }

    public hasNamespaceAt(namespaceName: string, time: number) {
        return this.getNamespacePosition(namespaceName) < time;
    }

    /**
     * Add a reference type symbol that passed the fixpoint check. Returns its position
     */
    public addReferenceSymbol(symbolName: string, pair: FileSymbolPair) {
        const position = this.nextReferencePosition++;
        let dotIndex = symbolName.indexOf('.');
        while (dotIndex > 0) {
            const namespaceName = symbolName.substring(0, dotIndex);
            if (!this.referenceNamespaces.has(namespaceName)) {
                this.referenceNamespaces.set(namespaceName, position);
            }
            dotIndex = symbolName.indexOf('.', dotIndex + 1);
        }
        const isStored = !this.hasNamespaceAt(symbolName, position) && !this.getSymbolAt(symbolName, position);
        if (isStored) {
            this.referenceSymbols.set(symbolName, { position: position, pair: pair });
        }
        return position;
    }
}

/**
 * Looks up provided symbols the same way the old per-scope tree did, but backed by `ScopeProvidedSymbols`.
 * `time` is when to look: symbols/namespaces added at or after it don't exist yet
 */
export class ProvidedSymbolsView {
    constructor(
        private scopeSymbols: ScopeProvidedSymbols,
        private prefix = '',
        private time = Infinity
    ) { }

    getSymbolByKey(symbolKeys: SymbolLookupKeys): FileSymbolPair {
        return this.getSymbol(symbolKeys.namespacedKey) ??
            this.getSymbol(symbolKeys.key) ??
            this.getSymbol(symbolKeys.namespacedPotentialTypeKey) ??
            this.getSymbol(symbolKeys.potentialTypeKey);
    }

    getSymbol(symbolName: string): FileSymbolPair {
        if (!symbolName) {
            return;
        }
        const lowerSymbolName = symbolName.toLowerCase();
        //components are only at the root
        if (!this.prefix && this.scopeSymbols.componentsMap?.has(lowerSymbolName)) {
            return this.scopeSymbols.componentsMap.get(lowerSymbolName);
        }
        let lowerSymbolNameParts = lowerSymbolName.split('.');
        //same as the old tree: a namespace node passes itself as the root
        return this.getSymbolByNameParts(lowerSymbolNameParts, this);
    }

    getNamespace(namespaceName: string): ProvidedSymbolsView {
        let lowerSymbolNameParts = namespaceName.toLowerCase().split('.');
        return this.getNamespaceByNameParts(lowerSymbolNameParts);
    }

    getSymbolByNameParts(lowerSymbolNameParts: string[], root: ProvidedSymbolsView): FileSymbolPair {
        const first = lowerSymbolNameParts?.[0];
        const rest = lowerSymbolNameParts.slice(1);
        if (!first) {
            return;
        }
        let result = this.scopeSymbols.getSymbolAt(this.prefix + first, this.time);
        if (result) {
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
                    let inheritableType = currentType;
                    while (inheritableType?.parentType) {
                        let parentType = inheritableType.parentType as BscType;
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
                        inheritableType = parentType as InheritableType;
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

        } else if (rest && this.scopeSymbols.hasNamespaceAt(this.prefix + first, this.time)) {
            return this.child(first).getSymbolByNameParts(rest, root);
        }
    }

    getNamespaceByNameParts(lowerSymbolNameParts: string[]): ProvidedSymbolsView {
        const first = lowerSymbolNameParts?.[0]?.toLowerCase();
        const rest = lowerSymbolNameParts.slice(1);
        if (!first) {
            return;
        }
        if (this.scopeSymbols.hasNamespaceAt(this.prefix + first, this.time)) {
            const node = this.child(first);
            return rest?.length > 0 ? node.getNamespaceByNameParts(rest) : node;
        }
    }

    private child(namespaceName: string) {
        return new ProvidedSymbolsView(this.scopeSymbols, `${this.prefix}${namespaceName}.`, this.time);
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
            const allUnifiedTypes = getAllTypesFromCompoundType(symbol.typeChain[0].type);
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
    providedTreeMap = new Map<string, { duplicatesMap: Map<string, Set<FileSymbolPair>>; providedTree: ProvidedSymbolsView }>();

    private providedSymbolIndex = new ProvidedSymbolIndex();

    /**
     * Only kept for the length of one `addDiagnosticsForScopes` call - the global table doesn't change during it
     */
    private globalSymbolCache: Map<string, BscSymbol[] | null>;
    private possibleDuplicateNamesCache: Map<BscFile, string[]>;

    private getGlobalSymbol(lowerSymbolName: string) {
        let result = this.globalSymbolCache?.get(lowerSymbolName);
        if (result === undefined) {
            // eslint-disable-next-line no-bitwise
            result = this.program.globalScope.symbolTable.getSymbol(lowerSymbolName, SymbolTypeFlag.typetime | SymbolTypeFlag.runtime) ?? null;
            this.globalSymbolCache?.set(lowerSymbolName, result);
        }
        return result ?? undefined;
    }

    /**
     * Names from this file that could be a duplicate in some scope. Every other name can't be, so it isn't looked at per scope
     */
    private getPossibleDuplicateNames(file: BscFile) {
        let names = this.possibleDuplicateNamesCache?.get(file);
        if (!names) {
            names = this.providedSymbolIndex.getSymbolNames(file).filter(name => this.providedSymbolIndex.couldBeDuplicate(name, x => !!this.getGlobalSymbol(x)));
            this.possibleDuplicateNamesCache?.set(file, names);
        }
        return names;
    }


    private componentsMap = new Map<string, FileSymbolPair>();

    getRequiredMap(scope: Scope) {
        const map = new Map<SymbolLookupKeys, UnresolvedSymbol>();
        scope.enumerateBrsFiles((file) => {
            //typedef files (.d.bs) are ambient declarations only - never validated for diagnostics,
            //so don't flag their own unresolved type references as missing symbols
            if (file.isTypedef) {
                return;
            }
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
        if (this.providedTreeMap.has(scope.name)) {
            return this.providedTreeMap.get(scope.name);
        }
        const scopeSymbols = new ScopeProvidedSymbols(this.providedSymbolIndex, this.componentsMap);
        const providedTree = new ProvidedSymbolsView(scopeSymbols);
        const duplicatesByName = new Map<string, { position: number; dupesSet: Set<FileSymbolPair> }>();

        const referenceTypesMap = new Map<{ symbolName: string; file: BscFile; symbolObj: ProvidedSymbol }, Array<{ name: string; namespacedName?: string }>>();

        //does the same as adding the symbol to a per-scope tree at `position`, and collects any duplicates
        const addSymbolWithDuplicates = (symbolName: string, file: BscFile, symbolObj: ProvidedSymbol, position: number) => {
            const globalSymbol = this.getGlobalSymbol(symbolName);
            const symbolIsNamespace = scopeSymbols.hasNamespaceAt(symbolName, position);
            let isDupe = symbolIsNamespace;
            if (!isDupe) {
                const existingSymbol = scopeSymbols.getSymbolAt(symbolName, position);
                isDupe = existingSymbol ? existingSymbol.symbol.data?.definingNode !== symbolObj.symbol.data?.definingNode : false;
            }
            if (symbolIsNamespace || globalSymbol || isDupe || symbolObj.duplicates.length > 0) {
                let dupesSet = duplicatesByName.get(symbolName)?.dupesSet;
                if (!dupesSet) {
                    dupesSet = new Set<{ file: BrsFile; symbol: BscSymbol }>();
                    duplicatesByName.set(symbolName, { position: position, dupesSet: dupesSet });
                    //what the tree would have had for this name right after adding this symbol
                    const existing = new ProvidedSymbolsView(scopeSymbols, '', position + 0.5).getSymbol(symbolName);
                    if (existing) {
                        dupesSet.add(existing);
                    }
                }
                dupesSet.add({ file: file, symbol: symbolObj.symbol });
                if (symbolIsNamespace) {
                    const namespaceContainer = scope.getNamespace(symbolName);
                    const nsNode = namespaceContainer?.namespaceStatements?.[0];
                    if (nsNode) {
                        const nsFile = namespaceContainer.file;
                        const nsType = nsNode.getType({ flags: SymbolTypeFlag.typetime });
                        let nsSymbol: BscSymbol = {
                            name: nsNode.getName(ParseMode.BrighterScript),
                            type: nsType,
                            data: { definingNode: nsNode },
                            flags: SymbolTypeFlag.typetime
                        };
                        dupesSet.add({ file: nsFile, symbol: nsSymbol });
                    }
                }
                for (const providedDupeSymbol of symbolObj.duplicates) {
                    dupesSet.add({ file: file, symbol: providedDupeSymbol });
                }
                if (globalSymbol) {
                    dupesSet.add({ file: globalFile, symbol: globalSymbol[0] });
                }
            }
        };

        const possibleDuplicateNames = new Set<string>();
        let fileIndex = 0;
        scope.enumerateBrsFiles((file) => {
            scopeSymbols.fileIndex.set(file, fileIndex++);
            for (const symbolName of this.getPossibleDuplicateNames(file)) {
                possibleDuplicateNames.add(symbolName);
            }

            // find all "provided symbols" that are reference types
            for (const [_, nameMap] of file.providedSymbols.referenceSymbolMap.entries()) {
                for (const [symbolName, symbolObj] of nameMap.entries()) {
                    const symbolType = symbolObj.symbol.type;
                    const namespaceLower = symbolObj.symbol.data?.definingNode?.findAncestor<NamespaceStatement>(isNamespaceStatement)?.getName(ParseMode.BrighterScript).toLowerCase();
                    const allNames = getAllRequiredSymbolNames(symbolType, namespaceLower);

                    referenceTypesMap.set({ symbolName: symbolName, file: file, symbolObj: symbolObj }, allNames);
                }
            }
        });

        //everything else is only provided once in this scope, and can't clash with anything
        for (const symbolName of possibleDuplicateNames) {
            for (const event of scopeSymbols.getEvents(symbolName)) {
                addSymbolWithDuplicates(symbolName, event.file, event.symbolObj, scopeSymbols.getPosition(event));
            }
        }

        // check provided reference types to see if they exist yet!
        while (referenceTypesMap.size > 0) {
            let addedSymbol = false;
            for (const [refTypeDetails, neededNames] of referenceTypesMap.entries()) {
                let foundNames = 0;
                for (const neededName of neededNames) {
                    // check if name exists or namespaced version exists
                    if (providedTree.getSymbol(neededName.name) ?? providedTree.getSymbol(neededName.namespacedName)) {
                        foundNames++;
                    }
                }
                if (neededNames.length === foundNames) {
                    //found all that were needed
                    const pair = { file: refTypeDetails.file, symbol: refTypeDetails.symbolObj.symbol };
                    const position = scopeSymbols.addReferenceSymbol(refTypeDetails.symbolName, pair);
                    addSymbolWithDuplicates(refTypeDetails.symbolName, refTypeDetails.file, refTypeDetails.symbolObj, position);
                    referenceTypesMap.delete(refTypeDetails);
                    addedSymbol = true;
                }
            }
            if (!addedSymbol) {
                break;
            }
        }

        //keep the order the duplicates were first found in
        let duplicatesMap: Map<string, Set<FileSymbolPair>> = null;
        for (const [symbolName, { dupesSet }] of [...duplicatesByName].sort((a, b) => a[1].position - b[1].position)) {
            duplicatesMap ??= new Map();
            duplicatesMap.set(symbolName, dupesSet);
        }

        const result = { duplicatesMap: duplicatesMap, providedTree: providedTree };
        this.providedTreeMap.set(scope.name, result);
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
                            // for each unresolved part of a chain, see if we can resolve it with stuff from the provided tree
                            // and if so, mark it as resolved
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
        const lowerScopeNames = new Set(scopes.map(scope => scope.name.toLowerCase()));
        for (const [symbol, resolutionInfos] of this.resolutionsMap.entries()) {
            for (const info of resolutionInfos.values()) {
                if (lowerScopeNames.has(info.scope.name.toLowerCase())) {
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

    getScopesRequiringChangedSymbol(scopes: Scope[], changedSymbols: Map<SymbolTypeFlag, Set<string>>) {
        const scopesThatNeedRevalidation = new Set<Scope>();
        const filesAlreadyChecked = new Set<BrsFile>();

        for (const scope of scopes) {
            scope.enumerateBrsFiles((file) => {
                if (filesAlreadyChecked.has(file) || scopesThatNeedRevalidation.has(scope)) {
                    return;
                }
                filesAlreadyChecked.add(file);

                if (util.hasAnyRequiredSymbolChanged(file.requiredSymbols, changedSymbols)) {
                    scopesThatNeedRevalidation.add(scope);
                }
            });
        }
        return scopesThatNeedRevalidation;
    }

    buildComponentsMap() {
        this.componentsMap.clear();
        // Add custom components
        for (let componentName of this.program.getSortedComponentNames()) {
            const typeName = 'rosgnode' + componentName;
            const component = this.program.getComponent(componentName);
            const componentSymbol = this.program.globalScope.symbolTable.getSymbol(typeName, SymbolTypeFlag.typetime)?.[0];
            if (componentSymbol && component) {
                this.componentsMap.set(typeName, { file: component.file, symbol: componentSymbol });
            }
        }
    }

    addDiagnosticsForScopes(scopes: Scope[]) { //, changedFiles: BrsFile[]) {
        const addDuplicateSymbolDiagnostics = true;
        const missingSymbolInScope = new Map<UnresolvedSymbol, Set<Scope>>();
        this.providedTreeMap.clear();
        this.clearResolutionsForScopes(scopes);

        this.globalSymbolCache = new Map();
        this.possibleDuplicateNamesCache = new Map();
        this.providedSymbolIndex.prune(this.program);
        for (const scope of scopes) {
            scope.enumerateBrsFiles((file) => {
                this.providedSymbolIndex.update(file);
            });
        }

        // Check scope for duplicates and missing symbols
        for (const scope of scopes) {
            this.program.diagnostics.clearByFilter({
                scope: scope,
                tag: CrossScopeValidatorDiagnosticTag
            });

            const { missingSymbols, duplicatesMap } = this.getIssuesForScope(scope);
            if (addDuplicateSymbolDiagnostics && duplicatesMap) {
                for (const [_flag, dupeSet] of duplicatesMap.entries()) {
                    if (dupeSet.size > 1) {

                        const dupesArray = [...dupeSet.values()];

                        for (let i = 0; i < dupesArray.length; i++) {
                            const dupe = dupesArray[i];

                            const dupeNode = dupe?.symbol?.data?.definingNode;
                            if (!dupeNode) {
                                continue;
                            }
                            let thisName = dupe.symbol?.name;
                            const wrappingNameSpace = dupeNode?.findAncestor<NamespaceStatement>(isNamespaceStatement);

                            if (wrappingNameSpace) {
                                thisName = `${wrappingNameSpace.getName(ParseMode.BrighterScript)}.` + thisName;
                            }

                            const thisNodeKindName = util.getAstNodeFriendlyName(dupeNode) ?? 'Item';

                            for (let j = 0; j < dupesArray.length; j++) {
                                if (i === j) {
                                    continue;
                                }
                                const otherDupe = dupesArray[j];
                                if (!otherDupe || dupe.symbol === otherDupe.symbol) {
                                    continue;
                                }

                                const otherDupeNode = otherDupe.symbol.data?.definingNode;
                                const otherIsGlobal = otherDupe.file.srcPath === 'global';

                                if (isFunctionStatement(dupeNode) && isFunctionStatement(otherDupeNode)) {
                                    // duplicate functions are handled in ScopeValidator
                                    continue;
                                }
                                if (otherIsGlobal &&
                                    (isInterfaceStatement(dupeNode) ||
                                        isEnumStatement(dupeNode) ||
                                        isConstStatement(dupeNode))) {
                                    // these are allowed to shadow global functions
                                    continue;
                                }
                                let thatName = otherDupe.symbol?.name;

                                if (otherDupeNode) {
                                    const otherWrappingNameSpace = otherDupeNode?.findAncestor<NamespaceStatement>(isNamespaceStatement);
                                    if (otherWrappingNameSpace) {
                                        thatName = `${otherWrappingNameSpace.getName(ParseMode.BrighterScript)}.` + thatName;
                                    }
                                }

                                type AstNodeWithName = VariableExpression | DottedGetExpression | EnumStatement | ClassStatement | ConstStatement | EnumMemberStatement | InterfaceStatement;

                                const thatNodeKindName = otherIsGlobal ? 'Global Function' : util.getAstNodeFriendlyName(otherDupeNode) ?? 'Item';
                                let thisNameRange = (dupeNode as AstNodeWithName)?.tokens?.name?.location?.range ?? dupeNode.location?.range;
                                let thatNameRange = (otherDupeNode as AstNodeWithName)?.tokens?.name?.location?.range ?? otherDupeNode?.location?.range;

                                const relatedInformation = thatNameRange ? [{
                                    message: `${thatNodeKindName} declared here`,
                                    location: util.createLocationFromFileRange(otherDupe.file, thatNameRange)
                                }] : undefined;
                                this.program.diagnostics.register({
                                    ...DiagnosticMessages.nameCollision(thisNodeKindName, thatNodeKindName, thatName),
                                    location: util.createLocationFromFileRange(dupe.file, thisNameRange),
                                    relatedInformation: relatedInformation
                                }, {
                                    scope: scope,
                                    tags: [CrossScopeValidatorDiagnosticTag]
                                });
                            }
                        }
                    }
                }
            }
            // build map of the symbols and scopes where the symbols are missing per file
            for (const missingSymbol of missingSymbols) {

                let scopesWithMissingSymbol = missingSymbolInScope.get(missingSymbol);
                if (!scopesWithMissingSymbol) {
                    scopesWithMissingSymbol = new Set<Scope>();
                    missingSymbolInScope.set(missingSymbol, scopesWithMissingSymbol);
                }
                scopesWithMissingSymbol.add(scope);
            }
        }

        // If symbols are missing in SOME scopes, add diagnostic
        for (const [symbol, scopeList] of missingSymbolInScope.entries()) {
            const typeChainResult = util.processTypeChain(symbol.typeChain);

            //roku built-in type names (rosgnode*, etc.) aren't tracked in any symbol table;
            //skip cannot-find-name when the symbol's name is one of those built-ins.
            if (typeChainResult.itemName && util.isBuiltInType(typeChainResult.itemName)) {
                continue;
            }

            for (const scope of scopeList) {
                this.program.diagnostics.register({
                    ...this.getCannotFindDiagnostic(scope, symbol, typeChainResult),
                    location: typeChainResult.location
                }, {
                    scope: scope,
                    tags: [CrossScopeValidatorDiagnosticTag]
                });
            }
        }

        this.globalSymbolCache = undefined;
        this.possibleDuplicateNamesCache = undefined;

        for (const resolution of this.getIncompatibleSymbolResolutions()) {
            const symbol = resolution.symbol;
            const incompatibleScopes = resolution.incompatibleScopes;
            if (incompatibleScopes.size > 1) {
                const typeChainResult = util.processTypeChain(symbol.typeChain);
                const scopeList = [...incompatibleScopes.values()].map(s => s.name);
                this.program.diagnostics.register({
                    ...DiagnosticMessages.incompatibleSymbolDefinition(typeChainResult.fullChainName, { scopes: scopeList }),
                    location: typeChainResult.location
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

    private getCannotFindDiagnostic(scope: Scope, unresolvedSymbol: UnresolvedSymbol, typeChainResult: TypeChainProcessResult) {
        const parentDescriptor = this.getParentTypeDescriptor(this.getProvidedTree(scope)?.providedTree, typeChainResult);
        const symbolType = typeChainResult.astNode?.getType({ flags: unresolvedSymbol.flags });
        if (isReferenceType(symbolType)) {
            const circularReferenceInfo = symbolType.getCircularReferenceInfo();
            if (circularReferenceInfo.isCircularReference) {
                let diagnosticDetail = util.getCircularReferenceDiagnosticDetail(circularReferenceInfo, typeChainResult.fullNameOfItem);
                return DiagnosticMessages.circularReferenceDetected(diagnosticDetail);
            }
        }

        if (isCallExpression(typeChainResult.astNode?.parent) && typeChainResult.astNode?.parent.callee === typeChainResult.astNode) {
            return DiagnosticMessages.cannotFindFunction(typeChainResult.itemName, typeChainResult.fullNameOfItem, typeChainResult.itemParentTypeName, parentDescriptor);
        }
        return DiagnosticMessages.cannotFindName(typeChainResult.itemName, typeChainResult.fullNameOfItem, typeChainResult.itemParentTypeName, parentDescriptor);
    }

    private getParentTypeDescriptor(provided: ProvidedSymbolsView, typeChainResult: TypeChainProcessResult) {
        if (typeChainResult.itemParentTypeKind === BscTypeKind.NamespaceType || provided?.getNamespace(typeChainResult.itemParentTypeName)) {
            return 'namespace';
        }
        return 'type';
    }

}
