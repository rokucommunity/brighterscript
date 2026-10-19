import { expect } from '../chai-config.spec';
import { Program } from '../Program';
import { rootDir } from '../testHelpers.spec';
import type { BrsFile } from './BrsFile';
import { ParseMode } from '../parser/Parser';
import { util } from '../util';
import { SymbolTypeFlag } from '../SymbolTypeFlag';

describe('BrsCode', () => {
    let program: Program;

    beforeEach(() => {
        program = new Program({ rootDir: rootDir });
    });

    afterEach(() => {
        program.dispose();
    });

    it('belongs to the file it lives in', () => {
        const file = program.setFile<BrsFile>('source/main.brs', `
            sub main()
            end sub
        `);
        expect(file.code).to.exist;
        expect(file.code.document).to.equal(file);
        expect(file.code.srcPath).to.equal(file.srcPath);
        expect(file.code.destPath).to.equal(file.destPath);
        expect(file.code.pkgPath).to.equal(file.pkgPath);
    });

    it('holds the parsed code for its file', () => {
        const file = program.setFile<BrsFile>('source/main.brs', `
            sub main()
            end sub
        `);
        expect(file.code.ast.statements).to.be.lengthOf(1);
        expect(file.code.ast).to.equal(file.code.ast);
        expect(file.code.parser).to.equal(file.code.parser);
        expect(file.code.callables.map(x => x.name)).to.eql(['main']);
        expect(file.code.callables).to.equal(file.code.callables);
    });

    it('uses brighterscript mode for .bs files', () => {
        const brsFile = program.setFile<BrsFile>('source/main.brs', '');
        const bsFile = program.setFile<BrsFile>('source/lib.bs', '');
        expect(brsFile.code.parseMode).to.equal(ParseMode.BrightScript);
        expect(bsFile.code.parseMode).to.equal(ParseMode.BrighterScript);
    });

    it('re-parses when its file is re-parsed', () => {
        const file = program.setFile<BrsFile>('source/main.brs', `
            sub main()
            end sub
        `);
        const code = file.code;
        file.parse(`
            sub a()
            end sub
            sub b()
            end sub
        `);
        expect(file.code).to.equal(code);
        expect(code.callables.map(x => x.name)).to.eql(['a', 'b']);
    });

    describe('getText', () => {
        it('returns all of the code, or the text in a range', () => {
            const file = program.setFile<BrsFile>('source/main.brs', `sub main()\n    print "hello"\nend sub`);
            expect(file.code.getText()).to.equal(`sub main()\n    print "hello"\nend sub`);
            expect(file.code.getText(util.createRange(1, 4, 1, 9))).to.equal('print');
        });

        it('reads ranges in document coordinates for code that starts partway into its document', () => {
            const file = program.setFile<BrsFile>('source/main.brs', '');
            //as if this code sat right after `<![CDATA[` at line 3, character 40 of an xml file
            file.code.parse(`sub main()\n    print "hello"\nend sub`, { startLine: 3, startCharacter: 40 });

            const subToken = file.code.parser.tokens[0];
            expect(subToken.location.range).to.eql(util.createRange(3, 40, 3, 43));
            expect(file.code.getText(subToken.location.range)).to.equal('sub');
            expect(file.code.getText(util.createRange(4, 4, 4, 9))).to.equal('print');
            expect(file.code.getText(util.createRange(3, 44, 4, 9))).to.equal('main()\n    print');
        });
    });

    it('is keyed by its file\'s pkgPath unless given its own key', () => {
        const file = program.setFile<BrsFile>('source/lib.bs', '');
        expect(file.code.key).to.equal(file.pkgPath);
        file.code.key = 'components/Widget.xml#script-1';
        expect(file.code.key).to.equal('components/Widget.xml#script-1');
    });

    it('stores its symbol info under its key', () => {
        const file = program.setFile<BrsFile>('source/main.brs', `sub main()\nend sub`);
        program.validate();
        expect(program.getCodeSymbolInfo(file.code).provides.symbolMap.get(SymbolTypeFlag.runtime).has('main')).to.be.true;
        //the deprecated file-based lookup finds the same info
        expect(program.getFileSymbolInfo(file)).to.equal(program.getCodeSymbolInfo(file.code));
    });

    it('knows where it starts in its document', () => {
        const file = program.setFile<BrsFile>('source/main.brs', `sub main()\nend sub`);
        expect(file.code.startPosition).to.eql(util.createPosition(0, 0));
        file.code.parse(`sub main()\nend sub`, { startLine: 3, startCharacter: 40 });
        expect(file.code.startPosition).to.eql(util.createPosition(3, 40));
    });

    it('parses on demand when its file has a typedef', () => {
        program.setFile('source/main.d.bs', `
            sub main()
            end sub
        `);
        const file = program.setFile<BrsFile>('source/main.brs', `
            sub main()
            end sub
        `);
        //the parse was skipped because the typedef describes this file
        expect(file.code['_parser']).not.to.exist;

        //asking the code for its parser forces the parse
        expect(file.code.parser.ast.statements).to.be.lengthOf(1);
        //the typedef link is restored afterwards
        expect(file.hasTypedef).to.be.true;
    });
});
