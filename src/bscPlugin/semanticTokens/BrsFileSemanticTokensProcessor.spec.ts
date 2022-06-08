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

    it('matches each namespace section for class', () => {
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

    it('matches each namespace section', () => {
        const file = program.setFile<BrsFile>('source/main.bs', `
            sub main()
                print Earthlings.Species.Human.Male
            end sub
            namespace Earthlings.Species
                enum Human
                    Male
                    Female
                end enum
            end namespace
        `);
        program.validate();
        expectZeroDiagnostics(program);
        expect(
            util.sortByRange(program.getSemanticTokens(file.srcPath))
        ).to.eql([{
            range: util.createRange(2, 22, 2, 32),
            tokenType: SemanticTokenTypes.namespace
        }, {
            range: util.createRange(2, 33, 2, 40),
            tokenType: SemanticTokenTypes.namespace
        }, {
            range: util.createRange(2, 41, 2, 46),
            tokenType: SemanticTokenTypes.enum
        }, {
            range: util.createRange(2, 47, 2, 51),
            tokenType: SemanticTokenTypes.enumMember
        }]);
    });

    it('matches each namespace section for enum', () => {
        const file = program.setFile<BrsFile>('source/main.bs', `
            sub main()
                print Sentients.Humanoids.HumanoidType.Cylon
            end sub
            namespace Sentients.Humanoids
                enum HumanoidType
                    Human
                    Alien
                    Cylon
                end enum
            end namespace
        `);
        program.validate();
        expectZeroDiagnostics(program);
        expect(
            util.sortByRange(program.getSemanticTokens(file.srcPath))
        ).to.eql([{
            range: util.createRange(2, 22, 2, 31),
            tokenType: SemanticTokenTypes.namespace
        }, {
            range: util.createRange(2, 32, 2, 41),
            tokenType: SemanticTokenTypes.namespace
        }, {
            range: util.createRange(2, 42, 2, 54),
            tokenType: SemanticTokenTypes.enum
        }, {
            range: util.createRange(2, 55, 2, 60),
            tokenType: SemanticTokenTypes.enumMember
        }]);
    });

    it('matches enums in if statements', () => {
        const file = program.setFile<BrsFile>('source/main.bs', `
            sub main()
                if Humanoids.HumanoidType.Cylon = "Cylon" then
                    print true
                end if
            end sub
            namespace Humanoids
                enum HumanoidType
                    Human = "Human"
                    Alien = "Alien"
                    Cylon = "Cylon"
                end enum
            end namespace
        `);
        program.validate();
        expectZeroDiagnostics(program);
        expect(
            util.sortByRange(program.getSemanticTokens(file.srcPath))
        ).to.eql([{
            range: util.createRange(2, 19, 2, 28),
            tokenType: SemanticTokenTypes.namespace
        }, {
            range: util.createRange(2, 29, 2, 41),
            tokenType: SemanticTokenTypes.enum
        }, {
            range: util.createRange(2, 42, 2, 47),
            tokenType: SemanticTokenTypes.enumMember
        }]);
    });

});
