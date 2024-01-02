import type { BsDiagnostic } from './interfaces';
import * as path from 'path';
import * as minimatch from 'minimatch';
import type { BsConfig } from './BsConfig';
import { standardizePath as s } from './util';

export class DiagnosticFilterer {
    private byFile: Record<string, BsDiagnostic[]>;
    private filters: Array<{ src?: string; codes?: (number | string)[] }> | undefined;
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
                if (finalDiagnostics.includes(diagnostic)) {
                    //do not include duplicate diagnostics
                } else {
                    finalDiagnostics.push(diagnostic);
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
            this.byFile[lowerSrcPath].push(diagnostic);
        }
    }

    private filterAllFiles(filter: { src?: string; codes?: (number | string)[] }) {
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

    private filterFile(filter: { src?: string; codes?: (number | string)[] }, filePath: string) {
        //if there are no codes, throw out all diagnostics for this file
        if (!filter.codes) {
            //remove this file from the list because all of its diagnostics were removed
            delete this.byFile[filePath];

            //filter any diagnostics with matching codes
        } else {
            let fileDiagnostics = this.byFile[filePath];
            for (let i = 0; i < fileDiagnostics.length; i++) {
                let diagnostic = fileDiagnostics[i];
                if (filter.codes.includes(diagnostic.code!)) {
                    //remove this diagnostic
                    fileDiagnostics.splice(i, 1);
                    //repeat this loop iteration (with the new item at this index)
                    i--;
                }
            }
        }
    }

    public getDiagnosticFilters(config1: BsConfig) {

        let globalIgnoreCodes: (number | string)[] = [...config1.ignoreErrorCodes ?? []];
        let diagnosticFilters = [...config1.diagnosticFilters ?? []];

        let result: Array<{ src?: string; codes: (number | string)[] }> = [];

        for (let filter of diagnosticFilters as any[]) {
            if (typeof filter === 'number') {
                globalIgnoreCodes.push(filter);
                continue;
            } else if (typeof filter === 'string') {
                filter = {
                    src: filter
                };

                //if this is a code-only filter, add them to the globalCodes array (and skip adding it now)
            } else if (Array.isArray(filter?.codes) && !filter.src) {
                globalIgnoreCodes.push(...filter.codes);
                continue;
            }

            //if this looks like a filter, keep it
            if (filter?.src || filter?.codes) {
                result.push(filter);
            }
        }
        //include a filter for all global ignore codes
        if (globalIgnoreCodes.length > 0) {
            result.push({
                codes: globalIgnoreCodes
            });
        }
        return result;
    }
}
