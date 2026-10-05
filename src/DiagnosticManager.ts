import type { DiagnosticContext, BsDiagnostic, DiagnosticContextPair, BsDiagnosticInput, DiagnosticLocationInput } from './interfaces';
import type { Locatable } from './lexer/Token';
import type { AstNode } from './parser/AstNode';
import type { Scope } from './Scope';
import { util } from './util';
import { Cache } from './Cache';
import { isBsDiagnostic, isXmlScope } from './astUtils/reflection';
import type { Location, Position } from 'vscode-languageserver-protocol';
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
    diagnostic: StoredDiagnostic;
    contexts: Set<DiagnosticContext>;
}

/**
 * The position details of a `Locatable`, detached from the locatable itself so the node/token (and its AST) is not retained.
 * `text` is only set (to a newline constant) when the locatable ended in a newline, so `util.getLocation()` resolves it the same way
 */
interface DetachedLocatable extends Locatable {
    text?: string;
}

/**
 * Either an already-resolved `Location`, or a detached locatable that is only resolved in `getDiagnostics()`
 */
export type StoredLocation = Location | DetachedLocatable;

export interface StoredRelatedInformation {
    message: string;
    location: StoredLocation;
}

export interface StoredDiagnostic extends Omit<BsDiagnostic, 'location' | 'relatedInformation'> {
    key: string;
    location: StoredLocation;
    relatedInformation: StoredRelatedInformation[];
}

export interface LocationResolverArgs {
    diagnostic: StoredDiagnostic;
    contexts: Set<DiagnosticContext>;
}

type LocationResolver = (options: LocationResolverArgs) => DiagnosticLocationInput | undefined;

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
     * Diagnostics can optionally be associated with a context.
     * Locations (including in `relatedInformation`) may be `Locatable`s. Only their position details are kept,
     * and they are not resolved into a `Location` until `getDiagnostics()`
     */
    public register(diagnostic: BsDiagnosticInput, context?: DiagnosticContext);
    public register(diagnostics: Array<BsDiagnosticInput>, context?: DiagnosticContext);
    public register(diagnostics: Array<DiagnosticContextPair>);
    public register(diagnosticArg: BsDiagnosticInput | Array<BsDiagnosticInput | DiagnosticContextPair>, context?: DiagnosticContext) {
        const diagnostics = Array.isArray(diagnosticArg) ? diagnosticArg : [{ diagnostic: diagnosticArg, context: context }];
        for (const diagnosticData of diagnostics) {
            const diagnostic = isBsDiagnostic(diagnosticData) ? diagnosticData as BsDiagnosticInput : (diagnosticData as DiagnosticContextPair).diagnostic;
            const diagContext = (diagnosticData as DiagnosticContextPair)?.context ?? context;
            const location = this.storeLocation(diagnostic.location);
            const relatedInformation = (diagnostic.relatedInformation ?? []).map(x => ({
                message: x.message,
                location: this.storeLocation(x.location)
            }));
            const key = this.getDiagnosticKey(diagnostic, location);
            let fromCache = true;
            const cacheData = this.diagnosticsCache.getOrAdd(key, () => {
                fromCache = false;
                return {
                    diagnostic: { ...diagnostic, key: key, location: location, relatedInformation: relatedInformation },
                    contexts: new Set<DiagnosticContext>()
                };
            });

            const cachedDiagnostic = cacheData.diagnostic;
            if (fromCache) {
                this.mergeRelatedInformation(cachedDiagnostic.relatedInformation, relatedInformation);
            }
            const contexts = cacheData.contexts;
            if (diagContext) {
                contexts.add(diagContext);
            }
            this.addToMaps(cachedDiagnostic, diagContext);
        }
    }

    private addToMaps(diagnostic: StoredDiagnostic, context?: DiagnosticContext) {
        const uriLower = util.pathToUri(this.getUri(diagnostic.location)?.toLowerCase());
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
            const storedDiagnostic = cachedDiagnostic.diagnostic;
            let location = storedDiagnostic.location;
            let message = storedDiagnostic.message;
            if (!this.getUri(location)) {
                location = this.storeLocation(this.locationResolver?.(cachedDiagnostic));
                if (location) {
                    //if we found a location, tweak the message a bit to let devs know this was not the original location
                    message = `${message} (location unknown, added here for visibility)`;
                }
            }
            //check suppression before resolving any locations, so suppressed diagnostics never pay for it
            if (this.isSuppressed(storedDiagnostic.code, storedDiagnostic.legacyCode, location)) {
                continue;
            }

            const originalLocation = this.resolveLocation(storedDiagnostic.location);
            const relatedInformation = storedDiagnostic.relatedInformation.map(x => ({
                message: x.message,
                location: this.resolveLocation(x.location)
            }));
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
                        location: originalLocation
                    });
                }

            }
            results.push({
                ...storedDiagnostic,
                message: message,
                location: location === storedDiagnostic.location ? originalLocation : this.resolveLocation(location),
                relatedInformation: relatedInformation
            });
        }
        return results;
    }

    /**
     * Determine whether this diagnostic should be supressed or not, based on brs comment-flags
     */
    public isDiagnosticSuppressed(diagnostic: BsDiagnostic) {
        return this.isSuppressed(diagnostic.code, diagnostic.legacyCode, diagnostic.location);
    }

    private isSuppressed(code: number | string | undefined, legacyCode: number | string | undefined, location: StoredLocation) {
        const diagnosticCode = typeof code === 'string' ? code.toLowerCase() : code?.toString() ?? undefined;
        const diagnosticLegacyCode = typeof legacyCode === 'string' ? legacyCode.toLowerCase() : legacyCode;
        const file = this.program?.getFile(this.getUri(location));

        if (diagnosticCode === DiagnosticCodeMap.unknownDiagnosticCode) {
            return false;
        }

        //only computed if the file actually has comment flags
        let start: Position | undefined;
        let isStartComputed = false;
        for (let flag of file?.commentFlags ?? []) {
            if (!isStartComputed) {
                start = this.isDetachedLocatable(location) ? util.getStartPosition(location) : location?.range?.start;
                isStartComputed = true;
            }
            if (!start || !util.rangeContains(flag.affectedRange, start)) {
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
                    isMatch = this.getUri(diagnostic.location) === filter.fileUri;
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

    private deleteContextsFromDiagnostic(diagnostic: StoredDiagnostic, contexts: DiagnosticContext[]) {
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

    private removeDiagnosticIfNoContexts(diagnostic: StoredDiagnostic) {
        const key = diagnostic.key;
        const cachedData = this.diagnosticsCache.get(key);
        if (cachedData.contexts.size === 0) {
            this.diagnosticsCache.delete(key);
            this.fileUriMap.get(this.getUri(diagnostic.location)?.toLowerCase())?.delete(key);
        }
    }


    private getDiagnosticKey(diagnostic: BsDiagnosticInput, location: StoredLocation) {
        return `${this.getLocationKey(location)} - ${diagnostic.code} - ${diagnostic.message}`;
    }

    private mergeRelatedInformation(target: StoredRelatedInformation[], source: StoredRelatedInformation[]) {
        const getRiKey = (relatedInfo: StoredRelatedInformation) => {
            return `${relatedInfo.message} - ${this.getLocationKey(relatedInfo.location)}`.toLowerCase();
        };

        const existingKeys = target.map(ri => getRiKey(ri));

        for (const ri of source) {
            const key = getRiKey(ri);
            if (!existingKeys.includes(key)) {
                target.push(ri);
            }
        }
    }

    private isDetachedLocatable(location: StoredLocation | DiagnosticLocationInput): location is DetachedLocatable {
        return typeof (location as Locatable)?.pos === 'number';
    }

    /**
     * Convert an incoming location into the form we keep in the cache. Locatables are copied down to just their position details
     * so the node/token they came from (and its whole AST) is not retained by the diagnostic
     */
    private storeLocation(location: DiagnosticLocationInput | undefined): StoredLocation | undefined {
        if (!this.isDetachedLocatable(location)) {
            return location;
        }
        const detached: DetachedLocatable = { pos: location.pos, end: location.end, source: location.source };
        //`util.getLocation()` keeps a newline-terminated token on its own line by looking at its text, so keep just enough text for that
        const newlineLength = location.end - util.getContentEnd(location);
        if (newlineLength > 0) {
            detached.text = newlineLength === 2 ? '\r\n' : '\n';
        }
        return detached;
    }

    private getUri(location: StoredLocation | undefined): string | undefined {
        return this.isDetachedLocatable(location) ? location.source?.uri : location?.uri;
    }

    private getLocationKey(location: StoredLocation | undefined) {
        if (this.isDetachedLocatable(location)) {
            return `${location.source?.uri ?? 'No uri'} @${location.pos}-${location.end}`;
        }
        return `${location?.uri ?? 'No uri'} ${util.rangeToString(location?.range)}`;
    }

    private resolveLocation(location: StoredLocation | undefined): Location | undefined {
        return this.isDetachedLocatable(location) ? util.getLocation(location) : location;
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
