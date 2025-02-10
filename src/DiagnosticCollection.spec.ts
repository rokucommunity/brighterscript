import { DiagnosticCollection } from './DiagnosticCollection';
import util from './util';
import { expect } from './chai-config.spec';
import type { LspDiagnostic } from './lsp/LspProject';
import { URI } from 'vscode-uri';
import { rootDir } from './testHelpers.spec';
import * as path from 'path';
import { standardizePath } from './util';
import { interpolatedRange } from './astUtils/creators';

describe('DiagnosticCollection', () => {
    let collection: DiagnosticCollection;
    let projectId: number;

    beforeEach(() => {
        collection = new DiagnosticCollection();
        projectId = 1;
    });

    function testPatch(options: {
        projectId?: number;
        diagnosticsByFile?: Record<string, Array<string | LspDiagnostic>>;
        expected?: Record<string, string[]>;
    }) {

        const patch = collection.getPatch(options.projectId ?? projectId, createDiagnostics(options.diagnosticsByFile ?? {}));
        //convert the patch into our test structure
        const actual = {};
        for (let filePath in patch) {
            filePath = path.resolve(rootDir, filePath);
            actual[filePath] = patch[filePath].map(x => x.message);
        }

        //sanitize expected paths
        let expected = {};
        for (let key in options.expected ?? {}) {
            const srcPath = standardizePath(
                path.resolve(rootDir, key)
            );
            expected[srcPath] = options.expected[key];
        }
        expect(actual).to.eql(expected);
    }

    it('computes patch for empty diagnostics', () => {
        //start with 1 diagnostic
        testPatch({
            diagnosticsByFile: {
                'source/file1.brs': ['message1']
            },
            expected: {
                'source/file1.brs': ['message1']
            }
        });
    });

    it('computes patch for specific project', () => {
        //should be all diagnostics from project1
        testPatch({
            projectId: 1,
            diagnosticsByFile: {
                'alpha.brs': ['a1', 'a2'],
                'beta.brs': ['b1', 'b2']
            },
            expected: {
                'alpha.brs': ['a1', 'a2'],
                'beta.brs': ['b1', 'b2']
            }
        });

        //set project2 diagnostics that overlap a little with project1
        testPatch({
            projectId: 2,
            diagnosticsByFile: {
                'beta.brs': ['b2', 'b3'],
                'charlie.brs': ['c1', 'c2']
            },
            //the patch should only include new diagnostics
            expected: {
                'beta.brs': ['b1', 'b2', 'b3'],
                'charlie.brs': ['c1', 'c2']
            }
        });

        //set project 1 diagnostics again (same diagnostics)
        testPatch({
            projectId: 1,
            diagnosticsByFile: {
                'alpha.brs': ['a1', 'a2'],
                'beta.brs': ['b1', 'b2']
            },
            //patch should be empty because nothing changed
            expected: {
            }
        });
    });

    it('does not crash for diagnostics with missing locations', () => {
        const d1: LspDiagnostic = {
            code: 123,
            range: undefined,
            uri: undefined,
            message: 'I have no location'
        };
        testPatch({
            diagnosticsByFile: {
                'source/file1.brs': [d1 as any]
            },
            expected: {
                'source/file1.brs': ['I have no location']
            }
        });
    });

    it('returns full list of diagnostics on first call, and nothing on second call', () => {
        //first patch should return all
        testPatch({
            diagnosticsByFile: {
                'file1.brs': ['message1', 'message2'],
                'file2.brs': ['message3', 'message4']
            },
            expected: {
                'file1.brs': ['message1', 'message2'],
                'file2.brs': ['message3', 'message4']
            }
        });

        //second patch should return empty (because nothing has changed)
        testPatch({
            diagnosticsByFile: {
                'file1.brs': ['message1', 'message2'],
                'file2.brs': ['message3', 'message4']
            },
            expected: {
            }
        });
    });

    it('removes diagnostics in patch', () => {
        //first patch should return all
        testPatch({
            diagnosticsByFile: {
                'file1.brs': ['message1', 'message2'],
                'file2.brs': ['message3', 'message4']
            },
            expected: {
                'file1.brs': ['message1', 'message2'],
                'file2.brs': ['message3', 'message4']
            }
        });

        //removing the diagnostics should result in a new patch with those diagnostics removed
        testPatch({
            diagnosticsByFile: {
                'file1.brs': [],
                'file2.brs': ['message3', 'message4']
            },
            expected: {
                'file1.brs': []
            }
        });
    });

    it('adds diagnostics in patch', () => {
        testPatch({
            diagnosticsByFile: {
                'file1.brs': ['message1', 'message2']
            },
            expected: {
                'file1.brs': ['message1', 'message2']
            }
        });

        testPatch({
            diagnosticsByFile: {
                'file1.brs': ['message1', 'message2'],
                'file2.brs': ['message3', 'message4']
            },
            expected: {
                'file2.brs': ['message3', 'message4']
            }
        });
    });

    it('sends full list when file diagnostics have changed', () => {
        testPatch({
            diagnosticsByFile: {
                'file1.brs': ['message1', 'message2']
            },
            expected: {
                'file1.brs': ['message1', 'message2']
            }
        });
        testPatch({
            diagnosticsByFile: {
                'file1.brs': ['message1', 'message2', 'message3', 'message4']
            },
            expected: {
                'file1.brs': ['message1', 'message2', 'message3', 'message4']
            }
        });
    });

    it('handles when diagnostics.projects is already defined and already includes this project', () => {
        testPatch({
            diagnosticsByFile: {
                'file1.brs': [{
                    message: 'message1',
                    range: interpolatedRange,
                    uri: undefined,
                    projects: [projectId]
                } as any]
            },
            expected: {
                'file1.brs': ['message1']
            }
        });
    });

    describe('getRemovedPatch', () => {
        it('returns empty array for file that was removed', () => {
            collection['previousDiagnosticsByFile'] = {
                [`lib1.brs`]: []
            };
            expect(
                collection['getRemovedPatch']({
                    [`lib2.brs`]: []
                })
            ).to.eql({
                [`lib1.brs`]: []
            });
        });
    });

    describe('diagnosticListsAreIdentical', () => {
        it('returns false for different diagnostics in same-sized list', () => {
            expect(
                collection['diagnosticListsAreIdentical']([
                    { key: 'one' } as any
                ], [
                    { key: 'two' } as any
                ])
            ).to.be.false;
        });
    });

    function createDiagnostics(diagnosticsByFile: Record<string, Array<string | LspDiagnostic>>) {
        const newDiagnostics: LspDiagnostic[] = [];
        for (let [srcPath, diagnostics] of Object.entries(diagnosticsByFile)) {
            srcPath = path.resolve(rootDir, srcPath);
            for (const d of diagnostics) {
                let diagnostic = d as LspDiagnostic;
                if (typeof d === 'string') {
                    diagnostic = {
                        uri: undefined,
                        range: util.createRange(0, 0, 0, 0),
                        //the code doesn't matter as long as the messages are different, so just enforce unique messages for this test files
                        code: 123,
                        message: d
                    };
                }
                diagnostic.uri = URI.file(srcPath).toString();
                newDiagnostics.push(diagnostic);
            }
        }
        return newDiagnostics;
    }
});
