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

    function locationToString(loc: Location) {
        return `${URI.parse(loc.uri).fsPath}:${loc.range.start.line}:${loc.range.start.character}-${loc.range.end.line}:${loc.range.end.character}`;
    }
});
