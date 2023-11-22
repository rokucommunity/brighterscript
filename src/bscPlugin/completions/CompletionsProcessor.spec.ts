import { expect } from '../../chai-config.spec';
import { Program } from '../../Program';
import util, { standardizePath as s } from '../../util';
import { CompletionItemKind, Position, Range } from 'vscode-languageserver';
import { createSandbox } from 'sinon';
import { expectCompletionsExcludes, expectCompletionsIncludes, tempDir, rootDir, stagingDir, trim, expectZeroDiagnostics } from '../../testHelpers.spec';
import { XmlFile } from '../../files/XmlFile';
import { Keywords } from '../../lexer/TokenKind';
import { CompletionsProcessor } from './CompletionsProcessor';
import * as pick from 'object.pick';
import { BrsFile } from '../../files/BrsFile';
import type { FileObj } from '../../interfaces';
import * as fsExtra from 'fs-extra';

describe('CompletionsProcessor', () => {
    let program: Program;
    let sinon = createSandbox();

    beforeEach(() => {
        fsExtra.emptyDirSync(tempDir);
        fsExtra.ensureDirSync(rootDir);
        fsExtra.ensureDirSync(stagingDir);
        program = new Program({ rootDir: rootDir });
    });
    afterEach(() => {
        sinon.restore();
        program.dispose();
    });

    describe('getCompletions - Program.spec', () => {
        it('includes `for each` variable', () => {
            program.setFile('source/main.brs', `
                sub main()
                    items = [1, 2, 3]
                    for each thing in items
                        t =
                    end for
                end sub
            `);
            program.validate();
            let completions = program.getCompletions(`${rootDir}/source/main.brs`, Position.create(4, 28)).map(x => x.label);
            expect(completions).to.include('thing');
        });

        it('includes `for` variable', () => {
            program.setFile('source/main.brs', `
                sub main()
                    for i = 0 to 10
                        t =
                    end for
                end sub
            `);
            program.validate();
            let completions = program.getCompletions(`${rootDir}/source/main.brs`, Position.create(3, 28)).map(x => x.label);
            expect(completions).to.include('i');
        });

        it('should include first-level namespace names for brighterscript files', () => {
            program.setFile('source/main.bs', `
                namespace NameA.NameB.NameC
                    sub DoSomething()
                    end sub
                end namespace
                sub main()
                    print
                end sub
            `);
            program.validate();
            // print |
            const completions = program.getCompletions(`${rootDir}/source/main.bs`, Position.create(6, 25));
            expectCompletionsIncludes(completions, [{
                label: 'NameA',
                kind: CompletionItemKind.Module
            }]);
            expectCompletionsExcludes(completions, [{
                label: 'NameB',
                kind: CompletionItemKind.Module
            }, {
                label: 'NameA.NameB',
                kind: CompletionItemKind.Module
            }, {
                label: 'NameA.NameB.NameC',
                kind: CompletionItemKind.Module
            }, {
                label: 'NameA.NameB.NameC.DoSomething',
                kind: CompletionItemKind.Module
            }]);
        });

        it('resolves completions for namespaces with next namespace part for brighterscript file', () => {
            program.setFile('source/main.bs', `
                namespace NameA.NameB.NameC
                    sub DoSomething()
                    end sub
                end namespace
                sub main()
                    NameA.
                end sub
            `);
            program.validate();
            let completions = program.getCompletions(`${rootDir}/source/main.bs`, Position.create(6, 26)).map(x => x.label);
            expect(completions).to.include('NameB');
            expect(completions).not.to.include('NameA');
            expect(completions).not.to.include('NameA.NameB');
            expect(completions).not.to.include('NameA.NameB.NameC');
            expect(completions).not.to.include('NameA.NameB.NameC.DoSomething');
        });

        it('finds namespace members for brighterscript file', () => {
            program.setFile('source/main.bs', `
                sub main()
                    NameA.
                    NameA.NameB.
                    NameA.NameB.NameC.
                end sub
                namespace NameA
                    sub alertA()
                    end sub
                end namespace
                namespace NameA
                    sub info()
                    end sub
                end namespace
                namespace NameA.NameB
                    sub alertB()
                    end sub
                end namespace
                namespace NameA.NameB.NameC
                    sub alertC()
                    end sub
                end namespace
            `);
            program.validate();
            expect(
                program.getCompletions(`${rootDir}/source/main.bs`, Position.create(2, 26)).map(x => x.label).sort()
            ).to.eql(['NameB', 'alertA', 'info']);

            expect(
                program.getCompletions(`${rootDir}/source/main.bs`, Position.create(3, 32)).map(x => x.label).sort()
            ).to.eql(['NameC', 'alertB']);

            expect(
                program.getCompletions(`${rootDir}/source/main.bs`, Position.create(4, 38)).map(x => x.label).sort()
            ).to.eql(['alertC']);
        });

        it('finds namespace members for classes', () => {
            program.setFile('source/main.bs', `
                sub main()
                    NameA.
                    NameA.NameB.
                    NameA.NameB.NameC.
                end sub
                namespace NameA
                    sub alertA()
                    end sub
                end namespace
                namespace NameA
                    sub info()
                    end sub
                    class MyClassA
                    end class
                end namespace
                namespace NameA.NameB
                    sub alertB()
                    end sub
                    class MyClassB
                    end class
                end namespace
                namespace NameA.NameB.NameC
                    sub alertC()
                    end sub
                end namespace
            `);
            program.validate();
            expect(
                program.getCompletions(`${rootDir}/source/main.bs`, Position.create(2, 26)).map(x => x.label).sort()
            ).to.eql(['MyClassA', 'NameB', 'alertA', 'info']);

            expect(
                program.getCompletions(`${rootDir}/source/main.bs`, Position.create(3, 32)).map(x => x.label).sort()
            ).to.eql(['MyClassB', 'NameC', 'alertB']);

            expect(
                program.getCompletions(`${rootDir}/source/main.bs`, Position.create(4, 38)).map(x => x.label).sort()
            ).to.eql(['alertC']);
        });

        it('finds only namespaces that have classes, when new keyword is used', () => {
            program.setFile('source/main.bs', `
                sub main()
                    a = new NameA.
                    b = new NameA.NameB.
                    c = new NameA.NameB.NameC.
                end sub
                namespace NameA
                    sub alertA()
                    end sub
                end namespace
                namespace NameA
                    sub info()
                    end sub
                    class MyClassA
                    end class
                end namespace
                namespace NameA.NoClassA
                end namespace
                namespace NameA.NoClassB
                end namespace
                namespace NameA.NameB
                    sub alertB()
                    end sub
                    class MyClassB
                    end class
                end namespace
                namespace NameA.NameB.NoClass
                end namespace
                namespace NameA.NameB.NameC
                    sub alertC()
                    end sub
                end namespace
            `);
            program.validate();
            expect(
                program.getCompletions(`${rootDir}/source/main.bs`, Position.create(2, 34)).map(x => x.label).sort()
            ).to.eql(['MyClassA', 'NameB']);

            expect(
                program.getCompletions(`${rootDir}/source/main.bs`, Position.create(3, 40)).map(x => x.label).sort()
            ).to.eql(['MyClassB']);

            expect(
                program.getCompletions(`${rootDir}/source/main.bs`, Position.create(4, 46)).map(x => x.label).sort()
            ).to.be.empty;
        });

        //Bron.. pain to get this working.. do we realy need this? seems moot with ropm..
        it.skip('should include translated namespace function names for brightscript files', () => {
            program.setFile('source/main.bs', `
                namespace NameA.NameB.NameC
                    sub DoSomething()
                    end sub
                end namespace
            `);
            program.setFile('source/lib.brs', `
                sub test()

                end sub
            `);
            program.validate();
            let completions = program.getCompletions(`${rootDir}/source/lib.brs`, Position.create(2, 23));
            expect(completions.map(x => x.label)).to.include('NameA_NameB_NameC_DoSomething');
        });

        it('includes global completions for file with no scope', () => {
            program.setFile('source/main.brs', `
                function Main()
                    age = 1
                end function
            `);
            program.validate();
            let completions = program.getCompletions('source/main.brs', Position.create(2, 21));
            expect(completions.filter(x => x.label.toLowerCase() === 'abs')).to.be.lengthOf(1);
        });

        it('filters out text results for top-level function statements', () => {
            program.setFile('source/main.brs', `
                function Main()
                    age = 1
                end function
            `);
            program.validate();
            let completions = program.getCompletions(`${rootDir}/source/main.brs`, Position.create(2, 21));
            expect(completions.filter(x => x.label === 'Main')).to.be.lengthOf(1);
        });

        it('does not filter text results for object properties used in conditional statements', () => {
            program.setFile('source/main.brs', `
                sub Main()
                    p.
                end sub
                sub SayHello()
                    person = {}
                    if person.isAlive then
                        print "Hello"
                    end if
                end sub
            `);
            program.validate();
            let completions = program.getCompletions(`${rootDir}/source/main.brs`, Position.create(2, 22));
            expect(completions.filter(x => x.label === 'isAlive')).to.be.lengthOf(1);
        });

        it('does not filter text results for object properties used in assignments', () => {
            program.setFile('source/main.brs', `
                sub Main()
                    p.
                end sub
                sub SayHello()
                   person = {}
                   localVar = person.name
                end sub
            `);
            program.validate();
            let completions = program.getCompletions(`${rootDir}/source/main.brs`, Position.create(2, 22));
            expect(completions.filter(x => x.label === 'name')).to.be.lengthOf(1);
        });

        it('does not filter text results for object properties', () => {
            program.setFile('source/main.brs', `
                sub Main()
                    p.
                end sub
                sub SayHello()
                   person = {}
                   person.name = "bob"
                end sub
            `);
            program.validate();
            let completions = program.getCompletions(`${rootDir}/source/main.brs`, Position.create(2, 22));
            expect(completions.filter(x => x.label === 'name')).to.be.lengthOf(1);
        });

        it('filters out text results for local vars used in conditional statements', () => {
            program.setFile('source/main.brs', `
                sub Main()

                end sub
                sub SayHello()
                    isTrue = true
                    if isTrue then
                        print "is true"
                    end if
                end sub
            `);
            program.validate();
            let completions = program.getCompletions(`${rootDir}/source/main.brs`, Position.create(2, 10));
            expect(completions.filter(x => x.label === 'isTrue')).to.be.lengthOf(0);
        });

        it('filters out text results for local variable assignments', () => {
            program.setFile('source/main.brs', `
                sub Main()

                end sub
                sub SayHello()
                    message = "Hello"
                end sub
            `);
            let completions = program.getCompletions(`${rootDir}/source/main.brs`, Position.create(2, 10));
            expect(completions.filter(x => x.label === 'message')).to.be.lengthOf(0);
        });

        it('filters out text results for local variables used in assignments', () => {
            program.setFile('source/main.brs', `
                sub Main()

                end sub
                sub SayHello()
                    message = "Hello"
                    otherVar = message
                end sub
            `);
            program.validate();
            let completions = program.getCompletions(`${rootDir}/source/main.brs`, Position.create(2, 10));
            expect(completions.filter(x => x.label === 'message')).to.be.lengthOf(0);
        });

        it('does not suggest local variables when initiated to the right of a period', () => {
            program.setFile('source/main.brs', `
                function Main()
                    helloMessage = "jack"
                    person.hello
                end function
            `);
            let completions = program.getCompletions(`${rootDir}/source/main.brs`, Position.create(3, 32));
            expect(completions.filter(x => x.kind === CompletionItemKind.Variable).map(x => x.label)).not.to.contain('helloMessage');
        });

        it('finds all file paths when initiated on xml uri', () => {
            let xmlPath = s`${rootDir}/components/component1.xml`;
            program.setFile('components/component1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="HeroScene" extends="Scene">
                    <script type="text/brightscript" uri="" />
                </component>
            `);
            program.setFile('components/component1.brs', '');
            program.validate();
            let completions = program.getCompletions(xmlPath, Position.create(2, 42));
            expect(completions[0]).to.include({
                kind: CompletionItemKind.File,
                label: 'component1.brs'
            });
            expect(completions[1]).to.include({
                kind: CompletionItemKind.File,
                label: 'pkg:/components/component1.brs'
            });
            //it should NOT include the global methods
            expect(completions).to.be.lengthOf(2);
        });

        it('get all functions and properties in scope when doing any dotted get on non m ', () => {
            program.setFile('source/main.bs', `
                sub main()
                    thing.anonPropA = "foo"
                    thing.anonPropB = "bar"
                    thing.person
                end sub
                class MyClassA
                    personName = "rafa"
                    personAName = "rafaA"
                    function personAMethodA()
                    end function
                    function personAMethodB()
                    end function
                end class
                namespace NameA
                    sub alertA()
                    end sub
                end namespace
                namespace NameA.NameB
                    sub alertB()
                    end sub
                    class MyClassB
                        personName = "roger"
                        personBName = "rogerB"
                        function personAMethodC()
                        end function
                        function personBMethodA()
                        end function
                        function personBMethodB()
                        end function
                    end class
                end namespace
                namespace NameA.NameB.NameC
                    sub alertC()
                    end sub
                end namespace
            `);
            program.validate();
            //note - we let the vscode extension do the filtering, so we still return everything; otherwise it exhibits strange behaviour in the IDE
            expect(
                (program.getCompletions(`${rootDir}/source/main.bs`, Position.create(4, 32))).map(x => x.label).sort()
            ).to.eql(['anonPropA', 'anonPropB', 'person', 'personAMethodA', 'personAMethodB', 'personAMethodC', 'personAName', 'personBMethodA', 'personBMethodB', 'personBName', 'personName']);
        });

        it('get all functions and properties relevant for m ', () => {
            program.setFile('source/main.bs', `
                class MyClassA
                    function new()
                        m.
                    end function
                    personName = "rafa"
                    personAName = "rafaA"
                    function personAMethodA()
                    end function
                    function personAMethodB()
                    end function
                end class
                class MyClassB
                    personName = "roger"
                    personBName = "rogerB"
                    function personAMethodC()
                    end function
                    function personBMethodA()
                    end function
                    function personBMethodB()
                    end function
                end class
                class MyClassC extends MyClassA
                    function new()
                        m.
                    end function
                    personCName = "rogerC"
                    function personCMethodC()
                    end function
                    function personCMethodA()
                    end function
                    function personCMethodB()
                    end function
                end class
                sub alertC()
                end sub
            `);
            program.validate();

            const myClassACompletions = program.getCompletions(`${rootDir}/source/main.bs`, Position.create(3, 26));
            // remove completions with sortText (they are built in methods), then sort the remaining labels
            const myClassACompletionsSorted = myClassACompletions.filter(x => !x.sortText).map(x => x.label).sort();
            expect(myClassACompletionsSorted).to.eql(['personAMethodA', 'personAMethodB', 'personAName', 'personName']);

            const myClassCCompletions = program.getCompletions(`${rootDir}/source/main.bs`, Position.create(24, 26));
            // remove completions with sortText (they are built in methods), then sort the remaining labels
            const myClassCCompletionsSorted = myClassCCompletions.filter(x => !x.sortText).map(x => x.label).sort();
            expect(myClassCCompletionsSorted).to.eql(['personAMethodA', 'personAMethodB', 'personAName', 'personCMethodA', 'personCMethodB', 'personCMethodC', 'personCName', 'personName']);
        });

        it.skip('include non-namespaced classes in the list of general output', () => {
            program.setFile('source/main.bs', `
                function regularFunc()
                    MyClass
                end function
                sub alertC()
                end sub
                class MyClassA
                end class
                class MyClassB
                end class
                class MyClassC extends MyClassA
                end class
            `);
            expect(
                (program.getCompletions(`${rootDir}/source/main.bs`, Position.create(3, 26))).map(x => x.label).sort()
            ).to.include.members(['MyClassA', 'MyClassB', 'MyClassC']);
        });

        it('only include classes when using new keyword', () => {
            program.setFile('source/main.bs', `
                class MyClassA
                end class
                class MyClassB
                end class
                class MyClassC extends MyClassA
                end class
                function regularFunc()
                    new MyClass
                end function
                sub alertC()
                end sub
            `);
            program.validate();
            expect(
                (program.getCompletions(`${rootDir}/source/main.bs`, Position.create(8, 29))).map(x => x.label).sort()
            ).to.eql(['MyClassA', 'MyClassB', 'MyClassC']);
        });

        it('gets completions when using callfunc invocation', () => {
            program.setFile('source/main.bs', `
                function doStuff(myNode)
                    myNode@.sayHello(1, 2)
                end function
            `);
            program.setFile('components/MyNode.bs', `
                function sayHello(text, text2)
                end function
            `);
            program.setFile<XmlFile>('components/MyNode.xml',
                trim`<?xml version="1.0" encoding="utf-8" ?>
            <component name="Component1" extends="Scene">
                <script type="text/brightscript" uri="pkg:/components/MyNode.bs" />
                <interface>
                    <function name="sayHello"/>
                </interface>
            </component>`);
            program.validate();
            expectZeroDiagnostics(program);

            expect(
                (program.getCompletions(`${rootDir}/source/main.bs`, Position.create(2, 30))).map(x => x.label).sort()
            ).to.eql(['sayHello']);
        });

        it('gets completions for callfunc invocation with multiple nodes', () => {
            program.setFile('source/main.bs', `
                function main()
                    myNode@.sayHello(arg1)
                end function
            `);
            program.setFile('components/MyNode.bs', `
                function sayHello(text, text2)
                end function
                function sayHello2(text, text2)
                end function
            `);
            program.setFile<XmlFile>('components/MyNode.xml',
                trim`<?xml version="1.0" encoding="utf-8" ?>
                <component name="Component1" extends="Scene">
                    <script type="text/brightscript" uri="pkg:/components/MyNode.bs" />
                    <interface>
                        <function name="sayHello"/>
                        <function name="sayHello2"/>
                    </interface>
                </component>`);
            program.setFile('components/MyNode2.bs', `
                function sayHello3(text, text2)
                end function
                function sayHello4(text, text2)
                end function
            `);
            program.setFile<XmlFile>('components/MyNode2.xml',
                trim`<?xml version="1.0" encoding="utf-8" ?>
                <component name="Component2" extends="Scene">
                    <script type="text/brightscript" uri="pkg:/components/MyNode2.bs" />
                    <interface>
                        <function name="sayHello3"/>
                        <function name="sayHello4"/>
                    </interface>
                </component>`);
            program.validate();

            expect(
                (program.getCompletions(`${rootDir}/source/main.bs`, Position.create(2, 30))).map(x => x.label).sort()
            ).to.eql(['sayHello', 'sayHello2', 'sayHello3', 'sayHello4']);
        });

        it('gets completions for callfunc invocation with multiple nodes and validates single code completion results', () => {
            program.setFile('source/main.bs', `
                function main()
                    ParentNode@.sayHello(arg1)
                end function
            `);
            program.setFile('components/ParentNode.bs', `
                function sayHello(text, text2)
                end function
            `);
            program.setFile<XmlFile>('components/ParentNode.xml',
                trim`<?xml version="1.0" encoding="utf-8" ?>
                <component name="ParentNode" extends="Scene">
                    <script type="text/brightscript" uri="pkg:/components/ParentNode.bs" />
                    <interface>
                        <function name="sayHello"/>
                    </interface>
                </component>`);
            program.setFile('components/ChildNode.bs', `
                function sayHello(text, text2)
                end function
            `);
            program.setFile<XmlFile>('components/ChildNode.xml',
                trim`<?xml version="1.0" encoding="utf-8" ?>
                <component name="ChildNode" extends="ParentNode">
                    <script type="text/brightscript" uri="pkg:/components/ChildNode.bs" />
                </component>`);
            program.validate();

            expect(
                (program.getCompletions(`${rootDir}/source/main.bs`, Position.create(2, 31))).map(x => x.label).sort()
            ).to.eql(['sayHello']);
        });

        it('gets completions for extended nodes with callfunc invocation - ensure overridden methods included', () => {
            program.setFile('source/main.bs', `
                function main()
                    myNode@.sayHello(arg1)
                end function
            `);
            program.setFile('components/MyNode.bs', `
                function sayHello(text, text2)
                end function
                function sayHello2(text, text2)
                end function
            `);
            program.setFile<XmlFile>('components/MyNode.xml',
                trim`<?xml version="1.0" encoding="utf-8" ?>
                <component name="Component1" extends="Scene">
                    <script type="text/brightscript" uri="pkg:/components/MyNode.bs" />
                    <interface>
                        <function name="sayHello"/>
                        <function name="sayHello2"/>
                    </interface>
                </component>`);
            program.setFile('components/MyNode2.bs', `
                function sayHello3(text, text2)
                end function
                function sayHello2(text, text2)
                end function
                function sayHello4(text, text2)
                end function
            `);
            program.setFile<XmlFile>('components/MyNode2.xml',
                trim`<?xml version="1.0" encoding="utf-8" ?>
                <component name="Component2" extends="Component1">
                    <script type="text/brightscript" uri="pkg:/components/MyNode2.bs" />
                    <interface>
                        <function name="sayHello3"/>
                        <function name="sayHello4"/>
                    </interface>
                </component>`);
            program.validate();

            expect(
                (program.getCompletions(`${rootDir}/source/main.bs`, Position.create(2, 30))).map(x => x.label).sort()
            ).to.eql(['sayHello', 'sayHello2', 'sayHello3', 'sayHello4']);
        });

        describe('getCompletions', () => {
            it('returns all functions in scope', () => {
                program.setFile('source/main.brs', `
                    sub Main()

                    end sub

                    sub ActionA()
                    end sub
                `);
                program.setFile('source/lib.brs', `
                    sub ActionB()
                    end sub
                `);

                program.validate();

                let completions = program
                    //get completions
                    .getCompletions(`${rootDir}/source/main.brs`, util.createPosition(2, 10))
                    //only keep the label property for this test
                    .map(x => pick(x, 'label'));

                expect(completions).to.deep.include({ label: 'Main' });
                expect(completions).to.deep.include({ label: 'ActionA' });
                expect(completions).to.deep.include({ label: 'ActionB' });
            });

            it('returns all variables in scope', () => {
                program.setFile('source/main.brs', `
                    sub Main()
                        name = "bob"
                        age = 20
                        shoeSize = 12.5
                    end sub
                    sub ActionA()
                    end sub
                `);
                program.setFile('source/lib.brs', `
                    sub ActionB()
                    end sub
                `);

                program.validate();

                let completions = program.getCompletions(`${rootDir}/source/main.brs`, util.createPosition(2, 24));
                let labels = completions.map(x => pick(x, 'label'));

                expect(labels).to.deep.include({ label: 'Main' });
                expect(labels).to.deep.include({ label: 'ActionA' });
                expect(labels).to.deep.include({ label: 'ActionB' });
                expect(labels).to.deep.include({ label: 'name' });
                expect(labels).to.deep.include({ label: 'age' });
                expect(labels).to.deep.include({ label: 'shoeSize' });
            });

            it('returns empty set when out of range', () => {
                const position = util.createPosition(99, 99);
                const mainFile = program.setFile('source/main.brs', '');
                let completions = program.getCompletions(`${rootDir}/source/main.brs`, position);
                const completionProcessor = new CompletionsProcessor({
                    program: program,
                    file: mainFile,
                    position: position,
                    scopes: [],
                    completions: []
                });
                program.validate();
                //get the name of all global completions
                const globalCompletions = program.globalScope.getAllFiles().flatMap(x => completionProcessor.getBrsFileCompletions(position, x as BrsFile, program.globalScope)).map(x => x.label);
                //filter out completions from global scope
                completions = completions.filter(x => !globalCompletions.includes(x.label));
                expect(completions).to.be.empty;
            });

            it('finds parameters', () => {
                program.setFile('source/main.brs', `
                    sub Main(count = 1)
                        firstName = "bob"
                        age = 21
                        shoeSize = 10
                    end sub
                `);
                program.validate();
                let completions = program.getCompletions(`${rootDir}/source/main.brs`, Position.create(2, 10));
                let labels = completions.map(x => pick(x, 'label'));

                expect(labels).to.deep.include({ label: 'count' });
            });
        });
    });

    describe('getCompletions - BrsFile.spec', () => {
        it('does not crash for callfunc on a function call', () => {
            const file = program.setFile('source/main.brs', `
                sub main()
                    getManager()@.
                end sub
            `);
            program.validate();
            expect(() => {
                program.getCompletions(file.srcPath, util.createPosition(2, 34));
            }).not.to.throw;
        });

        it('suggests pkg paths in strings that match that criteria', () => {
            program.setFile('source/main.brs', `
                sub main()
                    print "pkg:"
                end sub
            `);
            program.validate();
            const result = program.getCompletions(`${rootDir}/source/main.brs`, Position.create(2, 31));
            const names = result.map(x => x.label);
            expect(names.sort()).to.eql([
                'pkg:/source/main.brs'
            ]);
        });

        it('suggests libpkg paths in strings that match that criteria', () => {
            program.setFile('source/main.brs', `
                sub main()
                    print "libpkg:"
                end sub
            `);
            program.validate();
            const result = program.getCompletions(`${rootDir}/source/main.brs`, Position.create(2, 31));
            const names = result.map(x => x.label);
            expect(names.sort()).to.eql([
                'libpkg:/source/main.brs'
            ]);
        });

        it('suggests pkg paths in template strings', () => {
            program.setFile('source/main.brs', `
                sub main()
                    print \`pkg:\`
                end sub
            `);
            program.validate();
            const result = program.getCompletions(`${rootDir}/source/main.brs`, Position.create(2, 31));
            const names = result.map(x => x.label);
            expect(names.sort()).to.eql([
                'pkg:/source/main.brs'
            ]);
        });

        it('waits for the file to be processed before collecting completions', () => {
            //eslint-disable-next-line @typescript-eslint/no-floating-promises
            program.setFile('source/main.brs', `
                sub Main()
                    print "hello"
                    Say
                end sub

                sub SayHello()
                end sub
            `);
            program.validate();
            let result = program.getCompletions(`${rootDir}/source/main.brs`, Position.create(3, 23));
            let names = result.map(x => x.label);
            expect(names).to.includes('Main');
            expect(names).to.includes('SayHello');
        });

        it('includes every type of item at base level', () => {
            program.setFile('source/main.bs', `
                sub main()
                    print
                end sub
                sub speak()
                end sub
                namespace stuff
                end namespace
                class Person
                end class
                enum Direction
                end enum
            `);
            program.validate();
            expectCompletionsIncludes(program.getCompletions('source/main.bs', util.createPosition(2, 26)), [{
                label: 'main',
                kind: CompletionItemKind.Function
            }, {
                label: 'speak',
                kind: CompletionItemKind.Function
            }, {
                label: 'stuff',
                kind: CompletionItemKind.Module
            }, {
                label: 'Person',
                kind: CompletionItemKind.Class
            }, {
                label: 'Direction',
                kind: CompletionItemKind.Enum
            }]);
        });

        describe('namespaces', () => {
            it('gets full namespace completions at any point through the leading identifier', () => {
                program.setFile('source/main.bs', `
                    sub main()
                        foo.bar
                    end sub

                    namespace foo.bar
                    end namespace

                    class Person
                    end class
                `);
                program.validate();
                const result = program.getCompletions(`${rootDir}/source/main.bs`, Position.create(2, 24)).map(x => x.label);
                expect(result).includes('main');
                expect(result).includes('foo');
                expect(result).includes('Person');
            });

            it('gets namespace completions', () => {
                program.setFile('source/main.bs', `
                    namespace foo.bar
                        function sayHello()
                        end function
                    end namespace

                    sub Main()
                        print "hello"
                        foo.ba
                        foo.bar.
                    end sub
                `);
                program.validate();
                let result = program.getCompletions(`${rootDir}/source/main.bs`, Position.create(8, 30));
                let names = result.map(x => x.label);
                expect(names).to.includes('bar');

                result = program.getCompletions(`${rootDir}/source/main.bs`, Position.create(9, 32));
                names = result.map(x => x.label);
                expect(names).to.includes('sayHello');
            });
        });

        it('always includes `m`', () => {
            program.setFile('source/main.brs', `
                sub Main()

                end sub
            `);
            program.validate();
            let result = program.getCompletions(`${rootDir}/source/main.brs`, Position.create(2, 23));
            let names = result.map(x => x.label);
            expect(names).to.contain('m');
        });

        it('does not fail for missing previousToken', () => {
            //add a single character to the file, and get completions after it
            program.setFile('source/main.brs', `i`);
            program.validate();
            expect(() => {
                program.getCompletions(`${rootDir}/source/main.brs`, Position.create(0, 1)).map(x => x.label);
            }).not.to.throw;
        });

        it.skip('includes all keywords`', () => {
            program.setFile('source/main.brs', `
                sub Main()

                end sub
            `);

            program.validate();
            let keywords = Object.keys(Keywords).filter(x => !x.includes(' '));

            //inside the function
            let result = program.getCompletions(`${rootDir}/source/main.brs`, Position.create(2, 23));
            let names = result.map(x => x.label);
            for (let keyword of keywords) {
                expect(names).to.include(keyword);
            }

            //outside the function
            result = program.getCompletions(`${rootDir}/source/main.brs`, Position.create(4, 8));
            names = result.map(x => x.label);
            for (let keyword of keywords) {
                expect(names).to.include(keyword);
            }
        });

        it('does not provide completions within a comment', () => {
            program.setFile('source/main.brs', `
                sub Main()
                    'some comment
                end sub
            `);

            program.validate();
            //inside the function
            let result = program.getCompletions(`${rootDir}/source/main.brs`, Position.create(2, 33));
            expect(result).to.be.lengthOf(0);
        });

        it('does not provide duplicate entries for variables', () => {
            program.setFile('source/main.brs', `
                sub Main()
                    name = "bob"
                    age = 12
                    name = "john"
                end sub
            `);
            program.validate();
            let result = program.getCompletions(`${rootDir}/source/main.brs`, Position.create(3, 23));

            let count = result.reduce((total, x) => {
                return x.label === 'name' ? total + 1 : total;
            }, 0);
            expect(count).to.equal(1);
        });

        it('does not include `as` and `string` text options when used in function params', () => {
            program.setFile('source/main.brs', `
                sub Main(name as string)

                end sub
            `);

            program.validate();
            let result = program.getCompletions(`${rootDir}/source/main.brs`, Position.create(2, 23));
            expect(result.filter(x => x.kind === CompletionItemKind.Text)).not.to.contain('as');
            expect(result.filter(x => x.kind === CompletionItemKind.Text)).not.to.contain('string');
        });

        it('does not provide intellisense results when inside a comment', () => {
            program.setFile('source/main.brs', `
                sub Main(name as string)
                    'this is a comment
                end sub
            `);

            program.validate();
            let results = program.getCompletions(`${rootDir}/source/main.brs`, Position.create(2, 30));
            expect(results).to.be.empty;
        });

        it('does provide intellisence for labels only after a goto keyword', () => {
            program.setFile('source/main.brs', `
                sub Main(name as string)
                    something:
                    goto \nend sub
            `);

            program.validate();
            let results = program.getCompletions(`${rootDir}/source/main.brs`, Position.create(3, 25));
            expect(results.length).to.equal(1);
            expect(results[0]?.label).to.equal('something');
        });

    });

    describe('getCompletions - XmlFile.spec', () => {
        it('formats completion paths with proper slashes', () => {
            let scriptPath = s`C:/app/components/component1/component1.brs`;
            program.files[scriptPath] = new BrsFile({ srcPath: scriptPath, destPath: s`components/component1/component1.brs`, program: program });

            let xmlFile = new XmlFile({
                srcPath: s`${rootDir}/components/component1/component1.xml`,
                destPath: s`components/component1/component1.xml`,
                program: program
            });
            xmlFile.parser.references.scriptTagImports.push({
                destPath: s`components/component1/component1.brs`,
                text: 'component1.brs',
                filePathRange: Range.create(1, 1, 1, 1)
            });
            const processesor = new CompletionsProcessor(null);
            const completions = processesor.getXmlFileCompletions(Position.create(1, 1), xmlFile);
            expectCompletionsIncludes(completions, [{
                label: 'component1.brs',
                kind: CompletionItemKind.File
            }, {
                label: 'pkg:/components/component1/component1.brs',
                kind: CompletionItemKind.File
            }]);
        });

        //TODO - refine this test once cdata scripts are supported
        it('prevents scope completions entirely', () => {
            program.setFile('components/component1.brs', ``);

            let xmlFile = program.setFile('components/component1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ParentScene" extends="GrandparentScene">
                    <script type="text/brightscript" uri="./Component1.brs" />
                </component>
            `);
            program.validate();
            expect(program.getCompletions(xmlFile.srcPath, Position.create(1, 1))).to.be.empty;
        });
    });

    describe('documentation', () => {
        it('returns documentation when possible', () => {
            program.setFile('source/main.brs', `
                sub Main()
                    print "hello"
                    Say
                end sub

                ' Says hello to the world
                sub SayHello()
                end sub
            `);
            program.validate();
            // Say|
            let completions = program.getCompletions(`${rootDir}/source/main.brs`, Position.create(3, 22));
            //it should find the completions for the global scope
            expect(completions).to.be.length.greaterThan(0);
            //it should find documentation for completions
            expect(completions.filter(x => !!x.documentation)).to.have.length.greaterThan(0);
        });
    });

    describe('getPartialVariableName', () => {
        let entry = {
            src: `${rootDir}/source/lib.brs`,
            dest: `source/lib.brs`
        } as FileObj;

        it('creates proper tokens', () => {
            const file = program.setFile<BrsFile>(entry, `call(ModuleA.ModuleB.ModuleC.`);
            expect(file['getPartialVariableName'](file.parser.tokens[7])).to.equal('ModuleA.ModuleB.ModuleC.');
            expect(file['getPartialVariableName'](file.parser.tokens[6])).to.equal('ModuleA.ModuleB.ModuleC');
            expect(file['getPartialVariableName'](file.parser.tokens[5])).to.equal('ModuleA.ModuleB.');
            expect(file['getPartialVariableName'](file.parser.tokens[4])).to.equal('ModuleA.ModuleB');
            expect(file['getPartialVariableName'](file.parser.tokens[3])).to.equal('ModuleA.');
            expect(file['getPartialVariableName'](file.parser.tokens[2])).to.equal('ModuleA');
        });
    });

    describe('const completions', () => {
        it('shows up in standard completions', () => {
            program.setFile('source/main.bs', `
                const API_KEY = "123"
                sub log(message)
                    log()
                end sub
            `);
            program.validate();
            const completions = program.getCompletions('source/main.bs', util.createPosition(3, 24));
            expectCompletionsIncludes(
                // log(|)
                completions,
                [{
                    label: 'API_KEY',
                    kind: CompletionItemKind.Constant
                }]
            );
        });

        it('shows up in namespace completions', () => {
            program.setFile('source/main.bs', `
                namespace constants
                    const API_KEY = "123"
                end namespace
                sub log(message)
                    log(constants.)
                end sub
            `);
            program.validate();
            expectCompletionsIncludes(
                // log(|)
                program.getCompletions('source/main.bs', util.createPosition(5, 34)),
                [{
                    label: 'API_KEY',
                    kind: CompletionItemKind.Constant
                }]
            );
        });
    });

    describe('enum completions', () => {
        it('does not crash when completing enum members with unsupported values', () => {
            program.setFile('source/main.bs', `
                sub Main()
                    direction.obj
                end sub
                enum Direction
                    up
                    down
                    obj = {}
                end enum
            `);
            program.validate();
            //      direction.|obj
            expectCompletionsIncludes(program.getCompletions('source/main.bs', util.createPosition(2, 30)), [{
                label: 'up',
                kind: CompletionItemKind.EnumMember
            }, {
                label: 'down',
                kind: CompletionItemKind.EnumMember
            }, {
                label: 'obj',
                kind: CompletionItemKind.EnumMember
            }]);
        });

        it('gets enum statement completions from global enum', () => {
            program.setFile('source/main.bs', `
                sub Main()
                    direction.down
                end sub
                enum Direction
                    up
                    down
                end enum
            `);
            program.validate();
            //      |direction.down
            expectCompletionsIncludes(program.getCompletions('source/main.bs', util.createPosition(2, 20)), [{
                label: 'Direction',
                kind: CompletionItemKind.Enum
            }]);
            //      dire|ction.down
            expectCompletionsIncludes(program.getCompletions('source/main.bs', util.createPosition(2, 24)), [{
                label: 'Direction',
                kind: CompletionItemKind.Enum
            }]);
            //      direction|.down
            expectCompletionsIncludes(program.getCompletions('source/main.bs', util.createPosition(2, 29)), [{
                label: 'Direction',
                kind: CompletionItemKind.Enum
            }]);
        });

        it('gets enum member completions from global enum', () => {
            program.setFile('source/main.bs', `
                sub Main()
                    direction.down
                end sub
                enum Direction
                    up
                    down
                end enum
            `);
            program.validate();
            //      direction.|down
            expectCompletionsIncludes(program.getCompletions('source/main.bs', util.createPosition(2, 30)), [{
                label: 'up',
                kind: CompletionItemKind.EnumMember
            }, {
                label: 'down',
                kind: CompletionItemKind.EnumMember
            }]);
            //      direction.do|wn
            expectCompletionsIncludes(program.getCompletions('source/main.bs', util.createPosition(2, 32)), [{
                label: 'up',
                kind: CompletionItemKind.EnumMember
            }, {
                label: 'down',
                kind: CompletionItemKind.EnumMember
            }]);
            //      direction.down|
            expectCompletionsIncludes(program.getCompletions('source/main.bs', util.createPosition(2, 34)), [{
                label: 'up',
                kind: CompletionItemKind.EnumMember
            }, {
                label: 'down',
                kind: CompletionItemKind.EnumMember
            }]);
        });

        it('gets enum statement completions from namespaced enum', () => {
            program.setFile('source/main.bs', `
                sub Main()
                    enums.direction.down
                end sub
                namespace enums
                    enum Direction
                        up
                        down
                    end enum
                end namespace
            `);
            program.validate();
            //      enums.|direction.down
            expectCompletionsIncludes(program.getCompletions('source/main.bs', util.createPosition(2, 26)), [{
                label: 'Direction',
                kind: CompletionItemKind.Enum
            }]);
            //      enums.dire|ction.down
            expectCompletionsIncludes(program.getCompletions('source/main.bs', util.createPosition(2, 30)), [{
                label: 'Direction',
                kind: CompletionItemKind.Enum
            }]);
            //      enums.direction|.down
            expectCompletionsIncludes(program.getCompletions('source/main.bs', util.createPosition(2, 35)), [{
                label: 'Direction',
                kind: CompletionItemKind.Enum
            }]);
        });

        it('gets enum member completions from namespaced enum', () => {
            program.setFile('source/main.bs', `
                sub Main()
                    enums.direction.down
                end sub
                namespace enums
                    enum Direction
                        up
                        down
                    end enum
                end namespace
            `);
            program.validate();
            //      enums.direction.|down
            expectCompletionsIncludes(program.getCompletions('source/main.bs', util.createPosition(2, 36)), [{
                label: 'up',
                kind: CompletionItemKind.EnumMember
            }, {
                label: 'down',
                kind: CompletionItemKind.EnumMember
            }]);
            //      enums.direction.do|wn
            expectCompletionsIncludes(program.getCompletions('source/main.bs', util.createPosition(2, 38)), [{
                label: 'up',
                kind: CompletionItemKind.EnumMember
            }, {
                label: 'down',
                kind: CompletionItemKind.EnumMember
            }]);
            //      enums.direction.down|
            expectCompletionsIncludes(program.getCompletions('source/main.bs', util.createPosition(2, 40)), [{
                label: 'up',
                kind: CompletionItemKind.EnumMember
            }, {
                label: 'down',
                kind: CompletionItemKind.EnumMember
            }]);
        });

        it('excludes enum member completions from namespace enum', () => {
            program.setFile('source/main.bs', `
                sub Main()
                    direction.ba
                end sub
                namespace enums
                    enum Direction
                        up
                        down
                    end enum
                end namespace
            `);
            program.validate();
            //should NOT find Direction because it's not directly available at the top level (you need to go through `enums.` to get at it)
            //      dire|ction.down
            expectCompletionsExcludes(program.getCompletions('source/main.bs', util.createPosition(2, 24)), [{
                label: 'Direction',
                kind: CompletionItemKind.Enum
            }]);
        });

        it('infers namespace for enum statement completions', () => {
            program.setFile('source/main.bs', `
                namespace enums
                    sub Main()
                        direction.down
                    end sub
                    enum Direction
                        up
                        down
                    end enum
                end namespace
                enum Logic
                    yes
                    no
                end enum
            `);
            program.validate();
            //          dire|ction.down
            const completions = program.getCompletions('source/main.bs', util.createPosition(3, 33));
            expectCompletionsIncludes(completions, [{
                label: 'Direction',
                kind: CompletionItemKind.Enum
            }, {
                label: 'Logic',
                kind: CompletionItemKind.Enum
            }]);
        });

        it('infers multilevel deep namespace for enum statement completions', () => {
            program.setFile('source/main.bs', `
                namespace enums
                    namespace deep
                        sub Main()
                            direction.down
                        end sub
                        enum Direction
                            up
                            down
                        end enum
                    end namespace
                end namespace
                enum Logic
                    yes
                    no
                end enum
            `);
            program.validate();
            //          dire|ction.down
            const completions = program.getCompletions('source/main.bs', util.createPosition(3, 33));
            expectCompletionsIncludes(completions, [{
                label: 'Direction',
                kind: CompletionItemKind.Enum
            }, {
                label: 'Logic',
                kind: CompletionItemKind.Enum
            }]);
        });

        it('infers deep namespace for enum statement completions', () => {
            program.setFile('source/main.bs', `
                namespace enums.deep.deeper
                    sub Main()
                        direction.down
                    end sub
                    enum Direction
                        up
                        down
                    end enum
                end namespace
                enum Logic
                    yes
                    no
                end enum
            `);
            program.validate();
            //          dire|ction.down
            const completions = program.getCompletions('source/main.bs', util.createPosition(3, 33));
            expectCompletionsIncludes(completions, [{
                label: 'Direction',
                kind: CompletionItemKind.Enum
            }, {
                label: 'Logic',
                kind: CompletionItemKind.Enum
            }]);
        });

        it('infers namespace for enum member completions', () => {
            program.setFile('source/main.bs', `
                namespace enums
                    sub Main()
                        direction.down
                    end sub
                    enum Direction
                        up
                        down
                    end enum
                end namespace
            `);
            program.validate();
            //          direction.do|wn
            expectCompletionsIncludes(program.getCompletions('source/main.bs', util.createPosition(3, 36)), [{
                label: 'up',
                kind: CompletionItemKind.EnumMember
            }, {
                label: 'down',
                kind: CompletionItemKind.EnumMember
            }]);
        });

        it('supports explicit namespace for enum statement completions', () => {
            program.setFile('source/main.bs', `
                namespace enums
                    sub Main()
                        enums.direction.down
                    end sub
                    enum Direction
                        up
                        down
                    end enum
                end namespace
            `);
            program.validate();
            //          enums.dire|ction.down
            expectCompletionsIncludes(program.getCompletions('source/main.bs', util.createPosition(3, 38)), [{
                label: 'Direction',
                kind: CompletionItemKind.Enum
            }]);
        });

        it('supports explicit namespace for enum statement completions', () => {
            program.setFile('source/main.bs', `
                namespace logger
                    sub log()
                        enums.direction.down
                    end sub
                end namespace
                namespace enums
                    enum Direction
                        up
                        down
                    end enum
                end namespace
            `);
            program.validate();
            //          enums.dire|ction.down
            expectCompletionsIncludes(program.getCompletions('source/main.bs', util.createPosition(3, 38)), [{
                label: 'Direction',
                kind: CompletionItemKind.Enum
            }]);
        });

        it('gives completions for underlying types on enum members', () => {
            program.setFile('source/main.bs', `
                enum Direction
                    up = "up"
                    down = "down"
                end enum

                sub goAway(dir as Direction)
                    print dir.
                end sub

            `);
            program.validate();
            // print dir.|
            const completions = program.getCompletions('source/main.bs', util.createPosition(7, 31));
            expectCompletionsIncludes(completions, [{
                label: 'Trim',
                kind: CompletionItemKind.Method
            }]);
        });

        it('gives completions for underlying types on enum members on future enum declaration', () => {
            program.setFile('source/main.bs', `
                sub goAway(dir as Direction)
                    print dir.
                end sub

                enum Direction
                    up = "up"
                    down = "down"
                end enum
            `);
            program.validate();
            // print dir.|
            const completions = program.getCompletions('source/main.bs', util.createPosition(2, 31));
            expectCompletionsIncludes(completions, [{
                label: 'Trim',
                kind: CompletionItemKind.Method
            }]);
        });

        it('does not give other members on enum member completion', () => {
            program.setFile('source/main.bs', `
                sub goAway(dir as Direction)
                    print dir.
                end sub

                enum Direction
                    up = "up"
                    down = "down"
                end enum
            `);
            program.validate();
            // print dir.|
            const completions = program.getCompletions('source/main.bs', util.createPosition(2, 31));
            expectCompletionsExcludes(completions, [{
                label: 'down',
                kind: CompletionItemKind.EnumMember
            }]);
        });

    });

    describe('built in type members', () => {
        it('finds built in members', () => {
            program.setFile('source/main.bs', `
                sub foo(name as string)
                    print name.
                end sub
            `);
            program.validate();
            // print name|.
            expectCompletionsIncludes(program.getCompletions('source/main.bs', util.createPosition(2, 32)), [{
                label: 'Replace',
                kind: CompletionItemKind.Method
            }]);
        });
    });

    describe('global callables', () => {
        it('finds built in members', () => {
            program.setFile('source/main.bs', `
                sub foo(name as string)
                    print
                end sub
            `);
            program.validate();
            // print |
            const completions = program.getCompletions('source/main.bs', util.createPosition(2, 27));
            expectCompletionsIncludes(completions, [{
                label: 'LCase',
                kind: CompletionItemKind.Function
            }]);
            expectCompletionsIncludes(completions, [{
                label: 'CreateObject',
                kind: CompletionItemKind.Function
            }]);
        });

    });

    describe('callfunc completions', () => {
        it('finds callfunc members', () => {
            program.setFile('components/Widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                     <script uri="Widget.brs"/>
                    <interface>
                        <function name="someFunc" />
                    </interface>
                </component>
            `);
            program.setFile('components/Widget.brs', `
                function someFunc(input as string) as float
                    return input.toFloat()
                end function
            `);
            program.setFile('source/util.bs', `
                sub callWidgetSomeFunc(widget as roSGNodeWidget)
                    print widget@.
                end sub
            `);
            program.validate();
            // print widget@.|
            let completions = program.getCompletions('source/util.bs', util.createPosition(2, 34));
            expect(completions.length).to.eql(1);
            expectCompletionsIncludes(completions, [{
                label: 'someFunc',
                kind: CompletionItemKind.Function
            }]);
        });

        it('includes documentation', () => {
            program.setFile('components/Widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                     <script uri="Widget.brs"/>
                    <interface>
                        <function name="someFunc" />
                    </interface>
                </component>
            `);
            program.setFile('components/Widget.brs', `
                ' This is documentation
                function someFunc(input as string) as float
                    return input.toFloat()
                end function
            `);
            program.setFile('source/util.bs', `
                sub callWidgetSomeFunc(widget as roSGNodeWidget)
                    print widget@.
                end sub
            `);
            program.validate();
            // print widget@.|
            let completions = program.getCompletions('source/util.bs', util.createPosition(2, 34));
            expect(completions.length).to.eql(1);
            expectCompletionsIncludes(completions, [{
                label: 'someFunc',
                kind: CompletionItemKind.Function,
                documentation: 'This is documentation'
            }]);
        });
    });

    describe('type expressions', () => {
        it('finds built in types', () => {
            program.setFile('source/main.bs', `
                sub foo(thing as  )
                    print thing
                end sub
            `);
            program.validate();
            //  sub foo(thing as | )
            const completions = program.getCompletions('source/main.bs', util.createPosition(1, 34));
            expectCompletionsIncludes(completions, [{
                label: 'integer',
                kind: CompletionItemKind.Keyword
            }]);
            expectCompletionsIncludes(completions, [{
                label: 'roSGNode',
                kind: CompletionItemKind.Interface
            }]);
        });

        it('finds custom types', () => {
            program.setFile('source/main.bs', `
                sub foo(thing as  )
                    print thing
                end sub

                class SomeKlass
                end class
            `);
            program.validate();
            //  sub foo(thing as | )
            const completions = program.getCompletions('source/main.bs', util.createPosition(1, 34));
            expectCompletionsIncludes(completions, [{
                label: 'SomeKlass',
                kind: CompletionItemKind.Class
            }]);
        });

        it('only shows intrinsic/native types in brightscript', () => {
            program.setFile('source/main.brs', `
                sub foo(thing as  )
                    print thing
                end sub
            `);
            program.validate();
            //  sub foo(thing as | )
            const completions = program.getCompletions('source/main.brs', util.createPosition(1, 34));
            expectCompletionsIncludes(completions, [{
                label: 'integer',
                kind: CompletionItemKind.Keyword
            }]);
            expectCompletionsIncludes(completions, [{
                label: 'function',
                kind: CompletionItemKind.Keyword
            }]);
            expectCompletionsExcludes(completions, [{
                label: 'roSGNode'
            }]);
        });

    });

    describe('interfaces', () => {

        it('finds members of interfaces', () => {
            program.setFile('source/main.bs', `
                sub foo(thing as SomeInterface )
                    print thing.
                end sub


                interface SomeInterface
                    name as string
                    data
                    function doStuff()
                end interface
            `);
            program.validate();
            //  print thing.|
            const completions = program.getCompletions('source/main.bs', util.createPosition(2, 33));
            expectCompletionsIncludes(completions, [{
                label: 'name',
                kind: CompletionItemKind.Field
            }]);
            expectCompletionsIncludes(completions, [{
                label: 'data',
                kind: CompletionItemKind.Field
            }]);
            expectCompletionsIncludes(completions, [{
                label: 'doStuff',
                kind: CompletionItemKind.Method
            }]);

        });

        it('finds optional members of interfaces', () => {
            program.setFile('source/main.bs', `
                sub foo(thing as SomeInterface )
                    print thing.
                end sub


                interface SomeInterface
                    optional name as string
                    optional data
                    optional function doStuff()
                end interface
            `);
            program.validate();
            //  print thing.|
            const completions = program.getCompletions('source/main.bs', util.createPosition(2, 33));
            expectCompletionsIncludes(completions, [{
                label: 'name',
                kind: CompletionItemKind.Field
            }]);
            expectCompletionsIncludes(completions, [{
                label: 'data',
                kind: CompletionItemKind.Field
            }]);
            expectCompletionsIncludes(completions, [{
                label: 'doStuff',
                kind: CompletionItemKind.Method
            }]);

        });

    });

});
