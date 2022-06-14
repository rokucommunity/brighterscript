import type { BsDiagnostic } from './interfaces';
import type { Project } from './LanguageServer';

export class DiagnosticCollection {
    private previousDiagnosticsByFile = {} as Record<string, KeyedDiagnostic[]>;

    public getPatch(projects: Project[]) {
        const diagnosticsByFile = this.getDiagnosticsByFileFromProjects(projects);

        const patch = {
            ...this.getRemovedPatch(diagnosticsByFile),
            ...this.getModifiedPatch(diagnosticsByFile),
            ...this.getAddedPatch(diagnosticsByFile)
        };

        //save the new list of diagnostics
        this.previousDiagnosticsByFile = diagnosticsByFile;
        return patch;
    }

    private getDiagnosticsByFileFromProjects(projects: Project[]) {
        const result = {} as Record<string, KeyedDiagnostic[]>;

        //get all diagnostics for all projects
        let diagnostics = Array.prototype.concat.apply([] as KeyedDiagnostic[],
            projects.map((x) => x.builder.getDiagnostics())
        ) as KeyedDiagnostic[];

        const keys = {};
        //build the full current set of diagnostics by file
        for (let diagnostic of diagnostics) {
            const srcPath = diagnostic.file.srcPath;
            //ensure the file entry exists
            if (!result[srcPath]) {
                result[srcPath] = [];
            }
            const diagnosticMap = result[srcPath];

            diagnostic.key =
                srcPath.toLowerCase() + '-' +
                diagnostic.code + '-' +
                diagnostic.range.start.line + '-' +
                diagnostic.range.start.character + '-' +
                diagnostic.range.end.line + '-' +
                diagnostic.range.end.character +
                diagnostic.message;

            //don't include duplicates
            if (!keys[diagnostic.key]) {
                keys[diagnostic.key] = true;
                diagnosticMap.push(diagnostic);
            }
        }
        return result;
    }

    /**
     * Get a patch for all the files that have been removed since last time
     */
    private getRemovedPatch(currentDiagnosticsByFile: Record<string, KeyedDiagnostic[]>) {
        const result = {} as Record<string, KeyedDiagnostic[]>;
        for (const filePath in this.previousDiagnosticsByFile) {
            if (!currentDiagnosticsByFile[filePath]) {
                result[filePath] = [];
            }
        }
        return result;
    }

    /**
     * Get all files whose diagnostics have changed since last time
     */
    private getModifiedPatch(currentDiagnosticsByFile: Record<string, KeyedDiagnostic[]>) {
        const result = {} as Record<string, KeyedDiagnostic[]>;
        for (const filePath in currentDiagnosticsByFile) {
            //for this file, if there were diagnostics last time AND there are diagnostics this time, and the lists are different
            if (this.previousDiagnosticsByFile[filePath] && !this.diagnosticListsAreIdentical(this.previousDiagnosticsByFile[filePath], currentDiagnosticsByFile[filePath])) {
                result[filePath] = currentDiagnosticsByFile[filePath];
            }
        }
        return result;
    }

    /**
     * Determine if two diagnostic lists are identical
     */
    private diagnosticListsAreIdentical(list1: KeyedDiagnostic[], list2: KeyedDiagnostic[]) {
        //skip all checks if the lists are not the same size
        if (list1.length !== list2.length) {
            return false;
        }
        for (let i = 0; i < list1.length; i++) {
            if (list1[i].key !== list2[i].key) {
                return false;
            }
        }

        //if we made it here, the lists are identical
        return true;
    }

    /**
     * Get diagnostics for all new files not seen since last time
     */
    private getAddedPatch(currentDiagnosticsByFile: Record<string, KeyedDiagnostic[]>) {
        const result = {} as Record<string, KeyedDiagnostic[]>;
        for (const filePath in currentDiagnosticsByFile) {
            if (!this.previousDiagnosticsByFile[filePath]) {
                result[filePath] = currentDiagnosticsByFile[filePath];
            }
        }
        return result;
    }
}

interface KeyedDiagnostic extends BsDiagnostic {
    key: string;
}
