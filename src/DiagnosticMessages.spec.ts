import { expect } from './chai-config.spec';

import { DiagnosticCodeRegex, DiagnosticMessages } from './DiagnosticMessages';

describe('DiagnosticMessages', () => {
    it('has unique legacyCode for each message', () => {
        let codes = {};
        for (let key in DiagnosticMessages) {
            let func = DiagnosticMessages[key];
            let obj = func('', '', '', '', '', '', '', '', '');
            //if another message already has this code
            if (!codes[obj.legacyCode]) {
                codes[obj.legacyCode] = key;
            } else {
                expect(codes[obj.legacyCode]).to.equal(key, 'Two diagnostic messages share the same legacy Code');
            }
        }
    });

    it('has unique code for each message', () => {
        let codes = {};
        for (let key in DiagnosticMessages) {
            if (key.startsWith('__unused')) {
                // ignore unused diagnostics
                continue;
            }
            let func = DiagnosticMessages[key];
            let obj = func('', '', '', '', '', '', '', '', '');
            const diagCode: string = obj.code ?? '';
            expect(diagCode).to.not.equal('', `Diagnostic name is empty - ${key}`);
            expect(diagCode.toLowerCase()).to.equal(obj.code, `Diagnostic name has capitals - ${key}`);
            expect(diagCode.indexOf(' ')).to.equal(-1, `Diagnostic name has space - ${key}`);
            expect(DiagnosticCodeRegex.test(diagCode)).to.equal(true, `Diagnostic name does not match regex - ${key}`);
            //if another message already has this code
            if (!codes[obj.code]) {
                codes[obj.code] = key;
            } else {
                expect(codes[obj.code]).to.equal(key, 'Two diagnostic messages share the same error codes');
            }
        }
    });

    it('properly formats expected terminator diagnostics', () => {
        let diag = DiagnosticMessages.expectedTerminator(['end if', 'else if', 'else'], 'then', 'block');
        expect(diag.message).to.equal(`Expected 'end if', 'else if' or 'else' to terminate 'then' block`);
        diag = DiagnosticMessages.expectedTerminator('end try', 'try-catch');
        expect(diag.message).to.equal(`Expected 'end try' to terminate 'try-catch' statement`);
        diag = DiagnosticMessages.expectedTerminator(['one', 'two'], 'something');
        expect(diag.message).to.equal(`Expected 'one' or 'two' to terminate 'something' statement`);
    });
});
