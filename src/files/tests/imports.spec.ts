import { expect } from 'chai';
import * as sinonImport from 'sinon';
import * as fsExtra from 'fs-extra';
import { DiagnosticMessages } from '../../DiagnosticMessages';
import { Program } from '../../Program';
import { standardizePath as s } from '../../util';
import type { XmlFile } from '../XmlFile';
import { getTestTranspile } from '../BrsFile.spec';

let sinon = sinonImport.createSandbox();
let tmpPath = s`${process.cwd()}/.tmp`;
let rootDir = s`${tmpPath}/rootDir`;
let stagingFolderPath = s`${tmpPath}/staging`;

describe('import statements', () => {
    let program: Program;
    const testTranspile = getTestTranspile(() => [program, rootDir]);

    beforeEach(() => {
        fsExtra.ensureDirSync(tmpPath);
        fsExtra.emptyDirSync(tmpPath);
        program = new Program({
            rootDir: rootDir,
            stagingFolderPath: stagingFolderPath
        });
    });
    afterEach(() => {
        sinon.restore();
        fsExtra.ensureDirSync(tmpPath);
        fsExtra.emptyDirSync(tmpPath);
        program.dispose();
    });

    it('still transpiles import statements if found at bottom of file', async () => {
        await program.addOrReplaceFile('components/ChildScene.xml', `
            <?xml version="1.0" encoding="utf-8" ?>
            <component name="ChildScene" extends="Scene">
                <script type="text/brighterscript" uri="pkg:/source/lib.bs" />
            </component>
        `);

        await program.addOrReplaceFile('source/lib.bs', `
            function toLower(strVal as string)
                return StringToLower(strVal)
            end function
            'this import is purposefully at the bottom just to prove the transpile still works
            import "stringOps.bs"
        `);

        await program.addOrReplaceFile('source/stringOps.bs', `
            function StringToLower(strVal as string)
                return true
            end function
        `);
        let files = Object.keys(program.files).map(x => program.getFileByPathAbsolute(x)).filter(x => !!x).map(x => {
            return {
                src: x.pathAbsolute,
                dest: x.pkgPath
            };
        });
        await program.transpile(files, stagingFolderPath);
        expect(
            fsExtra.readFileSync(`${stagingFolderPath}/components/ChildScene.xml`).toString()
        ).to.equal(`
            <?xml version="1.0" encoding="utf-8" ?>
            <component name="ChildScene" extends="Scene">
                <script type="text/brightscript" uri="pkg:/source/lib.brs" />
                <script type="text/brightscript" uri="pkg:/source/stringOps.brs" />
                <script type="text/brightscript" uri="pkg:/source/bslib.brs" />
            </component>
        `);
    });

    it('finds function loaded in by import multiple levels deep', async () => {
        //create child component
        let component = await program.addOrReplaceFile('components/ChildScene.xml', `
            <?xml version="1.0" encoding="utf-8" ?>
            <component name="ChildScene" extends="ParentScene">
                <script type="text/brighterscript" uri="pkg:/source/lib.bs" />
            </component>
        `);
        await program.addOrReplaceFile('source/lib.bs', `
            import "stringOps.bs"
            function toLower(strVal as string)
                return StringToLower(strVal)
            end function
        `);
        await program.addOrReplaceFile('source/stringOps.bs', `
            import "intOps.bs"
            function StringToLower(strVal as string)
                return isInt(strVal)
            end function
        `);
        await program.addOrReplaceFile('source/intOps.bs', `
            function isInt(strVal as dynamic)
                return true
            end function
        `);
        await program.validate();
        expect(program.getDiagnostics().map(x => x.message)[0]).to.not.exist;
        expect(
            (component as XmlFile).getAvailableScriptImports().sort()
        ).to.eql([
            s`source/intOps.bs`,
            s`source/lib.bs`,
            s`source/stringOps.bs`
        ]);
    });

    it('supports importing brs files', async () => {
        //create child component
        let component = await program.addOrReplaceFile('components/ChildScene.xml', `
            <?xml version="1.0" encoding="utf-8" ?>
            <component name="ChildScene" extends="ParentScene">
                <script type="text/brighterscript" uri="pkg:/source/lib.bs" />
            </component>
        `);
        await program.addOrReplaceFile('source/lib.bs', `
            import "stringOps.brs"
            function toLower(strVal as string)
                return StringToLower(strVal)
            end function
        `);
        await program.addOrReplaceFile('source/stringOps.brs', `
            function StringToLower(strVal as string)
                return lcase(strVal)
            end function
        `);
        await program.validate();
        expect(program.getDiagnostics().map(x => x.message)[0]).to.not.exist;
        expect(
            (component as XmlFile).getAvailableScriptImports()
        ).to.eql([
            s`source/lib.bs`,
            s`source/stringOps.brs`
        ]);
    });

    it('detects when dependency contents have changed', async () => {
        //create child component
        await program.addOrReplaceFile('components/ChildScene.xml', `
            <?xml version="1.0" encoding="utf-8" ?>
            <component name="ChildScene" extends="ParentScene">
                <script type="text/brighterscript" uri="lib.bs" />
            </component>
        `);
        await program.addOrReplaceFile('components/lib.bs', `
            import "animalActions.bs"
            function init1(strVal as string)
                Waddle()
            end function
        `);
        //add the empty dependency
        await program.addOrReplaceFile('components/animalActions.bs', ``);

        //there should be an error because that function doesn't exist
        await program.validate();

        expect(program.getDiagnostics().map(x => x.message)).to.eql([
            DiagnosticMessages.callToUnknownFunction('Waddle', s`components/ChildScene.xml`).message
        ]);

        //change the dependency to now contain the file. the scope should re-validate
        await program.addOrReplaceFile('components/animalActions.bs', `
            sub Waddle()
                print "Waddling"
            end sub
        `);

        //validate again
        await program.validate();

        //the error should be gone
        expect(program.getDiagnostics()).to.be.empty;

    });

    it('adds brs imports to xml file during transpile', async () => {
        //create child component
        let component = await program.addOrReplaceFile({ src: s`${rootDir}/components/ChildScene.xml`, dest: 'components/ChildScene.xml' }, `
            <?xml version="1.0" encoding="utf-8" ?>
            <component name="ChildScene" extends="ParentScene">
                <script type="text/brightscript" uri="pkg:/source/lib.bs" />
            </component>
        `);
        await program.addOrReplaceFile({ src: s`${rootDir}/source/lib.bs`, dest: 'source/lib.bs' }, `
            import "stringOps.brs"
            function toLower(strVal as string)
                return StringToLower(strVal)
            end function
        `);
        await program.addOrReplaceFile({ src: s`${rootDir}/source/stringOps.brs`, dest: 'source/stringOps.brs' }, `
            function StringToLower(strVal as string)
                return isInt(strVal)
            end function
        `);
        await program.validate();
        expect(component.transpile().code).to.equal(`
            <?xml version="1.0" encoding="utf-8" ?>
            <component name="ChildScene" extends="ParentScene">
                <script type="text/brightscript" uri="pkg:/source/lib.brs" />
                <script type="text/brightscript" uri="pkg:/source/stringOps.brs" />
                <script type="text/brightscript" uri="pkg:/source/bslib.brs" />
            </component>
        `);
    });

    it('shows diagnostic for missing file in import', async () => {
        //create child component
        await program.addOrReplaceFile('components/ChildScene.xml', `
            <?xml version="1.0" encoding="utf-8" ?>
            <component name="ChildScene" extends="ParentScene">
                <script type="text/brighterscript" uri="ChildScene.bs" />
            </component>
        `);
        await program.addOrReplaceFile('components/ChildScene.bs', `
            import "stringOps.bs"
            sub init()
            end sub
        `);
        await program.validate();
        expect(program.getDiagnostics().map(x => x.message)[0]).to.eql(DiagnosticMessages.referencedFileDoesNotExist().message);
    });

    it('complicated import graph adds correct script tags', async () => {
        await program.addOrReplaceFile('source/maestro/ioc/IOCMixin.bs', `
            sub DoIocThings()
            end sub
        `);
        await program.addOrReplaceFile('source/BaseClass.bs', `
            import "pkg:/source/maestro/ioc/IOCMixin.bs"
        `);

        await program.addOrReplaceFile('components/AuthManager.bs', `
            import "pkg:/source/BaseClass.bs"
        `);
        await testTranspile(`
            <?xml version="1.0" encoding="utf-8" ?>
            <component name="ChildScene" extends="ParentScene">
                <script type="text/brighterscript" uri="AuthManager.bs" />
            </component>
        `, `
            <?xml version="1.0" encoding="utf-8" ?>
            <component name="ChildScene" extends="ParentScene">
                <script type="text/brightscript" uri="AuthManager.brs" />
                <script type="text/brightscript" uri="pkg:/source/maestro/ioc/IOCMixin.brs" />
                <script type="text/brightscript" uri="pkg:/source/BaseClass.brs" />
                <script type="text/brightscript" uri="pkg:/source/bslib.brs" />
            </component>
        `, null, 'components/AuthenticationService.xml');
    });
});
