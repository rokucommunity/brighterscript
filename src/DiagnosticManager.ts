import type { DiagnosticContext, BsDiagnostic, DiagnosticContextPair } from './interfaces';
import { URI } from 'vscode-uri';
import type { AstNode } from './parser/AstNode';
import type { Scope } from './Scope';
import { util } from './util';
import { Cache } from './Cache';
import { isXmlScope } from './astUtils/reflection';
import type { BscFile } from './files/BscFile';
import type { DiagnosticRelatedInformation } from 'vscode-languageserver-protocol';


export class DiagnosticManager {

    private multiScopeCache = new Cache<string, { diagnostic: BsDiagnostic; contexts: Set<DiagnosticContext> }>();

    public register(diagnostic: BsDiagnostic, context?: DiagnosticContext) {
        const key = this.getDiagnosticKey(diagnostic);
        let fromCache = true;
        const cacheData = this.multiScopeCache.getOrAdd(key, () => {

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
        if (context) {
            contexts.add(context);
        }
    }

    public registerMultiple(diagnostics: Array<BsDiagnostic | DiagnosticContextPair>) {
        for (const diag of diagnostics) {
            if ((diag as any).diagnostic) {
                const diagContextPair = (diag as DiagnosticContextPair);
                this.register(diagContextPair.diagnostic, diagContextPair.context);
            } else {
                this.register((diag as BsDiagnostic));
            }
        }

    }


    public getDiagnostics() {
        const results = [] as Array<BsDiagnostic>;
        for (const cachedDiagnostic of this.multiScopeCache.values()) {
            const diagnostic = { ...cachedDiagnostic.diagnostic };
            const relatedInformation = [...cachedDiagnostic.diagnostic.relatedInformation];
            for (const context of cachedDiagnostic.contexts.values()) {
                if (context.scope) {
                    const scope = context.scope;
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
            }
            diagnostic.relatedInformation = relatedInformation;
            results.push(diagnostic);
        }
        return results.filter((x) => {
            return !util.diagnosticIsSuppressed(x);
        });
    }

    public clear(file: BscFile) {
        this.multiScopeCache.clear();
    }

    public clearForFile(file: BscFile) {
        for (const [key, cachedData] of this.multiScopeCache.entries()) {
            if (cachedData.diagnostic.file === file) {
                this.multiScopeCache.delete(key);
            }
        }
    }

    public clearForScope(scope: Scope) {
        for (const [key, cachedData] of this.multiScopeCache.entries()) {
            let removedContext = false;
            for (const context of cachedData.contexts.values()) {
                if (context.scope === scope) {
                    cachedData.contexts.delete(context);
                    removedContext = true;
                }
            }
            if (removedContext && cachedData.contexts.size === 0) {
                // no more contexts for this diagnostic - remove diagnostic
                this.multiScopeCache.delete(key);
            }
        }
    }

    public clearForSegment(segment: AstNode) {
        for (const [key, cachedData] of this.multiScopeCache.entries()) {
            let removedContext = false;
            for (const context of cachedData.contexts.values()) {
                if (context.segment === segment) {
                    cachedData.contexts.delete(context);
                }
            }
            if (removedContext && cachedData.contexts.size === 0) {
                // no more contexts for this diagnostic - remove diagnostic
                this.multiScopeCache.delete(key);
            }
        }
    }

    public clearForTag(tag: string) {
        for (const [key, cachedData] of this.multiScopeCache.entries()) {
            for (const context of cachedData.contexts.values()) {
                if (context.tags.includes(tag)) {
                    this.multiScopeCache.delete(key);
                }
            }
        }
    }

    public clearByContext(inContext: { tag?: string; scope?: Scope; file?: BscFile; segment?: AstNode }) {

        const needToMatch = {
            tag: !!inContext.tag,
            scope: !!inContext.scope,
            file: !!inContext.file,
            segment: !!inContext.segment
        };

        for (const [key, cachedData] of this.multiScopeCache.entries()) {
            let removedContext = false;
            for (const context of cachedData.contexts.values()) {
                let isMatch = true;
                if (isMatch && needToMatch.tag) {
                    isMatch = !!context.tags?.includes(inContext.tag);
                }
                if (isMatch && needToMatch.scope) {
                    isMatch = context.scope === inContext.scope;
                }
                if (isMatch && needToMatch.file) {
                    isMatch = cachedData.diagnostic.file === inContext.file;
                }
                if (isMatch && needToMatch.segment) {
                    isMatch = context.segment === inContext.segment;
                }

                if (isMatch) {
                    cachedData.contexts.delete(context);
                    removedContext = true;
                }
            }
            if (removedContext && cachedData.contexts.size === 0) {
                // no more contexts for this diagnostic - remove diagnostic
                this.multiScopeCache.delete(key);
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
