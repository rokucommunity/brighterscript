import { expect } from 'chai';
import { LiteralExpression } from '../../Expression';
import { DiagnosticMessages } from '../../../DiagnosticMessages';
import { expectCompletionsExcludes, expectCompletionsIncludes, expectDiagnostics, expectInstanceOf, expectZeroDiagnostics, getTestTranspile, trim } from '../../../testHelpers.spec';
import { ParseMode, Parser } from '../../Parser';
import { util, standardizePath as s } from '../../../util';
import { EnumStatement, InterfaceStatement } from '../../Statement';
import { Program } from '../../../Program';
import { createSandbox } from 'sinon';
import type { BrsFile } from '../../../files/BrsFile';
import { Location, CancellationTokenSource, CompletionItemKind } from 'vscode-languageserver-protocol';
import { WalkMode } from '../../../astUtils/visitors';
import { isEnumStatement } from '../../../astUtils/reflection';
import { URI } from 'vscode-uri';

const sinon = createSandbox();

describe('EnumStatement', () => {
    let rootDir = s`${process.cwd()}/.tmp/rootDir`;
    let program: Program;
    let testTranspile = getTestTranspile(() => [program, rootDir]);

    beforeEach(() => {
        program = new Program({ rootDir: rootDir, sourceMap: true });
    });
    afterEach(() => {
        sinon.restore();
        program.dispose();
    });

    it('parses empty enum statement', () => {
        const parser = Parser.parse(`
            enum SomeEnum
            end enum
        `, { mode: ParseMode.BrighterScript });

        expectZeroDiagnostics(parser);
        expect(parser.ast.statements[0]).to.be.instanceOf(EnumStatement);
    });

    it('supports annotations above', () => {
        const parser = Parser.parse(`
            @someAnnotation
            enum SomeEnum
            end enum
        `, { mode: ParseMode.BrighterScript });

        expectZeroDiagnostics(parser);
        expect(parser.ast.statements[0].annotations[0].name).to.eql('someAnnotation');
    });

    it('constructs when missing enum name', () => {
        const parser = Parser.parse(`
            enum
            end enum
        `, { mode: ParseMode.BrighterScript });

        expectDiagnostics(parser, [
            DiagnosticMessages.expectedIdentifier()
        ]);
        expect(parser.ast.statements[0]).to.be.instanceOf(EnumStatement);
    });

    it('collects uninitialized members', () => {
        const parser = Parser.parse(`
            enum Direction
                up
                down
                left
                right
            end enum
        `, { mode: ParseMode.BrighterScript });

        expectZeroDiagnostics(parser);
        expect(
            (parser.ast.statements[0] as EnumStatement).getMembers().map(x => x.tokens.name.text)
        ).to.eql([
            'up',
            'down',
            'left',
            'right'
        ]);
    });

    it('collects int-initialized members', () => {
        const parser = Parser.parse(`
            enum Direction
                up = 1
                down = 2
                left = 3
                right = 4
            end enum
        `, { mode: ParseMode.BrighterScript });

        expectZeroDiagnostics(parser);
        const values = (parser.ast.statements[0] as EnumStatement).getMembers().map(x => x.value) as LiteralExpression[];
        expectInstanceOf(values, [
            LiteralExpression,
            LiteralExpression,
            LiteralExpression,
            LiteralExpression
        ]);
        expect(values.map(x => x.token.text)).to.eql([
            '1',
            '2',
            '3',
            '4'
        ]);
    });

    it('collects string-initialized members', () => {
        const parser = Parser.parse(`
            enum Direction
                up = "u"
                down = "d"
                left = "l"
                right = "r"
            end enum
        `, { mode: ParseMode.BrighterScript });

        expectZeroDiagnostics(parser);
        const values = (parser.ast.statements[0] as EnumStatement).getMembers().map(x => x.value) as LiteralExpression[];
        expectInstanceOf(values, [
            LiteralExpression,
            LiteralExpression,
            LiteralExpression,
            LiteralExpression
        ]);
        expect(values.map(x => x.token.text)).to.eql([
            '"u"',
            '"d"',
            '"l"',
            '"r"'
        ]);
    });

    it('flags when used in brs mode', () => {
        const parser = Parser.parse(`
            enum Direction
                up = "u"
                down = "d"
                left = "l"
                right = "r"
            end enum
        `, { mode: ParseMode.BrightScript });
        expectDiagnostics(parser, [
            DiagnosticMessages.bsFeatureNotSupportedInBrsFiles('enum declarations')
        ]);
    });

    it('allows enum at top of file', () => {
        const parser = Parser.parse(`
            enum Direction
                value1
            end enum

            interface Person
                name as string
            end interface
        `, { mode: ParseMode.BrighterScript });

        expectZeroDiagnostics(parser);
        expect(parser.statements[0]).instanceof(EnumStatement);
        expect(parser.statements[1]).instanceof(InterfaceStatement);
    });

    it('allows enum at bottom of file', () => {
        const parser = Parser.parse(`
            interface Person
                name as string
            end interface

            enum Direction
                value1
            end enum
        `, { mode: ParseMode.BrighterScript });

        expectZeroDiagnostics(parser);
        expect(parser.statements[0]).instanceof(InterfaceStatement);
        expect(parser.statements[1]).instanceof(EnumStatement);
    });

    it('allows enum in namespace', () => {
        const parser = Parser.parse(`
            namespace entities
                enum Person
                    name
                end enum
            end namespace

            enum Direction
                up
            end enum
        `, { mode: ParseMode.BrighterScript });

        expectZeroDiagnostics(parser);
        expect(parser.references.enumStatements.map(x => x.fullName)).to.eql([
            'entities.Person',
            'Direction'
        ]);
    });

    describe('validation', () => {

        it('catches duplicate enums from same file', () => {
            program.setFile('source/main.bs', `
                enum Direction
                    up
                end enum

                enum Direction
                    up
                end enum
            `);
            program.validate();
            expectDiagnostics(program, [{
                ...DiagnosticMessages.duplicateEnumDeclaration('source', 'Direction'),
                relatedInformation: [{
                    location: Location.create(
                        URI.file(s`${rootDir}/source/main.bs`).toString(),
                        util.createRange(1, 21, 1, 30)
                    ),
                    message: 'Enum declared here'
                }]
            }]);
        });

        it('catches duplicate enums from different files in same scope', () => {
            program.setFile('source/main.bs', `
                enum Direction
                    up
                end enum
            `);
            program.setFile('source/lib.bs', `
                enum Direction
                    up
                end enum
            `);
            program.validate();
            expectDiagnostics(program, [{
                ...DiagnosticMessages.duplicateEnumDeclaration('source', 'Direction'),
                relatedInformation: [{
                    location: Location.create(
                        URI.file(s`${rootDir}/source/lib.bs`).toString(),
                        util.createRange(1, 21, 1, 30)
                    ),
                    message: 'Enum declared here'
                }]
            }]);
        });

        it('allows duplicate enums across different scopes', () => {
            program.setFile('source/main.bs', `
                enum Direction
                    up
                end enum
            `);
            program.setFile('components/comp1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Comp1" extends="Scene">
                    <script uri="comp1.bs" />
                </component>
            `);
            program.setFile('components/comp1.bs', `
                enum Direction
                    up
                end enum
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('flags duplicate members', () => {
            program.setFile('source/main.bs', `
                enum Direction
                    name
                    name
                end enum
            `);
            program.validate();
            expectDiagnostics(program, [{
                ...DiagnosticMessages.duplicateIdentifier('name'),
                range: util.createRange(3, 20, 3, 24)
            }]);
        });

        it('flags mixed enum value types with int first', () => {
            program.setFile('source/main.bs', `
                enum Direction
                    a = 1
                    b = "c"
                end enum
            `);
            program.validate();
            expectDiagnostics(program, [{
                ...DiagnosticMessages.enumValueMustBeType('integer'),
                range: util.createRange(3, 24, 3, 27)
            }]);
        });

        it('flags mixed enum value types with string first', () => {
            program.setFile('source/main.bs', `
                enum Direction
                    a = "a"
                    b = 1
                end enum
            `);
            program.validate();
            expectDiagnostics(program, [{
                ...DiagnosticMessages.enumValueMustBeType('string'),
                range: util.createRange(3, 24, 3, 25)
            }]);
        });

        it('flags missing value for string enum when string is first item', () => {
            program.setFile('source/main.bs', `
                enum Direction
                    a = "a"
                    b
                end enum
            `);
            program.validate();
            expectDiagnostics(program, [{
                ...DiagnosticMessages.enumValueIsRequired('string'),
                range: util.createRange(3, 20, 3, 21)
            }]);
        });

        it('flags missing value for string enum where string is not first item', () => {
            program.setFile('source/main.bs', `
                enum Direction
                    a
                    b = "b" 'since this is the only value present, this is a string enum
                end enum
            `);
            program.validate();
            expectDiagnostics(program, [{
                ...DiagnosticMessages.enumValueIsRequired('string'),
                range: util.createRange(2, 20, 2, 21)
            }]);
        });

        it('catches unknown non-namespaced enum members', () => {
            program.setFile('source/main.bs', `
                enum Direction
                    up
                end enum

                sub main()
                    print Direction.up
                    print Direction.DOWN
                    print Direction.down
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [{
                ...DiagnosticMessages.unknownEnumValue('DOWN', 'Direction'),
                range: util.createRange(7, 36, 7, 40)
            }, {
                ...DiagnosticMessages.unknownEnumValue('down', 'Direction'),
                range: util.createRange(8, 36, 8, 40)
            }]);
        });

        it('catches unknown namespaced enum members', () => {
            program.setFile('source/main.bs', `
                namespace Enums
                    enum Direction
                        up
                    end enum
                end namespace

                sub main()
                    print Enums.Direction.up
                    print Enums.Direction.DOWN
                    print Enums.Direction.down
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [{
                ...DiagnosticMessages.unknownEnumValue('DOWN', 'Enums.Direction'),
                range: util.createRange(9, 42, 9, 46)
            }, {
                ...DiagnosticMessages.unknownEnumValue('down', 'Enums.Direction'),
                range: util.createRange(10, 42, 10, 46)
            }]);
        });
    });

    describe('getMemberValueMap', () => {
        function expectMemberValueMap(code: string, expected: Record<string, string>) {
            const file = program.setFile<BrsFile>('source/lib.brs', code);
            const cancel = new CancellationTokenSource();
            let firstEnum: EnumStatement;
            file.ast.walk(statement => {
                if (isEnumStatement(statement)) {
                    firstEnum = statement;
                    cancel.cancel();
                }
            }, {
                walkMode: WalkMode.visitStatements,
                cancel: cancel.token
            });
            expect(firstEnum).to.exist;
            const values = firstEnum.getMemberValueMap();
            expect(
                [...values].reduce((prev, [key, value]) => {
                    prev[key] = value;
                    return prev;
                }, {})
            ).to.eql(expected);
        }

        it('defaults first enum value to 0', () => {
            expectMemberValueMap(`
                enum Direction
                    up
                    down
                    left
                    right
                end enum
            `, {
                up: '0',
                down: '1',
                left: '2',
                right: '3'
            });
        });

        it('continues incrementing after defined int value', () => {
            expectMemberValueMap(`
                enum Direction
                    up
                    down = 9
                    left
                    right = 20
                    other
                end enum
            `, {
                up: '0',
                down: '9',
                left: '10',
                right: '20',
                other: '21'
            });
        });

        it('returns string values when defined', () => {
            expectMemberValueMap(`
                enum Direction
                    up = "up"
                    down = "DOWN"
                    left = "LeFt"
                    right = "righT"
                end enum
            `, {
                up: '"up"',
                down: '"DOWN"',
                left: '"LeFt"',
                right: '"righT"'
            });
        });
    });

    describe('transpile', () => {
        it('supports default-as-integer', () => {
            testTranspile(`
                enum Direction
                    up
                    down
                    left
                    right
                end enum
                sub main()
                    print Direction.up, Direction.down, Direction.left, Direction.right
                end sub
            `, `
                sub main()
                    print 0, 1, 2, 3
                end sub
            `);
        });

        it('supports string enums', () => {
            testTranspile(`
                enum Direction
                    up = "up"
                    down = "down"
                    left = "left"
                    right = "right"
                end enum
                sub main()
                    print Direction.up, Direction.down, Direction.left, Direction.right
                end sub
            `, `
                sub main()
                    print "up", "down", "left", "right"
                end sub
            `);
        });

        it('replaces enum values from separate file with literals', () => {
            program.setFile('source/enum.bs', `
                enum CharacterType
                    Human = "Human"
                    Zombie = "Zombie"
                end enum
                namespace Locations
                    enum Houses
                        TownHouse
                        FarmHouse
                    end enum
                end namespace
            `);
            testTranspile(`
                sub test()
                    print CharacterType.Human
                    print CharacterType.Zombie
                    print Locations.Houses.TownHouse
                    print Locations.Houses.FarmHouse
                end sub
            `, `
                sub test()
                    print "Human"
                    print "Zombie"
                    print 0
                    print 1
                end sub
            `);
        });
    });

    describe('completions', () => {
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
            //should NOT find these enums
            expectCompletionsExcludes(program.getCompletions('source/main.brs', util.createPosition(2, 28)), [{
                label: 'up',
                kind: CompletionItemKind.EnumMember
            }, {
                label: 'down',
                kind: CompletionItemKind.EnumMember
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
            `);
            //          dire|ction.down
            expectCompletionsIncludes(program.getCompletions('source/main.bs', util.createPosition(3, 33)), [{
                label: 'Direction',
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
            //          enums.dire|ction.down
            expectCompletionsIncludes(program.getCompletions('source/main.bs', util.createPosition(3, 38)), [{
                label: 'Direction',
                kind: CompletionItemKind.Enum
            }]);
        });
    });

});
