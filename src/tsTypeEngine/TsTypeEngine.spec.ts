import { expect } from '../chai-config.spec';
import * as ts from 'typescript';
import { Program } from '../Program';
import type { BrsFile } from '../files/BrsFile';
import { expectDiagnostics, expectZeroDiagnostics, rootDir } from '../testHelpers.spec';
import { util } from '../util';
import { TsTypeEngine } from './TsTypeEngine';
import { getPrelude, PRELUDE_PATH } from './Prelude';
import { TsTypeEnginePlugin } from './TsTypeEnginePlugin';
import { Parser, ParseMode } from '../parser/Parser';

describe('TsTypeEngine', () => {
    let program: Program;
    let engine: TsTypeEngine;

    beforeEach(() => {
        program = new Program({ rootDir: rootDir });
        engine = new TsTypeEngine(program);
    });

    afterEach(() => {
        engine.dispose();
        program.dispose();
    });

    function check(source: string, pkgPath = 'source/main.bs') {
        program.setFile(pkgPath, source);
        program.validate();
        return engine.getDiagnostics();
    }

    it('generates a prelude that has no errors of its own', () => {
        const sourceFile = ts.createSourceFile(PRELUDE_PATH, getPrelude(), ts.ScriptTarget.ES5);
        const host = ts.createCompilerHost({});
        host.getSourceFile = (fileName) => (fileName === PRELUDE_PATH ? sourceFile : undefined);
        const tsProgram = ts.createProgram([PRELUDE_PATH], { noLib: true, strict: true, noEmit: true, types: [] }, host);
        expect(ts.getPreEmitDiagnostics(tsProgram).map(x => ts.flattenDiagnosticMessageText(x.messageText, '\n'))).to.eql([]);
    });

    it('finds argument type mismatches and maps them back to the BrighterScript source', () => {
        expectDiagnostics(check(`
            function add(a as integer, b as integer) as integer
                return a + b
            end function
            sub main()
                print add("one", 2)
            end sub
        `), [{
            code: 'ts2345',
            message: `Argument of type 'string' is not assignable to parameter of type 'integer'.\n  Type 'string' is not assignable to type 'number'.`,
            location: { range: util.createRange(5, 26, 5, 31) }
        }]);
    });

    it('treats BrighterScript as case-insensitive and restores the declared casing in messages', () => {
        expectDiagnostics(check(`
            namespace Alpha.Beta
                function DoThing(value as string) as string
                    return value
                end function
            end namespace
            sub main()
                print ALPHA.beta.dothing("ok")
                print alpha.BETA.DOTHING(1)
                print alpha.beta.missing()
            end sub
        `), [
            `Argument of type 'number' is not assignable to parameter of type 'string'.`,
            `Property 'missing' does not exist on type 'typeof Beta'.`
        ]);
    });

    it('applies BrightScript operator rules', () => {
        expectDiagnostics(check(`
            sub main()
                a = 1 + 2.5
                b = "a" + "b"
                c = "a" + 1
                d = 1 - "a"
                e = true + 1
            end sub
        `), [
            `Argument of type 'number' is not assignable to parameter of type 'string'.`,
            `Argument of type 'string' is not assignable to parameter of type 'number'.`,
            `Argument of type 'boolean' is not assignable to parameter of type '$Addable'.`
        ]);
    });

    it('lets a variable change type on reassignment, and unions the types from different branches', () => {
        expectDiagnostics(check(`
            sub takesString(value as string)
            end sub
            sub main(flag as boolean)
                x = 1
                x = "now a string"
                takesString(x)
                y = 1
                if flag then y = "maybe a string"
                takesString(y)
            end sub
        `), [{
            message: `Argument of type 'string or number' is not assignable to parameter of type 'string'.\n  Type 'number' is not assignable to type 'string'.`,
            location: { range: util.createRange(9, 28, 9, 29) }
        }]);
    });

    it('narrows away invalid', () => {
        expectDiagnostics(check(`
            sub takesString(value as string)
            end sub
            sub main(flag as boolean)
                label = invalid
                if flag then label = "set"
                takesString(label)
                if label <> invalid
                    takesString(label)
                end if
            end sub
        `), [{
            message: `Argument of type 'string or invalid' is not assignable to parameter of type 'string'.\n  Type 'invalid' is not assignable to type 'string'.`,
            location: { range: util.createRange(6, 28, 6, 33) }
        }]);
    });

    it('supports union type annotations', () => {
        expectDiagnostics(check(`
            sub takesString(value as string)
            end sub
            sub main(value as string or integer)
                takesString(value)
            end sub
        `), [
            `Argument of type 'string or integer' is not assignable to parameter of type 'string'.\n  Type 'integer' is not assignable to type 'string'.`
        ]);
    });

    describe('generics', () => {
        it('parses generic functions, interfaces and classes', () => {
            const { diagnostics } = Parser.parse(`
                interface Container<T>
                    value as T
                end interface
                class Stack<T>
                    items as T[] = []
                end class
                function wrap<T, U>(value as T, other as U) as Container<Container<T>>
                    return { value: { value: value } }
                end function
                sub main()
                    stack = new Stack<Container<string>>()
                end sub
            `, { mode: ParseMode.BrighterScript });
            expectZeroDiagnostics(diagnostics);
        });

        it('infers type arguments from function arguments', () => {
            expectDiagnostics(check(`
                function identity<T>(value as T) as T
                    return value
                end function
                function first<T>(items as T[]) as T
                    return items[0]
                end function
                sub takesString(value as string)
                end sub
                sub main()
                    takesString(identity("ok"))
                    takesString(identity(5))
                    takesString(first(["a", "b"]))
                    takesString(first([1, 2]))
                end sub
            `), [
                `Argument of type 'number' is not assignable to parameter of type 'string'.`,
                `Argument of type 'number' is not assignable to parameter of type 'string'.`
            ]);
        });

        it('supports generic interfaces and classes', () => {
            expectDiagnostics(check(`
                interface Container<T>
                    value as T
                end interface
                class Stack<T>
                    items as T[] = []
                    sub push(item as T)
                        m.items.push(item)
                    end sub
                    function peek() as T
                        return m.items[m.items.count() - 1]
                    end function
                end class
                function wrap<T>(value as T) as Container<T>
                    return { value: value }
                end function
                sub takesString(value as string)
                end sub
                sub main()
                    takesString(wrap("ok").value)
                    takesString(wrap(1).value)
                    names = new Stack<string>()
                    names.push("a")
                    names.push(1)
                    takesString(names.peek())
                end sub
            `), [
                `Argument of type 'number' is not assignable to parameter of type 'string'.`,
                `Argument of type 'number' is not assignable to parameter of type 'string'.`
            ]);
        });
    });

    describe('classes', () => {
        it('checks members, inheritance and override', () => {
            expectDiagnostics(check(`
                class Animal
                    name as string = ""
                    function speak() as string
                        return m.name
                    end function
                end class
                class Dog extends Animal
                    override function speak() as string
                        return m.name + " barks"
                    end function
                end class
                class Cat extends Animal
                    function speak() as string
                        return m.nmae
                    end function
                end class
                sub main()
                    d = new Dog()
                    d.name = 1
                end sub
            `), [
                `This member must have an 'override' modifier because it overrides a member in the base class 'Animal'.`,
                `Property 'nmae' does not exist on type 'Cat'.`,
                `Type 'number' is not assignable to type 'string'.`
            ]);
        });
    });

    it('checks enums', () => {
        expectDiagnostics(check(`
            enum Direction
                Up = "up"
                Down = "down"
            end enum
            sub takesDirection(value as Direction)
            end sub
            sub takesString(value as string)
            end sub
            sub main()
                takesDirection(Direction.Up)
                takesDirection("up")
                takesString(Direction.Down)
            end sub
        `), [
            `Argument of type '"up"' is not assignable to parameter of type 'Direction'.`
        ]);
    });

    it('knows the built-in components, nodes and intrinsic methods', () => {
        expectDiagnostics(check(`
            sub main()
                label = CreateObject("roSGNode", "Label")
                label.text = "hello"
                label.text = 5
                s = "abc"
                print s.len() + 1
                print s.notAMethod()
                arr = CreateObject("roArray", 5, true)
                arr.push(1)
                bad = CreateObject("roNotAThing")
            end sub
        `), [
            `Type 'number' is not assignable to type 'string'.`,
            `Property 'notAMethod' does not exist on type 'string'.`,
            `Argument of type '"ronotathing"' is not assignable to parameter of type 'keyof $components'.`
        ]);
    });

    it('allows any member on associative arrays and dynamic values', () => {
        expectZeroDiagnostics(check(`
            sub main(value)
                aa = { known: 1 }
                print aa.known + 1
                print aa.unknown
                aa.another = "x"
                print value.anything.at.all()
            end sub
        `));
    });

    it('checks each component scope separately', () => {
        program.setFile('components/shared.bs', `
            sub useHelper()
                takesString(helper())
            end sub
            sub takesString(value as string)
            end sub
        `);
        program.setFile('components/a.bs', `
            function helper() as string
                return "a"
            end function
        `);
        program.setFile('components/b.bs', `
            function helper() as integer
                return 1
            end function
        `);
        for (const name of ['A', 'B']) {
            program.setFile(`components/${name}.xml`, `<?xml version="1.0" encoding="utf-8" ?>
                <component name="Comp${name}" extends="Group">
                    <script uri="shared.bs" />
                    <script uri="${name.toLowerCase()}.bs" />
                </component>
            `);
        }
        program.validate();
        expectDiagnostics(engine.getDiagnostics(), [
            `Argument of type 'integer' is not assignable to parameter of type 'string'. (in scope components/B.xml)`
        ]);
    });

    it('re-checks only what changed', () => {
        expect(check(`
            function getName() as string
                return "a"
            end function
        `)).to.eql([]);
        const file = program.getFile<BrsFile>('source/main.bs');
        const emitVersion = engine.getEmittedFile(file).version;

        program.setFile('source/other.bs', `
            sub main()
                getName()
            end sub
        `);
        program.validate();
        expect(engine.getDiagnostics()).to.eql([]);
        //main.bs didn't change, so it wasn't re-emitted
        expect(engine.getEmittedFile(file).version).to.equal(emitVersion);

        expectDiagnostics(check(`
            function getName() as string
                return 1
            end function
        `), [
            `Type 'number' is not assignable to type 'string'.`
        ]);
    });

    it('describes the type at a position', () => {
        check(`
            function identity<T>(value as T) as T
                return value
            end function
            sub main()
                result = identity("hello")
                print result
            end sub
        `);
        const file = program.getFile<BrsFile>('source/main.bs');
        const offset = file.fileContents.indexOf('print result') + 'print '.length;
        expect(engine.getTypeAtPosition(program.getScopesForFile(file)[0], file, offset)).to.equal('let result: string');
    });

    it('works as a plugin', () => {
        program.plugins.add(new TsTypeEnginePlugin());
        program.setFile('source/main.bs', `
            sub main()
                x = "a" + 1
            end sub
        `);
        program.validate();
        expect(program.getDiagnostics().filter(x => x.source === 'bsc-ts').map(x => x.message)).to.eql([
            `Argument of type 'number' is not assignable to parameter of type 'string'.`
        ]);
    });
});
