import { expect } from './chai-config.spec';
import { DiagnosticFilterer } from './DiagnosticFilterer';
import type { BsDiagnostic } from './interfaces';
import util, { standardizePath as s } from './util';
import { createSandbox } from 'sinon';
const sinon = createSandbox();
let rootDir = s`${process.cwd()}/rootDir`;

describe.only('DiagnosticFilterer', () => {

    let filterer: DiagnosticFilterer;
    let options = util.normalizeConfig({
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
    });

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
            ).to.eql([{ codes: [1, 2, 3], isNegative: false }]);
        });

        it('handles standard diagnostic filters', () => {
            expect(
                filterer.getDiagnosticFilters({
                    diagnosticFilters: [{ src: 'file.brs', codes: [1, 2, 'X3'] }]
                })
            ).to.eql([{ src: 'file.brs', codes: [1, 2, 'X3'], isNegative: false }]);
        });

        it('handles string-only diagnostic filter object', () => {
            expect(
                filterer.getDiagnosticFilters({
                    diagnosticFilters: [{ src: 'file.brs' }]
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
                    diagnosticFilters: ['file.brs']
                })
            ).to.eql([{ src: 'file.brs', isNegative: false }]);
        });

        it('converts ignoreErrorCodes to diagnosticFilters', () => {
            expect(filterer.getDiagnosticFilters({
                ignoreErrorCodes: [1, 2, 'X3']
            })).to.eql([
                { codes: [1, 2, 'X3'], isNegative: false }
            ]);
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
        expect(stub.callCount).to.eql(2);
        expect(stub.getCalls().map(x => x.args[1])).to.eql([
            s`${rootDir.toLowerCase()}/source/common1.brs`,
            s`${rootDir.toLowerCase()}/source/common2.brs`
        ]);
    });

});

function getDiagnostic(code: number | string, srcPath: string) {
    return {
        file: {
            srcPath: s`${srcPath}`
        },
        code: code
    } as BsDiagnostic;
}
