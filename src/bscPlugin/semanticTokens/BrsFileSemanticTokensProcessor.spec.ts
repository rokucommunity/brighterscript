import { expect } from '../../chai-config.spec';
import { SemanticTokenModifiers, SemanticTokenTypes } from 'vscode-languageserver-protocol';
import type { BrsFile } from '../../files/BrsFile';
import type { BscFile } from '../../files/BscFile';
import type { SemanticToken } from '../../interfaces';
import { Program } from '../../Program';
import { expectZeroDiagnostics } from '../../testHelpers.spec';
import { util } from '../../util';
import { rootDir } from '../../testHelpers.spec';

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

    /**
     * Ensure the specified tokens are present in the full list
     */
    function expectSemanticTokensIncludes(file: BscFile, expected: Array<SemanticToken | [SemanticTokenTypes, number, number, number, number, SemanticTokenModifiers[]?]>, validateDiagnostics = true) {
        const result = getSemanticTokenResults(file, expected, validateDiagnostics);
        expect(result.actual).to.include.members(result.expected);
    }

    /**
     * Ensure that the full list of tokens exactly equals the expected list
     */
    function expectSemanticTokens(file: BscFile, expected: Array<SemanticToken | [SemanticTokenTypes, number, number, number, number, SemanticTokenModifiers[]?]>, validateDiagnostics = true) {
        const result = getSemanticTokenResults(file, expected, validateDiagnostics);
        expect(result.actual).to.eql(result.expected);
    }

    function getSemanticTokenResults(file: BscFile, expected: Array<SemanticToken | [SemanticTokenTypes, number, number, number, number, SemanticTokenModifiers[]?]>, validateDiagnostics = true) {
        program.validate();
        if (validateDiagnostics) {
            expectZeroDiagnostics(program);
        }
        const result = util.sortByRange(
            program.getSemanticTokens(file.srcPath)!
        );

        //sort modifiers
        for (let collection of [result, expected]) {
            for (let i = 0; i < collection.length; i++) {
                if (Array.isArray(collection[i])) {
                    const parts = collection[i];
                    collection[i] = {
                        tokenType: parts[0],
                        range: util.createRange(parts[1], parts[2], parts[3], parts[4]),
                        tokenModifiers: parts[5] ?? []
                    };
                }
                let token = collection[i] as SemanticToken;
                token.tokenModifiers ??= [];
                token.tokenModifiers.sort();
            }
        }

        function stringify(token: SemanticToken) {
            return `${token.tokenType}|${util.rangeToString(token.range)}|${token.tokenModifiers?.join(',')}`;
        }

        return {
            actual: result.map(x => stringify(x)),
            expected: (expected as SemanticToken[]).map(x => stringify(x))
        };
    }

    it('matches each namespace section for class', () => {
        const file = program.setFile<BrsFile>('source/main.bs', `
            class Host
                sub new()
                    m.alien = new Humanoids.Aliens.Alien()
                end sub
                public alien
            end class

            namespace Humanoids.Aliens
                class Alien
                end class
            end namespace
        `);
        expectSemanticTokensIncludes(file, [
            //m.alien = new |Humanoids|.Aliens.Alien()
            [SemanticTokenTypes.namespace, 3, 34, 3, 43],
            //m.alien = new Humanoids.|Aliens|.Alien()
            [SemanticTokenTypes.namespace, 3, 44, 3, 50],
            //m.alien = new Humanoids.Aliens.|Alien|()
            [SemanticTokenTypes.class, 3, 51, 3, 56]
        ]);
    });

    it('matches each namespace section for namespaced function calls', () => {
        const file = program.setFile<BrsFile>('source/main.bs', `
            sub new()
                Humanoids.Aliens.Invade("earth")
            end sub
            namespace Humanoids.Aliens
                function Invade(planet)
                end function
            end namespace
        `);
        expectSemanticTokensIncludes(file, [
            // |Humanoids|.Aliens.Invade("earth")
            [SemanticTokenTypes.namespace, 2, 16, 2, 25],
            // Humanoids.|Aliens|.Invade("earth")
            [SemanticTokenTypes.namespace, 2, 26, 2, 32],
            // Humanoids.Aliens.|Invade|("earth")
            [SemanticTokenTypes.function, 2, 33, 2, 39]
        ]);
    });

    it('matches namespace-relative parts', () => {
        const file = program.setFile<BrsFile>('source/main.bs', `
            namespace alpha
                sub test()
                    lineHeight = 1
                    print lineHeight
                end sub
            end namespace
            namespace alpha.lineHeight
            end namespace
        `);
        expectSemanticTokensIncludes(file, [
            //|lineHeight| = 1
            [SemanticTokenTypes.variable, 3, 20, 3, 30],
            //print |lineHeight|
            [SemanticTokenTypes.variable, 4, 26, 4, 36]
        ], false);
    });

    it('matches namespace-relative parts in parameters', () => {
        const file = program.setFile<BrsFile>('source/main.bs', `
            namespace alpha
                sub test(lineHeight as integer)
                end sub
            end namespace
            namespace alpha.lineHeight
            end namespace
        `);
        expectSemanticTokensIncludes(file, [
            //sub test(|lineHeight| as integer)
            [SemanticTokenTypes.parameter, 2, 25, 2, 35]
        ], false);
    });

    it('matches parameters variable names', () => {
        const file = program.setFile<BrsFile>('source/main.bs', `
            namespace designSystem
                function getIcon(image = "" as string, size = -1 as float) as object
                    return {}
                end function
            end namespace
            namespace designSystem.size
            end namespace
        `);
        expectSemanticTokensIncludes(file, [
            // function getIcon(|image| = "" as string, size = -1 as float) as object
            [SemanticTokenTypes.parameter, 2, 33, 2, 38],
            // function getIcon(image = "" as string, |size| = -1 as float) as object
            [SemanticTokenTypes.parameter, 2, 55, 2, 59]
        ], false);
    });

    it('matches each namespace section for namespaced function assignment', () => {
        const file = program.setFile<BrsFile>('source/main.bs', `
            sub new()
                action = Humanoids.Aliens.Invade
            end sub
            namespace Humanoids.Aliens
                function Invade(planet)
                end function
            end namespace
        `);
        expectSemanticTokensIncludes(file, [
            // action = |Humanoids|.Aliens.Invade
            [SemanticTokenTypes.namespace, 2, 25, 2, 34],
            // action = Humanoids.|Aliens|.Invade
            [SemanticTokenTypes.namespace, 2, 35, 2, 41],
            // action = Humanoids.Aliens.|Invade|
            [SemanticTokenTypes.function, 2, 42, 2, 48]
        ]);
    });

    it('matches each namespace section for namespaced function as function parameter', () => {
        const file = program.setFile<BrsFile>('source/main.bs', `
            sub new()
                actionName = type(Humanoids.Aliens.Invade)
            end sub
            namespace Humanoids.Aliens
                function Invade(planet)
                end function
            end namespace
        `);
        expectSemanticTokensIncludes(file, [
            // actionName = |type|(Humanoids.Aliens.Invade)
            [SemanticTokenTypes.function, 2, 29, 2, 33],
            // actionName = type(|Humanoids|.Aliens.Invade)
            [SemanticTokenTypes.namespace, 2, 34, 2, 43],
            // actionName = type(Humanoids.|Aliens|.Invade)
            [SemanticTokenTypes.namespace, 2, 44, 2, 50],
            // actionName = type(Humanoids.Aliens.|Invade|)
            [SemanticTokenTypes.function, 2, 51, 2, 57]
        ]);
    });

    it('matches each namespace section for namespaced function in print statement', () => {
        const file = program.setFile<BrsFile>('source/main.bs', `
            sub new()
                print Humanoids.Aliens.Invade
            end sub
            namespace Humanoids.Aliens
                function Invade(planet)
                end function
            end namespace
        `);
        expectSemanticTokensIncludes(file, [
            // print |Humanoids|.Aliens.Invade
            [SemanticTokenTypes.namespace, 2, 22, 2, 31],
            // print Humanoids.|Aliens|.Invade
            [SemanticTokenTypes.namespace, 2, 32, 2, 38],
            // print Humanoids.Aliens.|Invade|
            [SemanticTokenTypes.function, 2, 39, 2, 45]
        ]);
    });

    it('matches each namespace section for namespace declaration', () => {
        const file = program.setFile<BrsFile>('source/main.bs', `
            namespace Sentients.Humanoids
            end namespace
        `);
        expectSemanticTokens(file, [
            // namespace |Sentients|.Humanoids
            [SemanticTokenTypes.namespace, 1, 22, 1, 31],
            // namespace Sentients.|Humanoids|
            [SemanticTokenTypes.namespace, 1, 32, 1, 41]
        ]);
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
        expectSemanticTokensIncludes(file, [
            // print |Sentients|.Humanoids.HumanoidType.Cylon
            [SemanticTokenTypes.namespace, 2, 22, 2, 31],
            // print Sentients.|Humanoids|.HumanoidType.Cylon
            [SemanticTokenTypes.namespace, 2, 32, 2, 41],
            // print Sentients.Humanoids.|HumanoidType|.Cylon
            [SemanticTokenTypes.enum, 2, 42, 2, 54],
            // print Sentients.Humanoids.HumanoidType.|Cylon|
            [SemanticTokenTypes.enumMember, 2, 55, 2, 60]
        ]);
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
        expectSemanticTokensIncludes(file, [
            // if |Humanoids|.HumanoidType.Cylon = "Cylon" then
            [SemanticTokenTypes.namespace, 2, 19, 2, 28],
            // if Humanoids.|HumanoidType|.Cylon = "Cylon" then
            [SemanticTokenTypes.enum, 2, 29, 2, 41],
            // if Humanoids.HumanoidType.|Cylon| = "Cylon" then
            [SemanticTokenTypes.enumMember, 2, 42, 2, 47]
        ]);
    });

    it('matches enum with invalid member name', () => {
        const file = program.setFile<BrsFile>('source/main.bs', `
            sub main()
                print Humanoids.HumanoidType.INVALID_VALUE 'bs:disable-line
            end sub
            namespace Humanoids
                enum HumanoidType
                    Human = "Human"
                    Alien = "Alien"
                    Cylon = "Cylon"
                end enum
            end namespace
        `);
        expectSemanticTokensIncludes(file, [
            // print |Humanoids|.HumanoidType.INVALID_VALUE 'bs:disable-line
            [SemanticTokenTypes.namespace, 2, 22, 2, 31],
            // print Humanoids.|HumanoidType|.INVALID_VALUE 'bs:disable-line
            [SemanticTokenTypes.enum, 2, 32, 2, 44]
        ]);
    });

    it('matches class with invalid stuff after it', () => {
        const file = program.setFile<BrsFile>('source/main.bs', `
            sub init()
                m.alien = new Humanoids.Aliens.Alien.NOT_A_CLASS() 'bs:disable-line
            end sub

            namespace Humanoids.Aliens
                class Alien
                end class
            end namespace
        `);
        expectSemanticTokensIncludes(file, [
            // m.alien = new |Humanoids|.Aliens.Alien.NOT_A_CLASS() 'bs:disable-line
            [SemanticTokenTypes.namespace, 2, 30, 2, 39],
            // m.alien = new Humanoids.|Aliens|.Alien.NOT_A_CLASS() 'bs:disable-line
            [SemanticTokenTypes.namespace, 2, 40, 2, 46],
            // m.alien = new Humanoids.Aliens.|Alien|.NOT_A_CLASS() 'bs:disable-line
            [SemanticTokenTypes.class, 2, 47, 2, 52]
        ]);
    });

    it('matches aliases', () => {
        program.setFile('source/alpha.bs', `
            namespace alpha
                sub test()
                end sub
            end namespace
        `);
        const file = program.setFile<BrsFile>('source/main.bs', `
            alias alpha2 = alpha
            sub main()
                print alpha2.test()
            end sub
        `);
        expectSemanticTokensIncludes(file, [
            // alias |alpha2| = alpha
            [SemanticTokenTypes.namespace, 1, 18, 1, 24],
            // alias alpha2 = |alpha|
            [SemanticTokenTypes.namespace, 1, 27, 1, 32],
            // print |alpha2|.test()
            [SemanticTokenTypes.namespace, 3, 22, 3, 28],
            // print alpha2.|test|()
            [SemanticTokenTypes.function, 3, 29, 3, 33]
        ]);
    });

    it('matches consts', () => {
        const file = program.setFile<BrsFile>('source/main.bs', `
            sub init()
                print API_URL
                print info.FIRST_NAME
            end sub
            const API_URL = "some_url"
            namespace info
                const FIRST_NAME = "bob"
            end namespace
        `);
        expectSemanticTokens(file, [
            // sub |init|()
            [SemanticTokenTypes.function, 1, 16, 1, 20],
            // print |API_URL|
            [SemanticTokenTypes.variable, 2, 22, 2, 29, [SemanticTokenModifiers.readonly, SemanticTokenModifiers.static]],
            // print |info|.FIRST_NAME
            [SemanticTokenTypes.namespace, 3, 22, 3, 26],
            // print info.|FIRST_NAME|
            [SemanticTokenTypes.variable, 3, 27, 3, 37, [SemanticTokenModifiers.readonly, SemanticTokenModifiers.static]],
            // const |API_URL| = "some_url"
            [SemanticTokenTypes.variable, 5, 18, 5, 25, [SemanticTokenModifiers.readonly, SemanticTokenModifiers.static]],
            // namespace |info|
            [SemanticTokenTypes.namespace, 6, 22, 6, 26],
            // const |FIRST_NAME| = "bob"
            [SemanticTokenTypes.variable, 7, 22, 7, 32, [SemanticTokenModifiers.readonly, SemanticTokenModifiers.static]]
        ]);
    });

    it('matches consts in assignment expressions', () => {
        const file = program.setFile<BrsFile>('source/main.bs', `
            sub main()
                value = ""
                value += constants.API_KEY
                value += API_URL
            end sub
            namespace constants
                const API_KEY = "test"
            end namespace
            const API_URL = "url"
        `);
        expectSemanticTokens(file, [
            // sub |main|()
            [SemanticTokenTypes.function, 1, 16, 1, 20],
            // |value| = ""
            [SemanticTokenTypes.variable, 2, 16, 2, 21],
            // |value| += constants.API_KEY
            [SemanticTokenTypes.variable, 3, 16, 3, 21],
            // value += |constants|.API_KEY
            [SemanticTokenTypes.namespace, 3, 25, 3, 34],
            // value += constants.|API_KEY|
            [SemanticTokenTypes.variable, 3, 35, 3, 42, [SemanticTokenModifiers.readonly, SemanticTokenModifiers.static]],
            // |value| += API_URL
            [SemanticTokenTypes.variable, 4, 16, 4, 21],
            // value += |API_URL|
            [SemanticTokenTypes.variable, 4, 25, 4, 32, [SemanticTokenModifiers.readonly, SemanticTokenModifiers.static]],
            // namespace |constants|
            [SemanticTokenTypes.namespace, 6, 22, 6, 31],
            // const |API_KEY| = "test"
            [SemanticTokenTypes.variable, 7, 22, 7, 29, [SemanticTokenModifiers.readonly, SemanticTokenModifiers.static]],
            //const |API_URL| = "url"
            [SemanticTokenTypes.variable, 9, 18, 9, 25, [SemanticTokenModifiers.readonly, SemanticTokenModifiers.static]]
        ]);
    });

    it('matches new statement of non-class', () => {
        const file = program.setFile<BrsFile>('source/main.bs', `
            sub init()
                m.alien = new Humanoids.Aliens.Alien.NOT_A_CLASS() 'bs:disable-line
            end sub

            namespace Humanoids.Aliens
                class Alien
                end class
            end namespace
        `);
        expectSemanticTokens(file, [
            // sub |init|()
            [SemanticTokenTypes.function, 1, 16, 1, 20],
            // |m|.alien = new Humanoids.Aliens.Alien.NOT_A_CLASS() 'bs:disable-line
            [SemanticTokenTypes.variable, 2, 16, 2, 17],
            // m.alien = new |Humanoids|.Aliens.Alien.NOT_A_CLASS() 'bs:disable-line
            [SemanticTokenTypes.namespace, 2, 30, 2, 39],
            // m.alien = new Humanoids.|Aliens|.Alien.NOT_A_CLASS() 'bs:disable-line
            [SemanticTokenTypes.namespace, 2, 40, 2, 46],
            // m.alien = new Humanoids.Aliens.|Alien|.NOT_A_CLASS() 'bs:disable-line
            [SemanticTokenTypes.class, 2, 47, 2, 52],
            // namespace |Humanoids|.Aliens
            [SemanticTokenTypes.namespace, 5, 22, 5, 31],
            // namespace Humanoids.|Aliens|
            [SemanticTokenTypes.namespace, 5, 32, 5, 38],
            // class |Alien|
            [SemanticTokenTypes.class, 6, 22, 6, 27]
        ]);
    });

    it('matches interface names', () => {
        const file = program.setFile<BrsFile>('source/main.bs', `
            interface Human
                name as string
            end interface

            namespace Humanoids
                interface Alien
                    name as string
                end interface
            end namespace
        `);
        expectSemanticTokensIncludes(file, [
            // interface |Human|
            [SemanticTokenTypes.interface, 1, 22, 1, 27],
            // interface |Alien|
            [SemanticTokenTypes.interface, 6, 26, 6, 31]
        ]);
    });

    it('works for `new` statement', () => {
        const file = program.setFile<BrsFile>('source/main.bs', `
            class Person
                sub speak()
                end sub
            end class
            sub test()
                dude = new Person()
                dude.speak()
            end sub
        `);
        expectSemanticTokens(file, [
            // class |Person|
            [SemanticTokenTypes.class, 1, 18, 1, 24],
            // sub |test|()
            [SemanticTokenTypes.function, 5, 16, 5, 20],
            // |dude| = new Person()
            [SemanticTokenTypes.variable, 6, 16, 6, 20],
            // dude = new |Person|()
            [SemanticTokenTypes.class, 6, 27, 6, 33],
            // |dude|.speak()
            [SemanticTokenTypes.variable, 7, 16, 7, 20],
            // dude.|speak|()
            [SemanticTokenTypes.method, 7, 21, 7, 26]
        ]);
    });
});
