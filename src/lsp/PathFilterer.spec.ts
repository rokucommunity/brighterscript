import { PathFilterer } from './PathFilterer';
import { rootDir } from '../testHelpers.spec';
import { expect } from 'chai';
import { standardizePath as s } from '../util';

describe('PathFilterer', () => {
    let filterer: PathFilterer;

    beforeEach(() => {
        filterer = new PathFilterer();
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

});
