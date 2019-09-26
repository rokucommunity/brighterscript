import { expect } from 'chai';
import { EventEmitter } from 'events';
import * as path from 'path';
import * as sinonImport from 'sinon';
import { Position } from 'vscode-languageserver';

import { Context as Context } from './Context';
import { diagnosticMessages } from './DiagnosticMessages';
import { BrsFile } from './files/BrsFile';
import { Program } from './Program';
import util from './util';
let n = path.normalize;

describe('Context', () => {
    let sinon = sinonImport.createSandbox();
    let rootDir = 'C:/projects/RokuApp';
    let program: Program;
    let context: Context;
    beforeEach(() => {
        program = new Program({
            rootDir: rootDir
        });
        context = new Context('root', () => { });
        context.attachProgram(program);
    });
    afterEach(() => {
        sinon.restore();
    });

    describe('attachProgram', () => {
        it.only('correctly listens to program events', async () => {
            let context = new Context('some context', (file) => true);

            let file = new BrsFile(util.normalizeFilePath(`${rootDir}/source/file.brs`), n('source/file.brs'), program);

            //we're only testing events, so make this emitter look like a program
            let fakeProgram = new EventEmitter();
            (fakeProgram as any).files = {};

            //attach the program (and therefore to the program's events)
            context.attachProgram(fakeProgram as any);

            expect(context.hasFile(file)).to.be.false;

            //"add" a file. context should keep it
            fakeProgram.emit('file-added', file);
            expect(context.hasFile(file)).to.be.true;

            //"remove" a file. context should discard it
            fakeProgram.emit('file-removed', file);
            expect(context.hasFile(file)).to.be.false;
        });
    });

    describe('attachParentContext', () => {
        it('listens for invalidated events', async () => {
            let parentCtx = new Context('parent', null);
            parentCtx.isValidated = false;

            let childCtx = new Context('child', null);
            childCtx.isValidated = true;

            //attaching child to invalidated parent invalidates child
            childCtx.attachParentContext(parentCtx);
            expect(childCtx.isValidated).to.be.false;

            childCtx.isValidated = true;

            //when parent emits invalidated, child marks as invalidated
            (parentCtx as any).emit('invalidated');
            expect(childCtx.isValidated).to.be.false;
        });
    });

    describe('addFile', () => {
        it('detects callables from all loaded files', async () => {
            program.platformContext = new Context('platform', () => false);
            program.contexts.global.attachParentContext(program.platformContext);

            await program.addOrReplaceFile(`${rootDir}/source/main.brs`, `
                sub Main()

                end sub

                sub ActionA()
                end sub
            `);
            await program.addOrReplaceFile(`${rootDir}/source/lib.brs`, `
                sub ActionB()
                end sub
            `);

            await program.validate();

            expect(program.contexts.global.hasFile(`${rootDir}/source/main.brs`));
            expect(program.contexts.global.hasFile(`${rootDir}/source/lib.brs`));
            expect(program.getDiagnostics()).to.be.lengthOf(0);
            expect(program.contexts.global.getOwnCallables()).is.lengthOf(3);
            expect(program.contexts.global.getAllCallables()).is.lengthOf(3);
        });

        it('picks up new callables', async () => {
            //we have global callables, so get that initial number
            let originalLength = context.getAllCallables().length;
            let file = new BrsFile('absolute_path/file.brs', 'relative_path/file.brs', program);
            await file.parse(`
                function DoA()
                    print "A"
                end function

                 function DoA()
                     print "A"
                 end function
            `);
            context.addOrReplaceFile(file);
            expect(context.getAllCallables().length).to.equal(originalLength + 2);
        });
    });

    describe('removeFile', () => {
        it('removes callables from list', async () => {
            let initCallableCount = context.getAllCallables().length;
            //add the file
            let file = new BrsFile(util.normalizeFilePath(`${rootDir}/source/file.brs`), n('source/file.brs'), program);
            await file.parse(`
                function DoA()
                    print "A"
                end function
            `);
            context.addOrReplaceFile(file);
            expect(context.getAllCallables().length).to.equal(initCallableCount + 1);

            //remove the file
            context.removeFile(file);
            expect(context.getAllCallables().length).to.equal(initCallableCount);
        });
    });

    describe('validate', () => {
        it('resolves local-variable function calls', async () => {
            await program.addOrReplaceFile(`${rootDir}/source/main.brs`, `
                sub DoSomething()
                    sayMyName = function(name as string)
                    end function

                    sayMyName()
                end sub`
            );
            await program.validate();
            expect(program.getDiagnostics()).to.be.lengthOf(0);
        });

        it('detects local functions with same name as global', async () => {
            await program.addOrReplaceFile(`${rootDir}/source/main.brs`, `
                sub Main()
                    SayHi = sub()
                        print "Hi from inner"
                    end sub
                end sub
                sub SayHi()
                    print "Hi from outer"
                end sub
            `);
            await program.validate();
            let diagnostics = program.getDiagnostics();
            expect(diagnostics).to.be.lengthOf(1);
            expect(diagnostics[0].code).to.equal(diagnosticMessages.Local_var_shadows_global_function_1011('', '').code);
        });

        it('detects duplicate callables', async () => {
            expect(context.getDiagnostics().length).to.equal(0);
            let file = new BrsFile('absolute_path/file.brs', 'relative_path/file.brs', program);
            await file.parse(`
                function DoA()
                    print "A"
                end function

                 function DoA()
                     print "A"
                 end function
            `);
            context.addOrReplaceFile(file);
            expect(
                context.getDiagnostics().length
            ).to.equal(0);
            //validate the context
            context.validate();
            //we should have the "DoA declared more than once" error twice (one for each function named "DoA")
            expect(context.getDiagnostics().length).to.equal(2);
        });

        it('detects calls to unknown callables', async () => {
            expect(context.getDiagnostics().length).to.equal(0);
            let file = new BrsFile('absolute_path/file.brs', 'relative_path/file.brs', program);
            await file.parse(`
                function DoA()
                    DoB()
                end function
            `);
            context.addOrReplaceFile(file);
            expect(context.getDiagnostics().length).to.equal(0);
            //validate the context
            context.validate();
            //we should have the "DoA declared more than once" error twice (one for each function named "DoA")
            expect(context.getDiagnostics().length).to.equal(1);
            expect(context.getDiagnostics()[0]).to.deep.include({
                code: diagnosticMessages.Call_to_unknown_function_1001('DoB', '').code
            });
        });

        it('recognizes known callables', async () => {
            expect(context.getDiagnostics().length).to.equal(0);
            let file = new BrsFile('absolute_path/file.brs', 'relative_path/file.brs', program);
            await file.parse(`
                function DoA()
                    DoB()
                end function
                function DoB()
                    DoC()
                end function
            `);
            context.addOrReplaceFile(file);
            expect(context.getDiagnostics().length).to.equal(0);
            //validate the context
            context.validate();
            expect(context.getDiagnostics().length).to.equal(1);
            expect(context.getDiagnostics()[0]).to.deep.include({
                code: diagnosticMessages.Call_to_unknown_function_1001('DoC', '').code
            });
        });

        //We don't currently support someObj.callSomething() format, so don't throw errors on those
        it('does not fail on object callables', async () => {
            expect(context.getDiagnostics().length).to.equal(0);
            let file = new BrsFile('absolute_path/file.brs', 'relative_path/file.brs', program);
            await file.parse(`
                function DoB()
                    m.doSomething()
                end function
            `);
            context.addOrReplaceFile(file);
            //validate the context
            context.validate();
            //shouldn't have any errors
            expect(context.getDiagnostics().length).to.equal(0);
        });

        it('detects calling functions with too many parameters', async () => {
            //sanity check
            let file = new BrsFile('absolute_path/file.brs', 'relative_path/file.brs', program);
            await file.parse(`
                sub a()
                end sub
                sub b()
                    a(1)
                end sub
            `);
            context.addOrReplaceFile(file);
            context.validate();
            //should have an error
            expect(context.getDiagnostics().length).to.equal(1);
            expect(context.getDiagnostics()[0]).to.deep.include({
                ...diagnosticMessages.Expected_a_arguments_but_got_b_1002(0, 1)
            });
        });

        it('detects calling functions with too many parameters', async () => {
            //sanity check
            let file = new BrsFile('absolute_path/file.brs', 'relative_path/file.brs', program);
            await file.parse(`
                sub a(name)
                end sub
                sub b()
                    a()
                end sub
            `);
            context.addOrReplaceFile(file);
            context.validate();
            //should have an error
            expect(context.getDiagnostics().length).to.equal(1);
            expect(context.getDiagnostics()[0]).to.deep.include({
                ...diagnosticMessages.Expected_a_arguments_but_got_b_1002(1, 0)
            });
        });

        it('allows skipping optional parameter', async () => {
            //sanity check
            let file = new BrsFile('absolute_path/file.brs', 'relative_path/file.brs', program);
            await file.parse(`
                sub a(name="Bob")
                end sub
                sub b()
                    a()
                end sub
            `);
            context.addOrReplaceFile(file);
            context.validate();
            //should have an error
            expect(context.getDiagnostics().length).to.equal(0);
        });

        it('shows expected parameter range in error message', async () => {
            //sanity check
            let file = new BrsFile('absolute_path/file.brs', 'relative_path/file.brs', program);
            await file.parse(`
                sub a(age, name="Bob")
                end sub
                sub b()
                    a()
                end sub
            `);
            context.addOrReplaceFile(file);
            context.validate();
            //should have an error
            expect(context.getDiagnostics().length).to.equal(1);
            expect(context.getDiagnostics()[0]).to.deep.include({
                ...diagnosticMessages.Expected_a_arguments_but_got_b_1002('1-2', 0)
            });
        });

        it('handles expressions as arguments to a function', async () => {
            //sanity check
            let file = new BrsFile('absolute_path/file.brs', 'relative_path/file.brs', program);
            await file.parse(`
                sub a(age, name="Bob")
                end sub
                sub b()
                    a("cat" + "dog" + "mouse")
                end sub
            `);
            context.addOrReplaceFile(file);
            context.validate();
            //should have an error
            expect(context.getDiagnostics().length).to.equal(0);
        });

        it('Catches extra arguments for expressions as arguments to a function', async () => {
            //sanity check
            let file = new BrsFile('absolute_path/file.brs', 'relative_path/file.brs', program);
            await file.parse(`
                sub a(age)
                end sub
                sub b()
                    a(m.lib.movies[0], 1)
                end sub
            `);
            context.addOrReplaceFile(file);
            context.validate();
            //should have an error
            expect(context.getDiagnostics().length).to.equal(1);
            expect(context.getDiagnostics()[0]).to.deep.include({
                ...diagnosticMessages.Expected_a_arguments_but_got_b_1002(1, 2),
            });
        });
    });

    describe('inheritance', () => {
        it('inherits callables from parent', () => {
            let program = new Program({ rootDir: rootDir });
            //erase the platform context so our tests are more stable
            program.platformContext = new Context('platform', null);

            let parentFile = new BrsFile('parentFile.brs', 'parentFile.brs', program);
            parentFile.callables.push(<any>{
                name: 'parentFunction'
            });
            let parentContext = new Context('parent', null);
            parentContext.attachProgram(program);
            parentContext.addOrReplaceFile(parentFile);

            let childContext = new Context('child', null);
            childContext.attachProgram(program);
            expect(childContext.getAllCallables()).to.be.lengthOf(0);

            childContext.attachParentContext(parentContext);

            //now that we attached the parent, the child should recognize the parent's callables
            expect(childContext.getAllCallables()).to.be.lengthOf(1);
            expect(childContext.getAllCallables()[0].callable.name).to.equal('parentFunction');

            //removes parent callables when parent is detached
            childContext.detachParent();
            expect(childContext.getAllCallables()).to.be.lengthOf(0);
        });
    });

    describe('shouldIncludeFile', () => {
        it('should detect whether to keep a file or not', () => {
            let context = new Context('testContext1', () => {
                return false;
            });
            expect(context.shouldIncludeFile({} as any)).to.be.false;

            context = new Context('testContext2', () => {
                return true;
            });
            expect(context.shouldIncludeFile({} as any)).to.be.true;

            //should bubble the error
            expect(() => {
                context = new Context('testContext2', () => {
                    throw new Error('error');
                });
                context.shouldIncludeFile({} as any);
            }).to.throw;
        });
    });

    describe('getDefinition', () => {
        it('returns empty list when there are no files', async () => {
            let file = await program.addOrReplaceFile(`${rootDir}/source/main.brs`, '');
            let context = program.contexts.global;
            expect(context.getDefinition(file, Position.create(0, 0))).to.be.lengthOf(0);
        });
    });

    describe('getCallablesAsCompletions', () => {
        it('returns documentation when possible', () => {
            let completions = program.platformContext.getCallablesAsCompletions();
            expect(completions.filter(x => !!x.documentation)).to.have.length.greaterThan(0);
        });
    });
});
