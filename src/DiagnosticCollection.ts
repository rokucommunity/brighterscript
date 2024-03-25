import { URI } from 'vscode-uri';
import type { LspDiagnostic, LspProject } from './lsp/LspProject';
import { util } from './util';
import { firstBy } from 'thenby';

export class DiagnosticCollection {
    private previousDiagnosticsByFile: Record<string, KeyedDiagnostic[]> = {};

    /**
     * Get a patch of any changed diagnostics since last time. This takes a single project and diagnostics, but evaulates
     * the patch based on all previously seen projects. It's supposed to be a rolling patch.
     * This will include _ALL_ diagnostics for a file if any diagnostics have changed for that file, due to how the language server expects diagnostics to be sent.
     */
    public getPatch(projectId: number, diagnostics: LspDiagnostic[]) {
        const diagnosticsByFile = this.getDiagnosticsByFile(projectId, diagnostics as KeyedDiagnostic[]);

        const patch = {
            ...this.getRemovedPatch(diagnosticsByFile),
            ...this.getModifiedPatch(diagnosticsByFile),
            ...this.getAddedPatch(diagnosticsByFile)
        };

        //save the new list of diagnostics
        this.previousDiagnosticsByFile = diagnosticsByFile;
        return patch;
    }

    /**
     * Get all the previous diagnostics, remove any that were exclusive to the current project, then mix in the project's new diagnostics.
     * @param projectId the id of the project that should have its diagnostics refreshed
     * @param thisProjectDiagnostics diagnostics for the project
     */
    private getDiagnosticsByFile(projectId: number, thisProjectDiagnostics: KeyedDiagnostic[]) {
        const result = this.clonePreviousDiagnosticsByFile();

        const diagnosticsByKey = new Map<string, KeyedDiagnostic>();

        //delete all diagnostics linked to this project
        for (const srcPath in result) {
            const diagnostics = result[srcPath];
            for (let i = diagnostics.length - 1; i >= 0; i--) {
                const diagnostic = diagnostics[i];

                //remember this diagnostic key for use when deduping down below
                diagnosticsByKey.set(diagnostic.key, diagnostic);

                //unlink the diagnostic from this project
                diagnostic.projectIds.delete(projectId);
                //delete this diagnostic if it's no longer linked to any projects
                if (diagnostic.projectIds.size === 0) {
                    diagnostics.splice(i, 1);
                    diagnosticsByKey.delete(diagnostic.key);
                }
            }
        }

        //build the full current set of diagnostics by file
        for (let diagnostic of thisProjectDiagnostics) {
            const srcPath = URI.parse(diagnostic.uri).fsPath;
            //ensure the file entry exists
            if (!result[srcPath]) {
                result[srcPath] = [];
            }

            //fall back to a default range if missing
            const range = diagnostic.range ?? util.createRange(0, 0, 0, 0);

            diagnostic.key =
                srcPath.toLowerCase() + '-' +
                diagnostic.code + '-' +
                range.start.line + '-' +
                range.start.character + '-' +
                range.end.line + '-' +
                range.end.character +
                diagnostic.message;

            diagnostic.projectIds ??= new Set([projectId]);

            //don't include duplicates
            if (!diagnosticsByKey.has(diagnostic.key)) {
                diagnosticsByKey.set(diagnostic.key, diagnostic);

                const diagnosticsForFile = result[srcPath];
                diagnosticsForFile.push(diagnostic);
            }

            //link this project to the diagnostic
            diagnosticsByKey.get(diagnostic.key).projectIds.add(projectId);
        }

        //sort the list so it's easier to compare later
        for (let key in result) {
            result[key].sort(firstBy(x => x.key));
        }
        return result;
    }

    /**
     * Clone the previousDiagnosticsByFile, retaining the array of project references on each diagnostic
     */
    private clonePreviousDiagnosticsByFile() {
        let clone: typeof this.previousDiagnosticsByFile = {};
        for (let key in this.previousDiagnosticsByFile) {
            clone[key] = [];
            for (const diagnostic of this.previousDiagnosticsByFile[key]) {
                clone[key].push({
                    ...diagnostic,
                    //make a copy of the projects array (but keep the project references intact)
                    projectIds: new Set([...diagnostic.projectIds])
                });
            }
        }
        return clone;
    }

    /**
     * Get a patch for all the files that have been removed since last time
     */
    private getRemovedPatch(currentDiagnosticsByFile: Record<string, KeyedDiagnostic[]>) {
        const result = {} as Record<string, KeyedDiagnostic[]>;
        for (const filePath in this.previousDiagnosticsByFile) {
            //if there are no current diagnostics for this file, add an empty array to the result for that file path
            if ((currentDiagnosticsByFile[filePath]?.length ?? 0) === 0) {
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
            if ((this.previousDiagnosticsByFile[filePath]?.length ?? 0) === 0) {
                result[filePath] = currentDiagnosticsByFile[filePath];
            }
        }
        return result;
    }
}

interface KeyedDiagnostic extends LspDiagnostic {
    key: string;
    projectIds: Set<number>;
}
