import type { TargetOptions } from '../target-runner';

module.exports = async (options: TargetOptions) => {
    const { suite, name, version, fullName, brighterscript, projectPath, suiteOptions } = options;
    const { ProgramBuilder, XmlFile } = brighterscript;

    const builder = new ProgramBuilder();
    //run the first run
    await builder.run({
        cwd: projectPath,
        createPackage: false,
        copyToStaging: false,
        //disable diagnostic reporting (they still get collected)
        diagnosticFilters: ['**/*'],
        logLevel: 'error'
    });
    //collect all the XML file contents
    const xmlFiles = Object.values(builder.program.files).filter(x => x.extension === '.xml').map(x => ({
        srcPath: x.srcPath ?? x.pathAbsolute,
        pkgPath: x.pkgPath,
        fileContents: x.fileContents
    }));
    if (xmlFiles.length === 0) {
        console.log('[xml-parser] No XML files found in program');
        return;
    }
    suite.add(fullName, (deferred) => {
        const wait: Promise<any>[] = [];
        for (const x of xmlFiles) {
            const xmlFile = new XmlFile(x.srcPath, x.pkgPath, builder.program);
            //handle async and sync parsing
            const prom = xmlFile.parse(x.fileContents);
            if (prom as any) {
                wait.push(prom as any);
            }
        }
        if (wait.length > 0) {
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            Promise.all(wait).then(() => deferred.resolve());
        } else {
            deferred.resolve();
        }
    }, {
        ...suiteOptions,
        'defer': true
    });
};
