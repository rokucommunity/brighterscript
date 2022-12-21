import { expect } from '../../chai-config.spec';
import { Program } from '../../Program';
import { util } from '../../util';
import { createSandbox } from 'sinon';
import { rootDir } from '../../testHelpers.spec';
let sinon = createSandbox();

const fence = (code: string) => util.mdFence(code, 'brightscript');

describe('HoverProcessor', () => {
    let program: Program;
    beforeEach(() => {
        program = new Program({ rootDir: rootDir, sourceMap: true });
    });
    afterEach(() => {
        sinon.restore();
        program.dispose();
    });

    it('does not short-circuit the event since our plugin is the base plugin', () => {
        const mock = sinon.mock();
        program.plugins.add({
            name: 'test-plugin',
            provideHover: mock
        });
        const file = program.setFile('source/main.brs', `
            sub main()
            end sub
        `);
        //get the hover
        program.getHover(file.srcPath, util.createPosition(1, 20));
        //the onGetHover function from `test-plugin` should always get called because
        //BscPlugin should never short-circuit the event
        expect(mock.called).to.be.true;
    });

    describe('BrsFile', () => {
        it('works for param types', () => {
            const file = program.setFile('source/main.brs', `
                sub DoSomething(name as string)
                    name = 1
                    sayMyName = function(name as string)
                    end function
                end sub
            `);

            //hover over the `name = 1` line
            let hover = program.getHover(file.srcPath, util.createPosition(2, 24))[0];
            expect(hover).to.exist;
            expect(hover.range).to.eql(util.createRange(2, 20, 2, 24));

            //hover over the `name` parameter declaration
            hover = program.getHover(file.srcPath, util.createPosition(1, 34))[0];
            expect(hover).to.exist;
            expect(hover.range).to.eql(util.createRange(1, 32, 1, 36));
        });

        //ignore this for now...it's not a huge deal
        it('does not match on keywords or data types', () => {
            let file = program.setFile('source/main.brs', `
                sub Main(name as string)
                end sub
                sub as()
                end sub
            `);
            //hover over the `as`
            expect(program.getHover(file.srcPath, util.createPosition(1, 31))).to.be.empty;
            //hover over the `string`
            expect(program.getHover(file.srcPath, util.createPosition(1, 36))).to.be.empty;
        });

        it('finds declared function', () => {
            let file = program.setFile('source/main.brs', `
                function Main(count = 1)
                    firstName = "bob"
                    age = 21
                    shoeSize = 10
                end function
            `);

            let hover = program.getHover(file.srcPath, util.createPosition(1, 28))[0];
            expect(hover).to.exist;

            expect(hover.range).to.eql(util.createRange(1, 25, 1, 29));
            expect(hover.contents).to.eql(fence('function Main(count? as dynamic) as dynamic'));
        });

        it('finds variable function hover in same scope', () => {
            let file = program.setFile('source/main.brs', `
                sub Main()
                    sayMyName = sub(name as string)
                    end sub

                    sayMyName()
                end sub
            `);

            let hover = program.getHover(file.srcPath, util.createPosition(5, 24))[0];

            expect(hover.range).to.eql(util.createRange(5, 20, 5, 29));
            expect(hover.contents).to.eql(fence('sub sayMyName(name as string) as void'));
        });

        it('finds function hover in file scope', () => {
            let file = program.setFile('source/main.brs', `
                sub Main()
                    sayMyName()
                end sub

                sub sayMyName()

                end sub
            `);

            let hover = program.getHover(file.srcPath, util.createPosition(2, 25))[0];

            expect(hover.range).to.eql(util.createRange(2, 20, 2, 29));
            expect(hover.contents).to.eql(fence('sub sayMyName() as void'));
        });

        it('finds function hover in scope', () => {
            let rootDir = process.cwd();
            program = new Program({
                rootDir: rootDir
            });

            let mainFile = program.setFile('source/main.brs', `
                sub Main()
                    sayMyName()
                end sub
            `);

            program.setFile('source/lib.brs', `
                sub sayMyName(name as string)

                end sub
            `);
            program.validate();

            let hover = program.getHover(mainFile.srcPath, util.createPosition(2, 25))[0];
            expect(hover?.range).to.eql(util.createRange(2, 20, 2, 29));
            expect(hover?.contents).to.eql(fence('sub sayMyName(name as string) as void'));
        });

        it('finds top-level constant value', () => {
            program.setFile('source/main.bs', `
                sub main()
                    print SOME_VALUE
                end sub
                const SOME_VALUE = true
            `);
            program.validate();
            // print SOM|E_VALUE
            let hover = program.getHover('source/main.bs', util.createPosition(2, 29))[0];
            expect(hover?.range).to.eql(util.createRange(2, 26, 2, 36));
            expect(hover?.contents).to.eql(fence('const SOME_VALUE = true'));
        });

        it('finds top-level constant in assignment expression', () => {
            program.setFile('source/main.bs', `
                sub main()
                    value = ""
                    value += SOME_VALUE
                end sub
                const SOME_VALUE = "value"
            `);
            program.validate();
            // value += SOME|_VALUE
            let hover = program.getHover('source/main.bs', util.createPosition(3, 33))[0];
            expect(hover?.range).to.eql(util.createRange(3, 29, 3, 39));
            expect(hover?.contents).to.eql(fence('const SOME_VALUE = "value"'));
        });

        it('finds namespaced constant in assignment expression', () => {
            program.setFile('source/main.bs', `
                sub main()
                    value = ""
                    value += someNamespace.SOME_VALUE
                end sub
                namespace someNamespace
                    const SOME_VALUE = "value"
                end namespace
            `);
            program.validate();
            // value += SOME|_VALUE
            let hover = program.getHover('source/main.bs', util.createPosition(3, 47))[0];
            expect(hover?.range).to.eql(util.createRange(3, 43, 3, 53));
            expect(hover?.contents).to.eql(fence('const someNamespace.SOME_VALUE = "value"'));
        });

        it('finds namespaced constant value', () => {
            program.setFile('source/main.bs', `
                sub main()
                    print name.SOME_VALUE
                end sub
                namespace name
                    const SOME_VALUE = true
                end namespace
            `);
            program.validate();
            // print name.SOM|E_VALUE
            let hover = program.getHover('source/main.bs', util.createPosition(2, 34))[0];
            expect(hover?.range).to.eql(util.createRange(2, 31, 2, 41));
            expect(hover?.contents).to.eql(fence('const name.SOME_VALUE = true'));
        });

        it('finds deep namespaced constant value', () => {
            program.setFile('source/main.bs', `
                sub main()
                    print name.sp.a.c.e.SOME_VALUE
                end sub
                namespace name.sp.a.c.e
                    const SOME_VALUE = true
                end namespace
            `);
            program.validate();
            // print name.sp.a.c.e.SOM|E_VALUE
            let hover = program.getHover('source/main.bs', util.createPosition(2, 43))[0];
            expect(hover?.range).to.eql(util.createRange(2, 40, 2, 50));
            expect(hover?.contents).to.eql(fence('const name.sp.a.c.e.SOME_VALUE = true'));
        });
    });
});
