import type { BsDiagnostic } from './interfaces';
import * as path from 'path';
import * as minimatch from 'minimatch';
import type { BsConfig } from './BsConfig';
import util, { standardizePath as s } from './util';
import { URI } from 'vscode-uri';
import type { Program } from './Program';

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
    private fileDestSrcUriMap: Record<string, string>;
    private _filters: NormalizedFilter[] | undefined;
    private rootDir: string | undefined;

    public options: BsConfig | undefined;


    constructor() {
        this.byFile = {};
        this.fileDestSrcUriMap = {};
    }

    get filters() {
        if (!this.options) {
            return null;
        }
        if (!this._filters) {
            this._filters = this.getDiagnosticFilters(this.options);
        }
        return this._filters;
    }


    /**
     * Filter a list of diagnostics based on the provided filters
     */
    public filter(options: BsConfig, diagnostics: BsDiagnostic[], program?: Program) {
        this.options = options;

        delete this._filters;

        this.rootDir = this.options.rootDir;

        this.groupByFile(diagnostics, program);

        for (let filter of this.filters) {
            this.filterAllFiles(filter);
        }
        let result = this.getDiagnostics();

        //clean up
        this.byFile = {};
        this.fileDestSrcUriMap = {};

        return result;
    }

    /**
     * Should this file be completely ignored?
     * If the file diagnostics are ignored, we do not need to validate this file
     */
    public isFileFiltered(file: { srcPath: string; destPath: string }) {
        if (!this.options || !this.filters) {
            return false;
        }
        this.rootDir = this.options.rootDir;
        let isMatch = false;
        //filter each matched file
        for (let filter of this.filters) {
            if (filter.codes?.length > 0) {
                continue;
            }
            let srcMatch = false;
            if (filter.src) {
                const srcUri = util.pathToUri(file.srcPath);
                const srcFsPath = URI.parse(srcUri).fsPath;
                srcMatch = !!(filter.src && this.matchFileSrcUris(filter, [srcFsPath])?.length > 0);
            }
            let destMatch = false;
            if (filter.dest) {
                destMatch = !!(filter.dest && this.matchFileDestUris(filter, [file.destPath])?.length > 0);
            }

            if (!filter.isNegative) {
                isMatch = isMatch || srcMatch || destMatch;
            } else {
                if (srcMatch || destMatch) {
                    isMatch = false;
                }
            }
        }
        return isMatch;
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
    private groupByFile(diagnostics: BsDiagnostic[], program?: Program) {
        this.byFile = {};
        this.fileDestSrcUriMap = {};
        for (let diagnostic of diagnostics) {
            const fileUri = diagnostic?.location?.uri ?? 'invalid-uri';
            //skip diagnostics that have issues
            if (!fileUri) {
                continue;
            }
            const lowerFileUri = fileUri.toLowerCase();
            //make a new array for this file if one does not yet exist
            if (!this.byFile[lowerFileUri]) {
                this.byFile[lowerFileUri] = [];
            }
            this.byFile[lowerFileUri].push({
                diagnostic: diagnostic,
                isSuppressed: false
            });

            if (program) {
                const fileForDiagnostic = program.getFile(diagnostic.location?.uri);
                if (fileForDiagnostic) {
                    const lowerDestPath = fileForDiagnostic.destPath.toLowerCase();
                    this.fileDestSrcUriMap[lowerDestPath] = diagnostic.location?.uri;
                }
            }
        }
    }


    private matchFileSrcUris(filter: NormalizedFilter, fileUris: string[]): string[] {
        //prepend rootDir to src if the filter is not a relative path
        let src = s(
            path.isAbsolute(filter.src) ? filter.src : `${this.rootDir}/${filter.src}`
        );

        let matchedFileUris = minimatch.match(fileUris, src, {
            nocase: true
        }).map(src => util.pathToUri(src).toLowerCase());

        return matchedFileUris;
    }

    private matchFileDestUris(filter: NormalizedFilter, fileUris: string[]): string[] {
        let matchedFileUris = minimatch.match(fileUris, filter.dest, {
            nocase: true
        });
        return matchedFileUris;
    }


    private filterAllFiles(filter: NormalizedFilter) {
        let matchedFileUris: string[];

        if (filter.src) {
            //if there's a src, match against all files
            const byFileSrcs = Object.keys(this.byFile).map(uri => URI.parse(uri).fsPath);
            matchedFileUris = this.matchFileSrcUris(filter, byFileSrcs);
        } else if (filter.dest) {
            // applies to file dest location
            // search against the set of file destinations
            const byFileDests = Object.keys(this.fileDestSrcUriMap);
            matchedFileUris = this.matchFileDestUris(filter, byFileDests).map((destPath) => {
                return this.fileDestSrcUriMap[destPath]?.toLowerCase();
            });
        } else {
            matchedFileUris = Object.keys(this.byFile);
        }

        //filter each matched file
        for (let fileUri of matchedFileUris) {
            this.filterFile(filter, fileUri);
        }
    }

    private filterFile(filter: NormalizedFilter, fileUri: string) {
        if (!fileUri) {
            return;
        }
        //if the filter is negative, we're turning diagnostics on
        //if the filter is not negative we're turning diagnostics off
        const isSuppressing = !filter.isNegative;
        const lowerFileUri = fileUri.toLowerCase();
        //if there is no code, set isSuppressed on every diagnostic in this file
        if (!filter.codes) {
            this.byFile[lowerFileUri].forEach(diagnostic => {
                diagnostic.isSuppressed = isSuppressing;
            });

            //set isSuppressed for any diagnostics with matching codes
        } else {
            let fileDiagnostics = this.byFile[lowerFileUri];
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
        if (config.diagnosticFiltersV0Compatibility) {
            return this.getDiagnosticFiltersV0(config);
        }

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

    private getDiagnosticFiltersV0(config: BsConfig) {
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

        for (let filter of diagnosticFilters as any) {
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

            //code-only filter
            if ('codes' in filter && !('src' in filter) && Array.isArray(filter.codes)) {
                result.push({
                    codes: filter.codes,
                    isNegative: false
                });
                continue;
            }

            if ('src' in filter && typeof filter.src === 'string') {
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
