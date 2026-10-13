import { expect } from '../../../chai-config.spec';
import { isBlock, isCaseStatement, isExitStatement, isIfStatement, isFunctionExpression, isFunctionStatement, isLiteralExpression, isPrintStatement, isSelectCaseStatement, isUnionType } from '../../../astUtils/reflection';
import { createVisitor, WalkMode } from '../../../astUtils/visitors';
import { DiagnosticMessages } from '../../../DiagnosticMessages';
import type { BrsFile } from '../../../files/BrsFile';
import { Program } from '../../../Program';
import { expectDiagnostics, expectDiagnosticsIncludes, expectZeroDiagnostics, getTestTranspile, rootDir } from '../../../testHelpers.spec';
import util from '../../../util';
import { SymbolTypeFlag } from '../../../SymbolTypeFlag';
import type { BscType } from '../../../types/BscType';
import { BrsTranspileState } from '../../BrsTranspileState';
import type { FunctionExpression, LiteralExpression } from '../../Expression';
import { Parser, ParseMode } from '../../Parser';
import type { ExitStatement, FunctionStatement, IfStatement, PrintStatement, SelectCaseStatement } from '../../Statement';
import { CaseStatement, SELECT_CASE_SUBJECT_VARIABLE, isExitSelectStatement } from '../../Statement';

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

        it('parses `exit select`', () => {
            const parser = parse(`
                sub main(value)
                    select case value
                        case 1
                            exit select
                        case else
                            if value then exit select
                    end select
                end sub
            `);
            expectZeroDiagnostics(parser);
            const exits = parser.ast.findChildren<ExitStatement>(isExitStatement, { walkMode: WalkMode.visitAllRecursive });
            expect(exits.map(x => x.tokens.loopType.text)).to.eql(['select', 'select']);
            expect(exits.every(x => isExitSelectStatement(x))).to.be.true;
        });

        it('supports values starting on the line after `case`', () => {
            const parser = parse(`
                sub main(value)
                    select case value
                        case
                            1, 2
                            print "one or two"
                        case
                            ' comments and blank lines are skipped

                            3,
                            4
                            print "three or four"
                        case else
                    end select
                end sub
            `);
            expectZeroDiagnostics(parser);
            const stmt = getSelect(parser);
            expect(stmt.cases.map(x => x.values.length)).to.eql([2, 2, 0]);
            expect(stmt.cases.map(x => x.body.statements.length)).to.eql([1, 1, 0]);
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

        it('allows select case inside an inline if', () => {
            const parser = parse(`
                sub main(value, ready)
                    if ready then select case value : case 1 : print 1 : case else : end select
                    if ready then select case value : case 1 : print 1 : case else : end select else print "no"
                    if ready then select case value
                        case 1
                            print 1
                        case else
                    end select
                    print "after"
                end sub
            `);
            expectZeroDiagnostics(parser);
            const ifStatements = parser.ast.findChildren<IfStatement>(isIfStatement, { walkMode: WalkMode.visitAllRecursive });
            expect(ifStatements.map(x => isSelectCaseStatement(x.thenBranch.statements[0]))).to.eql([true, true, true]);
            expect(ifStatements.map(x => x.thenBranch.statements.length)).to.eql([1, 1, 1]);
            expect(isBlock(ifStatements[1].elseBranch)).to.be.true;
            expect(getFunctionExpressions(parser)[0].body.statements).to.be.lengthOf(4);
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

            it('does not treat a line that is not a value list as the values of a bare `case`', () => {
                const parser = parse(`
                    sub main(a)
                        select case a
                            case
                                print "body"
                            case
                                a++
                            case
                                a = 1 : print "two statements"
                            case
                            case else
                        end select
                        select case a
                            case
                        end select
                        select case a
                            case
                    end sub
                `);
                expectDiagnostics(parser, [
                    { ...DiagnosticMessages.expectedCaseValue('case'), location: { range: util.createRange(3, 28, 3, 32) } },
                    { ...DiagnosticMessages.expectedCaseValue('case'), location: { range: util.createRange(5, 28, 5, 32) } },
                    { ...DiagnosticMessages.expectedCaseValue('case'), location: { range: util.createRange(9, 28, 9, 32) } },
                    { ...DiagnosticMessages.expectedCaseValue('case'), location: { range: util.createRange(13, 28, 13, 32) } },
                    { ...DiagnosticMessages.expectedCaseValue('case'), location: { range: util.createRange(16, 28, 16, 32) } },
                    DiagnosticMessages.couldNotFindMatchingEndKeyword('select')
                ]);
                const stmt = getSelect(parser);
                expect(stmt.cases.map(x => x.values.length)).to.eql([0, 0, 1, 0, 0]);
                expect(stmt.cases.map(x => x.body.statements.length)).to.eql([1, 1, 1, 0, 0]);
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

        it('flags empty cases followed by another case on the same line', () => {
            validate(`
                sub main(a)
                    select case a : case 1 : case 2 : print "two" : case else : end select
                    select case a
                        case 1 : case 2
                            print "one does nothing"
                        case else
                    end select
                end sub
            `);
            expectDiagnostics(program, [{
                ...DiagnosticMessages.emptyCaseDoesNotFallThrough(),
                location: { range: util.createRange(2, 36, 2, 40) }
            }, {
                ...DiagnosticMessages.emptyCaseDoesNotFallThrough(),
                location: { range: util.createRange(4, 24, 4, 28) }
            }]);
        });

        it('does not flag a case that only contains `exit select`', () => {
            validate(`
                sub main(a)
                    select case a
                        case 1
                            exit select
                        case 2
                            print "two"
                        case else
                    end select
                    select case a : case 1 : exit select : case 2 : print "two" : case else : end select
                end sub
            `);
            expectZeroDiagnostics(program);
        });

        it('flags `exit select` outside of a select case', () => {
            validate(`
                sub main(a)
                    exit select
                    while true
                        exit select
                    end while
                    select case a
                        case 1
                            callback = sub()
                                exit select
                            end sub
                        case else
                    end select
                end sub
            `);
            expectDiagnostics(program, [{
                ...DiagnosticMessages.exitSelectOutsideSelectCase(),
                location: { range: util.createRange(2, 20, 2, 31) }
            }, {
                ...DiagnosticMessages.exitSelectOutsideSelectCase(),
                location: { range: util.createRange(4, 24, 4, 35) }
            }, {
                ...DiagnosticMessages.exitSelectOutsideSelectCase(),
                location: { range: util.createRange(9, 32, 9, 43) }
            }]);
        });

        it('flags `exit select` inside a loop within a case', () => {
            validate(`
                sub main(a, items)
                    select case a
                        case 1
                            for each item in items
                                exit select
                            end for
                        case 2
                            while true
                                if a then
                                    exit select
                                end if
                            end while
                        case else
                            for each item in items
                                select case item
                                    case 1
                                        'exits the inner select, so this is fine
                                        exit select
                                    case else
                                end select
                            end for
                    end select
                end sub
            `);
            expectDiagnostics(program, [{
                ...DiagnosticMessages.exitSelectInLoop(),
                location: { range: util.createRange(5, 32, 5, 43) }
            }, {
                ...DiagnosticMessages.exitSelectInLoop(),
                location: { range: util.createRange(10, 36, 10, 47) }
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

    describe('type flow', () => {
        /**
         * Get a readable name for a type. Union members are sorted so tests don't depend on their order
         */
        function getTypeName(type: BscType) {
            if (isUnionType(type)) {
                return type.types.map(x => x.toString()).sort().join(' or ');
            }
            return type?.toString();
        }

        /**
         * Validate the code, then get the type of the first expression in every `print` statement, in the order they appear.
         * Statements that just print a literal (ie. `print "other"`) are skipped
         */
        function getPrintTypes(text: string) {
            const file = program.setFile<BrsFile>('source/main.bs', text);
            program.validate();
            return file.ast.findChildren<PrintStatement>(isPrintStatement, { walkMode: WalkMode.visitAllRecursive })
                .map(x => x.expressions[0])
                .filter(x => !isLiteralExpression(x))
                .map(x => getTypeName(x.getType({ flags: SymbolTypeFlag.runtime })));
        }

        /**
         * Validate the code, and make sure the type of each `print` statement's first expression is what we expect.
         * Union types can be written in any order (ie. `'string or integer'`)
         */
        function expectPrintTypes(text: string, expected: string[]) {
            expect(getPrintTypes(text)).to.eql(
                expected.map(x => x.split(' or ').sort().join(' or '))
            );
        }

        /**
         * A `select case` should produce the same types as the `if` chain it transpiles to
         */
        function expectSameTypesAsIfStatement(selectCaseCode: string, ifStatementCode: string) {
            const selectCaseTypes = getPrintTypes(selectCaseCode);
            const ifStatementTypes = getPrintTypes(ifStatementCode);
            //make sure the test is actually checking something
            expect(selectCaseTypes.length).to.be.greaterThan(0);
            expect(selectCaseTypes).to.eql(ifStatementTypes);
        }

        it('knows a variable assigned in every case (including `case else`) has the new type after the select', () => {
            expectPrintTypes(`
                sub main()
                    x = 1
                    y = 0
                    print y ' y is integer here
                    select x
                        case 1
                            y = "one"
                            print y
                        case else
                            y = "not one"
                            print y
                    end select
                    print y ' y *must* be a string here
                end sub
            `, ['integer', 'string', 'string', 'string']);
            expectZeroDiagnostics(program);
        });

        it('works the same with the `case` keyword after `select`', () => {
            expectPrintTypes(`
                sub main()
                    x = 1
                    y = 0
                    select case x
                        case 1
                            y = "one"
                        case else
                            y = "not one"
                    end select
                    print y
                end sub
            `, ['string']);
            expectZeroDiagnostics(program);
        });

        it('works with many cases', () => {
            expectPrintTypes(`
                sub main(x as integer)
                    y = 0
                    select case x
                        case 1
                            y = "one"
                        case 2, 3
                            y = "two or three"
                        case 4
                            y = "four"
                        case 5
                            y = "five"
                        case else
                            y = "something else"
                    end select
                    print y
                end sub
            `, ['string']);
            expectZeroDiagnostics(program);
        });

        it('works with a single case plus `case else`', () => {
            expectPrintTypes(`
                sub main(x as integer)
                    y = 0
                    select case x
                        case 1
                            y = "one"
                        case else
                            y = "other"
                    end select
                    print y
                end sub
            `, ['string']);
        });

        it('works when `case else` is the only case', () => {
            expectPrintTypes(`
                sub main(x as integer)
                    y = 0
                    select case x
                        case else
                            y = "always"
                    end select
                    print y
                end sub
            `, ['string']);
            expectZeroDiagnostics(program);
        });

        it('flags using the variable as its old type after the select', () => {
            validate(`
                sub main(x as integer)
                    y = 0
                    select case x
                        case 1
                            y = "one"
                        case else
                            y = "not one"
                    end select
                    takesString(y)
                    takesInteger(y)
                end sub

                sub takesString(value as string)
                end sub

                sub takesInteger(value as integer)
                end sub
            `);
            expectDiagnostics(program, [
                DiagnosticMessages.argumentTypeMismatch('string', 'integer').message
            ]);
        });

        it('allows using the variable as its new type after the select', () => {
            validate(`
                sub main(x as integer)
                    y = 0
                    select case x
                        case 1
                            y = "one"
                        case else
                            y = "not one"
                    end select
                    print y.len()
                    print lcase(y)
                end sub
            `);
            expectZeroDiagnostics(program);
        });

        it('uses a union when there is no `case else`', () => {
            expectPrintTypes(`
                sub main(x as integer)
                    y = 0
                    select case x
                        case 1
                            y = "one"
                        case 2
                            y = "two"
                    end select
                    print y
                end sub
            `, ['integer or string']);
            expectDiagnostics(program, [
                DiagnosticMessages.selectCaseMissingCaseElse()
            ]);
        });

        it('uses a union when only some cases assign the variable', () => {
            expectPrintTypes(`
                sub main(x as integer)
                    y = 0
                    select case x
                        case 1
                            y = "one"
                        case 2
                            print "two"
                        case else
                            y = "other"
                    end select
                    print y
                end sub
            `, ['integer or string']);
        });

        it('uses a union when only `case else` assigns the variable', () => {
            expectPrintTypes(`
                sub main(x as integer)
                    y = 0
                    select case x
                        case 1
                            print "one"
                        case else
                            y = "other"
                    end select
                    print y
                end sub
            `, ['integer or string']);
        });

        it('uses a union when `case else` does not assign the variable', () => {
            expectPrintTypes(`
                sub main(x as integer)
                    y = 0
                    select case x
                        case 1
                            y = "one"
                        case 2
                            y = "two"
                        case else
                            print "other"
                    end select
                    print y
                end sub
            `, ['integer or string']);
        });

        it('uses a union of every case type (but not the original type) when every case assigns a different type', () => {
            expectPrintTypes(`
                sub main(x as integer)
                    y = 0
                    select case x
                        case 1
                            y = "one"
                        case 2
                            y = true
                        case else
                            y = 3.5
                    end select
                    print y
                end sub
            `, ['string or boolean or float']);
        });

        it('includes the original type when every case assigns a different type, but there is no `case else`', () => {
            expectPrintTypes(`
                sub main(x as integer)
                    y = 0
                    select case x
                        case 1
                            y = "one"
                        case 2
                            y = true
                    end select
                    print y
                end sub
            `, ['integer or string or boolean']);
        });

        it('keeps the original type inside a case until the variable is reassigned', () => {
            expectPrintTypes(`
                sub main(x as integer)
                    y = 0
                    select case x
                        case 1
                            print y
                            y = "one"
                            print y
                        case 2
                            print y
                        case else
                            print y
                            y = true
                            print y
                    end select
                end sub
            `, ['integer', 'string', 'integer', 'integer', 'boolean']);
        });

        it('does not leak a type from one case into the next case', () => {
            expectPrintTypes(`
                sub main(x as integer)
                    y = 0
                    select case x
                        case 1
                            y = "one"
                        case 2
                            print y
                        case else
                            print y
                    end select
                end sub
            `, ['integer', 'integer']);
        });

        it('tracks multiple reassignments within a single case', () => {
            expectPrintTypes(`
                sub main(x as integer)
                    y = 0
                    select case x
                        case 1
                            y = "one"
                            print y
                            y = true
                            print y
                            y = 3.5
                            print y
                        case else
                            y = 1.5
                    end select
                    print y
                end sub
            `, ['string', 'boolean', 'float', 'float']);
        });

        it('uses the last assignment in each case for the type after the select', () => {
            expectPrintTypes(`
                sub main(x as integer)
                    y = 0
                    select case x
                        case 1
                            y = true
                            y = "one"
                        case else
                            y = 1.5
                            y = "other"
                    end select
                    print y
                end sub
            `, ['string']);
        });

        it('knows about a variable that is first created in every case', () => {
            expectPrintTypes(`
                sub main(x as integer)
                    select case x
                        case 1
                            label = "one"
                        case 2
                            label = "two"
                        case else
                            label = "other"
                    end select
                    print label
                end sub
            `, ['string']);
            expectZeroDiagnostics(program);
        });

        it('knows a variable first created in only some cases might be uninitialized', () => {
            expectPrintTypes(`
                sub main(x as integer)
                    select case x
                        case 1
                            label = "one"
                        case else
                            print "other"
                    end select
                    print label
                end sub
            `, ['string or uninitialized']);
        });

        it('knows a variable first created in every case might be uninitialized when there is no `case else`', () => {
            expectPrintTypes(`
                sub main(x as integer)
                    select case x
                        case 1
                            label = "one"
                        case 2
                            label = "two"
                    end select
                    print label
                end sub
            `, ['string or uninitialized']);
        });

        it('does not know about a variable created in a case when used in a different case', () => {
            validate(`
                sub main(x as integer)
                    select case x
                        case 1
                            label = "one"
                        case else
                            print label
                    end select
                end sub
            `);
            expectDiagnostics(program, [
                DiagnosticMessages.cannotFindName('label').message
            ]);
        });

        it('tracks several variables at once', () => {
            expectPrintTypes(`
                sub main(x as integer)
                    a = 0
                    b = 0
                    c = 0
                    select case x
                        case 1
                            a = "one"
                            b = "one"
                        case else
                            a = "other"
                            c = "other"
                    end select
                    print a
                    print b
                    print c
                end sub
            `, ['string', 'integer or string', 'integer or string']);
        });

        it('does not change the type of a variable that no case assigns', () => {
            expectPrintTypes(`
                sub main(x as integer)
                    y = 0
                    select case x
                        case 1
                            z = "one"
                        case else
                            z = "other"
                    end select
                    print y
                end sub
            `, ['integer']);
        });

        it('knows the type of the subject after it is reassigned in a case', () => {
            expectPrintTypes(`
                sub main()
                    x = 1
                    select case x
                        case 1
                            x = "one"
                        case else
                            x = "other"
                    end select
                    print x
                end sub
            `, ['string']);
        });

        it('uses the subject type for values computed from it', () => {
            expectPrintTypes(`
                sub main(x as integer)
                    select case x
                        case 1
                            y = x + 1
                        case else
                            y = x * 2
                    end select
                    print y
                end sub
            `, ['integer']);
        });

        it('supports compound assignments in a case', () => {
            expectPrintTypes(`
                sub main(x as integer)
                    y = "a"
                    select case x
                        case 1
                            y += "b"
                        case else
                            y += "c"
                    end select
                    print y
                end sub
            `, ['string']);
        });

        it('works with `select case true`', () => {
            expectPrintTypes(`
                sub main(age as integer)
                    group = 0
                    select case true
                        case age < 13
                            group = "child"
                        case age < 20
                            group = "teen"
                        case else
                            group = "adult"
                    end select
                    print group
                end sub
            `, ['string']);
            expectZeroDiagnostics(program);
        });

        it('works with a subject that is a function call', () => {
            expectPrintTypes(`
                sub main()
                    y = 0
                    select case getStatus()
                        case "on"
                            y = true
                        case else
                            y = false
                    end select
                    print y
                end sub

                function getStatus() as string
                    return "on"
                end function
            `, ['boolean']);
            expectZeroDiagnostics(program);
        });

        it('does not create a symbol for the temporary subject variable', () => {
            validate(`
                sub main()
                    select case getStatus()
                        case "on"
                            print "on"
                        case else
                            print "off"
                    end select
                    print ${SELECT_CASE_SUBJECT_VARIABLE}
                end sub

                function getStatus() as string
                    return "on"
                end function
            `);
            expectDiagnostics(program, [
                DiagnosticMessages.cannotFindName(SELECT_CASE_SUBJECT_VARIABLE).message
            ]);
        });

        it('works with values on the same line as `case`, separated by a colon', () => {
            expectPrintTypes(`
                sub main(x as integer)
                    y = 0
                    select case x
                        case 1: y = "one"
                        case 2: y = "two"
                        case else: y = "other"
                    end select
                    print y
                end sub
            `, ['string']);
        });

        it('works with values that wrap across lines', () => {
            expectPrintTypes(`
                sub main(x as integer)
                    y = 0
                    select case x
                        case 1,
                            2,
                            3
                            y = "small"
                        case else
                            y = "big"
                    end select
                    print y
                end sub
            `, ['string']);
        });

        it('works with values that start on the line after `case`', () => {
            expectPrintTypes(`
                sub main(x as integer)
                    y = 0
                    select case x
                        case
                            1, 2
                            y = "small"
                        case else
                            y = "big"
                    end select
                    print y
                end sub
            `, ['string']);
        });

        it('knows the type after a select that is nested in a case', () => {
            expectPrintTypes(`
                sub main(x as integer, z as integer)
                    y = 0
                    select case x
                        case 1
                            select case z
                                case 1
                                    y = "one one"
                                case else
                                    y = "one other"
                            end select
                            print y
                        case else
                            y = "other"
                    end select
                    print y
                end sub
            `, ['string', 'string']);
        });

        it('includes the original type inside a case when a nested select does not assign in every case', () => {
            expectPrintTypes(`
                sub main(x as integer, z as integer)
                    y = 0
                    select case x
                        case 1
                            select case z
                                case 1
                                    y = "one one"
                                case else
                                    print "one other"
                            end select
                            print y
                        case else
                            y = "other"
                    end select
                end sub
            `, ['integer or string']);
        });

        it('knows the type of a variable first created in every case of nested selects', () => {
            expectPrintTypes(`
                sub main(x as integer, z as integer)
                    select case x
                        case 1
                            select case z
                                case 1
                                    label = "one one"
                                case else
                                    label = "one other"
                            end select
                        case else
                            label = "other"
                    end select
                    print label
                end sub
            `, ['string']);
            expectZeroDiagnostics(program);
        });

        it('works with a select nested in an `if` branch', () => {
            expectPrintTypes(`
                sub main(x as integer, flag as boolean)
                    y = 0
                    if flag
                        select case x
                            case 1
                                y = "one"
                            case else
                                y = "other"
                        end select
                        print y
                    else
                        y = "not flagged"
                    end if
                    print y
                end sub
            `, ['string', 'string']);
        });

        it('works with an `if` nested in a case', () => {
            expectPrintTypes(`
                sub main(x as integer, flag as boolean)
                    y = 0
                    select case x
                        case 1
                            if flag
                                y = "flagged"
                            else
                                y = "not flagged"
                            end if
                            print y
                        case else
                            y = "other"
                    end select
                    print y
                end sub
            `, ['string', 'string']);
        });

        it('includes the original type inside a case when an `if` in the case does not assign in every branch', () => {
            expectPrintTypes(`
                sub main(x as integer, flag as boolean)
                    y = 0
                    select case x
                        case 1
                            if flag
                                y = "flagged"
                            end if
                            print y
                        case else
                            y = "other"
                    end select
                end sub
            `, ['integer or string']);
        });

        it('works with a loop in a case', () => {
            expectPrintTypes(`
                sub main(x as integer, items as string[])
                    y = 0
                    select case x
                        case 1
                            for each item in items
                                y = item
                                print y
                            end for
                            print y
                        case else
                            y = "other"
                    end select
                end sub
            `, ['string', 'integer or string']);
        });

        it('works with a select in a loop', () => {
            expectPrintTypes(`
                sub main(values as integer[])
                    y = 0
                    for each value in values
                        select case value
                            case 1
                                y = "one"
                            case else
                                y = "other"
                        end select
                        print y
                    end for
                    print y
                end sub
            `, ['string', 'integer or string']);
        });

        it('does not leak variables from a function expression in a case', () => {
            expectPrintTypes(`
                sub main(x as integer)
                    y = 0
                    select case x
                        case 1
                            callback = function()
                                y = "inner"
                                return y
                            end function
                        case else
                            callback = invalid
                    end select
                    print y
                end sub
            `, ['integer']);
        });

        it('knows the type of a variable used inside a function expression in a case', () => {
            expectPrintTypes(`
                sub main(x as integer)
                    select case x
                        case else
                            callback = function(value as string)
                                print value
                            end function
                    end select
                end sub
            `, ['string']);
        });

        it('works with class instances', () => {
            validate(`
                class Animal
                    function speak() as string
                        return "..."
                    end function
                end class

                class Dog extends Animal
                    function bark() as string
                        return "woof"
                    end function
                end class

                class Cat extends Animal
                end class

                sub main(x as integer)
                    select case x
                        case 1
                            pet = new Dog()
                        case else
                            pet = new Cat()
                    end select
                    print pet.speak()
                    print pet.bark()
                end sub
            `);
            expectDiagnosticsIncludes(program, [
                DiagnosticMessages.cannotFindFunction('bark', 'pet.bark', '(Dog or Cat)').message
            ]);
        });

        it('knows the class type when every case creates the same class', () => {
            expectPrintTypes(`
                class Dog
                    function bark() as string
                        return "woof"
                    end function
                end class

                sub main(x as integer)
                    pet = invalid
                    select case x
                        case 1
                            pet = new Dog()
                        case else
                            pet = new Dog()
                    end select
                    print pet
                    print pet.bark()
                end sub
            `, ['Dog', 'string']);
            expectZeroDiagnostics(program);
        });

        it('knows the type of an enum value assigned in every case', () => {
            expectPrintTypes(`
                enum Direction
                    up = "up"
                    down = "down"
                end enum

                sub main(x as integer)
                    select case x
                        case 1
                            direction = Direction.up
                            print direction
                        case else
                            direction = Direction.down
                            print direction
                    end select
                    print direction
                    print direction.len()
                end sub
            `, ['Direction', 'Direction', 'Direction or Direction', 'integer']);
            expectZeroDiagnostics(program);
        });

        it('includes the original type when an enum subject is fully covered, but there is no `case else`', () => {
            //an enum is just a string at runtime, so the subject could still hold some other value
            expectPrintTypes(`
                enum Direction
                    up = "up"
                    down = "down"
                end enum

                sub main(value as Direction)
                    y = 0
                    select case value
                        case Direction.up
                            y = "up"
                        case Direction.down
                            y = "down"
                    end select
                    print y
                end sub
            `, ['integer or string']);
            expectZeroDiagnostics(program);
        });

        it('keeps the type from before the select when a case returns before assigning', () => {
            expectPrintTypes(`
                sub main(x as integer)
                    y = 0
                    select case x
                        case 1
                            return
                        case else
                            y = "other"
                    end select
                    print y
                end sub
            `, ['integer or string']);
        });

        it('includes the original type when a case might `exit select` before assigning', () => {
            expectPrintTypes(`
                sub main(x as integer, flag as boolean)
                    y = 0
                    select case x
                        case 1
                            if flag
                                exit select
                            end if
                            y = "one"
                        case else
                            y = "other"
                    end select
                    print y
                end sub
            `, ['integer or string']);
        });

        it('includes the original type when `case else` might `exit select` before assigning', () => {
            expectPrintTypes(`
                sub main(x as integer, flag as boolean)
                    y = 0
                    select case x
                        case 1
                            y = "one"
                        case else
                            if flag then exit select
                            y = "other"
                    end select
                    print y
                end sub
            `, ['integer or string']);
        });

        it('knows a variable first created after an early `exit select` might be uninitialized', () => {
            expectPrintTypes(`
                sub main(x as integer, flag as boolean)
                    select case x
                        case 1
                            if flag
                                exit select
                            end if
                            label = "one"
                        case else
                            label = "other"
                    end select
                    print label
                end sub
            `, ['string or uninitialized']);
        });

        it('uses the new type when `exit select` is the last statement of a case', () => {
            expectPrintTypes(`
                sub main(x as integer)
                    y = 0
                    select case x
                        case 1
                            y = "one"
                            exit select
                        case else
                            y = "other"
                            exit select
                    end select
                    print y
                end sub
            `, ['string']);
            expectZeroDiagnostics(program);
        });

        it('uses the new type when an early `exit select` belongs to a nested select', () => {
            expectPrintTypes(`
                sub main(x as integer, z as integer)
                    y = 0
                    select case x
                        case 1
                            select case z
                                case 1
                                    if z > 0 then exit select
                                    print "positive"
                                case else
                                    print "other"
                            end select
                            y = "one"
                        case else
                            y = "other"
                    end select
                    print y
                end sub
            `, ['string']);
        });

        describe('matches the equivalent if statement', () => {
            it('when every branch assigns', () => {
                expectSameTypesAsIfStatement(`
                    sub main(x as integer)
                        y = 0
                        select case x
                            case 1
                                y = "one"
                            case 2
                                y = "two"
                            case else
                                y = "other"
                        end select
                        print y
                    end sub
                `, `
                    sub main(x as integer)
                        y = 0
                        if x = 1
                            y = "one"
                        else if x = 2
                            y = "two"
                        else
                            y = "other"
                        end if
                        print y
                    end sub
                `);
            });

            it('when there is no else branch', () => {
                expectSameTypesAsIfStatement(`
                    sub main(x as integer)
                        y = 0
                        select case x
                            case 1
                                y = "one"
                            case 2
                                y = true
                        end select
                        print y
                    end sub
                `, `
                    sub main(x as integer)
                        y = 0
                        if x = 1
                            y = "one"
                        else if x = 2
                            y = true
                        end if
                        print y
                    end sub
                `);
            });

            it('when only some branches assign', () => {
                expectSameTypesAsIfStatement(`
                    sub main(x as integer)
                        y = 0
                        select case x
                            case 1
                                y = "one"
                            case 2
                                print "two"
                            case else
                                y = 1.5
                        end select
                        print y
                    end sub
                `, `
                    sub main(x as integer)
                        y = 0
                        if x = 1
                            y = "one"
                        else if x = 2
                            print "two"
                        else
                            y = 1.5
                        end if
                        print y
                    end sub
                `);
            });

            it('when a variable is first created in the branches', () => {
                expectSameTypesAsIfStatement(`
                    sub main(x as integer)
                        select case x
                            case 1
                                a = "one"
                                b = "one"
                            case else
                                a = "other"
                        end select
                        print a
                        print b
                    end sub
                `, `
                    sub main(x as integer)
                        if x = 1
                            a = "one"
                            b = "one"
                        else
                            a = "other"
                        end if
                        print a
                        print b
                    end sub
                `);
            });

            it('when a variable is first created in the branches, but there is no else branch', () => {
                expectSameTypesAsIfStatement(`
                    sub main(x as integer)
                        select case x
                            case 1
                                a = "one"
                            case 2
                                a = "two"
                        end select
                        print a
                    end sub
                `, `
                    sub main(x as integer)
                        if x = 1
                            a = "one"
                        else if x = 2
                            a = "two"
                        end if
                        print a
                    end sub
                `);
            });

            it('inside each branch', () => {
                expectSameTypesAsIfStatement(`
                    sub main(x as integer)
                        y = 0
                        select case x
                            case 1
                                print y
                                y = "one"
                                print y
                            case 2
                                print y
                            case else
                                print y
                                y = true
                                print y
                        end select
                        print y
                    end sub
                `, `
                    sub main(x as integer)
                        y = 0
                        if x = 1
                            print y
                            y = "one"
                            print y
                        else if x = 2
                            print y
                        else
                            print y
                            y = true
                            print y
                        end if
                        print y
                    end sub
                `);
            });

            it('when a branch returns', () => {
                expectSameTypesAsIfStatement(`
                    sub main(x as integer)
                        y = 0
                        select case x
                            case 1
                                return
                            case else
                                y = "other"
                        end select
                        print y
                    end sub
                `, `
                    sub main(x as integer)
                        y = 0
                        if x = 1
                            return
                        else
                            y = "other"
                        end if
                        print y
                    end sub
                `);
            });

            it('when an `if` inside a branch does not assign in every branch', () => {
                expectSameTypesAsIfStatement(`
                    sub main(x as integer, flag as boolean)
                        y = 0
                        select case x
                            case 1
                                if flag
                                    y = "flagged"
                                end if
                            case else
                                y = "other"
                        end select
                        print y
                    end sub
                `, `
                    sub main(x as integer, flag as boolean)
                        y = 0
                        if x = 1
                            if flag
                                y = "flagged"
                            end if
                        else
                            y = "other"
                        end if
                        print y
                    end sub
                `);
            });

            it('when a loop inside a branch assigns', () => {
                expectSameTypesAsIfStatement(`
                    sub main(x as integer, items as string[])
                        y = 0
                        select case x
                            case 1
                                for each item in items
                                    y = item
                                end for
                            case else
                                y = "other"
                        end select
                        print y
                    end sub
                `, `
                    sub main(x as integer, items as string[])
                        y = 0
                        if x = 1
                            for each item in items
                                y = item
                            end for
                        else
                            y = "other"
                        end if
                        print y
                    end sub
                `);
            });

            it('when assigning enum values', () => {
                expectSameTypesAsIfStatement(`
                    enum Direction
                        up = "up"
                        down = "down"
                    end enum

                    sub main(x as integer)
                        select case x
                            case 1
                                direction = Direction.up
                            case else
                                direction = Direction.down
                        end select
                        print direction
                    end sub
                `, `
                    enum Direction
                        up = "up"
                        down = "down"
                    end enum

                    sub main(x as integer)
                        if x = 1
                            direction = Direction.up
                        else
                            direction = Direction.down
                        end if
                        print direction
                    end sub
                `);
            });

            it('when nested', () => {
                expectSameTypesAsIfStatement(`
                    sub main(x as integer, z as integer)
                        y = 0
                        select case x
                            case 1
                                select case z
                                    case 1
                                        y = "one one"
                                    case else
                                        y = true
                                end select
                                print y
                            case 2
                                select case z
                                    case 1
                                        y = 1.5
                                end select
                                print y
                            case else
                                y = "other"
                        end select
                        print y
                    end sub
                `, `
                    sub main(x as integer, z as integer)
                        y = 0
                        if x = 1
                            if z = 1
                                y = "one one"
                            else
                                y = true
                            end if
                            print y
                        else if x = 2
                            if z = 1
                                y = 1.5
                            end if
                            print y
                        else
                            y = "other"
                        end if
                        print y
                    end sub
                `);
            });
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

        it('drops an `exit select` at the end of a case, keeping its comments', async () => {
            await testTranspile(`
                sub main(key)
                    select case key
                        case "back"
                            ' handled elsewhere
                            exit select
                        case "options"
                            print "options"
                            exit select
                        case else
                            exit select
                    end select
                    select case key : case 1 : exit select : case 2 : print "two" : case else : end select
                end sub
            `, `
                sub main(key)
                    if key = "back" then
                        ' handled elsewhere
                    else if key = "options" then
                        print "options"
                    else
                    end if
                    if key = 1 then
                    else if key = 2 then
                        print "two"
                    else
                    end if
                end sub
            `);
        });

        it('turns an `exit select` in the middle of a case into a goto', async () => {
            await testTranspile(`
                sub main(key, isDirty)
                    select case key
                        case "save"
                            if not isDirty then
                                exit select
                            end if
                            print "saving"
                        case else
                            select case isDirty
                                case true
                                    if key = invalid then
                                        exit select
                                    end if
                                    print "inner"
                                case else
                            end select
                            exit select
                    end select
                    print "after"
                end sub
            `, `
                sub main(key, isDirty)
                    if key = "save" then
                        if not isDirty then
                            goto BRIGHTERSCRIPT_EXIT_SELECT_0
                        end if
                        print "saving"
                    else
                        if isDirty = true then
                            if key = invalid then
                                goto BRIGHTERSCRIPT_EXIT_SELECT_1
                            end if
                            print "inner"
                        else
                        end if
                        BRIGHTERSCRIPT_EXIT_SELECT_1:
                    end if
                    BRIGHTERSCRIPT_EXIT_SELECT_0:
                    print "after"
                end sub
            `);
        });

        it('transpiles select case inside an inline if', async () => {
            await testTranspile(`
                sub main(key, ready)
                    if ready then select case key : case 1 : print "one" : case else : print "other" : end select else print "not ready"
                    if ready then select case key
                        case 1
                            print "one"
                        case else
                    end select
                end sub
            `, `
                sub main(key, ready)
                    if ready then
                        if key = 1 then
                            print "one"
                        else
                            print "other"
                        end if
                    else
                        print "not ready"
                    end if
                    if ready then
                        if key = 1 then
                            print "one"
                        else
                        end if
                    end if
                end sub
            `);
        });

        it('transpiles values on the line after `case`', async () => {
            await testTranspile(`
                sub main(key)
                    select case key
                        case
                            1, 2
                            print "one or two"
                        case else
                    end select
                end sub
            `, `
                sub main(key)
                    if key = 1 or key = 2 then
                        print "one or two"
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
