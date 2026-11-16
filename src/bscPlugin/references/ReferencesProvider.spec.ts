import { expect } from '../../chai-config.spec';
import { Program } from '../../Program';
import { standardizePath as s, util } from '../../util';
let rootDir = s`${process.cwd()}/rootDir`;
import { createSandbox } from 'sinon';
import { ReferencesProvider } from './ReferencesProvider';
import type { Location } from 'vscode-languageserver-protocol';
import { URI } from 'vscode-uri';
const sinon = createSandbox();

describe('ReferencesProvider', () => {
    let program: Program;
    beforeEach(() => {
        program = new Program({
            rootDir: rootDir
        });
        sinon.restore();
    });

    afterEach(() => {
        program.dispose();
        sinon.restore();
    });

    it('handles unknown file type', () => {
        const result = new ReferencesProvider({
            program: program,
            file: undefined,
            position: util.createPosition(1, 2),
            references: []
        }).process();
        expect(result).to.eql([]);
    });

    it('finds references for variables in same function', () => {
        const file = program.setFile('source/main.brs', `
            sub main()
                name = "John"
                print name
                name = name + " Doe"
            end sub
        `);
        expect(
            util.sortByRange(
                program.getReferences('source/main.brs', util.createPosition(3, 25))
            ).map(locationToString)
        ).to.eql([
            s`${file.srcPath}:2:16-2:20`,
            s`${file.srcPath}:3:22-3:26`,
            s`${file.srcPath}:4:16-4:20`,
            s`${file.srcPath}:4:23-4:27`
        ]);
    });

    it('returns empty results when the file does not exist', () => {
        //master returned null here; v1's `getReferences` is typed `Location[]` and always returns
        //an array, so plugins still get their provideReferences events for an unknown file
        expect(
            program.getReferences('source/not-there.brs', util.createPosition(1, 1))
        ).to.eql([]);
    });

    it('returns empty results when there is no token at the given position', () => {
        program.setFile('source/main.brs', `
            sub main()
                name = "John"
            end sub
        `);
        //the cursor is way past the end of the line, so there's no token there
        expect(
            program.getReferences('source/main.brs', util.createPosition(2, 500))
        ).to.eql([]);
    });

    it('finds references across multiple files in the same scope', () => {
        const mainFile = program.setFile('source/main.brs', `
            sub main()
                alpha = 1
                print alpha
            end sub
        `);
        const utilFile = program.setFile('source/util.brs', `
            sub helper()
                alpha = 2
                print alpha
            end sub
        `);
        program.validate();
        expect(
            util.sortByRange(
                program.getReferences('source/main.brs', util.createPosition(2, 17))
            ).map(locationToString).sort()
        ).to.eql([
            s`${mainFile.srcPath}:2:16-2:21`,
            s`${mainFile.srcPath}:3:22-3:27`,
            s`${utilFile.srcPath}:2:16-2:21`,
            s`${utilFile.srcPath}:3:22-3:27`
        ].sort());
    });

    it('does not return duplicates when the file is included in multiple scopes', () => {
        const file = program.setFile('source/lib.brs', `
            sub sharedFunc()
                thing = 1
                print thing
            end sub
        `);
        //include the same file in two separate component scopes, plus the source scope
        program.setFile('components/A.xml', `
            <component name="A" extends="Group">
                <script uri="pkg:/source/lib.brs" />
            </component>
        `);
        program.setFile('components/B.xml', `
            <component name="B" extends="Group">
                <script uri="pkg:/source/lib.brs" />
            </component>
        `);
        program.validate();
        expect(
            util.sortByRange(
                program.getReferences('source/lib.brs', util.createPosition(2, 17))
            ).map(locationToString)
        ).to.eql([
            s`${file.srcPath}:2:16-2:21`,
            s`${file.srcPath}:3:22-3:27`
        ]);
    });

    it('finds references from files that are unique to each scope', () => {
        //this file lives in both component scopes, and is where the request is triggered
        const commonFile = program.setFile('source/common.brs', `
            sub common()
                alpha = 0
            end sub
        `);
        //this file is only present in the A scope
        const onlyAFile = program.setFile('components/onlyA.brs', `
            sub onlyA()
                print alpha
            end sub
        `);
        //this file is only present in the B scope
        const onlyBFile = program.setFile('components/onlyB.brs', `
            sub onlyB()
                print alpha
            end sub
        `);
        program.setFile('components/A.xml', `
            <component name="A" extends="Group">
                <script uri="pkg:/source/common.brs" />
                <script uri="pkg:/components/onlyA.brs" />
            </component>
        `);
        program.setFile('components/B.xml', `
            <component name="B" extends="Group">
                <script uri="pkg:/source/common.brs" />
                <script uri="pkg:/components/onlyB.brs" />
            </component>
        `);
        program.validate();
        //every scope-specific reference must be included exactly once. Deduplicating the
        //cross-scope file walk must not discard references only reachable through one scope
        expect(
            util.sortByRange(
                program.getReferences('source/common.brs', util.createPosition(2, 17))
            ).map(locationToString).sort()
        ).to.eql([
            s`${commonFile.srcPath}:2:16-2:21`,
            s`${onlyAFile.srcPath}:2:22-2:27`,
            s`${onlyBFile.srcPath}:2:22-2:27`
        ].sort());
    });

    it('matches references case insensitively', () => {
        const file = program.setFile('source/main.brs', `
            sub main()
                Name = "John"
                print NAME
                print name
            end sub
        `);
        expect(
            util.sortByRange(
                program.getReferences('source/main.brs', util.createPosition(2, 17))
            ).map(locationToString)
        ).to.eql([
            s`${file.srcPath}:2:16-2:20`,
            s`${file.srcPath}:3:22-3:26`,
            s`${file.srcPath}:4:22-4:26`
        ]);
    });

    it('finds references to a function parameter', () => {
        const file = program.setFile('source/main.brs', `
            sub main(greeting as string)
                print greeting
                greeting = "hi"
            end sub
        `);
        expect(
            util.sortByRange(
                program.getReferences('source/main.brs', util.createPosition(2, 24))
            ).map(locationToString)
        ).to.eql([
            s`${file.srcPath}:2:22-2:30`,
            s`${file.srcPath}:3:16-3:24`
        ]);
    });

    it('emits the before/provide/after plugin events in order', () => {
        program.setFile('source/main.brs', `
            sub main()
                name = "John"
                print name
            end sub
        `);
        const events: string[] = [];
        program.plugins.add({
            name: 'test-plugin',
            beforeProvideReferences: () => {
                events.push('before');
            },
            provideReferences: () => {
                events.push('provide');
            },
            afterProvideReferences: () => {
                events.push('after');
            }
        });
        program.getReferences('source/main.brs', util.createPosition(3, 25));
        expect(events).to.eql(['before', 'provide', 'after']);
    });

    it('allows a plugin to contribute additional references', () => {
        const file = program.setFile('source/main.brs', `
            sub main()
                name = "John"
            end sub
        `);
        program.plugins.add({
            name: 'test-plugin',
            provideReferences: (event) => {
                event.references.push(
                    util.createLocationFromRange(util.pathToUri(file.srcPath), util.createRange(9, 9, 9, 14))
                );
            }
        });
        expect(
            util.sortByRange(
                program.getReferences('source/main.brs', util.createPosition(2, 17))
            ).map(locationToString)
        ).to.eql([
            s`${file.srcPath}:2:16-2:20`,
            s`${file.srcPath}:9:9-9:14`
        ]);
    });

    it('allows a plugin to sanitize references in afterProvideReferences', () => {
        program.setFile('source/main.brs', `
            sub main()
                name = "John"
                print name
            end sub
        `);
        program.plugins.add({
            name: 'test-plugin',
            afterProvideReferences: (event) => {
                //drop everything
                event.references.splice(0, event.references.length);
            }
        });
        expect(
            program.getReferences('source/main.brs', util.createPosition(3, 25))
        ).to.eql([]);
    });

    it('returns empty results for an xml file', () => {
        program.setFile('components/A.xml', `
            <component name="A" extends="Group">
            </component>
        `);
        expect(
            program.getReferences('components/A.xml', util.createPosition(1, 30))
        ).to.eql([]);
    });

    describe('location boundaries', () => {
        //NOTE: these tests intentionally only use public `Program` APIs (Position in, Location out) so they
        //can be run against any implementation of token/node locations. All expected values are hand-counted.

        /**
         * Join lines with the given line ending. No trailing newline is added
         */
        function lines(eol: string, ...items: string[]) {
            return items.join(eol);
        }

        /**
         * Get the references at the position, sorted by uri, then by position
         */
        function referencesAt(srcPath: string, line: number, character: number) {
            return program.getReferences(srcPath, util.createPosition(line, character)).sort((a, b) => {
                if (a.uri !== b.uri) {
                    return a.uri < b.uri ? -1 : 1;
                }
                return (a.range.start.line - b.range.start.line) || (a.range.start.character - b.range.start.character);
            });
        }

        function loc(srcPath: string, startLine: number, startCharacter: number, endLine: number, endCharacter: number) {
            return {
                uri: util.pathToUri(srcPath),
                range: util.createRange(startLine, startCharacter, endLine, endCharacter)
            };
        }

        it('finds the identifier at its first character, middle, and immediately after its last character', () => {
            const file = program.setFile('source/main.brs', lines('\n',
                'sub main()',
                '    alpha = 1',
                '    print alpha',
                '    alpha = alpha + 1',
                'end sub'
            ));
            program.validate();
            const expected = [
                loc(file.srcPath, 1, 4, 1, 9),
                loc(file.srcPath, 2, 10, 2, 15),
                loc(file.srcPath, 3, 4, 3, 9),
                loc(file.srcPath, 3, 12, 3, 17)
            ];
            //print |alpha
            expect(referencesAt(file.srcPath, 2, 10)).to.eql(expected);
            //print al|pha
            expect(referencesAt(file.srcPath, 2, 12)).to.eql(expected);
            //print alpha|  (the end of a range is inclusive)
            expect(referencesAt(file.srcPath, 2, 15)).to.eql(expected);
            //alpha| = 1
            expect(referencesAt(file.srcPath, 1, 9)).to.eql(expected);

            //print| alpha  (immediately after `print`, so we search for `print` instead)
            expect(referencesAt(file.srcPath, 2, 9)).to.eql([]);
        });

        it('finds identifiers at column 0 of a line and at the end of a line', () => {
            const file = program.setFile('source/main.brs', lines('\n',
                'sub main()',
                'beta = 1',
                'print beta',
                'end sub'
            ));
            program.validate();
            const expected = [
                loc(file.srcPath, 1, 0, 1, 4),
                loc(file.srcPath, 2, 6, 2, 10)
            ];
            //|beta = 1
            expect(referencesAt(file.srcPath, 1, 0)).to.eql(expected);
            //print beta|
            expect(referencesAt(file.srcPath, 2, 10)).to.eql(expected);
        });

        it('handles CRLF line endings and returns the uri of each file for cross-file references', () => {
            const mainFile = program.setFile('source/main.brs', lines('\r\n',
                'sub main()',
                '    gamma = 1',
                '    print gamma',
                'gamma = 2',
                'end sub'
            ));
            const otherFile = program.setFile('source/other.brs', lines('\r\n',
                'sub other()',
                '    print gamma',
                'end sub'
            ));
            program.validate();
            const expected = [
                loc(mainFile.srcPath, 1, 4, 1, 9),
                loc(mainFile.srcPath, 2, 10, 2, 15),
                loc(mainFile.srcPath, 3, 0, 3, 5),
                loc(otherFile.srcPath, 1, 10, 1, 15)
            ];
            //column 0 after a `\r\n`
            expect(referencesAt(mainFile.srcPath, 3, 0)).to.eql(expected);
            //end of the line, right before the `\r\n`
            expect(referencesAt(mainFile.srcPath, 2, 15)).to.eql(expected);
            //from the other file
            expect(referencesAt(otherFile.srcPath, 1, 12)).to.eql(expected);
        });

        it('uses utf-16 code units for characters after a surrogate pair emoji on the same line', () => {
            const file = program.setFile('source/main.brs', lines('\n',
                'sub main()',
                '    name = "😀"',
                '    print "😀😀" + name',
                '    x = "😀": name = name + "😀"',
                'end sub'
            ));
            program.validate();
            //each emoji is 2 utf-16 code units
            const expected = [
                loc(file.srcPath, 1, 4, 1, 8),
                loc(file.srcPath, 2, 19, 2, 23),
                loc(file.srcPath, 3, 14, 3, 18),
                loc(file.srcPath, 3, 21, 3, 25)
            ];
            expect(referencesAt(file.srcPath, 2, 19)).to.eql(expected);
            expect(referencesAt(file.srcPath, 2, 21)).to.eql(expected);
            expect(referencesAt(file.srcPath, 2, 23)).to.eql(expected);
            expect(referencesAt(file.srcPath, 3, 25)).to.eql(expected);
        });

        it('counts lines through multi-line template strings', () => {
            const file = program.setFile('source/main.bs', lines('\n',
                'sub main()',
                '    name = "bob"',
                /* eslint-disable no-template-curly-in-string */
                '    msg = `hello ${name}',
                'line two ${name}',
                'and ${name} three`',
                /* eslint-enable no-template-curly-in-string */
                '    print msg + name',
                'end sub'
            ));
            program.validate();
            const expected = [
                loc(file.srcPath, 1, 4, 1, 8),
                loc(file.srcPath, 2, 19, 2, 23),
                loc(file.srcPath, 3, 11, 3, 15),
                loc(file.srcPath, 4, 6, 4, 10),
                loc(file.srcPath, 5, 16, 5, 20)
            ];
            //inside `${}` on later lines of the template string
            expect(referencesAt(file.srcPath, 3, 13)).to.eql(expected);
            expect(referencesAt(file.srcPath, 4, 10)).to.eql(expected);
            //after the template string
            expect(referencesAt(file.srcPath, 5, 20)).to.eql(expected);

            //print msg|
            expect(referencesAt(file.srcPath, 5, 13)).to.eql([
                loc(file.srcPath, 2, 4, 2, 7),
                loc(file.srcPath, 5, 10, 5, 13)
            ]);
        });

        it('finds items on the last line of a file with no trailing newline', () => {
            const file = program.setFile('source/main.brs', lines('\n',
                'sub main()',
                'end sub',
                'sub last(): value = 1: print value: end sub'
            ));
            program.validate();
            const expected = [
                loc(file.srcPath, 2, 12, 2, 17),
                loc(file.srcPath, 2, 29, 2, 34)
            ];
            //print value|:
            expect(referencesAt(file.srcPath, 2, 34)).to.eql(expected);
            //|value = 1
            expect(referencesAt(file.srcPath, 2, 12)).to.eql(expected);
        });

        it('finds symbols in namespaces, classes, and empty function bodies', () => {
            const file = program.setFile('source/main.bs', lines('\n',
                'namespace alpha.beta',
                '    function noop()',
                '    end function',
                '    class Widget',
                '        sub render()',
                '            count = 1',
                '            print count',
                '        end sub',
                '    end class',
                '    sub caller()',
                '        noop()',
                '    end sub',
                'end namespace'
            ));
            program.validate();
            //variables in a class method inside a namespace
            const expected = [
                loc(file.srcPath, 5, 12, 5, 17),
                loc(file.srcPath, 6, 18, 6, 23)
            ];
            expect(referencesAt(file.srcPath, 6, 23)).to.eql(expected);
            expect(referencesAt(file.srcPath, 5, 12)).to.eql(expected);

            //call to an empty function from inside a namespace
            expect(referencesAt(file.srcPath, 10, 12)).to.eql([
                loc(file.srcPath, 10, 8, 10, 12)
            ]);
        });
    });

    function locationToString(loc: Location) {
        return `${URI.parse(loc.uri).fsPath}:${loc.range.start.line}:${loc.range.start.character}-${loc.range.end.line}:${loc.range.end.character}`;
    }
});
