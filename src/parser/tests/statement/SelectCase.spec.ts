import { expect } from '../../../chai-config.spec';
import { isCaseStatement, isFunctionExpression, isFunctionStatement, isSelectCaseStatement } from '../../../astUtils/reflection';
import { createVisitor, WalkMode } from '../../../astUtils/visitors';
import { DiagnosticMessages } from '../../../DiagnosticMessages';
import type { BrsFile } from '../../../files/BrsFile';
import { Program } from '../../../Program';
import { expectDiagnostics, expectZeroDiagnostics, getTestTranspile, rootDir } from '../../../testHelpers.spec';
import util from '../../../util';
import { BrsTranspileState } from '../../BrsTranspileState';
import type { FunctionExpression, LiteralExpression } from '../../Expression';
import { Parser, ParseMode } from '../../Parser';
import type { FunctionStatement, SelectCaseStatement } from '../../Statement';
import { CaseStatement, SELECT_CASE_SUBJECT_VARIABLE } from '../../Statement';

describe('select case statement', () => {
    let program: Program;
    let testTranspile = getTestTranspile(() => [program, rootDir]);

    beforeEach(() => {
        program = new Program({ rootDir: rootDir, sourceMap: true });
    });
    afterEach(() => {
        program.dispose();
    });

    function parse(text: string, mode = ParseMode.BrighterScript) {
        return Parser.parse(text, { mode: mode });
    }

    function getFunctionNames(parser: Parser) {
        return parser.ast.findChildren<FunctionStatement>(isFunctionStatement).map(x => x.tokens.name.text);
    }

    function getFunctionExpressions(parser: Parser) {
        return parser.ast.findChildren<FunctionExpression>(isFunctionExpression, { walkMode: WalkMode.visitAllRecursive });
    }

    function getSelect(parser: Parser, index = 0) {
        const results = [] as SelectCaseStatement[];
        parser.ast.walk(createVisitor({
            SelectCaseStatement: (s) => {
                results.push(s);
            }
        }), { walkMode: WalkMode.visitStatementsRecursive });
        return results[index];
    }

    /**
     * Get the diagnostics from a file that was added to the program and validated
     */
    function validate(text: string, pkgPath = 'source/main.bs') {
        program.setFile(pkgPath, text);
        program.validate();
        return program;
    }

    describe('parser', () => {
        it('parses a basic select case statement', () => {
            const parser = parse(`
                sub main(number)
                    select case number
                        case 1
                            print "one"
                        case 6, 7, 8
                            print "six through eight"
                            print "inclusive"
                        case else
                            print "no match"
                    end select
                end sub
            `);
            expectZeroDiagnostics(parser);
            const stmt = getSelect(parser);
            expect(isSelectCaseStatement(stmt)).to.be.true;
            expect(stmt.tokens.select.text).to.eql('select');
            expect(stmt.tokens.case.text).to.eql('case');
            expect(stmt.tokens.endSelect.text).to.eql('end select');
            expect(stmt.subject).to.exist;
            expect(stmt.leadingStatements).not.to.exist;

            expect(stmt.cases).to.be.lengthOf(3);
            expect(stmt.cases.map(x => x.values.map(v => (v as LiteralExpression).tokens.value.text))).to.eql([
                ['1'],
                ['6', '7', '8'],
                []
            ]);
            expect(stmt.cases.map(x => x.body.statements.length)).to.eql([1, 2, 1]);
            expect(stmt.cases.map(x => x.isElse)).to.eql([false, false, true]);
            expect(stmt.elseCase).to.equal(stmt.cases[2]);
            expect(stmt.cases[2].tokens.else.text).to.eql('else');
            expect(stmt.location.range).to.eql(util.createRange(2, 20, 10, 30));
        });

        it('is case insensitive and supports `endselect`', () => {
            const parser = parse(`
                sub main(number)
                    SELECT CASE number
                        CASE 1
                            print "one"
                        Case Else
                            print "other"
                    EndSelect
                    Select Case number
                        Case Else
                    End   Select
                end sub
            `);
            expectZeroDiagnostics(parser);
            expect(getSelect(parser, 0).tokens.endSelect.text).to.eql('EndSelect');
            expect(getSelect(parser, 1).tokens.endSelect.text).to.eql('End   Select');
        });

        it('allows omitting the `case` keyword after `select`', () => {
            const parser = parse(`
                sub main(number)
                    select number
                        case 1
                    end select
                    select m.value
                        case 1
                    end select
                    select "text"
                        case "text"
                    end select
                    select not true
                        case false
                    end select
                end sub
            `);
            expectZeroDiagnostics(parser);
            expect(getSelect(parser, 0).tokens.case).not.to.exist;
            expect(getSelect(parser, 0).subject).to.exist;
            expect(getSelect(parser, 3).subject).to.exist;
        });

        it('supports case values spread across multiple lines', () => {
            const parser = parse(`
                sub main(number)
                    select case number
                        case 6,
                            7, ' seven

                            8
                            print "six through eight"
                        case else
                    end select
                end sub
            `);
            expectZeroDiagnostics(parser);
            const stmt = getSelect(parser);
            expect(stmt.cases[0].values).to.be.lengthOf(3);
            expect(stmt.cases[0].body.statements).to.be.lengthOf(1);
        });

        it('supports single-line and colon-separated forms', () => {
            const parser = parse(`
                sub main(number)
                    select case number : case 1 : print "one" : case 2, 3 : print "two" : print "three" : case else : print "other" : end select
                    select case number
                        case 1: print "one"
                        case else: print "other"
                    end select
                end sub
            `);
            expectZeroDiagnostics(parser);
            expect(getSelect(parser, 0).cases.map(x => x.body.statements.length)).to.eql([1, 2, 1]);
            expect(getSelect(parser, 1).cases.map(x => x.body.statements.length)).to.eql([1, 1]);
        });

        it('keeps comments found before the first case', () => {
            const parser = parse(`
                sub main(number)
                    select case number ' trailing comment
                        ' leading comment
                        case 1
                    end select
                end sub
            `);
            expectZeroDiagnostics(parser);
            const stmt = getSelect(parser);
            //comments are trivia, so they live on the first `case` rather than in the leading statements
            expect(stmt.leadingStatements).not.to.exist;
            expect(util.getLeadingComments(stmt.cases[0].tokens.case).map(x => x.text)).to.eql([
                `' trailing comment`,
                `' leading comment`
            ]);
        });

        it('supports nested select case statements and nested blocks', () => {
            const parser = parse(`
                sub main(a, b)
                    select case a
                        case 1
                            if b then
                                select case b
                                    case 1
                                        print "a1b1"
                                    case else
                                end select
                            end if
                        case else
                            for i = 0 to 10
                                while true
                                    exit while
                                end while
                            end for
                    end select
                end sub
            `);
            expectZeroDiagnostics(parser);
            expect(getSelect(parser, 0).cases).to.be.lengthOf(2);
            expect(getSelect(parser, 1).cases).to.be.lengthOf(2);
        });

        it('supports anonymous functions inside a case body', () => {
            const parser = parse(`
                sub main(a)
                    select case a
                        case 1
                            callback = function(value)
                                select case value
                                    case 1
                                        return "one"
                                    case else
                                        return "other"
                                end select
                            end function
                        case else
                            callback = sub()
                            end sub
                    end select
                end sub
            `);
            expectZeroDiagnostics(parser);
            expect(getSelect(parser, 0).cases).to.be.lengthOf(2);
        });

        it('still allows `select`, `case`, and `endselect` to be used as identifiers', () => {
            const parser = parse(`
                sub main()
                    select = 1
                    case = 2
                    endselect = 3
                    select += 1
                    case++
                    print select, case, endselect
                    m.select = select
                    m.case = case
                    m.endselect = endselect
                    m.case.select()
                    obj = { select: 1, case: 2, endselect: 3 }
                    print obj.select, obj.case, obj.endselect
                    select(1)
                    for each case in [1, 2]
                    end for
                end sub
                sub select(value)
                end sub
                class Picker
                    select as integer
                    function case()
                    end function
                end class
            `);
            expectZeroDiagnostics(parser);
            expect(getSelect(parser)).not.to.exist;
        });

        it('treats `case` used as a variable inside a select body as a variable', () => {
            const parser = parse(`
                sub main(value)
                    select case value
                        case 1
                            case = "upper"
                            case.name = "x"
                            case[0] = 1
                        case else
                            endselect = 1
                    end select
                end sub
            `);
            expectZeroDiagnostics(parser);
            const stmt = getSelect(parser);
            expect(stmt.cases).to.be.lengthOf(2);
            expect(stmt.cases[0].body.statements).to.be.lengthOf(3);
            expect(stmt.cases[1].body.statements).to.be.lengthOf(1);
        });

        it('flags select case in brightscript files', () => {
            const parser = parse(`
                sub main(value)
                    select case value
                        case 1
                    end select
                end sub
            `, ParseMode.BrightScript);
            expectDiagnostics(parser, [{
                ...DiagnosticMessages.bsFeatureNotSupportedInBrsFiles('select case statements'),
                location: { range: util.createRange(2, 20, 2, 26) }
            }]);
        });

        it('flags select case inside an inline if', () => {
            const parser = parse(`
                sub main(value)
                    if true then select case value : case 1 : print 1 : end select
                end sub
            `);
            expectDiagnostics(parser, [
                DiagnosticMessages.selectCaseNotAllowedInInlineIf()
            ]);
        });

        it('only walks the leading statements when there are some', () => {
            const parser = parse(`
                sub main(value)
                    select case value
                        case 1
                    end select
                end sub
            `);
            const kinds = [] as string[];
            getSelect(parser).walk((node) => {
                kinds.push(node.constructor.name);
            }, { walkMode: WalkMode.visitStatements });
            //no leading `Block`, just the case and its body
            expect(kinds).to.eql(['CaseStatement', 'Block']);
        });

        it('walks all of its children', () => {
            const parser = parse(`
                sub main(value)
                    select case value
                        ' comment
                        case 1, 2
                            print "a"
                        case else
                            print "b"
                    end select
                end sub
            `);
            const kinds = [] as string[];
            getSelect(parser).walk((node) => {
                kinds.push(node.constructor.name);
            }, { walkMode: WalkMode.visitAllRecursive });
            expect(kinds).to.eql([
                'VariableExpression',
                'CaseStatement',
                'LiteralExpression',
                'LiteralExpression',
                'Block',
                'PrintStatement',
                'LiteralExpression',
                'CaseStatement',
                'Block',
                'PrintStatement',
                'LiteralExpression'
            ]);

            //statement-only walks skip the expressions
            const statementKinds = [] as string[];
            getSelect(parser).walk((node) => {
                statementKinds.push(node.constructor.name);
            }, { walkMode: WalkMode.visitStatementsRecursive });
            expect(statementKinds).to.eql([
                'CaseStatement',
                'Block',
                'PrintStatement',
                'CaseStatement',
                'Block',
                'PrintStatement'
            ]);
        });

        it('clones', () => {
            const parser = parse(`
                sub main(value)
                    select case value
                        ' comment
                        case 1, 2
                            print "a"
                        case else
                            print "b"
                    end select
                end sub
            `);
            const stmt = getSelect(parser);
            const clone = stmt.clone();
            expect(clone).not.to.equal(stmt);
            expect(clone.cases[0]).not.to.equal(stmt.cases[0]);
            expect(clone.cases[0].parent).to.equal(clone);
            expect(clone.cases[0].values[0].parent).to.equal(clone.cases[0]);
            expect(clone.cases[0].body.statements[0].parent).to.equal(clone.cases[0].body);
            expect(clone.subject.parent).to.equal(clone);
            expect(clone.location).to.eql(stmt.location);
            expect(clone.cases.map(x => x.values.length)).to.eql([2, 0]);
            expect(clone.elseCase.isElse).to.be.true;
        });

        it('clones with missing pieces', () => {
            const parser = parse(`
                sub main()
                    select case
                        case
                    end sub
            `);
            const clone = getSelect(parser).clone();
            expect(clone.subject).not.to.exist;
            expect(clone.tokens.endSelect).not.to.exist;
            expect(clone.cases).to.be.lengthOf(1);
        });

        describe('syntax errors and partial code', () => {
            it('flags a missing subject', () => {
                const parser = parse(`
                    sub main()
                        select case
                            case 1
                                print "one"
                        end select
                    end sub
                `);
                expectDiagnostics(parser, [{
                    ...DiagnosticMessages.expectedExpressionAfterSelectCase(),
                    location: { range: util.createRange(2, 24, 2, 35) }
                }]);
                expect(getSelect(parser).cases).to.be.lengthOf(1);
            });

            it('flags leftover tokens after the subject', () => {
                const parser = parse(`
                    sub main(a, b)
                        select case a b
                            case 1
                        end select
                    end sub
                `);
                expectDiagnostics(parser, [{
                    ...DiagnosticMessages.unexpectedToken('b'),
                    location: { range: util.createRange(2, 38, 2, 39) }
                }]);
            });

            it('recovers from an invalid subject expression', () => {
                const parser = parse(`
                    sub main(a)
                        select case a +
                            case 1
                                print "one"
                        end select
                    end sub
                `);
                expect(parser.diagnostics).to.not.be.empty;
                const stmt = getSelect(parser);
                expect(stmt.cases).to.be.lengthOf(1);
                expect(stmt.tokens.endSelect).to.exist;
            });

            it('flags a case with no values', () => {
                const parser = parse(`
                    sub main(a)
                        select case a
                            case
                                print "partial"
                            case else
                        end select
                    end sub
                `);
                expectDiagnostics(parser, [{
                    ...DiagnosticMessages.expectedCaseValue('case'),
                    location: { range: util.createRange(3, 28, 3, 32) }
                }]);
                expect(getSelect(parser).cases[0].body.statements).to.be.lengthOf(1);
            });

            it('flags a trailing comma', () => {
                const parser = parse(`
                    sub main(a)
                        select case a
                            case 1,
                        end select
                        select case a
                            case 1, : print "x"
                        end select
                    end sub
                `);
                expectDiagnostics(parser, [{
                    ...DiagnosticMessages.expectedCaseValue(','),
                    location: { range: util.createRange(3, 34, 3, 35) }
                }, {
                    ...DiagnosticMessages.expectedCaseValue(','),
                    location: { range: util.createRange(6, 34, 6, 35) }
                }]);
                expect(getSelect(parser, 0).cases[0].values).to.be.lengthOf(1);
            });

            it('flags a trailing comma at the end of the function and file', () => {
                let parser = parse(`
                    sub main(a)
                        select case a
                            case 1,
                    end sub
                `);
                expectDiagnostics(parser, [
                    DiagnosticMessages.expectedCaseValue(','),
                    DiagnosticMessages.couldNotFindMatchingEndKeyword('select')
                ]);

                parser = parse(`select case a\ncase 1,`);
                expectDiagnostics(parser, [
                    DiagnosticMessages.expectedCaseValue(','),
                    DiagnosticMessages.couldNotFindMatchingEndKeyword('select')
                ]);
            });

            it('recovers from an invalid case value', () => {
                const parser = parse(`
                    sub main(a)
                        select case a
                            case 1, *, 3
                                print "one"
                            case 2
                                print "two"
                        end select
                    end sub
                `);
                expect(parser.diagnostics).to.not.be.empty;
                const stmt = getSelect(parser);
                expect(stmt.cases).to.be.lengthOf(2);
                expect(stmt.cases[0].values).to.be.lengthOf(1);
                expect(stmt.cases[0].body.statements).to.be.lengthOf(1);
            });

            it('flags leftover tokens after case values and `case else`', () => {
                const parser = parse(`
                    sub main(a)
                        select case a
                            case 1 to 5
                            case else a
                        end select
                    end sub
                `);
                expectDiagnostics(parser, [
                    DiagnosticMessages.unexpectedToken('to'),
                    DiagnosticMessages.unexpectedToken('5'),
                    DiagnosticMessages.unexpectedToken('a')
                ]);
            });

            it('flags statements before the first case', () => {
                const parser = parse(`
                    sub main(a)
                        select case a
                            ' comments are fine
                            print "not allowed"
                            case 1
                        end select
                    end sub
                `);
                expectDiagnostics(parser, [{
                    ...DiagnosticMessages.statementBeforeFirstCase(),
                    location: { range: util.createRange(4, 28, 4, 47) }
                }]);
                expect(getSelect(parser).leadingStatements.statements).to.be.lengthOf(1);
            });

            it('flags a missing `end select` and keeps parsing the next function', () => {
                const parser = parse(`
                    sub main(a)
                        select case a
                            case 1
                                print "one"
                    end sub
                    sub second()
                        print "second"
                    end sub
                `);
                expectDiagnostics(parser, [{
                    ...DiagnosticMessages.couldNotFindMatchingEndKeyword('select'),
                    location: { range: util.createRange(2, 24, 2, 30) }
                }]);
                expect(getSelect(parser).cases[0].body.statements).to.be.lengthOf(1);
                expect(getFunctionNames(parser)).to.eql(['main', 'second']);
            });

            it('flags a missing `end select` at the end of the file', () => {
                const parser = parse(`
                    select case a
                        case 1
                            print "one"
                `);
                expectDiagnostics(parser, [
                    DiagnosticMessages.couldNotFindMatchingEndKeyword('select')
                ]);
                expect(getSelect(parser).cases).to.be.lengthOf(1);
            });

            it('does not let an unterminated inner block swallow the rest of the select', () => {
                const parser = parse(`
                    sub main(a)
                        select case a
                            case 1
                                if a then
                                    print "if"
                            case 2
                                while true
                                    print "while"
                            case else
                                for i = 0 to 1
                                    print "for"
                        end select
                        print "after"
                    end sub
                `);
                expectDiagnostics(parser, [
                    DiagnosticMessages.expectedTerminator('end if', 'if'),
                    DiagnosticMessages.couldNotFindMatchingEndKeyword('while'),
                    DiagnosticMessages.expectedEndForOrNextToTerminateForLoop('for')
                ]);
                const stmt = getSelect(parser);
                expect(stmt.cases).to.be.lengthOf(3);
                expect(stmt.tokens.endSelect).to.exist;
                expect(getFunctionExpressions(parser)[0].body.statements).to.be.lengthOf(2);
            });

            it('flags `case` and `end select` found outside of a select case', () => {
                const parser = parse(`
                    sub main(a)
                        case 1
                            print "one"
                        case else
                        end select
                    end sub
                `);
                expectDiagnostics(parser, [{
                    ...DiagnosticMessages.caseOutsideSelectCase(),
                    location: { range: util.createRange(2, 24, 2, 28) }
                }, {
                    ...DiagnosticMessages.caseOutsideSelectCase(),
                    location: { range: util.createRange(4, 24, 4, 28) }
                }, {
                    ...DiagnosticMessages.endSelectWithoutSelectCase(),
                    location: { range: util.createRange(5, 24, 5, 34) }
                }]);
                expect(getFunctionExpressions(parser)[0].body.statements).to.be.lengthOf(1);
            });

            it('handles code as it is being typed', () => {
                //every prefix of this snippet should parse without throwing, and the function should always be found
                const full = `sub main(a)\n    select case a\n        case 1, 2\n            print "one"\n        case else\n            print "other"\n    end select\nend sub\n`;
                for (let i = 0; i <= full.length; i++) {
                    const parser = parse(full.substring(0, i));
                    //once the function signature is complete, the function should always be found
                    if (i >= 'sub main(a)'.length) {
                        expect(getFunctionExpressions(parser), `prefix length ${i}`).to.be.lengthOf(1);
                    }
                }
                expectZeroDiagnostics(parse(full));
            });
        });
    });

    describe('validation', () => {
        it('has no diagnostics for a complete statement', () => {
            validate(`
                sub main(a)
                    select case a
                        case 1, 2
                            print "one or two"
                        case else
                            print "other"
                    end select
                end sub
            `);
            expectZeroDiagnostics(program);
        });

        it('flags a missing `case else`', () => {
            validate(`
                sub main(a)
                    select case a
                        case 1
                            print "one"
                    end select
                end sub
            `);
            expectDiagnostics(program, [{
                ...DiagnosticMessages.selectCaseMissingCaseElse(),
                location: { range: util.createRange(2, 20, 2, 31) }
            }]);
        });

        it('flags a select case with no cases', () => {
            validate(`
                sub main(a)
                    select case a
                    end select
                end sub
            `);
            expectDiagnostics(program, [{
                ...DiagnosticMessages.selectCaseHasNoCases(),
                location: { range: util.createRange(2, 20, 2, 31) }
            }]);
        });

        it('flags `case else` that is not last', () => {
            validate(`
                sub main(a)
                    select case a
                        case else
                            print "other"
                        case 1
                            print "one"
                    end select
                end sub
            `);
            expectDiagnostics(program, [{
                ...DiagnosticMessages.caseElseMustBeLast(),
                location: { range: util.createRange(3, 24, 3, 33) }
            }]);
        });

        it('flags duplicate `case else`', () => {
            validate(`
                sub main(a)
                    select case a
                        case 1
                            print "one"
                        case else
                            print "other"
                        case else
                            print "other again"
                    end select
                end sub
            `);
            expectDiagnostics(program, [{
                ...DiagnosticMessages.duplicateCaseElse(),
                location: { range: util.createRange(7, 24, 7, 33) }
            }]);
        });

        it('flags empty cases that look like they fall through', () => {
            validate(`
                sub main(a)
                    select case a
                        case 1
                        case 2
                            print "two"
                        case 3
                            ' intentionally empty
                        case 4
                        case else
                    end select
                end sub
            `);
            expectDiagnostics(program, [{
                ...DiagnosticMessages.emptyCaseDoesNotFallThrough(),
                location: { range: util.createRange(3, 24, 3, 28) }
            }, {
                ...DiagnosticMessages.emptyCaseDoesNotFallThrough(),
                location: { range: util.createRange(8, 24, 8, 28) }
            }]);
        });

        it('does not flag an empty last case', () => {
            validate(`
                sub main(a)
                    select case a
                        case 1
                            print "one"
                        case else
                    end select
                end sub
            `);
            expectZeroDiagnostics(program);
        });

        it('flags duplicate case values', () => {
            validate(`
                enum Direction
                    up = "up"
                    down = "down"
                end enum
                sub main(a, b)
                    select case a
                        case 1, -1, Direction.up, b
                            print "first"
                        case 1, -1, direction.UP, B, 1.0, -2
                            print "second"
                        case getValue(), getValue()
                            print "third"
                        case else
                    end select
                    select case a
                        case "a", true
                        ' strings
                        case "a", "A", TRUE
                        ' strings
                        case else
                    end select
                end sub
                function getValue()
                    return 1
                end function
            `);
            expectDiagnostics(program, [{
                ...DiagnosticMessages.duplicateCaseValue('1', 8),
                location: { range: util.createRange(9, 29, 9, 30) }
            }, {
                ...DiagnosticMessages.duplicateCaseValue('-1', 8),
                location: { range: util.createRange(9, 32, 9, 34) }
            }, {
                ...DiagnosticMessages.duplicateCaseValue('direction.UP', 8),
                location: { range: util.createRange(9, 36, 9, 48) }
            }, {
                ...DiagnosticMessages.duplicateCaseValue('B', 8),
                location: { range: util.createRange(9, 50, 9, 51) }
            }, {
                //strings are compared case sensitively, so only the exact "a" is a duplicate
                ...DiagnosticMessages.duplicateCaseValue('"a"', 17),
                location: { range: util.createRange(18, 29, 18, 32) }
            }, {
                ...DiagnosticMessages.duplicateCaseValue('TRUE', 17),
                location: { range: util.createRange(18, 39, 18, 43) }
            },
            //mixing string and boolean literals is flagged too
            DiagnosticMessages.caseValueTypeMismatch('boolean', 'string'),
            DiagnosticMessages.caseValueTypeMismatch('boolean', 'string')
            ]);
        });

        it('does not flag values that might be different each time', () => {
            validate(`
                sub main(a, b)
                    select case a
                        case -b, getObject().value, getObject()[0]
                            print "first"
                        case -b, getObject().value, getObject()[0]
                            print "second"
                        case else
                    end select
                end sub
                function getObject()
                    return {}
                end function
            `);
            expectZeroDiagnostics(program);
        });

        it('flags literal values whose type does not match', () => {
            validate(`
                sub main(a)
                    select case a
                        case 1, 2.5, -3, &HFF, invalid
                            print "numbers"
                        case "one", true
                            print "mismatch"
                        case else
                    end select
                    select case "text"
                        case 1
                    end select
                    select case true
                        case a > 1, false
                            print "fine"
                        case "yes"
                            print "mismatch"
                        case else
                    end select
                end sub
            `);
            expectDiagnostics(program, [{
                ...DiagnosticMessages.caseValueTypeMismatch('string', 'number'),
                location: { range: util.createRange(5, 29, 5, 34) }
            }, {
                ...DiagnosticMessages.caseValueTypeMismatch('boolean', 'number'),
                location: { range: util.createRange(5, 36, 5, 40) }
            }, {
                ...DiagnosticMessages.caseValueTypeMismatch('number', 'string'),
                location: { range: util.createRange(10, 29, 10, 30) }
            },
            DiagnosticMessages.selectCaseMissingCaseElse(),
            {
                ...DiagnosticMessages.caseValueTypeMismatch('string', 'boolean'),
                location: { range: util.createRange(15, 29, 15, 34) }
            }]);
        });

        it('validates variables used inside a select case', () => {
            validate(`
                sub main()
                    select case unknownSubject
                        case unknownValue
                            print unknownInBody
                        case else
                    end select
                end sub
            `);
            expectDiagnostics(program, [
                DiagnosticMessages.cannotFindName('unknownSubject'),
                DiagnosticMessages.cannotFindName('unknownValue'),
                DiagnosticMessages.cannotFindName('unknownInBody')
            ]);
        });

        it('knows about variables assigned in every case', () => {
            validate(`
                sub main(a)
                    select case a
                        case 1
                            value = "one"
                        case 2
                            value = "two"
                        case else
                            value = "other"
                    end select
                    print value.len()
                end sub
            `);
            expectZeroDiagnostics(program);
        });

        describe('enum coverage', () => {
            const remoteDirection = `
                enum RemoteDirection
                    up = "up"
                    down = "down"
                    left = "left"
                    right = "right"
                end enum
            `;

            it('does not require `case else` when every member is covered', () => {
                program.setFile('source/enums.bs', remoteDirection);
                validate(`
                    sub move(direction as RemoteDirection)
                        select case direction
                            case RemoteDirection.up, RemoteDirection.down
                                print "vertical"
                            case RemoteDirection.left
                                print "left"
                            case RemoteDirection.right
                                print "right"
                        end select
                    end sub
                `);
                expectZeroDiagnostics(program);
            });

            it('lists the members that are not covered', () => {
                program.setFile('source/enums.bs', remoteDirection);
                validate(`
                    sub move(direction as RemoteDirection)
                        select case direction
                            case RemoteDirection.up
                                print "up"
                            case RemoteDirection.down
                                print "down"
                        end select
                    end sub
                `);
                expectDiagnostics(program, [{
                    ...DiagnosticMessages.selectCaseMissingEnumMembers('RemoteDirection', ['left', 'right']),
                    location: { range: util.createRange(2, 24, 2, 35) }
                }]);
            });

            it('does not check coverage when there is a `case else`', () => {
                program.setFile('source/enums.bs', remoteDirection);
                validate(`
                    sub move(direction as RemoteDirection)
                        select case direction
                            case RemoteDirection.up
                                print "up"
                            case else
                                print "other"
                        end select
                    end sub
                `);
                expectZeroDiagnostics(program);
            });

            it('counts literal values as covering members', () => {
                program.setFile('source/enums.bs', `
                    ${remoteDirection}
                    enum Level
                        low
                        medium = 5
                        high
                        negative = -1
                        hex = &HFF
                    end enum
                `);
                validate(`
                    sub move(direction as RemoteDirection, lvl as Level)
                        select case direction
                            case "up", "down"
                                print "vertical"
                            case "left", RemoteDirection.right
                                print "horizontal"
                        end select
                        select case lvl
                            case 0, 5
                                print "low or medium"
                            case 6, -1, &hff
                                print "other"
                        end select
                        select case direction
                            'strings are compared case sensitively
                            case "UP", "down", "left", "right"
                                print "not up"
                        end select
                    end sub
                `);
                expectDiagnostics(program, [
                    DiagnosticMessages.selectCaseMissingEnumMembers('RemoteDirection', ['up'])
                ]);
            });

            it('supports enums inside namespaces', () => {
                program.setFile('source/enums.bs', `
                    namespace alpha
                        enum Level
                            low
                            high
                        end enum
                    end namespace
                `);
                validate(`
                    sub a(level as alpha.Level)
                        select case level
                            case alpha.Level.low
                                print "low"
                        end select
                    end sub
                    namespace alpha
                        sub b(level as Level)
                            select case level
                                case Level.low
                                    print "low"
                                case Level.high
                                    print "high"
                            end select
                        end sub
                    end namespace
                `);
                expectDiagnostics(program, [
                    DiagnosticMessages.selectCaseMissingEnumMembers('alpha.Level', ['high'])
                ]);
            });

            it('only requires the members a narrowed variable can hold', () => {
                program.setFile('source/enums.bs', remoteDirection);
                validate(`
                    sub move(flag)
                        if flag then
                            direction = RemoteDirection.up
                        else
                            direction = RemoteDirection.down
                        end if
                        select case direction
                            case RemoteDirection.up
                                print "up"
                            case RemoteDirection.down
                                print "down"
                        end select
                        select case direction
                            case RemoteDirection.up
                                print "up"
                        end select
                    end sub
                `);
                expectDiagnostics(program, [
                    DiagnosticMessages.selectCaseMissingEnumMembers('RemoteDirection', ['down'])
                ]);
            });

            it('still requires `case else` for subjects that are not an enum', () => {
                program.setFile('source/enums.bs', remoteDirection);
                validate(`
                    sub move(direction, name as string)
                        select case direction
                            case RemoteDirection.up
                                print "up"
                            case RemoteDirection.down
                                print "down"
                            case RemoteDirection.left
                                print "left"
                            case RemoteDirection.right
                                print "right"
                        end select
                        select case name
                            case "up"
                                print "up"
                        end select
                    end sub
                `);
                expectDiagnostics(program, [
                    DiagnosticMessages.selectCaseMissingCaseElse(),
                    DiagnosticMessages.selectCaseMissingCaseElse()
                ]);
            });

            it('flags existing statements when a member is added to the enum', () => {
                program.setFile('source/enums.bs', remoteDirection);
                validate(`
                    sub move(direction as RemoteDirection)
                        select case direction
                            case RemoteDirection.up, RemoteDirection.down, RemoteDirection.left, RemoteDirection.right
                                print "moved"
                        end select
                    end sub
                `);
                expectZeroDiagnostics(program);

                program.setFile('source/enums.bs', remoteDirection.replace('right = "right"', 'right = "right"\n    center = "center"'));
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.selectCaseMissingEnumMembers('RemoteDirection', ['center'])
                ]);

                program.setFile('source/enums.bs', remoteDirection);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('flags case values from a different enum', () => {
                program.setFile('source/enums.bs', `
                    ${remoteDirection}
                    enum Other
                        up = "up"
                    end enum
                `);
                validate(`
                    sub move(direction as RemoteDirection)
                        select case direction
                            case Other.up
                                print "up"
                            case else
                                print "other"
                        end select
                    end sub
                `);
                expectDiagnostics(program, [{
                    ...DiagnosticMessages.caseValueEnumMismatch('Other', 'RemoteDirection'),
                    location: { range: util.createRange(3, 33, 3, 41) }
                }]);
            });
        });

        it('flags select case in brs files', () => {
            validate(`
                sub main(a)
                    select case a
                        case else
                    end select
                end sub
            `, 'source/main.brs');
            expectDiagnostics(program, [
                DiagnosticMessages.bsFeatureNotSupportedInBrsFiles('select case statements')
            ]);
        });
    });

    describe('transpile', () => {
        it('transpiles to an if/else chain', async () => {
            await testTranspile(`
                sub main(number)
                    select case number
                        case 1
                            print "one"
                        case 6, 7, 8
                            print "six through eight"
                        case else
                            print "no match"
                    end select
                end sub
            `, `
                sub main(number)
                    if number = 1 then
                        print "one"
                    else if number = 6 or number = 7 or number = 8 then
                        print "six through eight"
                    else
                        print "no match"
                    end if
                end sub
            `);
        });

        it('transpiles without `case else`', async () => {
            await testTranspile(`
                sub main(number)
                    select case number
                        case 1
                            print "one"
                        case 2
                            print "two"
                    end select
                end sub
            `, `
                sub main(number)
                    if number = 1 then
                        print "one"
                    else if number = 2 then
                        print "two"
                    end if
                end sub
            `, 'trim', 'source/main.bs', false);
        });

        it('transpiles multi-line values, the optional `case` keyword and single-line forms', async () => {
            await testTranspile(`
                sub main(number)
                    select number
                        case 6,
                            7,
                            8
                            print "six through eight"
                        case else
                    end select
                    select case number : case 1 : print "one" : case else : print "other" : end select
                end sub
            `, `
                sub main(number)
                    if number = 6 or number = 7 or number = 8 then
                        print "six through eight"
                    else
                    end if
                    if number = 1 then
                        print "one"
                    else
                        print "other"
                    end if
                end sub
            `);
        });

        it('transpiles only a `case else`', async () => {
            await testTranspile(`
                sub main(number)
                    select case number
                        case else
                            print "always"
                    end select
                end sub
            `, `
                sub main(number)
                    if true then
                        print "always"
                    end if
                end sub
            `);
        });

        it('evaluates a complex subject exactly once', async () => {
            await testTranspile(`
                sub main()
                    select case getValue()
                        case 1
                            print "one"
                        case 2, 3
                            print "two or three"
                        case else
                            print "other"
                    end select
                    select case m.top.value
                        case 1
                        ' nothing
                        case else
                    end select
                end sub
                function getValue()
                    return 1
                end function
            `, `
                sub main()
                    ${SELECT_CASE_SUBJECT_VARIABLE} = getValue()
                    if ${SELECT_CASE_SUBJECT_VARIABLE} = 1 then
                        print "one"
                    else if ${SELECT_CASE_SUBJECT_VARIABLE} = 2 or ${SELECT_CASE_SUBJECT_VARIABLE} = 3 then
                        print "two or three"
                    else
                        print "other"
                    end if
                    ${SELECT_CASE_SUBJECT_VARIABLE} = m.top.value
                    if ${SELECT_CASE_SUBJECT_VARIABLE} = 1 then
                        ' nothing
                    else
                    end if
                end sub

                function getValue()
                    return 1
                end function
            `);
        });

        it('still evaluates a complex subject when there are no cases', async () => {
            await testTranspile(`
                sub main()
                    select case getValue()
                    end select
                    select case 1
                    end select
                end sub
                function getValue()
                    return 1
                end function
            `, `
                sub main()
                    ${SELECT_CASE_SUBJECT_VARIABLE} = getValue()

                end sub

                function getValue()
                    return 1
                end function
            `, 'trim', 'source/main.bs', false);
        });

        it('uses literal subjects directly', async () => {
            await testTranspile(`
                sub main(a)
                    select case 1
                        case a
                            print "a"
                        case else
                    end select
                end sub
            `, `
                sub main(a)
                    if 1 = a then
                        print "a"
                    else
                    end if
                end sub
            `);
        });

        it('transpiles nested select case statements', async () => {
            await testTranspile(`
                sub main(a, b)
                    select case getValue(a)
                        case 1
                            select case getValue(b)
                                case 1
                                    print "a1b1"
                                case else
                                    print "a1"
                            end select
                        case else
                            print "other"
                    end select
                end sub
                function getValue(value)
                    return value
                end function
            `, `
                sub main(a, b)
                    ${SELECT_CASE_SUBJECT_VARIABLE} = getValue(a)
                    if ${SELECT_CASE_SUBJECT_VARIABLE} = 1 then
                        ${SELECT_CASE_SUBJECT_VARIABLE} = getValue(b)
                        if ${SELECT_CASE_SUBJECT_VARIABLE} = 1 then
                            print "a1b1"
                        else
                            print "a1"
                        end if
                    else
                        print "other"
                    end if
                end sub

                function getValue(value)
                    return value
                end function
            `);
        });

        it('uses conditions directly for `select case true`', async () => {
            await testTranspile(`
                sub main(a)
                    select case true
                        case a > 5 and a < 10
                            print "between"
                        case a = 1 or a = 2, a > 100, not a
                            print "several"
                        case a < 0
                            print "negative"
                        case else
                    end select
                end sub
            `, `
                sub main(a)
                    if a > 5 and a < 10 then
                        print "between"
                    else if (a = 1 or a = 2) or a > 100 or (not a) then
                        print "several"
                    else if a < 0 then
                        print "negative"
                    else
                    end if
                end sub
            `);
        });

        it('wraps values that would bind looser than `=`', async () => {
            await testTranspile(`
                sub main(a, b, c)
                    select case a
                        case b = c, b and c, not b, b + 1, -1, b as integer, (b), b < c as boolean
                            print "match"
                        case else
                    end select
                end sub
            `, `
                sub main(a, b, c)
                    if a = (b = c) or a = (b and c) or a = (not b) or a = b + 1 or a = -1 or a = b or a = (b) or a = (b < c) then
                        print "match"
                    else
                    end if
                end sub
            `);
        });

        it('inlines enums and constants', async () => {
            await testTranspile(`
                enum Direction
                    up = "up"
                    down = "down"
                end enum
                const MAX = 10
                namespace alpha
                    const MIN = 1
                end namespace
                sub main(a)
                    select case a
                        case Direction.up
                            print "up"
                        case Direction.down, MAX, alpha.MIN
                            print "other"
                        case else
                    end select
                    select case Direction.up
                        case a
                        ' nothing
                        case else
                    end select
                end sub
            `, `
                sub main(a)
                    if a = "up" then
                        print "up"
                    else if a = "down" or a = 10 or a = 1 then
                        print "other"
                    else
                    end if
                    ${SELECT_CASE_SUBJECT_VARIABLE} = "up"
                    if ${SELECT_CASE_SUBJECT_VARIABLE} = a then
                        ' nothing
                    else
                    end if
                end sub
            `);
        });

        it('keeps comments', async () => {
            await testTranspile(`
                sub main(a)
                    select case a ' what is a
                        ' before the first case
                        case 1 ' trailing
                            ' inside
                            print "one"
                        case else ' else trailing
                            ' else inside
                    end select
                end sub
            `, `
                sub main(a)
                    ' what is a
                    ' before the first case
                    if a = 1 then ' trailing
                        ' inside
                        print "one"
                    else ' else trailing
                        ' else inside
                    end if
                end sub
            `);
        });

        it('works with loops, `exit`, `continue`, and `return`', async () => {
            await testTranspile(`
                function main(items)
                    for each item in items
                        select case item
                            case 1
                                continue for
                            case 2
                                exit for
                            case else
                                return item
                        end select
                    end for
                    return invalid
                end function
            `, `
                function main(items)
                    for each item in items
                        if item = 1 then
                            continue for
                        else if item = 2 then
                            exit for
                        else
                            return item
                        end if
                    end for
                    return invalid
                end function
            `);
        });

        it('rewrites `continue` inside a case for older firmware', async () => {
            program = new Program({ rootDir: rootDir, sourceMap: true, minFirmwareVersion: '11.0.0' });
            await testTranspile(`
                sub main(items)
                    for each item in items
                        select case item
                            case 1
                                continue for
                            case else
                                print item
                        end select
                    end for
                end sub
            `, `
                sub main(items)
                    for each item in items
                        if item = 1 then
                            goto BRIGHTERSCRIPT_CONTINUE_0
                        else
                            print item
                        end if
                        BRIGHTERSCRIPT_CONTINUE_0:
                    end for
                end sub
            `);
        });

        it('transpiles partially-written code without crashing', async () => {
            await testTranspile(`
                sub main(a)
                    select case
                        case
                            print "one"
                        case else
                            print "other"
                end sub
            `, `
                sub main(a)
                    if false then
                        print "one"
                    else
                        print "other"
                    end if
                end sub
            `, 'trim', 'source/main.bs', false);
        });

        it('transpiles a missing subject as invalid', async () => {
            await testTranspile(`
                sub main()
                    select case
                        case 1
                            print "one"
                    end select
                end sub
            `, `
                sub main()
                    if invalid = 1 then
                        print "one"
                    end if
                end sub
            `, 'trim', 'source/main.bs', false);
        });

        it('transpiles misplaced `case else` as the final branch', async () => {
            await testTranspile(`
                sub main(a)
                    select case a
                        case else
                            print "other"
                        case 1
                            print "one"
                    end select
                end sub
            `, `
                sub main(a)
                    if a = 1 then
                        print "one"
                    else
                        print "other"
                    end if
                end sub
            `, 'trim', 'source/main.bs', false);
        });

        it('transpiles a standalone case statement as its body', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                sub main(a)
                    select case a
                        case 1
                            print "one"
                        case else
                    end select
                end sub
            `);
            const caseStatement = file.ast.findChild<CaseStatement>(isCaseStatement);
            const state = new BrsTranspileState(file);
            const code = util.sourceNodeFromTranspileResult(null, null, null, caseStatement.transpile(state)).toString();
            expect(code.trim()).to.eql('print "one"');
            expect(new CaseStatement({ case: caseStatement.tokens.case }).transpile(state)).to.eql([]);
        });

        it('maps the generated code back to the source', async () => {
            const result = await testTranspile(`
                sub main(a)
                    select case a
                        case 1
                            print "one"
                        case else
                    end select
                end sub
            `, `
                sub main(a)
                    if a = 1 then
                        print "one"
                    else
                    end if
                end sub
            `);
            expect(result.map).to.exist;
        });
    });
});
