import type { DiagnosticContext, BsDiagnostic, DiagnosticContextPair } from './interfaces';
import type { AstNode } from './parser/AstNode';
import type { Scope } from './Scope';
import { util } from './util';
import { Cache } from './Cache';
import { isBsDiagnostic, isXmlScope } from './astUtils/reflection';
import type { DiagnosticRelatedInformation, Location } from 'vscode-languageserver-protocol';
import { DiagnosticFilterer } from './DiagnosticFilterer';
import { DiagnosticSeverityAdjuster } from './DiagnosticSeverityAdjuster';
import type { FinalizedBsConfig } from './BsConfig';
import chalk from 'chalk';
import type { Logger } from './logging';
import { LogLevel, createLogger } from './logging';
import type { Program } from './Program';
import type { BrsFile } from './files/BrsFile';
import { DiagnosticCodeMap, DiagnosticMessages } from './DiagnosticMessages';
import * as path from 'path';

interface DiagnosticWithContexts {
    diagnostic: BsDiagnosticWithKey;
    contexts: Set<DiagnosticContext>;
}

interface BsDiagnosticWithKey extends BsDiagnostic {
    key: string;
}

export interface LocationResolverArgs {
    diagnostic: BsDiagnosticWithKey;
    contexts: Set<DiagnosticContext>;
}

type LocationResolver = (options: LocationResolverArgs) => Location | undefined;

/**
 * Manages all diagnostics for a program.
 * Diagnostics can be added specific to a certain file/range and optionally scope or an AST node
 * and can be tagged with arbitrary keys.
 * Diagnostics can be cleared based on file, scope, and/or AST node.
 * If multiple diagnostics are added related to the same range of code, they will be consolidated as related information
 */
export class DiagnosticManager {

    constructor(options?: { logger?: Logger; locationResolver: LocationResolver }) {
        this.logger = options?.logger ?? createLogger();
        this.locationResolver = options?.locationResolver ?? ((x) => x?.diagnostic?.location);
    }

    private diagnosticsCache = new Cache<string, DiagnosticWithContexts>();

    private diagnosticFilterer = new DiagnosticFilterer();

    private diagnosticAdjuster = new DiagnosticSeverityAdjuster();

    public logger: Logger;

    public locationResolver: LocationResolver;

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
    public getDiagnostics(): BsDiagnostic[] {
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
            if (!diagnostic.location?.uri) {
                diagnostic.location = this.locationResolver?.(cachedDiagnostic);
                if (diagnostic.location) {
                    //if we found a location, tweak the message a bit to let devs know this was not the original location
                    diagnostic.message = `${diagnostic.message} (location unknown, added here for visibility)`;
                }
            }
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

        if (diagnosticCode === DiagnosticCodeMap.unknownDiagnosticCode) {
            return false;
        }

        for (let flag of file?.commentFlags ?? []) {

            if (!diagnostic.location?.range || !util.rangeContains(flag.affectedRange, diagnostic.location.range.start)) {
                continue;
            }
            //if this flag explicitly re-enables the code, it's not suppressed here, keep looking
            const isEnabled = flag.enableCodes === null || this.doesCodeListIncludeCode(flag.enableCodes, diagnosticCode, diagnosticLegacyCode);
            if (isEnabled) {
                continue;
            }

            //if this flag disables the code, it's suppressed
            const isDisabled = flag.codes === null || this.doesCodeListIncludeCode(flag.codes, diagnosticCode, diagnosticLegacyCode);
            if (isDisabled) {
                return true;
            }
        }
        return false;
    }

    private doesCodeListIncludeCode(codes: (string | number)[] | null, code: string | number | undefined, legacyCode: string | number | undefined) {
        const codeLower = typeof code === 'string' ? code.toLowerCase() : code.toString();
        const legacyCodeLower = typeof legacyCode === 'string' ? legacyCode.toLowerCase() : legacyCode?.toString();
        return codes?.some((c) => {
            const cLower = typeof c === 'string' ? c.toLowerCase() : c.toString();
            return cLower === codeLower || cLower === legacyCodeLower;
        });
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

        //Intersect the indexed key-sets directly instead of copying the whole diagnosticsCache
        //into an array and filtering it down - this is called per file/segment/scope during
        //validation, so that copy made validation quadratic in the number of diagnostics.
        const keySets: Array<Set<string>> = [];
        if (needToMatch.tag) {
            const keySet = this.tagMap.get(filter.tag?.toLowerCase());
            if (!keySet || keySet.size === 0) {
                return;
            }
            keySets.push(keySet);
        }
        if (needToMatch.scope) {
            const keySet = this.scopeMap.get(filter.scope?.name?.toLowerCase());
            if (!keySet || keySet.size === 0) {
                return;
            }
            keySets.push(keySet);
        }
        if (needToMatch.fileUri) {
            const keySet = this.fileUriMap.get(util.pathToUri(filter.fileUri).toLowerCase());
            if (!keySet || keySet.size === 0) {
                return;
            }
            keySets.push(keySet);
        }
        if (needToMatch.segment) {
            const keySet = this.segmentMap.get(filter.segment);
            if (!keySet || keySet.size === 0) {
                return;
            }
            keySets.push(keySet);
        }

        let candidateKeys: Iterable<string>;
        if (keySets.length === 0) {
            //no filter aspect specified - consider every diagnostic
            candidateKeys = this.diagnosticsCache.keys();
        } else {
            //walk the smallest set and check membership in the rest
            keySets.sort((a, b) => a.size - b.size);
            const [smallest, ...rest] = keySets;
            const intersection: string[] = [];
            for (const key of smallest) {
                if (rest.every(keySet => keySet.has(key))) {
                    intersection.push(key);
                }
            }
            candidateKeys = intersection;
        }

        for (const key of candidateKeys) {
            const cachedData = this.diagnosticsCache.get(key);
            if (!cachedData) {
                continue;
            }
            const { diagnostic, contexts } = cachedData;
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

    /**
     * Are the diagnostics for this file completely filtered?
     * If so, we can skip any Scope-based validation on this file at all, which can save a lot of time for large files
     * with many diagnostics that are being ignored
     */
    public canSkipScopeValidationForFile(file: BrsFile): boolean {
        if (this.diagnosticFilterer.options !== this.options) {
            this.diagnosticFilterer.options = this.options;
        }
        return this.diagnosticFilterer.isFileCompletelyFiltered(file);
    }

    /**
     * Flag `diagnosticFilters` entries that look like file paths/globs rather than diagnostic codes.
     * This is a common mistake when migrating a bsconfig.json from the v0-style filters (which were file globs)
     */
    public detectPathLikeDiagnosticFilterCodes(config: FinalizedBsConfig, context?: DiagnosticContext) {
        const knownDestPaths = this.program ? new Set(
            Object.values(this.program.files).map(file => file.destPath.toLowerCase().replace(/\\/g, '/'))
        ) : undefined;
        const pathLikeCodes = this.diagnosticFilterer.getPathLikeDiagnosticFilterCodes(config, knownDestPaths);
        if (pathLikeCodes.length === 0) {
            return;
        }
        const location = util.createLocationFromRange(
            util.pathToUri(config.project ?? path.join(config.cwd, 'bsconfig.json')),
            util.createRange(0, 0, 0, 0)
        );
        this.register(pathLikeCodes.map(code => ({
            ...DiagnosticMessages.diagnosticFilterLooksLikeFilePath(code.toString()),
            location: location
        })), context);
    }
}

interface DiagnosticContextFilter {
    tag?: string;
    scope?: Scope;
    fileUri?: string;
    segment?: AstNode;
}
