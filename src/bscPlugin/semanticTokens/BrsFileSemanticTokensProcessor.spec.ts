import { expect } from 'chai';
import { SemanticTokenTypes } from 'vscode-languageserver-protocol';
import type { BrsFile } from '../../files/BrsFile';
import { Program } from '../../Program';
import { expectZeroDiagnostics } from '../../testHelpers.spec';
import { standardizePath as s, util } from '../../util';

const rootDir = s`${process.cwd()}/.tmp/rootDir`;

describe('BrsFileSemanticTokensProcessor', () => {
    let program: Program;
    beforeEach(() => {
        program = new Program({
            rootDir: rootDir
        });
    });
    afterEach(() => {
        program.dispose();
    });

    it('matches each namespace section', () => {
        const file = program.setFile<BrsFile>('source/main.bs', `
            namespace Earthlings.Humanoids
                class Person
                end class
            end namespace
            class Dog
                sub new()
                    m.owner = new Earthlings.Humanoids.Person()
                end sub
            end class
        `);
        program.validate();
        expectZeroDiagnostics(program);
        expect(
            program.getSemanticTokens(file.srcPath)
        ).to.eql([{
            range: util.createRange(7, 34, 7, 44),
            tokenType: SemanticTokenTypes.namespace
        }, {
            range: util.createRange(7, 45, 7, 54),
            tokenType: SemanticTokenTypes.namespace
        }, {
            range: util.createRange(7, 55, 7, 61),
            tokenType: SemanticTokenTypes.class
        }]);
    });
});
