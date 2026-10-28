import { expect } from '../chai-config.spec';
import { Program } from '../Program';
import { rootDir, getBrsCode } from '../testHelpers.spec';
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
        expect(getBrsCode(file)).to.exist;
        expect(getBrsCode(file).document).to.equal(file);
        expect(getBrsCode(file).srcPath).to.equal(file.srcPath);
        expect(getBrsCode(file).destPath).to.equal(file.destPath);
        expect(getBrsCode(file).pkgPath).to.equal(file.pkgPath);
    });

    it('holds the parsed code for its file', () => {
        const file = program.setFile<BrsFile>('source/main.brs', `
            sub main()
            end sub
        `);
        expect(getBrsCode(file).ast.statements).to.be.lengthOf(1);
        expect(getBrsCode(file).ast).to.equal(getBrsCode(file).ast);
        expect(getBrsCode(file).parser).to.equal(getBrsCode(file).parser);
        expect(getBrsCode(file).callables.map(x => x.name)).to.eql(['main']);
        expect(getBrsCode(file).callables).to.equal(getBrsCode(file).callables);
    });

    it('uses brighterscript mode for .bs files', () => {
        const brsFile = program.setFile<BrsFile>('source/main.brs', '');
        const bsFile = program.setFile<BrsFile>('source/lib.bs', '');
        expect(getBrsCode(brsFile).parseMode).to.equal(ParseMode.BrightScript);
        expect(getBrsCode(bsFile).parseMode).to.equal(ParseMode.BrighterScript);
    });

    it('re-parses when its file is re-parsed', () => {
        const file = program.setFile<BrsFile>('source/main.brs', `
            sub main()
            end sub
        `);
        const code = getBrsCode(file);
        file.parse(`
            sub a()
            end sub
            sub b()
            end sub
        `);
        expect(getBrsCode(file)).to.equal(code);
        expect(code.callables.map(x => x.name)).to.eql(['a', 'b']);
    });

    describe('getText', () => {
        it('returns all of the code, or the text in a range', () => {
            const file = program.setFile<BrsFile>('source/main.brs', `sub main()\n    print "hello"\nend sub`);
            expect(getBrsCode(file).getText()).to.equal(`sub main()\n    print "hello"\nend sub`);
            expect(getBrsCode(file).getText(util.createRange(1, 4, 1, 9))).to.equal('print');
        });

        it('reads ranges in document coordinates for code that starts partway into its document', () => {
            const file = program.setFile<BrsFile>('source/main.brs', '');
            //as if this code sat right after `<![CDATA[` at line 3, character 40 of an xml file
            getBrsCode(file).parse(`sub main()\n    print "hello"\nend sub`, { startLine: 3, startCharacter: 40 });

            const subToken = getBrsCode(file).parser.tokens[0];
            expect(subToken.location.range).to.eql(util.createRange(3, 40, 3, 43));
            expect(getBrsCode(file).getText(subToken.location.range)).to.equal('sub');
            expect(getBrsCode(file).getText(util.createRange(4, 4, 4, 9))).to.equal('print');
            expect(getBrsCode(file).getText(util.createRange(3, 44, 4, 9))).to.equal('main()\n    print');
        });
    });

    it('is keyed by its file\'s pkgPath unless given its own key', () => {
        const file = program.setFile<BrsFile>('source/lib.bs', '');
        expect(getBrsCode(file).key).to.equal(file.pkgPath);
        getBrsCode(file).key = 'components/Widget.xml#script-1';
        expect(getBrsCode(file).key).to.equal('components/Widget.xml#script-1');
    });

    it('stores its symbol info under its key', () => {
        const file = program.setFile<BrsFile>('source/main.brs', `sub main()\nend sub`);
        program.validate();
        expect(program.getCodeSymbolInfo(getBrsCode(file)).provides.symbolMap.get(SymbolTypeFlag.runtime).has('main')).to.be.true;
    });

    it('knows where it starts in its document', () => {
        const file = program.setFile<BrsFile>('source/main.brs', `sub main()\nend sub`);
        expect(getBrsCode(file).startPosition).to.eql(util.createPosition(0, 0));
        getBrsCode(file).parse(`sub main()\nend sub`, { startLine: 3, startCharacter: 40 });
        expect(getBrsCode(file).startPosition).to.eql(util.createPosition(3, 40));
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
        expect(getBrsCode(file)['_parser']).not.to.exist;

        //asking the code for its parser forces the parse
        expect(getBrsCode(file).parser.ast.statements).to.be.lengthOf(1);
        //the typedef link is untouched by the parse
        expect(file.hasTypedef).to.be.true;
    });

    describe('typedef', () => {
        it('links a .brs file\'s code to the code of its typedef', () => {
            const typedef = program.setFile<BrsFile>('source/main.d.bs', `
                sub main()
                end sub
            `);
            const file = program.setFile<BrsFile>('source/main.brs', `
                sub main()
                end sub
            `);
            expect(getBrsCode(file).typedef).to.equal(getBrsCode(typedef));
            expect(getBrsCode(file).isValidated).to.be.true;
            expect(file.hasTypedef).to.be.true;
            expect(file.typedefFile).to.equal(typedef);
            expect(file.isValidated).to.be.true;
        });

        it('parses normally once its typedef is removed', () => {
            const typedef = program.setFile('source/main.d.bs', `
                sub main()
                end sub
            `);
            const file = program.setFile<BrsFile>('source/main.brs', `
                sub main()
                end sub
            `);
            program.removeFile(typedef.srcPath);
            expect(getBrsCode(file).typedef).not.to.exist;
            expect(file.hasTypedef).to.be.false;

            file.parse(`
                sub main()
                end sub
                sub other()
                end sub
            `);
            expect(getBrsCode(file)['_parser']).to.exist;
            expect(getBrsCode(file).callables.map(x => x.name)).to.eql(['main', 'other']);
        });

        it('is never set for code that has no typedef', () => {
            const bsFile = program.setFile<BrsFile>('source/lib.bs', `
                sub lib()
                end sub
            `);
            const xmlFile = program.setFile('components/Widget.xml', `<?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                    <script type="text/brightscript"><![CDATA[
                        sub init()
                        end sub
                    ]]></script>
                </component>
            `);
            expect(getBrsCode(bsFile).typedef).not.to.exist;
            expect(getBrsCode(xmlFile).typedef).not.to.exist;
            expect(getBrsCode(xmlFile)['_parser']).to.exist;
        });
    });
});
