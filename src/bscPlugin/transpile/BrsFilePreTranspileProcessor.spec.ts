import { createSandbox } from 'sinon';
import * as fsExtra from 'fs-extra';
import { Program } from '../../Program';
import { standardizePath as s } from '../../util';
import { tempDir, rootDir } from '../../testHelpers.spec';
import { getTestTranspile } from '../../testHelpers.spec';
import { LogLevel, createLogger } from '../../logging';
import PluginInterface from '../../PluginInterface';
const sinon = createSandbox();

describe('BrsFile', () => {

    let program: Program;

    beforeEach(() => {
        fsExtra.emptyDirSync(tempDir);
        const logger = createLogger({
            logLevel: LogLevel.warn
        });
        program = new Program({ rootDir: rootDir, sourceMap: true }, logger, new PluginInterface([], {
            logger: logger,
            suppressErrors: false
        }));
    });

    afterEach(() => {
        sinon.restore();
        program.dispose();
    });

    describe('BrsFilePreTranspileProcessor', () => {
        it('does not crash when operating on a file not included by any scope', async () => {
            program.setFile('components/lib.brs', `
                enum Direction
                    up
                    down
                    left
                    right
                end enum
                sub doSomething()
                    a = { b: "c"}
                    print a.b
                    print Direction.up
                end sub
            `);
            await program.transpile([], s`${tempDir}/out`);
        });
    });

    describe('perfettoTracing', () => {
        let tracingProgram: Program;
        let testTranspile: ReturnType<typeof getTestTranspile>;

        beforeEach(() => {
            const logger = createLogger({ logLevel: LogLevel.warn });
            tracingProgram = new Program({ rootDir: rootDir, sourceMap: true, perfettoTracing: true }, logger, new PluginInterface([], {
                logger: logger,
                suppressErrors: false
            }));
            testTranspile = getTestTranspile(() => [tracingProgram, rootDir]);
        });

        afterEach(() => {
            tracingProgram.dispose();
        });

        it('does not inject trace statements when perfettoTracing is disabled', () => {
            // The outer `program` has no perfettoTracing option
            const transpile = getTestTranspile(() => [program, rootDir]);
            transpile(`
                function doSomething()
                    print "hello"
                end function
            `, `
                function doSomething()
                    print "hello"
                end function
            `);
        });

        it('injects trace into a simple function', () => {
            testTranspile(`
                function doSomething()
                    print "hello"
                end function
            `, `
                function doSomething()
                    bsc__trace = CreateObject("roPerfetto").createScopedEvent("doSomething")
                    print "hello"
                end function
            `);
        });

        it('injects trace into a sub', () => {
            testTranspile(`
                sub doSomething()
                    print "hello"
                end sub
            `, `
                sub doSomething()
                    bsc__trace = CreateObject("roPerfetto").createScopedEvent("doSomething")
                    print "hello"
                end sub
            `);
        });

        it('injects trace into a namespace-prefixed function', () => {
            testTranspile(`
                namespace MyApp.Utils
                    function helperFunc()
                        print "hello"
                    end function
                end namespace
            `, `
                function MyApp_Utils_helperFunc()
                    bsc__trace = CreateObject("roPerfetto").createScopedEvent("MyApp_Utils_helperFunc")
                    print "hello"
                end function
            `);
        });

        it('injects trace into a class method', () => {
            testTranspile(`
                class Animal
                    function speak()
                        print "hello"
                    end function
                end class
            `, `
                sub __Animal_method_new()
                end sub
                function __Animal_method_speak()
                    bsc__trace = CreateObject("roPerfetto").createScopedEvent("__Animal_method_speak")
                    print "hello"
                end function
                function __Animal_builder()
                    instance = {}
                    instance.new = __Animal_method_new
                    instance.speak = __Animal_method_speak
                    return instance
                end function
                function Animal()
                    instance = __Animal_builder()
                    instance.new()
                    return instance
                end function
            `, undefined, 'source/main.bs');
        });

        it('injects trace into a namespaced class method', () => {
            testTranspile(`
                namespace Birds
                    class Duck
                        function quack()
                            print "quack"
                        end function
                    end class
                end namespace
            `, `
                sub __Birds_Duck_method_new()
                end sub
                function __Birds_Duck_method_quack()
                    bsc__trace = CreateObject("roPerfetto").createScopedEvent("__Birds_Duck_method_quack")
                    print "quack"
                end function
                function __Birds_Duck_builder()
                    instance = {}
                    instance.new = __Birds_Duck_method_new
                    instance.quack = __Birds_Duck_method_quack
                    return instance
                end function
                function Birds_Duck()
                    instance = __Birds_Duck_builder()
                    instance.new()
                    return instance
                end function
            `, undefined, 'source/main.bs');
        });

        it('injects trace into every function in a file', () => {
            testTranspile(`
                function alpha()
                end function
                function beta()
                end function
            `, `
                function alpha()
                    bsc__trace = CreateObject("roPerfetto").createScopedEvent("alpha")
                end function

                function beta()
                    bsc__trace = CreateObject("roPerfetto").createScopedEvent("beta")
                end function
            `);
        });

        it('does inject trace into an anonymous function expression inside a named function', () => {
            testTranspile(`
                function outer()
                    callback = function()
                        print "I am anon"
                    end function
                    callback()
                end function
            `, `
                function outer()
                    bsc__trace = CreateObject("roPerfetto").createScopedEvent("outer")
                    callback = function()
                        bsc__trace = CreateObject("roPerfetto").createScopedEvent("outer$anon0")
                        print "I am anon"
                    end function
                    callback()
                end function
            `);
        });

        it('does inject trace into multiple anonymous function expressions inside a named function', () => {
            testTranspile(`
                function outer()
                    a = function()
                        print "anon a"
                    end function
                    b = function()
                        print "anon b"
                    end function
                    a()
                    b()
                end function
            `, `
                function outer()
                    bsc__trace = CreateObject("roPerfetto").createScopedEvent("outer")
                    a = function()
                        bsc__trace = CreateObject("roPerfetto").createScopedEvent("outer$anon0")
                        print "anon a"
                    end function
                    b = function()
                        bsc__trace = CreateObject("roPerfetto").createScopedEvent("outer$anon1")
                        print "anon b"
                    end function
                    a()
                    b()
                end function
            `);
        });

        it('does inject trace into a deeply nested anonymous function expression', () => {
            testTranspile(`
                function outer()
                    a = function()
                        b = function()
                            print "deeply anon"
                        end function
                        b()
                    end function
                    a()
                end function
            `, `
                function outer()
                    bsc__trace = CreateObject("roPerfetto").createScopedEvent("outer")
                    a = function()
                        bsc__trace = CreateObject("roPerfetto").createScopedEvent("outer$anon0")
                        b = function()
                            bsc__trace = CreateObject("roPerfetto").createScopedEvent("outer$anon0$anon0")
                            print "deeply anon"
                        end function
                        b()
                    end function
                    a()
                end function
            `);
        });
    });
});
