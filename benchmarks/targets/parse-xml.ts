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
        logLevel: 'error',
        ...options.additionalConfig
    });
    //collect all the XML file contents
    const xmlFiles = Object.values(builder.program.files).filter(x => (x as any)?.extension === '.xml').map(x => ({
        srcPath: x.srcPath ?? (x as any).pathAbsolute,
        pkgPath: x.pkgPath,
        fileContents: (x as any).fileContents
    }));
    if (xmlFiles.length === 0) {
        console.log('[xml-parser] No XML files found in program');
        return;
    }
    suite.add(fullName, (deferred) => {
        const wait: Promise<any>[] = [];
        for (const x of xmlFiles) {
            let xmlFile = new XmlFile({ srcPath: x.srcPath, destPath: (x as any)?.destPath ?? x.pkgPath, program: builder.program });
            if (typeof xmlFile.srcPath !== 'string') {
                //fallback to legacy constructor signature
                xmlFile = (XmlFile as any)(x.srcPath, x.pkgPath, builder.program);
            }
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
