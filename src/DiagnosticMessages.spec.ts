import { expect } from './chai-config.spec';

import { DiagnosticMessages } from './DiagnosticMessages';

describe('DiagnosticMessages', () => {
    it('has unique code for each message', () => {
        let codes = {};
        for (let key in DiagnosticMessages) {
            let func = DiagnosticMessages[key];
            let obj = func('', '', '', '', '', '', '', '', '');
            //if another message already has this code
            if (!codes[obj.code]) {
                codes[obj.code] = key;
            } else {
                expect(codes[obj.code]).to.equal(key, 'Two diagnostic messages share the same error code');
            }
        }
    });
    it('has unique name for each message', () => {
        let names = {};
        for (let key in DiagnosticMessages) {
            if (key.startsWith('__unused')) {
                // ignore unused diagnostics
                continue;
            }
            let func = DiagnosticMessages[key];
            let obj = func('', '', '', '', '', '', '', '', '');
            const diagName: string = obj.name ?? '';
            expect(diagName).to.not.equal('', `Diagnostic name is empty - ${key}`);
            expect(diagName.toLowerCase()).to.equal(obj.name, `Diagnostic name has capitals - ${key}`);
            expect(diagName.indexOf(' ')).to.equal(-1, `Diagnostic name has space - ${key}`);
            //if another message already has this name
            if (!names[obj.name]) {
                names[obj.name] = key;
            } else {
                expect(names[obj.name]).to.equal(key, 'Two diagnostic messages share the same error names');
            }
        }
    });
});
