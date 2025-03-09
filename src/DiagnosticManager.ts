import type { DiagnosticContext, BsDiagnostic, DiagnosticContextPair } from './interfaces';
import type { AstNode } from './parser/AstNode';
import type { Scope } from './Scope';
import { util } from './util';
import { Cache } from './Cache';
import { isBsDiagnostic, isXmlScope } from './astUtils/reflection';
import type { DiagnosticRelatedInformation } from 'vscode-languageserver-protocol';
import { DiagnosticFilterer } from './DiagnosticFilterer';
import { DiagnosticSeverityAdjuster } from './DiagnosticSeverityAdjuster';
import type { FinalizedBsConfig } from './BsConfig';
import chalk from 'chalk';
import type { Logger } from './logging';
import { LogLevel, createLogger } from './logging';
import type { Program } from './Program';
import type { BrsFile } from './files/BrsFile';

interface DiagnosticWithContexts {
    diagnostic: BsDiagnosticWithKey;
    contexts: Set<DiagnosticContext>;
}

interface BsDiagnosticWithKey extends BsDiagnostic {
    key: string;
}

/**
 * Manages all diagnostics for a program.
 * Diagnostics can be added specific to a certain file/range and optionally scope or an AST node
 * and can be tagged with arbitrary keys.
 * Diagnostics can be cleared based on file, scope, and/or AST node.
 * If multiple diagnostics are added related to the same range of code, they will be consolidated as related information
 */
export class DiagnosticManager {

    constructor(options?: { logger?: Logger }) {
        this.logger = options?.logger ?? createLogger();
    }

    private diagnosticsCache = new Cache<string, DiagnosticWithContexts>();

    private diagnosticFilterer = new DiagnosticFilterer();

    private diagnosticAdjuster = new DiagnosticSeverityAdjuster();

    public logger: Logger;

    public options: FinalizedBsConfig;

    public program: Program;

    private fileUriMap = new Map<string, Set<string>>();
    private tagMap = new Map<string, Set<string>>();
    private scopeMap = new Map<string, Set<string>>();
    private segmentMap = new Map<AstNode, Set<string>>();

    /**
     * Registers a diagnostic (or multiple diagnostics) for a program.
     * Diagnostics can optionally be associated with a context
     */
    public register(diagnostic: BsDiagnostic, context?: DiagnosticContext);
    public register(diagnostics: Array<BsDiagnostic>, context?: DiagnosticContext);
    public register(diagnostics: Array<DiagnosticContextPair>);
    public register(diagnosticArg: BsDiagnostic | Array<BsDiagnostic | DiagnosticContextPair>, context?: DiagnosticContext) {
        const diagnostics = Array.isArray(diagnosticArg) ? diagnosticArg : [{ diagnostic: diagnosticArg, context: context }];
        for (const diagnosticData of diagnostics) {
            const diagnostic = isBsDiagnostic(diagnosticData) ? diagnosticData : diagnosticData.diagnostic;
            const diagContext = (diagnosticData as DiagnosticContextPair)?.context ?? context;
            const key = this.getDiagnosticKey(diagnostic);
            let fromCache = true;
            const cacheData = this.diagnosticsCache.getOrAdd(key, () => {

                if (!diagnostic.relatedInformation) {
                    diagnostic.relatedInformation = [];
                }
                fromCache = false;
                return { diagnostic: { key: key, ...diagnostic }, contexts: new Set<DiagnosticContext>() };
            });

            const cachedDiagnostic = cacheData.diagnostic;
            if (!fromCache && diagnostic.relatedInformation) {
                this.mergeRelatedInformation(cachedDiagnostic.relatedInformation, diagnostic.relatedInformation);
            }
            const contexts = cacheData.contexts;
            if (diagContext) {
                contexts.add(diagContext);
            }
            this.addToMaps(cachedDiagnostic, diagContext);
        }
    }

    private addToMaps(diagnostic: BsDiagnosticWithKey, context?: DiagnosticContext) {
        const uriLower = util.pathToUri(diagnostic.location?.uri?.toLowerCase());
        if (uriLower) {
            if (!this.fileUriMap.has(uriLower)) {
                this.fileUriMap.set(uriLower, new Set());
            }
            this.fileUriMap.get(uriLower)?.add(diagnostic.key);
        }
        if (context) {
            if (context.tags) {
                for (const tag of context.tags) {
                    const lowerTag = tag.toLowerCase();
                    if (!this.tagMap.has(lowerTag)) {
                        this.tagMap.set(lowerTag, new Set());
                    }
                    this.tagMap.get(lowerTag)?.add(diagnostic.key);
                }
            }
            if (context.scope) {
                const scopeKey = context.scope.name.toLowerCase();
                if (!this.scopeMap.has(scopeKey)) {
                    this.scopeMap.set(scopeKey, new Set());
                }
                this.scopeMap.get(scopeKey)?.add(diagnostic.key);
            }
            if (context.segment) {
                if (!this.segmentMap.has(context.segment)) {
                    this.segmentMap.set(context.segment, new Set());
                }
                this.segmentMap.get(context.segment)?.add(diagnostic.key);
            }
        }
    }

    /**
     * Returns a list of all diagnostics, filtered by the in-file comment filters, filtered by BsConfig diagnostics and adjusted based on BsConfig
     * If the same diagnostic is included in multiple contexts, they are included in a single diagnostic's relatedInformation
     */
    public getDiagnostics() {
        const doDiagnosticsGathering = () => {
            const diagnostics = this.getNonSuppressedDiagnostics();
            const filteredDiagnostics = this.logger?.time(LogLevel.debug, ['filter diagnostics'], () => {
                return this.filterDiagnostics(diagnostics);
            }) ?? this.filterDiagnostics(diagnostics);

            this.logger?.time(LogLevel.debug, ['adjust diagnostics severity'], () => {
                this.diagnosticAdjuster?.adjust(this.options ?? {}, filteredDiagnostics);
            });

            this.logger?.info(`diagnostic counts: total=${chalk.yellow(diagnostics.length.toString())}, after filter=${chalk.yellow(filteredDiagnostics.length.toString())}`);
            return filteredDiagnostics;
        };

        return this.logger?.time(LogLevel.info, ['DiagnosticsManager.getDiagnostics()'], doDiagnosticsGathering) ?? doDiagnosticsGathering();
    }

    private getNonSuppressedDiagnostics() {
        const results = [] as Array<BsDiagnostic>;
        for (const cachedDiagnostic of this.diagnosticsCache.values()) {
            const diagnostic = { ...cachedDiagnostic.diagnostic };
            const relatedInformation = [...cachedDiagnostic.diagnostic.relatedInformation];
            const affectedScopes = new Set<Scope>();
            for (const context of cachedDiagnostic.contexts.values()) {
                if (context.scope) {
                    affectedScopes.add(context.scope);
                }
            }
            for (const scope of affectedScopes) {
                if (isXmlScope(scope) && scope.xmlFile?.srcPath) {
                    relatedInformation.push({
                        message: `In component scope '${scope?.xmlFile?.componentName?.text}'`,
                        location: util.createLocationFromRange(
                            util.pathToUri(scope.xmlFile?.srcPath),
                            scope?.xmlFile?.ast?.componentElement?.getAttribute('name')?.tokens?.value?.location?.range ?? util.createRange(0, 0, 0, 10)
                        )
                    });
                } else {
                    relatedInformation.push({
                        message: `In scope '${scope.name}'`,
                        location: diagnostic.location
                    });
                }

            }
            diagnostic.relatedInformation = relatedInformation;
            results.push(diagnostic);
        }
        const filteredResults = results.filter((x) => {
            return !this.isDiagnosticSuppressed(x);
        });
        return filteredResults;
    }

    /**
     * Determine whether this diagnostic should be supressed or not, based on brs comment-flags
     */
    public isDiagnosticSuppressed(diagnostic: BsDiagnostic) {
        const diagnosticCode = typeof diagnostic.code === 'string' ? diagnostic.code.toLowerCase() : diagnostic.code?.toString() ?? undefined;
        const diagnosticLegacyCode = typeof diagnostic.legacyCode === 'string' ? diagnostic.legacyCode.toLowerCase() : diagnostic.legacyCode;
        const file = this.program?.getFile(diagnostic.location?.uri);

        for (let flag of file?.commentFlags ?? []) {
            //this diagnostic is affected by this flag
            if (diagnostic.location.range && util.rangeContains(flag.affectedRange, diagnostic.location.range.start)) {
                //if the flag acts upon this diagnostic's code
                const diagCodeSuppressed = (diagnosticCode !== undefined && flag.codes?.includes(diagnosticCode)) ||
                    (diagnosticLegacyCode !== undefined && flag.codes?.includes(diagnosticLegacyCode));
                if (flag.codes === null || diagCodeSuppressed) {
                    return true;
                }
            }
        }
        return false;
    }

    private filterDiagnostics(diagnostics: BsDiagnostic[]) {
        //filter out diagnostics based on our diagnostic filters
        let filteredDiagnostics = this.diagnosticFilterer.filter({
            ...this.options ?? {},
            rootDir: this.options?.rootDir
        }, diagnostics, this.program);
        return filteredDiagnostics;
    }

    public clear() {
        this.diagnosticsCache.clear();
    }

    public clearForFile(fileSrcPath: string) {
        const fileSrcPathUri = util.pathToUri(fileSrcPath)?.toLowerCase?.();
        for (const key of this.fileUriMap.get(fileSrcPathUri) ?? []) {
            const cachedData = this.diagnosticsCache.get(key);
            this.deleteContextsFromDiagnostic(cachedData.diagnostic, Array.from(cachedData.contexts));
            this.removeDiagnosticIfNoContexts(cachedData.diagnostic);
        }
        this.fileUriMap.get(fileSrcPathUri)?.clear();
    }

    public clearForScope(scope: Scope) {
        const scopeNameLower = scope.name.toLowerCase();
        for (const key of this.scopeMap.get(scopeNameLower) ?? []) {
            const cachedData = this.diagnosticsCache.get(key);
            const contextsToRemove: DiagnosticContext[] = [];
            let foundMatch = false;
            for (const context of cachedData.contexts.values()) {
                if (context.scope === scope) {
                    contextsToRemove.push(context);
                    foundMatch = true;
                }
            }
            this.deleteContextsFromDiagnostic(cachedData.diagnostic, contextsToRemove);
            if (foundMatch) {
                this.removeDiagnosticIfNoContexts(cachedData.diagnostic);
            }
        }
        this.scopeMap.get(scopeNameLower)?.clear();
    }

    public clearForSegment(segment: AstNode) {
        for (const key of this.segmentMap.get(segment) ?? []) {
            const cachedData = this.diagnosticsCache.get(key);
            const contextsToRemove: DiagnosticContext[] = [];
            let foundMatch = false;
            for (const context of cachedData.contexts.values()) {
                if (context.segment === segment) {
                    foundMatch = true;
                    contextsToRemove.push(context);
                }
            }
            this.deleteContextsFromDiagnostic(cachedData.diagnostic, contextsToRemove);
            if (foundMatch) {
                this.removeDiagnosticIfNoContexts(cachedData.diagnostic);
            }
        }
        this.segmentMap.get(segment)?.clear();
    }

    public clearForTag(tag: string) {
        const tagLower = tag.toLowerCase();
        for (const key of this.tagMap.get(tagLower) ?? []) {
            const cachedData = this.diagnosticsCache.get(key);
            const contextsToRemove: DiagnosticContext[] = [];
            let foundMatch = false;
            for (const context of cachedData.contexts.values()) {
                if (context.tags.includes(tag)) {
                    foundMatch = true;
                    contextsToRemove.push(context);
                }
            }
            this.deleteContextsFromDiagnostic(cachedData.diagnostic, contextsToRemove);
            if (foundMatch) {
                this.removeDiagnosticIfNoContexts(cachedData.diagnostic);
            }
        }
        this.tagMap.get(tagLower)?.clear();
    }

    /*
     *  Filters searchData to include only those diagnostics that match the filter provided
     *
     * @param shouldMatch true if this is an important filter, false if it is an optional filter
     * @param {MapIterator<DiagnosticWithContexts>} searchData Data to filter
     * @param filteredDiagnosticKeysSet Set of keys to filter by
     * @returns  {MapIterator<DiagnosticWithContexts>} result of intersection
     */
    private getSearchIntersection(shouldMatch: boolean, searchData: DiagnosticWithContexts[], filteredDiagnosticKeysSet: Set<string>, ignoreEmptyFilter = false): DiagnosticWithContexts[] {
        if (!shouldMatch) {
            return searchData;
        }

        if (!filteredDiagnosticKeysSet || filteredDiagnosticKeysSet.size === 0) {
            return [];
        }

        return searchData.filter((diagnosticWithContext) => {
            return filteredDiagnosticKeysSet.has(diagnosticWithContext.diagnostic.key);
        });
    }

    /**
     * Clears all diagnostics that match all aspects of the filter provided
     * Matches equality of tag, scope, file, segment filters. Leave filter option undefined to not filter on option
     */
    public clearByFilter(filter: DiagnosticContextFilter) {

        const needToMatch = {
            tag: !!filter.tag,
            scope: !!filter.scope,
            fileUri: !!filter.fileUri,
            segment: !!filter.segment
        };

        let searchData = Array.from(this.diagnosticsCache.values());
        searchData = this.getSearchIntersection(needToMatch.tag, searchData, needToMatch.tag ? this.tagMap.get(filter.tag?.toLowerCase()) : null);
        if (searchData.length === 0) {
            return;
        }
        searchData = this.getSearchIntersection(needToMatch.scope, searchData, needToMatch.scope ? this.scopeMap.get(filter.scope?.name?.toLowerCase()) : null, true);
        if (searchData.length === 0) {
            return;
        }
        searchData = this.getSearchIntersection(needToMatch.fileUri, searchData, needToMatch.fileUri ? this.fileUriMap.get(util.pathToUri(filter.fileUri).toLowerCase()) : null);
        if (searchData.length === 0) {
            return;
        }
        searchData = this.getSearchIntersection(needToMatch.segment, searchData, needToMatch.segment ? this.segmentMap.get(filter.segment) : null);

        for (const { diagnostic, contexts } of searchData ?? []) {
            const contextsToRemove: DiagnosticContext[] = [];
            let foundMatch = false;
            for (const context of contexts) {
                let isMatch = true;
                if (isMatch && needToMatch.tag) {
                    isMatch = !!context.tags?.includes(filter.tag);
                }
                if (isMatch && needToMatch.scope) {
                    isMatch = context.scope?.name === filter.scope.name;
                }
                if (isMatch && needToMatch.fileUri) {
                    isMatch = diagnostic.location?.uri === filter.fileUri;
                }
                if (isMatch && needToMatch.segment) {
                    isMatch = context.segment === filter.segment;
                }

                if (isMatch) {
                    contextsToRemove.push(context);
                    foundMatch = true;
                }
            }
            this.deleteContextsFromDiagnostic(diagnostic, contextsToRemove);
            if (foundMatch) {
                this.removeDiagnosticIfNoContexts(diagnostic);
            }
        }
    }

    private deleteContextsFromDiagnostic(diagnostic: BsDiagnosticWithKey, contexts: DiagnosticContext[]) {
        const key = diagnostic.key;
        const cachedData = this.diagnosticsCache.get(key);
        for (const context of contexts) {
            cachedData.contexts.delete(context);
        }
        for (const context of contexts) {
            for (const tag of context.tags ?? []) {
                let foundTagOtherContext = false;
                for (const otherContext of cachedData.contexts) {
                    if (otherContext.tags?.includes(tag)) {
                        foundTagOtherContext = true;
                        break;
                    }
                }
                if (!foundTagOtherContext) {
                    this.tagMap.get(tag.toLowerCase())?.delete(key);
                }
            }
            if (context.scope) {
                let foundScopeOtherContext = false;
                for (const otherContext of cachedData.contexts) {
                    if (otherContext.scope === context.scope) {
                        foundScopeOtherContext = true;
                        break;
                    }
                }
                if (!foundScopeOtherContext) {
                    this.scopeMap.get(context.scope.name.toLowerCase())?.delete(key);
                }
            }
            if (context.segment) {
                let foundSegmentOtherContext = false;
                for (const otherContext of cachedData.contexts) {
                    if (otherContext.segment === context.segment) {
                        foundSegmentOtherContext = true;
                        break;
                    }
                }
                if (!foundSegmentOtherContext) {
                    this.segmentMap.get(context.segment)?.delete(key);
                }
            }
        }
    }

    private removeDiagnosticIfNoContexts(diagnostic: BsDiagnosticWithKey) {
        const key = diagnostic.key;
        const cachedData = this.diagnosticsCache.get(key);
        if (cachedData.contexts.size === 0) {
            this.diagnosticsCache.delete(key);
            this.fileUriMap.get(diagnostic.location?.uri?.toLowerCase())?.delete(key);
        }
    }


    private getDiagnosticKey(diagnostic: BsDiagnostic) {
        return `${diagnostic.location?.uri ?? 'No uri'} ${util.rangeToString(diagnostic.location?.range)} - ${diagnostic.code} - ${diagnostic.message}`;
    }

    private mergeRelatedInformation(target: DiagnosticRelatedInformation[], source: DiagnosticRelatedInformation[]) {
        function getRiKey(relatedInfo: DiagnosticRelatedInformation) {
            return `${relatedInfo.message} - ${relatedInfo.location?.uri} - ${util.rangeToString(relatedInfo.location?.range)}`.toLowerCase();
        }

        const existingKeys = target.map(ri => getRiKey(ri));

        for (const ri of source) {
            const key = getRiKey(ri);
            if (!existingKeys.includes(key)) {
                target.push(ri);
            }
        }
    }

    public shouldFilterFile(file: BrsFile): boolean {
        if (this.diagnosticFilterer.options !== this.options) {
            this.diagnosticFilterer.options = this.options;
        }
        this.diagnosticFilterer.isFileFiltered(file);
        return false;
    }

}

interface DiagnosticContextFilter {
    tag?: string;
    scope?: Scope;
    fileUri?: string;
    segment?: AstNode;
}
