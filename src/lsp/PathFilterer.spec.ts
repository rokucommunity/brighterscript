import { PathCollection, PathFilterer } from './PathFilterer';
import { cwd, rootDir } from '../testHelpers.spec';
import { expect } from 'chai';
import { standardizePath as s } from '../util';
import { createSandbox } from 'sinon';
const sinon = createSandbox();

describe('PathFilterer', () => {
    let filterer: PathFilterer;

    beforeEach(() => {
        filterer = new PathFilterer();
        sinon.restore();
    });
    afterEach(() => {
        sinon.restore();
    });

    it('allows all files through when no filters exist', () => {
        expect(
            filterer.filter([
                s`${rootDir}/a.brs`,
                s`${rootDir}/a/b/c/d.xml`,
                s`${rootDir}/e.txt`
            ])
        ).to.eql([
            s`${rootDir}/a.brs`,
            s`${rootDir}/a/b/c/d.xml`,
            s`${rootDir}/e.txt`
        ]);
    });

    it('supports standalone workspace style', () => {
        const filterer = new PathCollection({
            rootDir: s`${cwd}/src/lsp/standalone-project-1`,
            globs: [s`${cwd}/.tmp/rootDir/source/main.bs`]
        });
        expect(
            filterer.isMatch(`${cwd}/.tmp/rootDir/source/main.bs`)
        ).to.be.true;
    });

    it('filters files', () => {
        filterer.registerExcludeList(rootDir, ['**/*.brs']);
        expect(
            filterer.filter([
                s`${rootDir}/a.brs`,
                s`${rootDir}/b.txt`,
                s`${rootDir}/c.brs`
            ])
        ).to.eql([
            s`${rootDir}/b.txt`
        ]);
    });

    it('filters files but re-includes them if part of an include list', () => {
        filterer.registerExcludeList(rootDir, ['**/*.brs']);
        filterer.registerIncludeList(rootDir, ['**/a*.brs']);
        expect(
            filterer.filter([
                s`${rootDir}/a.brs`,
                s`${rootDir}/b.txt`,
                s`${rootDir}/c.brs`
            ])
        ).to.eql([
            s`${rootDir}/a.brs`,
            s`${rootDir}/b.txt`
        ]);
    });

    it('supports removing lists', () => {
        const removeExclude = filterer.registerExcludeList(rootDir, ['**/*.brs']);
        const removeInclude = filterer.registerIncludeList(rootDir, ['**/a*.brs']);
        expect(
            filterer.filter([
                s`${rootDir}/a.brs`,
                s`${rootDir}/b.txt`,
                s`${rootDir}/c.brs`
            ])
        ).to.eql([
            s`${rootDir}/a.brs`,
            s`${rootDir}/b.txt`
        ]);

        removeInclude();

        expect(
            filterer.filter([
                s`${rootDir}/a.brs`,
                s`${rootDir}/b.txt`,
                s`${rootDir}/c.brs`
            ])
        ).to.eql([
            s`${rootDir}/b.txt`
        ]);

        removeExclude();

        expect(
            filterer.filter([
                s`${rootDir}/a.brs`,
                s`${rootDir}/b.txt`,
                s`${rootDir}/c.brs`
            ])
        ).to.eql([
            s`${rootDir}/a.brs`,
            s`${rootDir}/b.txt`,
            s`${rootDir}/c.brs`
        ]);
    });

    it('clear removes all exclude and include lists', () => {
        filterer.registerExcludeList(rootDir, ['**/components/**/*.brs']);
        expect(
            filterer.filter([
                s`${rootDir}/components/a.brs`,
                s`${rootDir}/components/b.brs`,
                s`${rootDir}/components/c.brs`
            ])
        ).to.eql([]);

        filterer.clear();

        expect(
            filterer.filter([
                s`${rootDir}/components/a.brs`,
                s`${rootDir}/components/b.brs`,
                s`${rootDir}/components/c.brs`
            ])
        ).to.eql([
            s`${rootDir}/components/a.brs`,
            s`${rootDir}/components/b.brs`,
            s`${rootDir}/components/c.brs`
        ]);
    });

    it('works with null exclude list', () => {
        filterer.registerExcludeList(rootDir, null);
        expect(
            filterer.filter([
                s`${rootDir}/components/a.brs`,
                s`${rootDir}/components/b.brs`,
                s`${rootDir}/components/c.brs`
            ])
        ).to.eql([
            s`${rootDir}/components/a.brs`,
            s`${rootDir}/components/b.brs`,
            s`${rootDir}/components/c.brs`
        ]);
    });

    it('works with null include list', () => {
        filterer.registerExcludeList(rootDir, ['**/*']);
        filterer.registerIncludeList(rootDir, null);
        expect(
            filterer.filter([
                s`${rootDir}/components/a.brs`,
                s`${rootDir}/components/b.brs`,
                s`${rootDir}/components/c.brs`
            ])
        ).to.eql([]);
    });

    describe.only('registerExcludeMatcher', () => {
        it('calls the callback function on every path', () => {
            const spy = sinon.spy();
            filterer.registerExcludeMatcher(spy);
            filterer.filter([
                s`${rootDir}/a.brs`,
                s`${rootDir}/b.txt`,
                s`${rootDir}/c.brs`
            ]);
            expect(spy.getCalls().map(x => s`${x.args[0]}`)).to.eql([
                s`${rootDir}/a.brs`,
                s`${rootDir}/b.txt`,
                s`${rootDir}/c.brs`
            ]);
        });
    });
});
