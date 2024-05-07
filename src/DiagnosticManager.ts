import type { DiagnosticContext, BsDiagnostic, DiagnosticContextPair } from './interfaces';
import { URI } from 'vscode-uri';
import type { AstNode } from './parser/AstNode';
import type { Scope } from './Scope';
import { util } from './util';
import { Cache } from './Cache';
import { isBsDiagnostic, isXmlScope } from './astUtils/reflection';
import type { BscFile } from './files/BscFile';
import type { DiagnosticRelatedInformation } from 'vscode-languageserver-protocol';
import { LogLevel, type Logger } from './Logger';
import { DiagnosticFilterer } from './DiagnosticFilterer';
import { DiagnosticSeverityAdjuster } from './DiagnosticSeverityAdjuster';
import type { FinalizedBsConfig } from './BsConfig';
import chalk from 'chalk';

/**
 * Manages all diagnostics for a program.
 * Diagnostics can be added specific to a certain file/range and optionally scope or an AST node
 * and can be tagged with arbitrary keys.
 * Diagnostics can be cleared based on file, scope, and/or AST node.
 * If multiple diagnostics are added related to the same range of code, they will be consolidated as related information
 */
export class DiagnosticManager {

    private diagnosticsCache = new Cache<string, { diagnostic: BsDiagnostic; contexts: Set<DiagnosticContext> }>();

    private diagnosticFilterer = new DiagnosticFilterer();

    private diagnosticAdjuster = new DiagnosticSeverityAdjuster();

    public logger: Logger;

    public options: FinalizedBsConfig;

    /**
     * Registers a diagnostic (or multiple diagnostics) for a program.
     * Diagnostics can optionally be associated with a context
     */
    public register(diagnostic: BsDiagnostic, context?: DiagnosticContext);
    public register(diagnostics: Array<BsDiagnostic>);
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
                return { diagnostic: diagnostic, contexts: new Set<DiagnosticContext>() };
            });

            const cachedDiagnostic = cacheData.diagnostic;
            if (!fromCache && diagnostic.relatedInformation) {
                this.mergeRelatedInformation(cachedDiagnostic.relatedInformation, diagnostic.relatedInformation);
            }
            const contexts = cacheData.contexts;
            if (diagContext) {
                contexts.add(diagContext);
            }
        }
    }

    /**
     * Returns a list of all diagnostics, filtered by the in-file comment filters, filtered by BsConfig diagnostics and adjusted based on BsConfig
     * If the same diagnostic is included in multiple contexts, they are included in a single diagnostic's relatedInformation
     */
    public getDiagnostics() {
        const doDiagnosticsGathering = () => {
            const diagnostics = this.getNonSuppresedDiagnostics();
            const filteredDiagnostics = this.logger?.time(LogLevel.debug, ['filter diagnostics'], () => {
                return this.filterDiagnostics(diagnostics);
            }) ?? this.filterDiagnostics(diagnostics);

            if (this.logger) {
                this.logger?.time(LogLevel.debug, ['adjust diagnostics severity'], () => {
                    this.diagnosticAdjuster?.adjust(this.options ?? {}, filteredDiagnostics);
                });
            } else {
                this.diagnosticAdjuster.adjust(this.options ?? {}, filteredDiagnostics);
            }

            this.logger?.info(`diagnostic counts: total=${chalk.yellow(diagnostics.length.toString())}, after filter=${chalk.yellow(filteredDiagnostics.length.toString())}`);
            return filteredDiagnostics;
        };

        return this.logger?.time(LogLevel.info, ['DiagnosticsManager.getDiagnostics()'], doDiagnosticsGathering) ?? doDiagnosticsGathering();
    }

    private getNonSuppresedDiagnostics() {
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
                        location: util.createLocation(
                            URI.file(scope.xmlFile.srcPath).toString(),
                            scope?.xmlFile?.ast?.componentElement?.getAttribute('name')?.tokens?.value?.range ?? util.createRange(0, 0, 0, 10)
                        )
                    });
                } else {
                    relatedInformation.push({
                        message: `In scope '${scope.name}'`,
                        location: util.createLocation(
                            URI.file(diagnostic.file.srcPath).toString(),
                            diagnostic.range
                        )
                    });
                }

            }
            diagnostic.relatedInformation = relatedInformation;
            results.push(diagnostic);
        }
        return results.filter((x) => {
            return !util.diagnosticIsSuppressed(x);
        });
    }

    private filterDiagnostics(diagnostics: BsDiagnostic[]) {
        //filter out diagnostics based on our diagnostic filters
        let filteredDiagnostics = this.diagnosticFilterer.filter({
            ...this.options ?? {},
            rootDir: this.options?.rootDir
        }, diagnostics);
        return filteredDiagnostics;
    }

    public clear() {
        this.diagnosticsCache.clear();
    }

    public clearForFile(fileSrcPath: string) {
        const fileSrcPathLower = fileSrcPath.toLowerCase();
        for (const [key, cachedData] of this.diagnosticsCache.entries()) {
            if (cachedData.diagnostic.file.srcPath.toLowerCase() === fileSrcPathLower) {
                this.diagnosticsCache.delete(key);
            }
        }
    }

    public clearForScope(scope: Scope) {
        for (const [key, cachedData] of this.diagnosticsCache.entries()) {
            let removedContext = false;
            for (const context of cachedData.contexts.values()) {
                if (context.scope === scope) {
                    cachedData.contexts.delete(context);
                    removedContext = true;
                }
            }
            if (removedContext && cachedData.contexts.size === 0) {
                // no more contexts for this diagnostic - remove diagnostic
                this.diagnosticsCache.delete(key);
            }
        }
    }

    public clearForSegment(segment: AstNode) {
        for (const [key, cachedData] of this.diagnosticsCache.entries()) {
            let removedContext = false;
            for (const context of cachedData.contexts.values()) {
                if (context.segment === segment) {
                    cachedData.contexts.delete(context);
                }
            }
            if (removedContext && cachedData.contexts.size === 0) {
                // no more contexts for this diagnostic - remove diagnostic
                this.diagnosticsCache.delete(key);
            }
        }
    }

    public clearForTag(tag: string) {
        for (const [key, cachedData] of this.diagnosticsCache.entries()) {
            for (const context of cachedData.contexts.values()) {
                if (context.tags.includes(tag)) {
                    this.diagnosticsCache.delete(key);
                }
            }
        }
    }

    /**
     * Clears all diagnostics that match all aspects of the filter provided
     */
    public clearByFilter(filter: DiagnosticContextFilter) {

        const needToMatch = {
            tag: !!filter.tag,
            scope: !!filter.scope,
            file: !!filter.file,
            segment: !!filter.segment
        };

        for (const [key, cachedData] of this.diagnosticsCache.entries()) {
            let removedContext = false;
            for (const context of cachedData.contexts.values()) {
                let isMatch = true;
                if (isMatch && needToMatch.tag) {
                    isMatch = !!context.tags?.includes(filter.tag);
                }
                if (isMatch && needToMatch.scope) {
                    isMatch = context.scope === filter.scope;
                }
                if (isMatch && needToMatch.file) {
                    isMatch = cachedData.diagnostic.file === filter.file;
                }
                if (isMatch && needToMatch.segment) {
                    isMatch = context.segment === filter.segment;
                }

                if (isMatch) {
                    cachedData.contexts.delete(context);
                    removedContext = true;
                }
            }
            if (removedContext && cachedData.contexts.size === 0) {
                // no more contexts for this diagnostic - remove diagnostic
                this.diagnosticsCache.delete(key);
            }
        }
    }


    private getDiagnosticKey(diagnostic: BsDiagnostic) {
        return `${diagnostic.file?.srcPath} - ${diagnostic.code} - ${diagnostic.message} - ${util.rangeToString(diagnostic.range)}`;
    }

    private mergeRelatedInformation(target: DiagnosticRelatedInformation[], source: DiagnosticRelatedInformation[]) {
        function getRiKey(relatedInfo: DiagnosticRelatedInformation) {
            return `${relatedInfo.message} - ${relatedInfo.location.uri} - ${util.rangeToString(relatedInfo.location.range)}`.toLowerCase();
        }

        const existingKeys = target.map(ri => getRiKey(ri));

        for (const ri of source) {
            const key = getRiKey(ri);
            if (!existingKeys.includes(key)) {
                target.push(ri);
            }
        }
    }

}

interface DiagnosticContextFilter {
    tag?: string;
    scope?: Scope;
    file?: BscFile;
    segment?: AstNode;
}
