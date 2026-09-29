import { expect } from '../../chai-config.spec';
import { Program } from '../../Program';
import { util } from '../../util';
import { expectZeroDiagnostics, rootDir } from '../../testHelpers.spec';

const fence = (code: string) => util.mdFence(code, 'brightscript');

describe('HoverProcessor generics', () => {
    let program: Program;
    beforeEach(() => {
        program = new Program({ rootDir: rootDir, sourceMap: true });
    });
    afterEach(() => {
        program.dispose();
    });

    it('shows type parameters, and inferred types at call sites', () => {
        program.setFile('source/main.bs', `
                function first<TItem>(items as TItem[]) as TItem
                    return items[0]
                end function

                sub main()
                    result = first([1, 2])
                end sub
        `);
        program.validate();
        expectZeroDiagnostics(program);

        //function first<TI|tem>(items as TItem[]) as TItem
        let hover = program.getHover('source/main.bs', util.createPosition(1, 33))[0];
        expect(hover?.contents).to.eql([fence('TItem')]);

        //function first<TItem>(items as TI|tem[]) as TItem
        hover = program.getHover('source/main.bs', util.createPosition(1, 49))[0];
        expect(hover?.contents).to.eql([fence('TItem')]);

        //function first<TItem>(items as TItem[]) as TI|tem
        hover = program.getHover('source/main.bs', util.createPosition(1, 61))[0];
        expect(hover?.contents).to.eql([fence('TItem')]);

        //function fi|rst<TItem>(items as TItem[]) as TItem
        hover = program.getHover('source/main.bs', util.createPosition(1, 27))[0];
        expect(hover?.contents).to.eql([fence('function first<TItem>(items as Array<TItem>) as TItem')]);

        //res|ult = first([1, 2])
        hover = program.getHover('source/main.bs', util.createPosition(6, 23))[0];
        expect(hover?.contents).to.eql([fence('result as integer')]);
    });

    it('shows constraints and instantiated class types', () => {
        program.setFile('source/main.bs', `
                class Animal
                end class

                class Crate<TItem extends Animal>
                    value as TItem
                end class

                sub main()
                    thing = new Crate<Animal>()
                    print thing.value
                end sub
        `);
        program.validate();
        expectZeroDiagnostics(program);

        //class Crate<TI|tem extends Animal>
        let hover = program.getHover('source/main.bs', util.createPosition(4, 30))[0];
        expect(hover?.contents).to.eql([fence('TItem extends Animal')]);

        //thi|ng = new Crate<Animal>()
        hover = program.getHover('source/main.bs', util.createPosition(9, 23))[0];
        expect(hover?.contents).to.eql([fence('thing as Crate<Animal>')]);

        //thing = new Cr|ate<Animal>()
        hover = program.getHover('source/main.bs', util.createPosition(9, 34))[0];
        expect(hover?.contents).to.eql([fence('class Crate<TItem extends Animal>')]);
    });
});
