import type { BsDiagnostic } from './interfaces';
import * as path from 'path';
import * as minimatch from 'minimatch';
import type { BsConfig } from './BsConfig';
import { standardizePath as s } from './util';

interface DiagnosticWithSuppression {
    diagnostic: BsDiagnostic;
    isSuppressed: boolean;
}

interface NormalizedFilter {
    src?: string;
    dest?: string;
    codes?: (number | string)[];
    isNegative: boolean;
}

export class DiagnosticFilterer {
    private byFile: Record<string, DiagnosticWithSuppression[]>;
    private fileDestSrcMap: Record<string, string>;
    private filters: NormalizedFilter[] | undefined;
    private rootDir: string | undefined;


    constructor() {
        this.byFile = {};
        this.fileDestSrcMap = {};
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
        this.fileDestSrcMap = {};
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
        this.fileDestSrcMap = {};
        for (let diagnostic of diagnostics) {
            const srcPath = diagnostic?.file?.srcPath;

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
        for (let diagnostic of diagnostics) {
            const destPath = diagnostic?.file?.destPath;
            const srcPath = diagnostic?.file?.srcPath;

            //skip diagnostics that have issues
            if (!destPath || !srcPath) {
                continue;
            }

            const lowerDestPath = destPath.toLowerCase();
            const lowerSrcPath = srcPath.toLowerCase();
            this.fileDestSrcMap[lowerDestPath] = lowerSrcPath;
        }
    }

    private filterAllFiles(filter: NormalizedFilter) {
        let matchedFilePaths: string[];

        if (filter.src) {
            //if there's a src, match against all files

            //prepend rootDir to src if the filter is a relative path
            let src = s(
                path.isAbsolute(filter.src) ? filter.src : `${this.rootDir}/${filter.src}`
            );

            matchedFilePaths = minimatch.match(Object.keys(this.byFile), src, {
                nocase: true
            });

        } else if (filter.dest) {
            // applies to file dest location

            //prepend rootDir to dest if the filter is a relative path
            let dest = s(
                path.isAbsolute(filter.dest) ? filter.dest : `${this.rootDir}/${filter.dest}`
            );
            // search against the set of file destinations
            const matchedDestFilePaths = minimatch.match(Object.keys(this.fileDestSrcMap), dest, {
                nocase: true
            });
            // convert to file srcs
            matchedFilePaths = matchedDestFilePaths.map(destPath => this.fileDestSrcMap[destPath]);

        } else {
            //there is no src; this applies to all files
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

        // get correct diagnostics set
        const fileDiagnostics = this.byFile[filePath];

        //if there is no code, set isSuppressed on every diagnostic in this file
        if (!filter.codes) {
            fileDiagnostics.forEach(diagnostic => {
                diagnostic.isSuppressed = isSuppressing;
            });

            //set isSuppressed for any diagnostics with matching codes
        } else {
            for (const diagnostic of fileDiagnostics) {
                if (filter.codes.includes(diagnostic.diagnostic.code!) ||
                    (diagnostic.diagnostic.legacyCode &&
                        (filter.codes.includes(diagnostic.diagnostic.legacyCode) ||
                            filter.codes.includes(diagnostic.diagnostic.legacyCode.toString())))) {
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
            if (typeof filter === 'number' || typeof filter === 'string') {
                result.push({
                    codes: [filter],
                    isNegative: false
                });
                continue;
            }

            //filter out bad inputs
            if (!filter || typeof filter !== 'object') {
                continue;
            }

            //code-only filter
            if ('codes' in filter && !('files' in filter) && Array.isArray(filter.codes)) {
                result.push({
                    codes: filter.codes,
                    isNegative: false
                });
                continue;
            }

            if ('files' in filter) {
                if (typeof filter.files === 'string') {
                    result.push(this.getNormalizedFilter(filter.files, filter));
                    continue;
                }

                if (Array.isArray(filter.files)) {
                    for (const fileIdentifier of filter.files) {
                        if (typeof fileIdentifier === 'string') {
                            result.push(this.getNormalizedFilter(fileIdentifier, filter));
                            continue;
                        }
                        if (typeof fileIdentifier === 'object') {
                            if ('src' in fileIdentifier) {
                                result.push(this.getNormalizedFilter(fileIdentifier.src, filter));
                                continue;
                            }
                            if ('dest' in fileIdentifier) {
                                result.push(this.getNormalizedFilter(fileIdentifier.dest, filter, 'dest'));
                                continue;
                            }
                        }
                    }
                }
            }
        }
        return result;
    }


    private getNormalizedFilter(fileGlob: string, filter: { files: string } | { codes?: (number | string)[] }, locationKey: 'src' | 'dest' = 'src'): NormalizedFilter {
        const isNegative = fileGlob.startsWith('!');
        const trimmedFilter = isNegative ? fileGlob.slice(1) : fileGlob;
        if (locationKey === 'src') {
            if ('codes' in filter && Array.isArray(filter.codes)) {
                return {
                    src: trimmedFilter,
                    codes: filter.codes,
                    isNegative: isNegative
                };
            } else {
                return {
                    src: trimmedFilter,
                    isNegative: isNegative
                };
            }
        } else {
            // dest
            if ('codes' in filter && Array.isArray(filter.codes)) {
                return {
                    dest: trimmedFilter,
                    codes: filter.codes,
                    isNegative: isNegative
                };
            } else {
                return {
                    dest: trimmedFilter,
                    isNegative: isNegative
                };
            }
        }

    }
}
