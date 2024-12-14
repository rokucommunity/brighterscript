import { expect } from './chai-config.spec';
import { DiagnosticFilterer } from './DiagnosticFilterer';
import type { BsDiagnostic } from './interfaces';
import { Program } from './Program';
import util, { standardizePath as s } from './util';
import { createSandbox } from 'sinon';
const sinon = createSandbox();
let rootDir = s`${process.cwd()}/rootDir`;

describe('DiagnosticFilterer', () => {

    let filterer: DiagnosticFilterer;
    let options = {
        rootDir: rootDir,
        diagnosticFilters: [
            'codename',
            //ignore these codes globally
            { codes: [1, 2, 3, 'X4'] },
            //ignore all codes from lib
            { files: 'lib/**/*.brs' },
            //ignore all codes from `packages` with absolute path
            { files: `${rootDir}/packages/**/*.brs` },
            //ignore specific codes for main.brs
            { files: 'source/main.brs', codes: [4] }
        ]
    };

    afterEach(() => {
        sinon.restore();
    });

    beforeEach(() => {
        filterer = new DiagnosticFilterer();
    });

    describe('filter', () => {

        it('removes duplicates', () => {
            let diagnostic = getDiagnostic(100, `${rootDir}/source/common.brs`);
            expect(
                filterer.filter(options, [diagnostic, diagnostic])
            ).to.eql([diagnostic]);
        });

        it('uses global code filter', () => {
            expect(
                filterer.filter(options, [
                    getDiagnostic(1, `${rootDir}/source/common.brs`),
                    getDiagnostic(2, `${rootDir}/source/common.brs`),
                    getDiagnostic(4, `${rootDir}/source/common.brs`),
                    getDiagnostic('X4', `${rootDir}/source/common.brs`)
                ]).map(x => x.code)
            ).to.eql([4]);
        });

        it('works with relative src globs', () => {
            expect(
                filterer.filter(options, [
                    getDiagnostic(10, `${rootDir}/source/common.brs`), //keep
                    getDiagnostic(11, `${rootDir}/lib/a.brs`), //remove
                    getDiagnostic(12, `${rootDir}/lib/a/b/b.brs`), //remove
                    getDiagnostic(13, `${rootDir}/lib/a/b/c/c.brs`) //remove
                ]).map(x => x.code)
            ).to.eql([10]);
        });

        it('works with absolute src globs', () => {
            expect(
                filterer.filter(options, [
                    getDiagnostic(10, `${rootDir}/source/common.brs`), //keep
                    getDiagnostic(11, `${rootDir}/packages/a.brs`), //remove
                    getDiagnostic(12, `${rootDir}/packages/a/b/b.brs`), //remove
                    getDiagnostic(13, `${rootDir}/packages/a/b/c/c.brs`), //remove
                    getDiagnostic('X14', `${rootDir}/packages/a/b/c/c.brs`) //remove
                ]).map(x => x.code)
            ).to.eql([10]);
        });

        it('works with single file src glob', () => {
            expect(
                filterer.filter(options, [
                    getDiagnostic(4, `${rootDir}/source/main.brs`), //remove
                    getDiagnostic(11, `${rootDir}/common/a.brs`), //keep
                    getDiagnostic(12, `${rootDir}/common/a/b/b.brs`), //keep
                    getDiagnostic(13, `${rootDir}/common/a/b/c/c.brs`), //keep
                    getDiagnostic('X14', `${rootDir}/common/a/b/c/c.brs`) //keep
                ]).map(x => x.code)
            ).to.eql([11, 12, 13, 'X14']);
        });


        it('works with single file src glob', () => {
            expect(
                filterer.filter(options, [
                    getDiagnostic('codename', `${rootDir}/source/main.brs`) //remove
                ]).map(x => x.code)
            ).to.eql([]);
        });

        describe('with negative globs', () => {
            let optionsWithNegatives = {
                rootDir: rootDir,
                diagnosticFilters: [
                    //ignore these codes globally
                    { codes: [1, 2, 'codename'] },
                    3,
                    4,
                    'codename',
                    //ignore all codes from lib
                    { files: 'lib/**/*.brs' },
                    //un-ignore specific errors from lib/special
                    { files: '!lib/special/**/*.brs', codes: [1, 2, 3, 'codename'] },
                    //re-ignore errors from one extra special file
                    { files: 'lib/special/all-reignored.brs' },
                    //un-ignore all codes from third special file
                    { files: '!lib/special/all-unignored.brs' },
                    //un-ignore code 5 globally
                    { files: '!*/**/*', codes: [5] },
                    //re-ignore code 10 globally, overriding previous unignores
                    { codes: [10] }
                ]
            };

            it('should unignore specific error codes for specific files', () => {
                expect(
                    filterer.filter(optionsWithNegatives, [
                        getDiagnostic(1, `${rootDir}/lib/special/a.brs`), //keep
                        getDiagnostic(3, `${rootDir}/lib/special/a.brs`), //keep
                        getDiagnostic(7, `${rootDir}/lib/special/a.brs`) //remove
                    ]).map(x => x.code)
                ).to.eql([1, 3]);
            });

            it('should unignore all codes from specific file', () => {
                expect(
                    filterer.filter(optionsWithNegatives, [
                        getDiagnostic(1, `${rootDir}/lib/special/all-unignored.brs`), //keep
                        getDiagnostic(2, `${rootDir}/lib/special/all-unignored.brs`), //keep
                        getDiagnostic(3, `${rootDir}/lib/special/all-unignored.brs`), //keep
                        getDiagnostic(4, `${rootDir}/lib/special/all-unignored.brs`) //keep
                    ]).map(x => x.code)
                ).to.eql([1, 2, 3, 4]);
            });

            it('should re-ignore errors', () => {
                expect(
                    filterer.filter(optionsWithNegatives, [
                        getDiagnostic(1, `${rootDir}/lib/special/all-reignored.brs`), //remove
                        getDiagnostic(10, `${rootDir}/lib/special/a.brs`) //remove
                    ]).map(x => x.code)
                ).to.eql([]);
            });

            it('should unignore errors globally by using "*/**/*" glob', () => {
                expect(
                    filterer.filter(optionsWithNegatives, [
                        getDiagnostic(5, `${rootDir}/lib/a/b/c.brs`) //keep
                    ]).map(x => x.code)
                ).to.eql([5]);
            });
        });
    });
    describe('standardizeDiagnosticFilters', () => {
        it('handles null and falsey diagnostic filters', () => {
            expect(
                filterer.getDiagnosticFilters({
                    diagnosticFilters: <any>[null, undefined, false, true]
                })
            ).to.eql([]);
        });

        it('handles a completely empty diagnostic filter', () => {
            expect(
                filterer.getDiagnosticFilters({
                    diagnosticFilters: <any>[{}]
                })
            ).to.eql([]);
        });

        it('handles number diagnostic filters', () => {
            expect(
                filterer.getDiagnosticFilters({
                    diagnosticFilters: [1, 2, 3]
                })
            ).to.eql([
                { codes: [1], isNegative: false },
                { codes: [2], isNegative: false },
                { codes: [3], isNegative: false }
            ]);
        });

        it('handles standard diagnostic filters', () => {
            expect(
                filterer.getDiagnosticFilters({
                    diagnosticFilters: [{ files: 'file.brs', codes: [1, 2, 'X3'] }]
                })
            ).to.eql([{ src: 'file.brs', codes: [1, 2, 'X3'], isNegative: false }]);
        });

        it('handles string-only diagnostic filter object', () => {
            expect(
                filterer.getDiagnosticFilters({
                    diagnosticFilters: [{ files: 'file.brs' }]
                })
            ).to.eql([{ src: 'file.brs', isNegative: false }]);
        });

        it('handles code-only diagnostic filter object', () => {
            expect(filterer.getDiagnosticFilters({
                diagnosticFilters: [{ codes: [1, 2, 'X3'] }]
            })).to.eql([
                { codes: [1, 2, 'X3'], isNegative: false }
            ]);
        });

        it('handles string diagnostic filter', () => {
            expect(
                filterer.getDiagnosticFilters({
                    diagnosticFilters: ['cannot-find-name']
                })
            ).to.eql([{ codes: ['cannot-find-name'], isNegative: false }]);
        });

        it('converts ignoreErrorCodes to diagnosticFilters', () => {
            expect(filterer.getDiagnosticFilters({
                ignoreErrorCodes: [1, 2, 'X3']
            })).to.eql([
                { codes: [1, 2, 'X3'], isNegative: false }
            ]);
        });

        it('handles negative globs in objects', () => {
            expect(filterer.getDiagnosticFilters({
                diagnosticFilters: [
                    {
                        files: '!file.brs'
                    }
                ]
            })).to.eql([
                { src: 'file.brs', isNegative: true }
            ]);
        });

        it('handles negative globs with codes', () => {
            expect(filterer.getDiagnosticFilters({
                diagnosticFilters: [
                    {
                        files: '!file.brs',
                        codes: [1, 2, 3]
                    }
                ]
            })).to.eql([
                { src: 'file.brs', codes: [1, 2, 3], isNegative: true }
            ]);
        });
    });

    describe('filtering by dest', () => {
        it('will filter by a files destPath', () => {
            const program = new Program({ rootDir: rootDir });
            program.setFile('source/common.brs', '');
            program.setFile({ src: `${rootDir}/source/utils.brs`, dest: `source/remove/utils.brs` }, '');
            program.setFile({ src: `${rootDir}/components/utils.brs`, dest: `source/remove/utils2.brs` }, '');

            const resultDiagnostics = filterer.filter({
                rootDir: rootDir,
                diagnosticFilters: [
                    {
                        files: [
                            { dest: 'source/remove/**/*.*' }
                        ],
                        codes: ['diagCode']
                    }
                ]
            }, [
                getDiagnostic('diagCode', `${rootDir}/source/common.brs`), //keep
                getDiagnostic('diagCode', `${rootDir}/source/utils.brs`, `${rootDir}/source/remove/utils.brs`), //remove
                getDiagnostic('diagCode', `${rootDir}/components/utils.brs`, `${rootDir}/source/remove/utils2.brs`) //remove
            ], program);
            expect(resultDiagnostics.map(x => x.code)).to.eql(['diagCode']);
            expect(resultDiagnostics.map(x => x.location.uri)).to.eql([util.pathToUri(s`${rootDir}/source/common.brs`)]);
        });

        it('respects order of ignores with negative globs', () => {
            const resultDiagnostics = filterer.filter({
                rootDir: rootDir,
                diagnosticFilters: [{
                    files: [
                        { dest: 'source/**/*.*' } //ignore diagCode in files with destPath in /source/remove
                    ],
                    codes: ['diagCode']
                }, {
                    files: '!**/*.*', //unignore diagCode everywhere
                    codes: ['diagCode']
                }
                ]
            }, [
                getDiagnostic('diagCode', `${rootDir}/source/common.brs`), //keep
                getDiagnostic('diagCode', `${rootDir}/source/utils.brs`, `${rootDir}/source/remove/utils.brs`), //remove
                getDiagnostic('diagCode', `${rootDir}/components/utils.brs`, `${rootDir}/source/remove/utils2.brs`) //remove
            ]);
            expect(resultDiagnostics.map(x => x.code)).to.eql(['diagCode', 'diagCode', 'diagCode']);
        });
    });

    it('only filters by file once per unique file (case-insensitive)', () => {
        const stub = sinon.stub(filterer as any, 'filterFile').returns(null);
        filterer.filter(options, [
            getDiagnostic(1, s`${rootDir}/source/common1.brs`),
            getDiagnostic(2, s`${rootDir}/source/Common1.brs`),
            getDiagnostic(3, s`${rootDir}/source/common2.brs`),
            getDiagnostic(4, s`${rootDir}/source/Common2.brs`)
        ]);
        const expectedCallCount = options.diagnosticFilters.reduce((acc, filter) => {
            if (typeof filter === 'object' && 'files' in (filter as any)) {
                return acc;
            }
            return acc + 1;
        }, 0);
        expect(stub.callCount).to.eql(expectedCallCount * 2); // 2 times for 'codename', 2 times for { codes: [1, 2, 3, 'X4'] }
        expect(stub.getCalls().map(x => x.args[1].toLowerCase())).to.eql([
            util.pathToUri(s`${rootDir.toLowerCase()}/source/common1.brs`).toLowerCase(),
            util.pathToUri(s`${rootDir.toLowerCase()}/source/common2.brs`).toLowerCase(),
            util.pathToUri(s`${rootDir.toLowerCase()}/source/common1.brs`).toLowerCase(),
            util.pathToUri(s`${rootDir.toLowerCase()}/source/common2.brs`).toLowerCase()
        ]);
    });

});

function getDiagnostic(code: number | string, srcPath: string, destPath?: string) {
    destPath = destPath ?? srcPath;
    return {
        location: {
            uri: util.pathToUri(s`${srcPath}`)
        },
        code: code
    } as BsDiagnostic;
}
