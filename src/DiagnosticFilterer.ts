import { BsDiagnostic } from './interfaces';
import * as path from 'path';
import * as minimatch from 'minimatch';
import { BsConfig } from './BsConfig';
import { standardizePath as s } from './util';

export class DiagnosticFilterer {
    private byFile: { [filePath: string]: BsDiagnostic[] };
    private filePaths: string[];
    private filters: Array<{ src?: string; codes?: number[] }>;
    private rootDir: string;

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
        delete this.byFile;
        delete this.filePaths;
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
        this.filePaths = [] as string[];

        for (let diagnostic of diagnostics) {
            //make a new array for this file if one does not yet exist
            if (!this.byFile[diagnostic.file.pathAbsolute]) {
                this.byFile[diagnostic.file.pathAbsolute] = [];
            }
            this.byFile[diagnostic.file.pathAbsolute].push(diagnostic);
            this.filePaths.push(diagnostic.file.pathAbsolute);
        }
    }

    private filterAllFiles(filter: { src?: string; codes?: number[] }) {
        let matchedFilePaths: string[];

        //if there's a src, match against all files
        if (filter.src) {
            //prepend rootDir to src if the filter is a relative path
            let src = s(
                path.isAbsolute(filter.src) ? filter.src : `${this.rootDir}/${filter.src}`
            );

            matchedFilePaths = minimatch.match(this.filePaths, src);

            //there is no src; this applies to all files
        } else {
            matchedFilePaths = this.filePaths.slice();
        }

        //filter each matched file
        for (let filePath of matchedFilePaths) {
            this.filterFile(filter, filePath);
        }
    }

    private filterFile(filter: { src?: string; codes?: number[] }, filePath: string) {
        //if there are no codes, throw out all diagnostics for this file
        if (!filter.codes) {
            delete this.byFile[filePath];
            //remove this file from the list because all of its diagnostics were removed
            this.filePaths.splice(this.filePaths.indexOf(filePath), 1);

            //filter any diagnostics with matching codes
        } else {
            let fileDiagnostics = this.byFile[filePath];
            for (let i = 0; i < fileDiagnostics.length; i++) {
                let diagnostic = fileDiagnostics[i];
                if (filter.codes.includes(diagnostic.code as number)) {
                    //remove this diagnostic
                    fileDiagnostics.splice(i, 1);
                    //repeat this loop iteration (with the new item at this index)
                    i--;
                }
            }
        }
    }

    public getDiagnosticFilters(config1: BsConfig) {

        let globalIgnoreCodes = [...config1.ignoreErrorCodes ?? []];
        let diagnosticFilters = [...config1.diagnosticFilters ?? []];

        let result = [];

        for (let i = 0; i < diagnosticFilters.length; i++) {
            let filter: any = diagnosticFilters[i];
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
        return result as Array<{ src?: string; codes: number[] }>;
    }
}
