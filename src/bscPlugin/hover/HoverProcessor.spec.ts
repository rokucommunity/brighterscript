import { expect } from 'chai';
import { Program } from '../../Program';
import util, { standardizePath as s } from '../../util';
import { createSandbox } from 'sinon';
let sinon = createSandbox();

let rootDir = s`${process.cwd()}/.tmp/rootDir`;

describe('HoverProcessor', () => {
    let program: Program;
    beforeEach(() => {
        program = new Program({ rootDir: rootDir, sourceMap: true });
    });
    afterEach(() => {
        sinon.restore();
        program.dispose();
    });

    it('short-circuits the event', () => {
        const mock = sinon.mock();
        program.plugins.add({
            name: 'test-plugin',
            onGetHover: mock
        });
        const file = program.addOrReplaceFile('source/main.brs', `
            sub main()
            end sub
        `);
        //get the hover
        program.getHover(file.pathAbsolute, util.createPosition(1, 20));
        //the onGetHover function from `test-plugin` should never get called because
        //BscPlugin should have short-circuited the event
        expect(mock.called).to.be.false;
    });

    describe('BrsFile', () => {
        it('works for param types', () => {
            const file = program.addOrReplaceFile('source/main.brs', `
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
            let file = program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
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
            let file = program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                function Main(count = 1)
                    firstName = "bob"
                    age = 21
                    shoeSize = 10
                end function
            `);

            let hover = program.getHover(file.pathAbsolute, util.createPosition(1, 28));
            expect(hover).to.exist;

            expect(hover.range).to.eql(util.createRange(1, 25, 1, 29));
            expect(hover.contents).to.eql({
                language: 'brighterscript',
                value: 'function Main(count? as dynamic) as dynamic'
            });
        });

        it('finds variable function hover in same scope', () => {
            let file = program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub Main()
                    sayMyName = sub(name as string)
                    end sub

                    sayMyName()
                end sub
            `);

            let hover = program.getHover(file.pathAbsolute, util.createPosition(5, 24));

            expect(hover.range).to.eql(util.createRange(5, 20, 5, 29));
            expect(hover.contents).to.eql({
                language: 'brighterscript',
                value: 'sub sayMyName(name as string) as void'
            });
        });

        it('finds function hover in file scope', () => {
            let file = program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub Main()
                    sayMyName()
                end sub

                sub sayMyName()

                end sub
            `);

            let hover = program.getHover(file.pathAbsolute, util.createPosition(2, 25));

            expect(hover.range).to.eql(util.createRange(2, 20, 2, 29));
            expect(hover.contents).to.eql({
                language: 'brighterscript',
                value: 'sub sayMyName() as void'
            });
        });

        it('finds function hover in scope', () => {
            let rootDir = process.cwd();
            program = new Program({
                rootDir: rootDir
            });

            let mainFile = program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub Main()
                    sayMyName()
                end sub
            `);

            program.addOrReplaceFile({ src: `${rootDir}/source/lib.brs`, dest: 'source/lib.brs' }, `
                sub sayMyName(name as string)

                end sub
            `);

            let hover = program.getHover(mainFile.pathAbsolute, util.createPosition(2, 25));
            expect(hover).to.exist;

            expect(hover.range).to.eql(util.createRange(2, 20, 2, 29));
            expect(hover.contents).to.eql({
                language: 'brighterscript',
                value: 'sub sayMyName(name as string) as void'
            });
        });
    });
});
