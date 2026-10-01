import { expect } from '../../../chai-config.spec';
import { DiagnosticMessages } from '../../../DiagnosticMessages';
import { Parser, ParseMode } from '../../Parser';
import { Program } from '../../../Program';
import { expectDiagnostics, expectDiagnosticsIncludes, expectZeroDiagnostics, getTestTranspile, rootDir } from '../../../testHelpers.spec';
import type { DestructuringAssignmentStatement } from '../../Statement';
import type { ArrayPatternExpression, ObjectPatternExpression } from '../../Expression';
import { isArrayPatternExpression, isDestructuringAssignmentStatement, isObjectPatternExpression, isVariableExpression } from '../../../astUtils/reflection';
import { SymbolTypeFlag } from '../../../SymbolTypeFlag';
import type { BrsFile } from '../../../files/BrsFile';
import { util } from '../../../util';
import { createSandbox } from 'sinon';
import { TokenKind } from '../../../lexer/TokenKind';

const sinon = createSandbox();

describe('DestructuringAssignmentStatement', () => {
    let program: Program;
    const testTranspile = getTestTranspile(() => [program, rootDir]);

    beforeEach(() => {
        program = new Program({ rootDir: rootDir, sourceMap: true });
    });
    afterEach(() => {
        sinon.restore();
        program.dispose();
    });

    function parse(text: string, mode = ParseMode.BrighterScript) {
        return Parser.parse(text, { mode: mode });
    }

    function parseStatement(text: string) {
        const parser = parse(text);
        expectZeroDiagnostics(parser);
        const statement = parser.ast.statements[0] as DestructuringAssignmentStatement;
        expect(isDestructuringAssignmentStatement(statement)).to.be.true;
        return statement;
    }

    describe('parse', () => {
        it('parses an object pattern with shorthand properties', () => {
            const statement = parseStatement(`{ name, age } = person`);
            const pattern = statement.pattern as ObjectPatternExpression;
            expect(isObjectPatternExpression(pattern)).to.be.true;
            expect(pattern.properties.map(x => x.getKeyName())).to.eql(['name', 'age']);
            expect(pattern.properties.map(x => x.targetName.text)).to.eql(['name', 'age']);
            expect(pattern.rest).to.be.undefined;
            expect(isVariableExpression(statement.value)).to.be.true;
            expect(statement.getTargetNames().map(x => x.text)).to.eql(['name', 'age']);
        });

        it('parses renamed, nested, defaulted, string-keyed and rest properties', () => {
            const statement = parseStatement(`{ name: userName, address: { city }, age = 21, "first name": firstName, ...others } = person`);
            const pattern = statement.pattern as ObjectPatternExpression;
            expect(pattern.properties.map(x => x.getKeyName())).to.eql(['name', 'address', 'age', 'first name']);
            expect(pattern.properties[0].tokens.name.text).to.eql('userName');
            expect(pattern.properties[0].targetName.text).to.eql('userName');
            expect(isObjectPatternExpression(pattern.properties[1].pattern)).to.be.true;
            expect(pattern.properties[1].targetName).to.be.undefined;
            expect(pattern.properties[2].defaultValue).to.exist;
            expect(pattern.properties[3].tokens.key.kind).to.eql(TokenKind.StringLiteral);
            expect(pattern.rest.tokens.dotDotDot.kind).to.eql(TokenKind.DotDotDot);
            expect(pattern.rest.tokens.name.text).to.eql('others');
            expect(statement.getTargetNames().map(x => x.text)).to.eql(['userName', 'city', 'age', 'firstName', 'others']);
        });

        it('parses an array pattern with holes, defaults, nested patterns and rest', () => {
            const statement = parseStatement(`[first, , third = 3, [nestedA, nestedB], { name }, ...rest] = items`);
            const pattern = statement.pattern as ArrayPatternExpression;
            expect(isArrayPatternExpression(pattern)).to.be.true;
            expect(pattern.elements).to.have.lengthOf(5);
            expect(pattern.elements[0].tokens.name.text).to.eql('first');
            expect(pattern.elements[1].isHole).to.be.true;
            expect(pattern.elements[2].tokens.name.text).to.eql('third');
            expect(pattern.elements[2].defaultValue).to.exist;
            expect(isArrayPatternExpression(pattern.elements[3].pattern)).to.be.true;
            expect(isObjectPatternExpression(pattern.elements[4].pattern)).to.be.true;
            expect(pattern.rest.tokens.name.text).to.eql('rest');
            expect(statement.getTargetNames().map(x => x.text)).to.eql(['first', 'third', 'nestedA', 'nestedB', 'name', 'rest']);
        });

        it('parses a leading hole', () => {
            const statement = parseStatement(`[, second] = items`);
            const pattern = statement.pattern as ArrayPatternExpression;
            expect(pattern.elements[0].isHole).to.be.true;
            expect(pattern.elements[1].tokens.name.text).to.eql('second');
        });

        it('parses patterns that span multiple lines and have trailing commas', () => {
            const statement = parseStatement(`
                {
                    name,
                    age,
                } = person
            `);
            expect(statement.getTargetNames().map(x => x.text)).to.eql(['name', 'age']);
            expect((statement.pattern as ObjectPatternExpression).properties[1].tokens.comma).to.exist;

            const arrayStatement = parseStatement(`
                [
                    first,
                    second,
                ] = items
            `);
            expect(arrayStatement.getTargetNames().map(x => x.text)).to.eql(['first', 'second']);
        });

        it('parses an object pattern as the value of a destructuring assignment', () => {
            const statement = parseStatement(`{ a } = { a: 1 }`);
            expect(statement.getTargetNames().map(x => x.text)).to.eql(['a']);
        });

        it('parses a default value that contains brackets', () => {
            const statement = parseStatement(`{ a = items[0], b = getValue() } = obj`);
            expect(statement.getTargetNames().map(x => x.text)).to.eql(['a', 'b']);
        });

        it('parses inside a single-line if statement', () => {
            const parser = parse(`if true then [a, b] = items`);
            expectZeroDiagnostics(parser);
        });

        it('flags the feature when used in plain brightscript', () => {
            const parser = parse(`{ name } = person`, ParseMode.BrightScript);
            expectDiagnosticsIncludes(parser, [
                DiagnosticMessages.bsFeatureNotSupportedInBrsFiles('destructuring assignment').message
            ]);
        });

        it('flags a rest element that is not last', () => {
            expectDiagnostics(parse(`{ ...rest, name } = person`), [
                DiagnosticMessages.restElementMustBeLast().message
            ]);
            expectDiagnostics(parse(`[...rest, first] = items`), [
                DiagnosticMessages.restElementMustBeLast().message
            ]);
            expectDiagnostics(parse(`[...rest, , first] = items`), [
                DiagnosticMessages.restElementMustBeLast().message
            ]);
        });

        it('allows whitespace but not a newline between the `...` and the rest element name', () => {
            expectZeroDiagnostics(parse(`[... rest] = items`));
            expectZeroDiagnostics(parse(`{ name, ... rest } = person`));
            expectZeroDiagnostics(parse(`[...rest] = items`));
            expect(parse(`{ ...
                rest } = person`).diagnostics).not.to.be.empty;
        });

        it('flags a string literal key without a target', () => {
            expectDiagnosticsIncludes(parse(`{ "first name" } = person`), [
                DiagnosticMessages.expectedToken(TokenKind.Colon).message
            ]);
        });

        it('flags reserved words used as targets', () => {
            expectDiagnosticsIncludes(parse(`{ run } = person`), [
                DiagnosticMessages.cannotUseReservedWordAsIdentifier('run').message
            ]);
            expectDiagnosticsIncludes(parse(`{ name: run } = person`), [
                DiagnosticMessages.cannotUseReservedWordAsIdentifier('run').message
            ]);
            expectDiagnosticsIncludes(parse(`[run] = items`), [
                DiagnosticMessages.cannotUseReservedWordAsIdentifier('run').message
            ]);
        });

        it('flags an invalid array element', () => {
            expectDiagnosticsIncludes(parse(`[1] = items`), [
                DiagnosticMessages.expectedDestructuringTarget().message
            ]);
        });

        it('does not treat brackets that are not followed by `=` as destructuring', () => {
            const parser = parse(`[1, 2].push(3)`);
            expect(parser.ast.statements.some(x => isDestructuringAssignmentStatement(x))).to.be.false;
        });

        it('clones the statement', () => {
            const statement = parseStatement(`{ name: userName, address: { city }, age = 21, ...others } = person`);
            const clone = statement.clone();
            expect(clone).not.to.equal(statement);
            expect(clone.getTargetNames().map(x => x.text)).to.eql(['userName', 'city', 'age', 'others']);
            expect(clone.pattern.rest.parent).to.equal(clone.pattern);
            expect(clone.pattern.parent).to.equal(clone);
            expect(clone.value.parent).to.equal(clone);
            expect(clone.location).to.eql(statement.location);
            const arrayStatement = parseStatement(`[first, , third = 3, ...rest] = items`);
            const arrayClone = arrayStatement.clone();
            expect(arrayClone.getTargetNames().map(x => x.text)).to.eql(['first', 'third', 'rest']);
        });
    });

    describe('transpile', () => {
        it('reads directly from a plain variable source', async () => {
            await testTranspile(`
                sub main(person)
                    { name, age } = person
                    print name; age
                end sub
            `, `
                sub main(person)
                    name = person.name
                    age = person.age
                    print name; age
                end sub
            `);
        });

        it('evaluates a non-variable source exactly once', async () => {
            await testTranspile(`
                sub main()
                    { name, age } = getPerson()
                    print name; age
                end sub
                function getPerson()
                    return { name: "bob", age: 12 }
                end function
            `, `
                sub main()
                    __bsDestructure0 = getPerson()
                    name = __bsDestructure0.name
                    age = __bsDestructure0.age
                    print name; age
                end sub

                function getPerson()
                    return {
                        name: "bob"
                        age: 12
                    }
                end function
            `);
        });

        it('transpiles renamed properties and string literal keys', async () => {
            await testTranspile(`
                sub main(person)
                    { name: userName, "first name": firstName } = person
                    print userName; firstName
                end sub
            `, `
                sub main(person)
                    userName = person.name
                    firstName = person["first name"]
                    print userName; firstName
                end sub
            `);
        });

        it('transpiles nested patterns', async () => {
            await testTranspile(`
                sub main(person)
                    { address: { city, geo: [lat, lng] } } = person
                    print city; lat; lng
                end sub
            `, `
                sub main(person)
                    __bsDestructure0 = person.address
                    city = __bsDestructure0.city
                    __bsDestructure1 = __bsDestructure0.geo
                    lat = __bsDestructure1[0]
                    lng = __bsDestructure1[1]
                    print city; lat; lng
                end sub
            `);
        });

        it('transpiles default values as a fallback when the value is invalid', async () => {
            await testTranspile(`
                sub main(person)
                    { name = "unknown", address: { city } = {} } = person
                    print name; city
                end sub
            `, `
                sub main(person)
                    name = person.name
                    if name = invalid then name = "unknown"
                    __bsDestructure0 = person.address
                    if __bsDestructure0 = invalid then __bsDestructure0 = {}
                    city = __bsDestructure0.city
                    print name; city
                end sub
            `);
        });

        it('transpiles an object rest element', async () => {
            await testTranspile(`
                sub main(person)
                    { name, "first name": firstName, ...others } = person
                    print name; firstName; others
                end sub
            `, `
                sub main(person)
                    name = person.name
                    firstName = person["first name"]
                    others = {}
                    others.append(person)
                    others.delete("name")
                    others.delete("first name")
                    print name; firstName; others
                end sub
            `);
        });

        it('transpiles array patterns with holes, defaults and rest', async () => {
            await testTranspile(`
                sub main(items)
                    [first, , third = 3, ...rest] = items
                    print first; third; rest
                end sub
            `, `
                sub main(items)
                    first = items[0]
                    third = items[2]
                    if third = invalid then third = 3
                    rest = []
                    for __bsDestructure0 = 3 to items.count() - 1
                        rest.push(items[__bsDestructure0])
                    end for
                    print first; third; rest
                end sub
            `);
        });

        it('transpiles an array rest element on its own', async () => {
            await testTranspile(`
                sub main(items)
                    [...copy] = items
                    print copy
                end sub
            `, `
                sub main(items)
                    copy = []
                    for __bsDestructure0 = 0 to items.count() - 1
                        copy.push(items[__bsDestructure0])
                    end for
                    print copy
                end sub
            `);
        });

        it('destructures a spread literal on the right-hand side', async () => {
            await testTranspile(`
                sub main(defaults, items)
                    { name, ...others } = { ...defaults, name: "bob" }
                    [first, ...rest] = [...items, 9]
                    print name; others; first; rest
                end sub
            `, `
                sub main(defaults, items)
                    __bsc_tmp_spread = {}
                    __bsc_tmp_spread.append(defaults)
                    __bsc_tmp_spread.name = "bob"
                    name = __bsc_tmp_spread.name
                    others = {}
                    others.append(__bsc_tmp_spread)
                    others.delete("name")
                    __bsc_tmp_spread = []
                    __bsc_tmp_spread.append(items)
                    __bsc_tmp_spread.push(9)
                    first = __bsc_tmp_spread[0]
                    rest = []
                    for __bsDestructure0 = 1 to __bsc_tmp_spread.count() - 1
                        rest.push(__bsc_tmp_spread[__bsDestructure0])
                    end for
                    print name; others; first; rest
                end sub
            `);
        });

        it('transpiles a const source instead of reading it by name', async () => {
            await testTranspile(`
                const DEFAULTS = { a: 1 }
                sub main()
                    { a } = DEFAULTS
                    print a
                end sub
            `, `
                sub main()
                    __bsDestructure0 = ({
                        a: 1
                    })
                    a = __bsDestructure0.a
                    print a
                end sub
            `);
        });

        it('transpiles a namespace-relative const source instead of reading it by name', async () => {
            await testTranspile(`
                namespace alpha
                    const CFG = { a: 1 }
                    sub main()
                        { a } = CFG
                        print a
                    end sub
                end namespace
            `, `
                sub alpha_main()
                    __bsDestructure0 = ({
                        a: 1
                    })
                    a = __bsDestructure0.a
                    print a
                end sub
            `);
        });

        it('swaps variables through a temp', async () => {
            await testTranspile(`
                sub main()
                    a = 1
                    b = 2
                    [a, b] = [b, a]
                    print a; b
                end sub
            `, `
                sub main()
                    a = 1
                    b = 2
                    __bsDestructure0 = [
                        b
                        a
                    ]
                    a = __bsDestructure0[0]
                    b = __bsDestructure0[1]
                    print a; b
                end sub
            `);
        });

        it('uses a temp when the source variable is also a target', async () => {
            await testTranspile(`
                sub main(items)
                    [items, other] = items
                    print items; other
                end sub
            `, `
                sub main(items)
                    __bsDestructure0 = items
                    items = __bsDestructure0[0]
                    other = __bsDestructure0[1]
                    print items; other
                end sub
            `);
        });

        it('transpiles nested blocks with correct indentation', async () => {
            await testTranspile(`
                sub main(items)
                    if true then
                        [a, b] = getItems()
                        print a; b
                    end if
                end sub
                function getItems()
                    return [1, 2]
                end function
            `, `
                sub main(items)
                    if true then
                        __bsDestructure0 = getItems()
                        a = __bsDestructure0[0]
                        b = __bsDestructure0[1]
                        print a; b
                    end if
                end sub

                function getItems()
                    return [
                        1
                        2
                    ]
                end function
            `);
        });

        it('keeps leading comments and handles multi-line patterns', async () => {
            await testTranspile(`
                sub main(person)
                    'extract the important bits
                    {
                        name,
                        age
                    } = person
                    print name; age
                end sub
            `, `
                sub main(person)
                    'extract the important bits
                    name = person.name
                    age = person.age
                    print name; age
                end sub
            `);
        });
    });

    describe('validation', () => {
        function getMainBodyTable(file: BrsFile) {
            const func = file.ast.findChild<any>(x => x.kind === 'FunctionStatement');
            return func.func.body.getSymbolTable();
        }

        it('registers the targets as variables with inferred types', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                sub main()
                    person = { name: "bob", age: 12, address: { city: "nyc" }, tags: ["a", "b"] }
                    { name, age: personAge, address: { city }, missing = 1.5, ...others } = person
                    [firstTag, ...otherTags] = person.tags
                    print name; personAge; city; missing; others; firstTag; otherTags
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
            const table = getMainBodyTable(file);
            const typeOf = (name: string) => table.getSymbolType(name, { flags: SymbolTypeFlag.runtime }).toString();
            expect(typeOf('name')).to.eql('string');
            expect(typeOf('personAge')).to.eql('integer');
            expect(typeOf('city')).to.eql('string');
            expect(typeOf('missing')).to.eql('float');
            expect(typeOf('others')).to.eql('roAssociativeArray');
            expect(typeOf('firstTag')).to.eql('string');
            expect(typeOf('otherTags')).to.eql('Array<string>');
        });

        it('drops invalid from the inferred type when a default is present', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                sub main()
                    [first, second = 3] = [1, 2, invalid]
                    print first; second
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
            const table = getMainBodyTable(file);
            expect(table.getSymbolType('first', { flags: SymbolTypeFlag.runtime }).toString()).to.eql('integer or invalid');
            expect(table.getSymbolType('second', { flags: SymbolTypeFlag.runtime }).toString()).to.eql('integer');
        });

        it('infers dynamic for targets from an unknown source', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                sub main(data)
                    { name } = data
                    [first] = data.items
                    print name; first
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
            const table = getMainBodyTable(file);
            expect(table.getSymbolType('name', { flags: SymbolTypeFlag.runtime }).toString()).to.eql('dynamic');
            expect(table.getSymbolType('first', { flags: SymbolTypeFlag.runtime }).toString()).to.eql('dynamic');
        });

        it('uses the type from an interface when destructuring a typed value', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                interface Person
                    name as string
                    age as integer
                end interface
                sub main(person as Person)
                    { name, age } = person
                    print name; age
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
            const table = getMainBodyTable(file);
            expect(table.getSymbolType('name', { flags: SymbolTypeFlag.runtime }).toString()).to.eql('string');
            expect(table.getSymbolType('age', { flags: SymbolTypeFlag.runtime }).toString()).to.eql('integer');
        });

        it('validates the expressions used as default values and sources', () => {
            program.setFile('source/main.bs', `
                sub main()
                    { name = notDefined } = alsoNotDefined()
                    print name
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.cannotFindName('notDefined').message,
                DiagnosticMessages.cannotFindFunction('alsoNotDefined').message
            ]);
        });

        it('does not flag a spread literal owned by a destructuring assignment', () => {
            program.setFile('source/main.bs', `
                sub main(defaults)
                    { name } = { ...defaults, name: "bob" }
                    print name
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('provides hover for a rest element', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                sub main(person)
                    { name, ...others } = person
                    print name; others
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
            const hover = program.getHover(file.srcPath, util.createPosition(2, 33))[0];
            expect(hover.contents).to.eql(['```brightscript\nothers as roAssociativeArray\n```']);
        });

        it('provides hover for a destructured variable', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                sub main()
                    person = { name: "bob", age: 12 }
                    { name, age: personAge } = person
                    print name; personAge
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
            //hover over `name` in the pattern
            let hover = program.getHover(file.srcPath, util.createPosition(3, 24))[0];
            expect(hover.contents).to.eql(['```brightscript\nname as string\n```']);
            //hover over `personAge` in the pattern
            hover = program.getHover(file.srcPath, util.createPosition(3, 36))[0];
            expect(hover.contents).to.eql(['```brightscript\npersonAge as integer\n```']);
        });

        it('reports the targets as variable declarations in the function scope', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                sub main(person)
                    { name, address: { city } } = person
                    print name; city
                end sub
            `);
            program.validate();
            const scope = file.getFunctionScopeAtPosition(util.createPosition(3, 10));
            expect(scope.variableDeclarations.map(x => x.name)).to.eql(['person', 'name', 'city']);
        });

        it('includes destructured variables in references', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                sub main(person)
                    { name } = person
                    print name
                end sub
            `);
            program.validate();
            const references = program.getReferences(file.srcPath, util.createPosition(3, 27));
            expect(references.map(x => x.range.start.line)).to.eql([2, 3]);
        });
    });
});
