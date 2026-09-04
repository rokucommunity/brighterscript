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

    it('returns null when the file does not exist', () => {
        expect(
            program.getReferences('source/not-there.brs', util.createPosition(1, 1))
        ).to.be.null;
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
                    util.createLocation(util.pathToUri(file.srcPath), util.createRange(9, 9, 9, 14))
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

    function locationToString(loc: Location) {
        return `${URI.parse(loc.uri).fsPath}:${loc.range.start.line}:${loc.range.start.character}-${loc.range.end.line}:${loc.range.end.character}`;
    }
});
