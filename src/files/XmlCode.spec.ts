import { expect } from '../chai-config.spec';
import { Program } from '../Program';
import { rootDir, trim } from '../testHelpers.spec';
import type { XmlFile } from './XmlFile';
import type { BrsFile } from './BrsFile';
import { isBrsCode, isXmlCode } from '../astUtils/reflection';

describe('XmlCode', () => {
    let program: Program;

    beforeEach(() => {
        program = new Program({ rootDir: rootDir });
    });

    afterEach(() => {
        program.dispose();
    });

    it('belongs to the file it lives in', () => {
        const file = program.setFile<XmlFile>('components/Widget.xml', trim`
            <?xml version="1.0" encoding="utf-8" ?>
            <component name="Widget" extends="Group">
            </component>
        `);
        expect(file.code).to.exist;
        expect(file.code.document).to.equal(file);
        expect(file.code.srcPath).to.equal(file.srcPath);
        expect(file.code.destPath).to.equal(file.destPath);
    });

    it('holds the parsed component for its file', () => {
        const file = program.setFile<XmlFile>('components/Widget.xml', trim`
            <?xml version="1.0" encoding="utf-8" ?>
            <component name="Widget" extends="Group">
                <script type="text/brightscript" uri="Widget.brs" />
            </component>
        `);
        expect(file.code.componentName.text).to.equal('Widget');
        expect(file.code.parentComponentName.text).to.equal('Group');
        expect(file.code.scriptTagImports.map(x => x.text)).to.eql(['Widget.brs']);
        expect(file.ast).to.equal(file.code.ast);
        expect(file.componentName).to.equal(file.code.componentName);
    });

    it('updates its required symbols when its file is re-parsed', () => {
        const file = program.setFile<XmlFile>('components/Widget.xml', trim`
            <?xml version="1.0" encoding="utf-8" ?>
            <component name="Widget" extends="Group">
                <interface>
                    <function name="first" />
                </interface>
            </component>
        `);
        expect(file.code.requiredSymbols.map(x => x.name)).to.eql(['first']);
        file.parse(trim`
            <?xml version="1.0" encoding="utf-8" ?>
            <component name="Widget" extends="Group">
                <interface>
                    <function name="second" />
                </interface>
            </component>
        `);
        expect(file.code.requiredSymbols.map(x => x.name)).to.eql(['second']);
    });

    it('collects comment flags', () => {
        const file = program.setFile<XmlFile>('components/Widget.xml', trim`
            <?xml version="1.0" encoding="utf-8" ?>
            <!-- bs:disable-next-line -->
            <component name="Widget" extends="Group">
            </component>
        `);
        expect(file.code.commentFlags).to.be.lengthOf(1);
        expect(file.commentFlags).to.equal(file.code.commentFlags);
    });

    describe('codes', () => {
        it('lists the code each file provides', () => {
            const brsFile = program.setFile<BrsFile>('source/main.brs', '');
            const xmlFile = program.setFile<XmlFile>('components/Widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                </component>
            `);
            expect(brsFile.codes).to.eql([brsFile.code]);
            expect(xmlFile.codes).to.eql([xmlFile.code]);
        });

        it('can tell the kinds of code apart', () => {
            const brsFile = program.setFile<BrsFile>('source/main.brs', '');
            const xmlFile = program.setFile<XmlFile>('components/Widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                </component>
            `);
            expect(isBrsCode(brsFile.code)).to.be.true;
            expect(isXmlCode(brsFile.code)).to.be.false;
            expect(isXmlCode(xmlFile.code)).to.be.true;
            expect(isBrsCode(xmlFile.code)).to.be.false;
            expect(isBrsCode(undefined)).to.be.false;
        });
    });
});
