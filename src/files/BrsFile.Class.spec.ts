import * as sinonImport from 'sinon';

import { Program } from '../Program';
import { getTestTranspile } from './BrsFile.spec';
import { BrsFile } from './BrsFile';
import { expect } from 'chai';

let sinon = sinonImport.createSandbox();

describe('BrsFile BrighterScript classes', () => {
    let rootDir = process.cwd();
    let program: Program;
    let testTranspile = getTestTranspile(() => [program, rootDir]);

    beforeEach(() => {
        program = new Program({ rootDir: rootDir });
    });
    afterEach(() => {
        sinon.restore();
    });

    it('detects all classes after parse', async () => {
        let file = (await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
            class Animal
            end class
            class Duck
            end class
        `) as BrsFile);
        expect(file.classStatements.map(x => x.name.text).sort()).to.eql(['Animal', 'Duck']);
    });

    describe('transpile', () => {
        it('works for simple  class', async () => {
            await testTranspile(`
                class Duck
                end class
            `, `
                function __Duck_builder()
                    instance = {}
                    instance.new = sub()
                    end sub
                    return instance
                end function
                function Duck()
                    instance = __Duck_builder()
                    instance.new()
                    return instance
                end function
            `);
        });

        it('registers the constructor and properly handles its parameters', async () => {
            await testTranspile(`
                class Duck
                    sub new(name as string, age as integer)
                    end sub
                end class
            `, `
                function __Duck_builder()
                    instance = {}
                    instance.new = sub(name as string, age as integer)
                    end sub
                    return instance
                end function
                function Duck(name as string, age as integer)
                    instance = __Duck_builder()
                    instance.new(name, age)
                    return instance
                end function
            `);
        });

        it('properly handles child class constructor override and super calls', async () => {
            await testTranspile(`
                class Animal
                    sub new(name as string)
                    end sub
                end class

                class Duck extends Animal
                    sub new(name as string, age as integer) 
                        super(name)
                        super.DoSomething()
                    end sub
                end class
            `, `
                function __Animal_builder()
                    instance = {}
                    instance.new = sub(name as string)
                    end sub
                    return instance
                end function
                function Animal(name as string)
                    instance = __Animal_builder()
                    instance.new(name)
                    return instance
                end function
                function __Duck_builder()
                    instance = __Animal_builder()
                    instance.super0_new = instance.new
                    instance.new = sub(name as string, age as integer)
                        instance.super0_new(name)
                        instance.super0_DoSomething()
                    end sub
                    return instance
                end function
                function Duck(name as string, age as integer)
                    instance = __Duck_builder()
                    instance.new(name, age)
                    return instance
                end function
            `);
        });
    });

});
