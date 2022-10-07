import { assert } from '../chai-config.spec';

import * as Characters from './Characters';

describe('lexer/Characters', () => {
    it('isDecimalDigit throws when when given > 1 length string', () => {
        assert.throws(() => {
            Characters.isDecimalDigit('11');
        });
    });

    it('isHexDigit throws when when given > 1 length string', () => {
        assert.throws(() => {
            Characters.isHexDigit('ab');
        });
    });

    it('isAlpha throws when when given > 1 length string', () => {
        assert.throws(() => {
            Characters.isAlpha('ab');
        });
    });

    it('isAlphaNumeric throws when when given > 1 length string', () => {
        assert.throws(() => {
            Characters.isAlphaNumeric('a1');
        });
    });
});
