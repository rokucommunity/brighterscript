import { expect } from 'chai';
import { Program } from '../../Program';
import util, { standardizePath as s } from '../../util';
import { createSandbox } from 'sinon';
import { Location } from 'vscode-languageserver';
import { URI } from 'vscode-uri';
let sinon = createSandbox();

let rootDir = s`${process.cwd()}/.tmp/rootDir`;

describe('ReferencesProcessor', () => {
    let program: Program;
    beforeEach(() => {
        program = new Program({ rootDir: rootDir, sourceMap: true });
    });
    afterEach(() => {
        sinon.restore();
        program.dispose();
    });

    it.only('finds local variable references', () => {
        const file = program.addOrReplaceFile('source/main.brs', `
            sub main()
                age = 2
                print age
                age = increment(age)
            end sub
        `);

        expectReferencesEqual(
            program.getReferences(file.pathAbsolute, util.createPosition(3, 24)),
            [file.pathAbsolute, 2, 17, 2, 20],
            [file.pathAbsolute, 3, 22, 3, 25],
            [file.pathAbsolute, 4, 17, 4, 20],
            [file.pathAbsolute, 4, 32, 4, 35]
        );
    });
});

function expectReferencesEqual(actual: Location[], ...expectedShorthand: Array<[string, number, number, number, number]>) {
    const expected = expectedShorthand.map(x => Location.create(
        URI.file(x[0]).toString(),
        util.createRange(x[1], x[2], x[3], x[4])
    ));

    expect(
        actual.sort((a, b) => locationKey(a).localeCompare(locationKey(b)))
    ).to.eql(
        expected.sort((a, b) => locationKey(a).localeCompare(locationKey(b)))
    );
}

function locationKey(location: Location) {
    return [
        location.uri.toString(),
        location.range.start.line,
        location.range.start.character,
        location.range.end.line,
        location.range.end.character
    ].join('-');
}
