import type { BsDiagnostic } from './interfaces';
import * as path from 'path';
import * as micromatch from 'micromatch';
import type { BsConfig } from './BsConfig';
import { standardizePath as s } from './util';
import { DiagnosticSeverity } from 'vscode-languageserver-protocol';

type DiagnosticSeverityFilter = 'error' | 'warn' | 'info' | 'hint' | DiagnosticSeverity;

const severityMap: Record<string, DiagnosticSeverity> = {
    error: DiagnosticSeverity.Error,
    warn: DiagnosticSeverity.Warning,
    warning: DiagnosticSeverity.Warning,
    info: DiagnosticSeverity.Information,
    information: DiagnosticSeverity.Information,
    hint: DiagnosticSeverity.Hint
};

interface DiagnosticWithSuppression {
    diagnostic: BsDiagnostic;
    isSuppressed: boolean;
}

interface NormalizedFilter {
    src?: string;
    codes?: (number | string)[];
    severities?: DiagnosticSeverityFilter[];
    isNegative: boolean;
}

export class DiagnosticFilterer {
    private byFile: Record<string, DiagnosticWithSuppression[]>;
    private filters: NormalizedFilter[] | undefined;
    private rootDir: string | undefined;


    constructor() {
        this.byFile = {};
    }

    /**
     * Filter a list of diagnostics based on the provided filters
     */
    public filter(options: BsConfig, diagnostics: BsDiagnostic[]) {
        this.filters = this.getDiagnosticFilters(options);
        this.rootDir = options.rootDir;

        this.groupByFile(diagnostics);

        for (let filter of this.filters) {
            this.filterAllFiles(filter);
        }
        let result = this.getDiagnostics();

        //clean up
        this.byFile = {};
        delete this.rootDir;
        delete this.filters;

        return result;
    }

    /**
     * Iterate over all remaining diagnostics from the byFile map.
     * Also removes duplicates
     */
    private getDiagnostics() {
        //combine all remaining diagnostics
        let finalDiagnostics = [] as BsDiagnostic[];
        for (let key in this.byFile) {
            let fileDiagnostics = this.byFile[key];
            for (let diagnostic of fileDiagnostics) {
                //filter out duplicate and suppressed diagnostics
                if (!finalDiagnostics.includes(diagnostic.diagnostic) && !diagnostic.isSuppressed) {
                    finalDiagnostics.push(diagnostic.diagnostic);
                }
            }
        }
        return finalDiagnostics;
    }

    /**
     * group the diagnostics by file
     */
    private groupByFile(diagnostics: BsDiagnostic[]) {
        this.byFile = {};

        for (let diagnostic of diagnostics) {
            const srcPath = diagnostic?.file?.srcPath ?? diagnostic?.file?.srcPath;
            //skip diagnostics that have issues
            if (!srcPath) {
                continue;
            }
            const lowerSrcPath = srcPath.toLowerCase();
            //make a new array for this file if one does not yet exist
            if (!this.byFile[lowerSrcPath]) {
                this.byFile[lowerSrcPath] = [];
            }
            this.byFile[lowerSrcPath].push({
                diagnostic: diagnostic,
                isSuppressed: false
            });
        }
    }

    private filterAllFiles(filter: NormalizedFilter) {
        let matchedFilePaths: string[];

        //if there's a src, match against all files
        if (filter.src) {
            //prepend rootDir to src if the filter is a relative path
            let src = s(
                path.isAbsolute(filter.src) ? filter.src : `${this.rootDir}/${filter.src}`
            );

            //micromatch (picomatch) treats backslashes as escape chars, but standardizePath produces
            //backslashes on Windows. Match against forward-slash-normalized copies of the paths (and pattern),
            //then map the matches back to the original `byFile` keys.
            const originalByNormalized = new Map<string, string>();
            for (const filePath of Object.keys(this.byFile)) {
                originalByNormalized.set(filePath.replace(/\\/g, '/'), filePath);
            }
            matchedFilePaths = micromatch([...originalByNormalized.keys()], src.replace(/\\/g, '/'), {
                nocase: true
            }).map(normalized => originalByNormalized.get(normalized));

            //there is no src; this applies to all files
        } else {
            matchedFilePaths = Object.keys(this.byFile);
        }

        //filter each matched file
        for (let filePath of matchedFilePaths) {
            this.filterFile(filter, filePath);
        }
    }

    private resolveSeverities(filter: NormalizedFilter): DiagnosticSeverity[] | undefined {
        if (!Array.isArray(filter.severities)) {
            return undefined;
        }

        const resolved: DiagnosticSeverity[] = [];
        for (const item of filter.severities) {
            if (typeof item === 'number') {
                resolved.push(item);
            } else if (typeof item === 'string') {
                const mapped = severityMap[item.toLowerCase()];
                if (mapped !== undefined) {
                    resolved.push(mapped);
                }
            }
        }
        return resolved;
    }

    /**
     * Apply a normalized filter to a single matched file.
     *
     * Semantics:
     * - Positive filters (`isNegative: false`) suppress matching diagnostics (`isSuppressed = true`).
     * - Negative filters (`isNegative: true`, i.e., `src` prefixed with `!`) un-suppress matching diagnostics (`isSuppressed = false`).
     * - Filters are evaluated sequentially in configuration order (.gitignore-style last-match-wins precedence).
     * - When neither `codes` nor `severities`/`severity` is specified, every diagnostic in the matched file is affected.
     * - When both `codes` and `severities`/`severity` are specified on the same filter object, a diagnostic is matched
     *   if its code is in `codes` OR its severity is in `severities` (`matchesCode || matchesSeverity`), allowing a single
     *   filter entry to target both broad severity classes and specific diagnostic codes within the matched `src` scope.
     */
    private filterFile(filter: NormalizedFilter, filePath: string) {
        //if the filter is negative, we're turning diagnostics on
        //if the filter is not negative we're turning diagnostics off
        const isSuppressing = !filter.isNegative;
        const severities = this.resolveSeverities(filter);

        //if there is no code or severity filter, set isSuppressed on every diagnostic in this file
        if (!filter.codes && !severities) {
            this.byFile[filePath].forEach(diagnostic => {
                diagnostic.isSuppressed = isSuppressing;
            });

            //set isSuppressed for any diagnostics with matching codes or severities
        } else {
            let fileDiagnostics = this.byFile[filePath];
            for (const diagnostic of fileDiagnostics) {
                const matchesCode = filter.codes ? filter.codes.includes(diagnostic.diagnostic.code!) : false;
                const matchesSeverity = severities ? severities.includes(diagnostic.diagnostic.severity!) : false;
                if (matchesCode || matchesSeverity) {
                    diagnostic.isSuppressed = isSuppressing;
                }
            }
        }
    }

    public getDiagnosticFilters(config: BsConfig) {
        let globalIgnoreCodes: (number | string)[] = [...config.ignoreErrorCodes ?? []];
        let diagnosticFilters = [...config.diagnosticFilters ?? []];

        let result: NormalizedFilter[] = [];

        //include a filter for all global ignore codes
        //this comes first, because negative patterns will override ignoreErrorCodes
        if (globalIgnoreCodes.length > 0) {
            result.push({
                codes: globalIgnoreCodes,
                isNegative: false
            });
        }

        for (let filter of diagnosticFilters) {
            if (typeof filter === 'number') {
                result.push({
                    codes: [filter],
                    isNegative: false
                });
                continue;
            }

            if (typeof filter === 'string') {
                const isNegative = filter.startsWith('!');
                const trimmedFilter = isNegative ? filter.slice(1) : filter;

                result.push({
                    src: trimmedFilter,
                    isNegative: isNegative
                });
                continue;
            }

            //filter out bad inputs
            if (!filter || typeof filter !== 'object') {
                continue;
            }

            const hasSrc = 'src' in filter && typeof filter.src === 'string';
            const hasCodes = 'codes' in filter && Array.isArray(filter.codes);
            const hasSeverities = 'severities' in filter && Array.isArray(filter.severities);
            const hasSeverity = 'severity' in filter && (typeof filter.severity === 'string' || typeof filter.severity === 'number' || Array.isArray(filter.severity));

            if (!hasSrc && !hasCodes && !hasSeverities && !hasSeverity) {
                continue;
            }

            let isNegative = false;
            let normalizedFilter: NormalizedFilter = {
                isNegative: false
            };

            if (hasSrc) {
                isNegative = filter.src.startsWith('!');
                normalizedFilter.src = isNegative ? filter.src.slice(1) : filter.src;
            }
            if (hasCodes) {
                normalizedFilter.codes = filter.codes;
            }
            if (hasSeverities && !hasSeverity) {
                normalizedFilter.severities = filter.severities;
            } else if (hasSeverity) {
                normalizedFilter.severities = [
                    ...(hasSeverities ? filter.severities : []),
                    ...(Array.isArray(filter.severity) ? filter.severity : [filter.severity])
                ];
            }
            normalizedFilter.isNegative = isNegative;

            result.push(normalizedFilter);
        }
        return result;
    }
}
