import { expect } from '../chai-config.spec';
import { Program } from '../Program';
import { rootDir, trim, getBrsCode } from '../testHelpers.spec';
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
        expect(file.componentCode).to.exist;
        expect(file.componentCode.document).to.equal(file);
        expect(file.componentCode.srcPath).to.equal(file.srcPath);
        expect(file.componentCode.destPath).to.equal(file.destPath);
    });

    it('holds the parsed component for its file', () => {
        const file = program.setFile<XmlFile>('components/Widget.xml', trim`
            <?xml version="1.0" encoding="utf-8" ?>
            <component name="Widget" extends="Group">
                <script type="text/brightscript" uri="Widget.brs" />
            </component>
        `);
        expect(file.componentCode.componentName.text).to.equal('Widget');
        expect(file.componentCode.parentComponentName.text).to.equal('Group');
        expect(file.componentCode.scriptTagImports.map(x => x.text)).to.eql(['Widget.brs']);
        expect(file.componentCode.ast).to.equal(file.componentCode.ast);
        expect(file.componentCode.componentName).to.equal(file.componentCode.componentName);
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
        expect(file.componentCode.requiredSymbols.map(x => x.name)).to.eql(['first']);
        file.parse(trim`
            <?xml version="1.0" encoding="utf-8" ?>
            <component name="Widget" extends="Group">
                <interface>
                    <function name="second" />
                </interface>
            </component>
        `);
        expect(file.componentCode.requiredSymbols.map(x => x.name)).to.eql(['second']);
    });

    it('collects comment flags', () => {
        const file = program.setFile<XmlFile>('components/Widget.xml', trim`
            <?xml version="1.0" encoding="utf-8" ?>
            <!-- bs:disable-next-line -->
            <component name="Widget" extends="Group">
            </component>
        `);
        expect(file.componentCode.commentFlags).to.be.lengthOf(1);
        expect(file.componentCode.commentFlags).to.equal(file.componentCode.commentFlags);
    });

    describe('codes', () => {
        it('lists the code each file provides', () => {
            const brsFile = program.setFile<BrsFile>('source/main.brs', '');
            const xmlFile = program.setFile<XmlFile>('components/Widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                </component>
            `);
            expect(brsFile.codes).to.eql([getBrsCode(brsFile)]);
            expect(xmlFile.codes).to.eql([xmlFile.componentCode]);
        });

        it('can tell the kinds of code apart', () => {
            const brsFile = program.setFile<BrsFile>('source/main.brs', '');
            const xmlFile = program.setFile<XmlFile>('components/Widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                </component>
            `);
            expect(isBrsCode(getBrsCode(brsFile))).to.be.true;
            expect(isXmlCode(getBrsCode(brsFile))).to.be.false;
            expect(isXmlCode(xmlFile.componentCode)).to.be.true;
            expect(isBrsCode(xmlFile.componentCode)).to.be.false;
            expect(isBrsCode(undefined)).to.be.false;
        });
    });
});
