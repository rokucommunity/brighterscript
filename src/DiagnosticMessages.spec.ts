import { expect } from 'chai';

import { diagnosticMessages } from './DiagnosticMessages';

describe('DiagnosticMessages', () => {
    it('has unique code for each message', () => {
        let codes = {};
        for (let key in diagnosticMessages) {
            let func = diagnosticMessages[key];
            let obj = func('', '', '', '', '', '', '', '', '');
            //if another message already has this code
            if (!codes[obj.code]) {
                codes[obj.code] = key;
            } else {
                expect(codes[obj.code]).to.equal(key, 'Two diagnostic messages share the same error code');
            }
        }
    });
});
