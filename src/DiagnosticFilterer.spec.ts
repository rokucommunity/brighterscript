import { expect } from 'chai';
import { DiagnosticFilterer } from './DiagnosticFilterer';
import type { BsDiagnostic } from './interfaces';
import { standardizePath as s } from './util';
let rootDir = s`${process.cwd()}/rootDir`;

describe('DiagnosticFilterer', () => {
    let filterer: DiagnosticFilterer;
    let options = {
        rootDir: rootDir,
        diagnosticFilters: [
            //ignore these codes globally
            { codes: [1, 2, 3, 'X4'] },
            //ignore all codes from lib
            { src: 'lib/**/*.brs' },
            //ignore all codes from `packages` with absolute path
            { src: `${rootDir}/packages/**/*.brs` },
            //ignore specific codes for main.brs
            { src: 'source/main.brs', codes: [4] }
        ]
    };

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
            ).to.eql([{ codes: [1, 2, 3] }]);
        });

        it('handles standard diagnostic filters', () => {
            expect(
                filterer.getDiagnosticFilters({
                    diagnosticFilters: [{ src: 'file.brs', codes: [1, 2, 'X3'] }]
                })
            ).to.eql([{ src: 'file.brs', codes: [1, 2, 'X3'] }]);
        });

        it('handles string-only diagnostic filter object', () => {
            expect(
                filterer.getDiagnosticFilters({
                    diagnosticFilters: [{ src: 'file.brs' }]
                })
            ).to.eql([{ src: 'file.brs' }]);
        });

        it('handles code-only diagnostic filter object', () => {
            expect(filterer.getDiagnosticFilters({
                diagnosticFilters: [{ codes: [1, 2, 'X3'] }]
            })).to.eql([
                { codes: [1, 2, 'X3'] }
            ]);
        });

        it('handles string diagnostic filter', () => {
            expect(
                filterer.getDiagnosticFilters({
                    diagnosticFilters: ['file.brs']
                })
            ).to.eql([{ src: 'file.brs' }]);
        });

        it('converts ignoreErrorCodes to diagnosticFilters', () => {
            expect(filterer.getDiagnosticFilters({
                ignoreErrorCodes: [1, 2, 'X3']
            })).to.eql([
                { codes: [1, 2, 'X3'] }
            ]);
        });
    });

});

function getDiagnostic(code: number|string, pathAbsolute: string) {
    return {
        file: {
            pathAbsolute: s`${pathAbsolute}`
        },
        code: code
    } as BsDiagnostic;
}
