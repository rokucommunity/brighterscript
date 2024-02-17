import type { BsDiagnostic } from './interfaces';
import * as path from 'path';
import * as minimatch from 'minimatch';
import type { BsConfig, FinalizedBsConfig } from './BsConfig';
import { standardizePath as s } from './util';

interface DiagnosticWithSuppression {
    diagnostic: BsDiagnostic;
    isSuppressed: boolean;
}

interface NormalizedFilter {
    src?: string;
    codes?: (number | string)[];
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
    public filter(options: FinalizedBsConfig, diagnostics: BsDiagnostic[]) {
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

            matchedFilePaths = minimatch.match(Object.keys(this.byFile), src, {
                nocase: true
            });

            //there is no src; this applies to all files
        } else {
            matchedFilePaths = Object.keys(this.byFile);
        }

        //filter each matched file
        for (let filePath of matchedFilePaths) {
            this.filterFile(filter, filePath);
        }
    }

    private filterFile(filter: NormalizedFilter, filePath: string) {
        //if the filter is negative, we're turning diagnostics on
        //if the filter is not negative we're turning diagnostics off
        const isSuppressing = !filter.isNegative;

        //if there is no code, set isSuppressed on every diagnostic in this file
        if (!filter.codes) {
            this.byFile[filePath].forEach(diagnostic => {
                diagnostic.isSuppressed = isSuppressing;
            });

            //set isSuppressed for any diagnostics with matching codes
        } else {
            let fileDiagnostics = this.byFile[filePath];
            for (const diagnostic of fileDiagnostics) {
                if (filter.codes.includes(diagnostic.diagnostic.code!)) {
                    diagnostic.isSuppressed = true;
                }
            }
        }
    }

    public getDiagnosticFilters(config1: BsConfig) {

        let globalIgnoreCodes: (number | string)[] = [...config1.ignoreErrorCodes ?? []];
        let diagnosticFilters = [...config1.diagnosticFilters ?? []];

        let result: NormalizedFilter[] = [];

        for (let filter of diagnosticFilters) {
            if (typeof filter === 'number') {
                globalIgnoreCodes.push(filter);
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

            //if this is a code-only filter, add them to the globalCodes array (and skip adding it now)
            if ('codes' in filter && !('src' in filter) && Array.isArray(filter.codes)) {
                globalIgnoreCodes.push(...filter.codes);
                continue;
            }

            if ('src' in filter) {
                const isNegative = filter.src.startsWith('!');
                const trimmedFilter = isNegative ? filter.src.slice(1) : filter.src;

                if ('codes' in filter) {
                    result.push({
                        src: trimmedFilter,
                        codes: filter.codes,
                        isNegative: isNegative
                    });
                } else {
                    result.push({
                        src: trimmedFilter,
                        isNegative: isNegative
                    });
                }
            }
        }
        //include a filter for all global ignore codes
        if (globalIgnoreCodes.length > 0) {
            result.push({
                codes: globalIgnoreCodes,
                isNegative: false
            });
        }
        return result;
    }
}
