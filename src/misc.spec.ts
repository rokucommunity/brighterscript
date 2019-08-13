import * as fs from 'fs';
describe('miscellaneous tests', () => {
    //while targeting brs nightlies, we need to make sure we target an exact version number
    it('exact brs version is targed', () => {
        let packageJson = fs.readFileSync('./package.json').toString();
        let pkg = JSON.parse(packageJson);
        let unacceptableChars = ['>', '<', '=', '~', '^'];
        let brsVersion = pkg.dependencies.brs as string;
        if (brsVersion.indexOf('nightly') > -1) {
            for (let char of unacceptableChars) {
                if (brsVersion.indexOf(char) > -1) {
                    throw new Error(`When targing a nightly build of brs, an exact version must be specified. However, the version number contained "${char}"`);
                }
            }
        }
    });
});
