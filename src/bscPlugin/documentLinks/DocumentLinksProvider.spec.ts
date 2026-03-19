import { expect } from '../../chai-config.spec';
import { Program } from '../../Program';
import { standardizePath as s } from '../../util';
import { URI } from 'vscode-uri';
let rootDir = s`${process.cwd()}/rootDir`;
import { createSandbox } from 'sinon';
const sinon = createSandbox();

describe('DocumentLinksProvider', () => {
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

    it('returns document links for pkg:/ script tag uris', () => {
        const brsFile = program.setFile('components/MainScene.brs', `
            sub main()
            end sub
        `);
        const xmlFile = program.setFile('components/MainScene.xml', `
            <component name="MainScene" extends="Scene">
                <script type="text/brightscript" uri="pkg:/components/MainScene.brs" />
            </component>
        `);
        const links = program.getDocumentLinks(xmlFile.srcPath);
        expect(links).to.be.lengthOf(1);
        expect(links[0].target).to.equal(URI.file(brsFile.srcPath).toString());
        expect(links[0].range).to.exist;
    });

    it('returns document links for relative script tag uris', () => {
        const brsFile1 = program.setFile('components/MainScene.brs', ``);
        const brsFile2 = program.setFile('components/Helpers.brs', ``);
        const xmlFile = program.setFile('components/MainScene.xml', `
            <component name="MainScene" extends="Scene">
                <script type="text/brightscript" uri="MainScene.brs" />
                <script type="text/brightscript" uri="Helpers.brs" />
            </component>
        `);
        const links = program.getDocumentLinks(xmlFile.srcPath);
        expect(links).to.be.lengthOf(2);
        expect(links[0].target).to.equal(URI.file(brsFile1.srcPath).toString());
        expect(links[1].target).to.equal(URI.file(brsFile2.srcPath).toString());
    });

    it('returns document link with undefined target when script file is not found', () => {
        const xmlFile = program.setFile('components/MainScene.xml', `
            <component name="MainScene" extends="Scene">
                <script type="text/brightscript" uri="pkg:/components/NotFound.brs" />
            </component>
        `);
        const links = program.getDocumentLinks(xmlFile.srcPath);
        expect(links).to.be.lengthOf(1);
        expect(links[0].target).to.be.undefined;
    });

    it('returns empty array for non-xml files', () => {
        const brsFile = program.setFile('source/main.brs', `
            sub main()
            end sub
        `);
        const links = program.getDocumentLinks(brsFile.srcPath);
        expect(links).to.eql([]);
    });

    it('returns empty array for unknown file', () => {
        const links = program.getDocumentLinks(`${rootDir}/does-not-exist.xml`);
        expect(links).to.eql([]);
    });

    it('allows plugins to contribute additional document links', () => {
        const xmlFile = program.setFile('components/MainScene.xml', `
            <component name="MainScene" extends="Scene">
            </component>
        `);
        const plugin = {
            name: 'test-plugin',
            provideDocumentLinks: (event: any) => {
                event.documentLinks.push({
                    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
                    target: 'file:///some/file.brs'
                });
            }
        };
        program.plugins.add(plugin as any);
        const links = program.getDocumentLinks(xmlFile.srcPath);
        expect(links.some(l => l.target === 'file:///some/file.brs')).to.be.true;
    });
});
