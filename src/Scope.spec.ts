import { expect } from 'chai';
import { EventEmitter } from 'eventemitter3';
import * as sinonImport from 'sinon';
import { Position, Range } from 'vscode-languageserver';
import { standardizePath as s } from './util';
import { Scope } from './Scope';
import { DiagnosticMessages } from './DiagnosticMessages';
import { BrsFile } from './files/BrsFile';
import { Program } from './Program';
import { ParseMode } from './parser/Parser';


describe('Scope', () => {
    let sinon = sinonImport.createSandbox();
    let rootDir = process.cwd();
    let program: Program;
    let scope: Scope;
    beforeEach(() => {
        program = new Program({
            rootDir: rootDir
        });
        scope = new Scope('root', () => { });
        scope.attachProgram(program);
    });
    afterEach(() => {
        sinon.restore();
    });

    it('does not mark namespace functions as collisions with stdlib', async () => {
        await program.addOrReplaceFile({
            src: `${rootDir}/source/main.bs`,
            dest: `source/main.bs`
        }, `
            namespace a
                function constructor()
                end function
            end namespace
        `);

        await program.validate();
        expect(program.getDiagnostics()[0]?.message).not.to.exist;
    });

    describe('attachProgram', () => {
        it('correctly listens to program events', () => {
            scope = new Scope('some scope', () => true);

            let file = new BrsFile(s`${rootDir}/source/file.brs`, s`source/file.brs`, program);

            //we're only testing events, so make this emitter look like a program
            let fakeProgram = new EventEmitter();
            (fakeProgram as any).files = {};

            //attach the program (and therefore to the program's events)
            scope.attachProgram(fakeProgram as any);

            expect(scope.hasFile(file)).to.be.false;

            //"add" a file. scope should keep it
            fakeProgram.emit('file-added', file);
            expect(scope.hasFile(file)).to.be.true;

            //"remove" a file. scope should discard it
            fakeProgram.emit('file-removed', file);
            expect(scope.hasFile(file)).to.be.false;
        });
    });

    describe('attachParentScope', () => {
        it('listens for invalidated events', () => {
            let parentCtx = new Scope('parent', null);
            parentCtx.isValidated = false;

            let childCtx = new Scope('child', null);
            childCtx.isValidated = true;

            //attaching child to invalidated parent invalidates child
            childCtx.attachParentScope(parentCtx);
            expect(childCtx.isValidated).to.be.false;

            childCtx.isValidated = true;

            //when parent emits invalidated, child marks as invalidated
            (parentCtx as any).emit('invalidated');
            expect(childCtx.isValidated).to.be.false;
        });
    });

    describe('addFile', () => {
        it('detects callables from all loaded files', async () => {
            program.platformScope = new Scope('platform', () => false);
            const globalScope = program.getScopeByName('global');
            globalScope.attachParentScope(program.platformScope);

            await program.addOrReplaceFile({ src: s`${rootDir}/source/main.brs`, dest: s`source/main.brs` }, `
                sub Main()

                end sub

                sub ActionA()
                end sub
            `);
            await program.addOrReplaceFile({ src: s`${rootDir}/source/lib.brs`, dest: s`source/lib.brs` }, `
                sub ActionB()
                end sub
            `);

            await program.validate();

            expect(globalScope.hasFile(`${rootDir}/source/main.brs`));
            expect(globalScope.hasFile(`${rootDir}/source/lib.brs`));
            expect(program.getDiagnostics()).to.be.lengthOf(0);
            expect(globalScope.getOwnCallables()).is.lengthOf(3);
            expect(globalScope.getAllCallables()).is.lengthOf(3);
        });

        it('picks up new callables', async () => {
            //we have global callables, so get that initial number
            let originalLength = scope.getAllCallables().length;
            let file = new BrsFile('absolute_path/file.brs', 'relative_path/file.brs', program);
            await file.parse(`
                function DoA()
                    print "A"
                end function

                 function DoA()
                     print "A"
                 end function
            `);
            scope.addOrReplaceFile(file);
            expect(scope.getAllCallables().length).to.equal(originalLength + 2);
        });
    });

    describe('removeFile', () => {
        it('removes callables from list', async () => {
            let initCallableCount = scope.getAllCallables().length;
            //add the file
            let file = new BrsFile(s`${rootDir}/source/file.brs`, s`source/file.brs`, program);
            await file.parse(`
                function DoA()
                    print "A"
                end function
            `);
            scope.addOrReplaceFile(file);
            expect(scope.getAllCallables().length).to.equal(initCallableCount + 1);

            //remove the file
            scope.removeFile(file);
            expect(scope.getAllCallables().length).to.equal(initCallableCount);
        });
    });

    describe('validate', () => {
        it('marks the scope as validated after validation has occurred', async () => {
            await program.addOrReplaceFile({ src: s`${rootDir}/source/main.bs`, dest: s`source/main.bs` }, `
               sub main()
               end sub
            `);
            let lib = await program.addOrReplaceFile({ src: s`${rootDir}/source/lib.bs`, dest: s`source/lib.bs` }, `
               sub libFunc()
               end sub
            `);
            expect(program.getScopesForFile(lib)[0].isValidated).to.be.false;
            await program.validate();
            expect(program.getScopesForFile(lib)[0].isValidated).to.be.true;
            lib = await program.addOrReplaceFile({ src: s`${rootDir}/source/lib.bs`, dest: s`source/lib.bs` }, `
                sub libFunc()
                end sub
            `);

            //scope gets marked as invalidated
            expect(program.getScopesForFile(lib)[0].isValidated).to.be.false;

        });

        it('does not mark same-named-functions in different namespaces as an error', async () => {
            await program.addOrReplaceFile({ src: s`${rootDir}/source/main.bs`, dest: s`source/main.bs` }, `
                namespace NameA
                    sub alert()
                    end sub
                end namespace
                namespace NameB
                    sub alert()
                    end sub
                end namespace
            `);
            await program.validate();
            expect(program.getDiagnostics()[0]?.message).not.to.exist;
            expect(program.getDiagnostics()).to.be.lengthOf(0);
        });
        it('resolves local-variable function calls', async () => {
            await program.addOrReplaceFile({ src: s`${rootDir}/source/main.brs`, dest: s`source/main.brs` }, `
                sub DoSomething()
                    sayMyName = function(name as string)
                    end function

                    sayMyName()
                end sub`
            );
            await program.validate();
            expect(program.getDiagnostics()[0]?.message).not.to.exist;
            expect(program.getDiagnostics()).to.be.lengthOf(0);
        });

        describe('function shadowing', () => {
            it('warns when local var function has same name as stdlib function', async () => {
                await program.addOrReplaceFile({ src: s`${rootDir}/source/main.brs`, dest: s`source/main.brs` }, `
                    sub main()
                        str = function(p)
                            return "override"
                        end function
                        print str(12345) 'prints "12345" (i.e. our local function is never used)
                    end sub
                `);
                await program.validate();
                let diagnostics = program.getDiagnostics().map(x => {
                    return {
                        message: x.message,
                        range: x.range
                    };
                });
                expect(diagnostics[0]).to.exist.and.to.eql({
                    message: DiagnosticMessages.localVarFunctionShadowsParentFunction('stdlib').message,
                    range: Range.create(2, 24, 2, 27)
                });
            });

            it('warns when local var has same name as built-in function', async () => {
                await program.addOrReplaceFile({ src: s`${rootDir}/source/main.brs`, dest: s`source/main.brs` }, `
                    sub main()
                        str = 12345
                        print str ' prints "12345" (i.e. our local variable is allowed to shadow the built-in function name)
                    end sub
                `);
                await program.validate();
                let diagnostics = program.getDiagnostics();
                expect(diagnostics[0]?.message).not.to.exist;
            });

            it('warns when local var has same name as built-in function', async () => {
                await program.addOrReplaceFile({ src: s`${rootDir}/source/main.brs`, dest: s`source/main.brs` }, `
                    sub main()
                        str = 6789
                        print str(12345) ' prints "12345" (i.e. our local variable did not override the callable global function)
                    end sub
                `);
                await program.validate();
                let diagnostics = program.getDiagnostics();
                expect(diagnostics[0]?.message).not.to.exist;
            });

            it('detects local function with same name as scope function', async () => {
                await program.addOrReplaceFile({ src: s`${rootDir}/source/main.brs`, dest: s`source/main.brs` }, `
                    sub main()
                        getHello = function()
                            return "override"
                        end function
                        print getHello() 'prints "hello" (i.e. our local variable is never called)
                    end sub
                    
                    function getHello()
                        return "hello"
                    end function
                `);
                await program.validate();
                let diagnostics = program.getDiagnostics().map(x => {
                    return {
                        message: x.message,
                        range: x.range
                    };
                });
                expect(diagnostics[0]).to.exist.and.to.eql({
                    message: DiagnosticMessages.localVarFunctionShadowsParentFunction('scope').message,
                    range: Range.create(2, 24, 2, 32)
                });
            });

            it('detects local function with same name as scope function', async () => {
                await program.addOrReplaceFile({ src: s`${rootDir}/source/main.brs`, dest: s`source/main.brs` }, `
                    sub main()
                        getHello = "override"
                        print getHello ' prints <Function: gethello> (i.e. local variable override does NOT work for same-scope-defined methods)
                    end sub
                    function getHello()
                        return "hello"
                    end function
                `);
                await program.validate();
                let diagnostics = program.getDiagnostics().map(x => {
                    return {
                        message: x.message,
                        range: x.range
                    };
                });
                expect(diagnostics[0]).to.exist.and.to.eql({
                    message: DiagnosticMessages.localVarShadowedByScopedFunction().message,
                    range: Range.create(2, 24, 2, 32)
                });
            });

            it('detects scope function with same name as built-in function', async () => {
                await program.addOrReplaceFile({ src: s`${rootDir}/source/main.brs`, dest: s`source/main.brs` }, `
                    sub main()
                        print str(12345) ' prints 12345 (i.e. our str() function below is ignored)
                    end sub
                    function str(num)
                        return "override"
                    end function
                `);
                await program.validate();
                let diagnostics = program.getDiagnostics().map(x => {
                    return {
                        message: x.message,
                        range: x.range
                    };
                });
                expect(diagnostics[0]).to.exist.and.to.eql({
                    message: DiagnosticMessages.scopeFunctionShadowedByBuiltInFunction().message,
                    range: Range.create(4, 29, 4, 32)
                });
            });
        });

        it('detects duplicate callables', async () => {
            expect(scope.getDiagnostics().length).to.equal(0);
            let file = new BrsFile('absolute_path/file.brs', 'relative_path/file.brs', program);
            await file.parse(`
                function DoA()
                    print "A"
                end function

                 function DoA()
                     print "A"
                 end function
            `);
            scope.addOrReplaceFile(file);
            expect(
                scope.getDiagnostics().length
            ).to.equal(0);
            //validate the scope
            scope.validate();
            //we should have the "DoA declared more than once" error twice (one for each function named "DoA")
            expect(scope.getDiagnostics().length).to.equal(2);
        });

        it('detects calls to unknown callables', async () => {
            expect(scope.getDiagnostics().length).to.equal(0);
            let file = new BrsFile('absolute_path/file.brs', 'relative_path/file.brs', program);
            await file.parse(`
                function DoA()
                    DoB()
                end function
            `);
            scope.addOrReplaceFile(file);
            expect(scope.getDiagnostics().length).to.equal(0);
            //validate the scope
            scope.validate();
            //we should have the "DoA declared more than once" error twice (one for each function named "DoA")
            expect(scope.getDiagnostics().length).to.equal(1);
            expect(scope.getDiagnostics()[0]).to.deep.include({
                code: DiagnosticMessages.callToUnknownFunction('DoB', '').code
            });
        });

        it('recognizes known callables', async () => {
            expect(scope.getDiagnostics().length).to.equal(0);
            let file = new BrsFile('absolute_path/file.brs', 'relative_path/file.brs', program);
            await file.parse(`
                function DoA()
                    DoB()
                end function
                function DoB()
                    DoC()
                end function
            `);
            scope.addOrReplaceFile(file);
            expect(scope.getDiagnostics().length).to.equal(0);
            //validate the scope
            scope.validate();
            expect(scope.getDiagnostics().length).to.equal(1);
            expect(scope.getDiagnostics()[0]).to.deep.include({
                code: DiagnosticMessages.callToUnknownFunction('DoC', '').code
            });
        });

        //We don't currently support someObj.callSomething() format, so don't throw errors on those
        it('does not fail on object callables', async () => {
            expect(scope.getDiagnostics().length).to.equal(0);
            let file = new BrsFile('absolute_path/file.brs', 'relative_path/file.brs', program);
            await file.parse(`
                function DoB()
                    m.doSomething()
                end function
            `);
            scope.addOrReplaceFile(file);
            //validate the scope
            scope.validate();
            //shouldn't have any errors
            expect(scope.getDiagnostics().length).to.equal(0);
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
            scope.addOrReplaceFile(file);
            scope.validate();
            //should have an error
            expect(scope.getDiagnostics().length).to.equal(1);
            expect(scope.getDiagnostics()[0]).to.deep.include({
                ...DiagnosticMessages.mismatchArgumentCount(0, 1)
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
            scope.addOrReplaceFile(file);
            scope.validate();
            //should have an error
            expect(scope.getDiagnostics().length).to.equal(1);
            expect(scope.getDiagnostics()[0]).to.deep.include({
                ...DiagnosticMessages.mismatchArgumentCount(1, 0)
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
            scope.addOrReplaceFile(file);
            scope.validate();
            //should have an error
            expect(scope.getDiagnostics().length).to.equal(0);
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
            scope.addOrReplaceFile(file);
            scope.validate();
            //should have an error
            expect(scope.getDiagnostics().length).to.equal(1);
            expect(scope.getDiagnostics()[0]).to.deep.include({
                ...DiagnosticMessages.mismatchArgumentCount('1-2', 0)
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
            scope.addOrReplaceFile(file);
            scope.validate();
            //should have an error
            expect(scope.getDiagnostics().length).to.equal(0);
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
            scope.addOrReplaceFile(file);
            scope.validate();
            //should have an error
            expect(scope.getDiagnostics().length).to.equal(1);
            expect(scope.getDiagnostics()[0]).to.deep.include({
                ...DiagnosticMessages.mismatchArgumentCount(1, 2)
            });
        });
    });

    describe('inheritance', () => {
        it('inherits callables from parent', () => {
            program = new Program({ rootDir: rootDir });
            //erase the platform scope so our tests are more stable
            program.platformScope = new Scope('platform', null);

            let parentFile = new BrsFile('parentFile.brs', 'parentFile.brs', program);
            parentFile.callables.push(<any>{
                name: 'parentFunction'
            });
            let parentScope = new Scope('parent', null);
            parentScope.attachProgram(program);
            parentScope.addOrReplaceFile(parentFile);

            let childScope = new Scope('child', null);
            childScope.attachProgram(program);
            expect(childScope.getAllCallables()).to.be.lengthOf(0);

            childScope.attachParentScope(parentScope);

            //now that we attached the parent, the child should recognize the parent's callables
            expect(childScope.getAllCallables()).to.be.lengthOf(1);
            expect(childScope.getAllCallables()[0].callable.name).to.equal('parentFunction');

            //removes parent callables when parent is detached
            childScope.detachParent();
            expect(childScope.getAllCallables()).to.be.lengthOf(0);
        });
    });

    describe('detachParent', () => {
        it('does not attach platform to itself', () => {
            expect(program.platformScope.parentScope).to.be.undefined;
            program.platformScope.detachParent();
            expect(program.platformScope.parentScope).to.be.undefined;
        });
    });

    describe('shouldIncludeFile', () => {
        it('should detect whether to keep a file or not', () => {
            scope = new Scope('testScope1', () => {
                return false;
            });
            expect(scope.shouldIncludeFile({} as any)).to.be.false;

            scope = new Scope('testScope2', () => {
                return true;
            });
            expect(scope.shouldIncludeFile({} as any)).to.be.true;

            //should bubble the error
            expect(() => {
                scope = new Scope('testScope2', () => {
                    throw new Error('error');
                });
                scope.shouldIncludeFile({} as any);
            }).to.throw;
        });
    });

    describe('getDefinition', () => {
        it('returns empty list when there are no files', async () => {
            let file = await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, '');
            scope = program.getScopeByName('global');
            expect(scope.getDefinition(file, Position.create(0, 0))).to.be.lengthOf(0);
        });
    });

    describe('getCallablesAsCompletions', () => {
        it('returns documentation when possible', () => {
            let completions = program.platformScope.getCallablesAsCompletions(ParseMode.BrightScript);
            expect(completions.filter(x => !!x.documentation)).to.have.length.greaterThan(0);
        });
    });
});
