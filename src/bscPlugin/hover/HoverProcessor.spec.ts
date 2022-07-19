import { expect } from 'chai';
import { Program } from '../../Program';
import util, { standardizePath as s } from '../../util';
import { createSandbox } from 'sinon';
let sinon = createSandbox();

let rootDir = s`${process.cwd()}/.tmp/rootDir`;
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
        program.getHover(file.pathAbsolute, util.createPosition(1, 20));
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
            let hover = program.getHover(file.pathAbsolute, util.createPosition(2, 24));
            expect(hover).to.exist;
            expect(hover.range).to.eql(util.createRange(2, 20, 2, 24));

            //hover over the `name` parameter declaration
            hover = program.getHover(file.pathAbsolute, util.createPosition(1, 34));
            expect(hover).to.exist;
            expect(hover.range).to.eql(util.createRange(1, 32, 1, 36));
        });

        //ignore this for now...it's not a huge deal
        it('does not match on keywords or data types', () => {
            let file = program.setFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub Main(name as string)
                end sub
                sub as()
                end sub
            `);
            //hover over the `as`
            expect(program.getHover(file.pathAbsolute, util.createPosition(1, 31))).not.to.exist;
            //hover over the `string`
            expect(program.getHover(file.pathAbsolute, util.createPosition(1, 36))).not.to.exist;
        });

        it('finds declared function', () => {
            let file = program.setFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                function Main(count = 1)
                    firstName = "bob"
                    age = 21
                    shoeSize = 10
                end function
            `);

            let hover = program.getHover(file.pathAbsolute, util.createPosition(1, 28));
            expect(hover).to.exist;

            expect(hover.range).to.eql(util.createRange(1, 25, 1, 29));
            expect(hover.contents).to.eql(fence('function Main(count? as dynamic) as dynamic'));
        });

        it('finds variable function hover in same scope', () => {
            let file = program.setFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub Main()
                    sayMyName = sub(name as string)
                    end sub

                    sayMyName()
                end sub
            `);

            let hover = program.getHover(file.pathAbsolute, util.createPosition(5, 24));

            expect(hover.range).to.eql(util.createRange(5, 20, 5, 29));
            expect(hover.contents).to.eql(fence('sub sayMyName(name as string) as void'));
        });

        it('finds function hover in file scope', () => {
            let file = program.setFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub Main()
                    sayMyName()
                end sub

                sub sayMyName()

                end sub
            `);

            let hover = program.getHover(file.pathAbsolute, util.createPosition(2, 25));

            expect(hover.range).to.eql(util.createRange(2, 20, 2, 29));
            expect(hover.contents).to.eql(fence('sub sayMyName() as void'));
        });

        it('finds function hover in scope', () => {
            let rootDir = process.cwd();
            program = new Program({
                rootDir: rootDir
            });

            let mainFile = program.setFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub Main()
                    sayMyName()
                end sub
            `);

            program.setFile({ src: `${rootDir}/source/lib.brs`, dest: 'source/lib.brs' }, `
                sub sayMyName(name as string)

                end sub
            `);

            let hover = program.getHover(mainFile.pathAbsolute, util.createPosition(2, 25));
            expect(hover).to.exist;

            expect(hover.range).to.eql(util.createRange(2, 20, 2, 29));
            expect(hover.contents).to.eql(fence('sub sayMyName(name as string) as void'));
        });
    });
});
