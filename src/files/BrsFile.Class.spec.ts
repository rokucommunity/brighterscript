import * as sinonImport from 'sinon';

import { Program } from '../Program';
import { getTestTranspile } from './BrsFile.spec';

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

    describe('transpile', () => {
        it('works for simple  class', async () => {
            await testTranspile(`
                class Duck
                end class
            `, `
                function __Duck_builder()
                    instance = {}
                    return instance
                end function
                function Duck()
                    instance = __Duck_builder()
                    return instance
                end function
            `);
        });

        it.only('registers the constructor and properly handles its parameters', async () => {
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
    });

});
