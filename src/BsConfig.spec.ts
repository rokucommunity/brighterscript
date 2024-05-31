import Ajv from 'ajv';
import * as fsExtra from 'fs-extra';

describe('bsconfig', () => {
    it('is valid json schema', () => {
        const schema = fsExtra.readJsonSync(`${__dirname}/../bsconfig.schema.json`);
        const ajv = new Ajv({
            strict: true
        });
        //register `deprecationMessage` as a supported keyword
        ajv.addKeyword('deprecationMessage');

        try {
            ajv.compile(schema, true);
        } catch (e) {
            (e as Error).message = 'bsconfig.schema.json has schema errors: ' + (e as Error).message;
            throw e;
        }
    });
});
