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
            expect(hover.contents).to.eql(fence('function Main(count? as integer) as dynamic'));
        });

        it('finds variable function hover in same scope', () => {
            let file = program.setFile('source/main.brs', `
                sub Main()
                    sayMyName = sub(name as string)
                    end sub

                    sayMyName()
                end sub
            `);
            program.validate();
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

        it('finds namespaced class types', () => {
            program.setFile('source/main.bs', `
                sub main()
                    myKlass = new name.Klass()
                    runNoop(myKlass)
                end sub

                sub runNoop(myKlass as name.Klass)
                    myKlass.noop()
                end sub

                namespace name
                    class Klass
                        sub noop()
                        end sub
                    end class
                end namespace
            `);
            program.validate();
            // run|Noop(myKlass)
            let hover = program.getHover('source/main.bs', util.createPosition(3, 24))[0];
            expect(hover?.range).to.eql(util.createRange(3, 20, 3, 27));
            expect(hover?.contents).to.eql(fence('sub runNoop(myKlass as name.Klass) as void'));
            // myKl|ass.noop()
            hover = program.getHover('source/main.bs', util.createPosition(7, 25))[0];
            expect(hover?.range).to.eql(util.createRange(7, 20, 7, 27));
            expect(hover?.contents).to.eql(fence('myKlass as name.Klass'));
            //  sub no|op()
            hover = program.getHover('source/main.bs', util.createPosition(12, 31))[0];
            // Unfortunately, we can't get hover details on class members yet
            // TODO: Add hover ability on class members
            expect(hover).to.be.undefined;
        });

        it('finds types properly', () => {
            program.setFile('source/main.bs', `
                class Person
                end class

                sub doWork(age as integer, name as string, guy as Person)
                end sub
            `);
            program.validate();
            // a|ge as integer
            let hover = program.getHover('source/main.bs', util.createPosition(4, 29))[0];
            expect(hover?.range).to.eql(util.createRange(4, 27, 4, 30));
            expect(hover?.contents).to.eql(fence('age as integer'));
            // age as int|eger
            hover = program.getHover('source/main.bs', util.createPosition(4, 39))[0];
            // no hover on base types
            expect(hover).to.be.undefined;
            // n|ame as string
            hover = program.getHover('source/main.bs', util.createPosition(4, 46))[0];
            expect(hover?.range).to.eql(util.createRange(4, 43, 4, 47));
            expect(hover?.contents).to.eql(fence('name as string'));
            // name as st|ring
            hover = program.getHover('source/main.bs', util.createPosition(4, 54))[0];
            // no hover on base types
            expect(hover).to.be.undefined;
            // gu|y as Person
            hover = program.getHover('source/main.bs', util.createPosition(4, 60))[0];
            expect(hover?.range).to.eql(util.createRange(4, 59, 4, 62));
            expect(hover?.contents).to.eql(fence('guy as Person'));
            // guy as Pe|rson
            hover = program.getHover('source/main.bs', util.createPosition(4, 69))[0];
            //TODO: Add hover on custom types (classes, interfaces, enums, etc.)
            expect(hover).to.be.undefined;
        });


    });

    describe('BrsFile - enableTypeValidation', () => {
        beforeEach(() => {
            program.options.enableTypeValidation = true;
        });

        it('finds types from assignments defined in different file', () => {
            program.setFile(`source/main.bs`, `
                sub main()
                    thing = new MyKlass()
                    useKlass(thing)
                    someVal = getValue()
                    print someVal
                end sub

                sub useKlass(thing as MyKlass)
                    print thing
                end sub
            `);
            program.setFile(`source/MyKlass.bs`, `
                class MyKlass
                end class
            `);

            program.setFile(`source/util.bs`, `
                function getValue() as string
                    return "hello"
                end function
            `);
            program.validate();
            //th|ing = new MyKlass()
            let hover = program.getHover('source/main.bs', util.createPosition(2, 24))[0];
            expect(hover?.range).to.eql(util.createRange(2, 20, 2, 25));
            expect(hover?.contents).to.eql([fence('thing as MyKlass')]);
            //print some|Val
            hover = program.getHover('source/main.bs', util.createPosition(5, 31))[0];
            expect(hover?.range).to.eql(util.createRange(5, 26, 5, 33));
            expect(hover?.contents).to.eql([fence('someVal as string')]);
        });

        it('works for param types', () => {
            const file = program.setFile('source/main.brs', `
                sub DoSomething(name as string)
                    name = 1
                    sayMyName = function(name as string)
                    end function
                end sub
            `);
            program.validate();
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
            program.validate();
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
            program.validate();

            let hover = program.getHover(file.srcPath, util.createPosition(1, 28))[0];
            expect(hover).to.exist;

            expect(hover.range).to.eql(util.createRange(1, 25, 1, 29));
            expect(hover.contents).to.eql([fence('function Main(count? as integer) as dynamic')]);
        });

        it('finds variable function hover in same scope', () => {
            let file = program.setFile('source/main.brs', `
                sub Main()
                    sayMyName = sub(name as string)
                    end sub

                    sayMyName()
                end sub
            `);
            program.validate();
            let hover = program.getHover(file.srcPath, util.createPosition(5, 24))[0];

            expect(hover.range).to.eql(util.createRange(5, 20, 5, 29));
            expect(hover.contents).to.eql([fence('sub sayMyName(name as string) as void')]);
        });

        it('finds function hover in file scope', () => {
            let file = program.setFile('source/main.brs', `
                sub Main()
                    sayMyName()
                end sub

                sub sayMyName()

                end sub
            `);
            program.validate();
            let hover = program.getHover(file.srcPath, util.createPosition(2, 25))[0];

            expect(hover.range).to.eql(util.createRange(2, 20, 2, 29));
            expect(hover.contents).to.eql([fence('sub sayMyName() as void')]);
        });

        it('finds function hover in scope', () => {
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
            expect(hover?.contents).to.eql([fence('sub sayMyName(name as string) as void')]);
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
            expect(hover?.contents).to.eql([fence('const SOME_VALUE = true')]);
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
            expect(hover?.contents).to.eql([fence('const SOME_VALUE = "value"')]);
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
            expect(hover?.contents).to.eql([fence('const someNamespace.SOME_VALUE = "value"')]);
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
            expect(hover?.contents).to.eql([fence('const name.SOME_VALUE = true')]);
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
            expect(hover?.contents).to.eql([fence('const name.sp.a.c.e.SOME_VALUE = true')]);
        });

        it('finds namespaced class types', () => {
            program.setFile('source/main.bs', `
                sub main()
                    myKlass = new name.Klass()
                    runNoop(myKlass)
                end sub

                sub runNoop(myKlass as name.Klass)
                    myKlass.noop()
                end sub

                namespace name
                    class Klass
                        sub noop()
                        end sub
                    end class
                end namespace
            `);
            program.validate();
            // run|Noop(myKlass)
            let hover = program.getHover('source/main.bs', util.createPosition(3, 24))[0];
            expect(hover?.range).to.eql(util.createRange(3, 20, 3, 27));
            expect(hover?.contents).to.eql([fence('sub runNoop(myKlass as name.Klass) as void')]);
            // myKl|ass.noop()
            hover = program.getHover('source/main.bs', util.createPosition(7, 25))[0];
            expect(hover?.range).to.eql(util.createRange(7, 20, 7, 27));
            expect(hover?.contents).to.eql([fence('myKlass as name.Klass')]);
            //  sub no|op()
            hover = program.getHover('source/main.bs', util.createPosition(12, 31))[0];
            expect(hover?.contents).to.eql([fence('sub name.Klass.noop() as void')]);
        });

        it('finds types properly', () => {
            program.setFile('source/main.bs', `
                class Person
                end class

                sub doWork(age as integer, name as string, guy as Person)
                end sub
            `);
            program.validate();
            // a|ge as integer
            let hover = program.getHover('source/main.bs', util.createPosition(4, 29))[0];
            expect(hover?.range).to.eql(util.createRange(4, 27, 4, 30));
            expect(hover?.contents).to.eql([fence('age as integer')]);
            // age as int|eger
            hover = program.getHover('source/main.bs', util.createPosition(4, 39))[0];
            // no hover on base types
            expect(hover).to.be.undefined;
            // n|ame as string
            hover = program.getHover('source/main.bs', util.createPosition(4, 46))[0];
            expect(hover?.range).to.eql(util.createRange(4, 43, 4, 47));
            expect(hover?.contents).to.eql([fence('name as string')]);
            // name as st|ring
            hover = program.getHover('source/main.bs', util.createPosition(4, 54))[0];
            // no hover on base types
            expect(hover).to.be.undefined;
            // gu|y as Person
            hover = program.getHover('source/main.bs', util.createPosition(4, 60))[0];
            expect(hover?.range).to.eql(util.createRange(4, 59, 4, 62));
            expect(hover?.contents).to.eql([fence('guy as Person')]);
            // guy as Pe|rson
            hover = program.getHover('source/main.bs', util.createPosition(4, 69))[0];
            expect(hover?.contents).to.eql([fence('class Person')]);
        });

        it('finds types from assignments defined in different file', () => {
            program.setFile(`source/main.bs`, `
                sub main()
                    thing = new MyKlass()
                    useKlass(thing)
                    someVal = getValue()
                    print someVal
                end sub

                sub useKlass(thing as MyKlass)
                    print thing
                    print thing.myNumber
                end sub
            `);
            program.setFile(`source/MyKlass.bs`, `
                class MyKlass
                    myNumber as integer
                end class
            `);

            program.setFile(`source/util.bs`, `
                function getValue() as string
                    return "hello"
                end function
            `);
            program.validate();
            let hover = program.getHover('source/main.bs', util.createPosition(2, 24))[0];
            expect(hover?.range).to.eql(util.createRange(2, 20, 2, 25));
            expect(hover?.contents).to.eql([fence('thing as MyKlass')]);
            //thing = new MyK|lass()
            hover = program.getHover('source/main.bs', util.createPosition(2, 35))[0];
            expect(hover?.range).to.eql(util.createRange(2, 32, 2, 39));
            expect(hover?.contents).to.eql([fence('class MyKlass')]);
            //print some|Val
            hover = program.getHover('source/main.bs', util.createPosition(5, 31))[0];
            expect(hover?.range).to.eql(util.createRange(5, 26, 5, 33));
            expect(hover?.contents).to.eql([fence('someVal as string')]);
            //print thi|ng
            hover = program.getHover('source/main.bs', util.createPosition(9, 29))[0];
            expect(hover?.range).to.eql(util.createRange(9, 26, 9, 31));
            expect(hover?.contents).to.eql([fence('thing as MyKlass')]);
            //print thing.myI|nteger
            hover = program.getHover('source/main.bs', util.createPosition(10, 34))[0];
            expect(hover?.range).to.eql(util.createRange(10, 32, 10, 40));
            expect(hover?.contents).to.eql([fence('MyKlass.myNumber as integer')]);
        });

        it('hovers of functions include comments', () => {
            program.setFile(`source/main.bs`, `
                sub main()
                    thing = new MyKlass()
                    useKlass(thing)
                end sub

                ' Prints a MyKlass.name
                sub useKlass(thing as MyKlass)
                    print thing.getName()
                end sub

                ' A sample class
                class MyKlass
                    name as string

                    ' Gets the name of this thing
                    function getName() as string
                        return m.name
                    end function

                    ' Wraps another function
                    function getNameWrap() as string
                        return m.getName()
                    end function
                end class
            `);
            program.validate();
            let commentSep = `\n***\n`;
            //th|ing = new MyKlass()
            let hover = program.getHover('source/main.bs', util.createPosition(2, 24))[0];
            expect(hover?.contents).to.eql([fence('thing as MyKlass')]);
            //use|Klass(thing)
            hover = program.getHover('source/main.bs', util.createPosition(3, 24))[0];
            expect(hover?.contents).to.eql([`${fence('sub useKlass(thing as MyKlass) as void')}${commentSep} Prints a MyKlass.name`]);
            //print thing.getN|ame()
            hover = program.getHover('source/main.bs', util.createPosition(8, 37))[0];
            // TODO: Add comments for class methods/properties
            expect(hover?.contents).to.eql([`${fence('function MyKlass.getName() as string')}`]);
        });
    });
});