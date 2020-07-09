import { KeyedDebouncer } from './KeyedDebouncer';
import { expect } from 'chai';

describe.only('KeyedDebouncer', () => {
    let debouncer: KeyedDebouncer<string>;
    beforeEach(() => {
        debouncer = new KeyedDebouncer<string>();

    });
    it('returns full list when nothing is called afterwords', async () => {
        let result = await debouncer.debounce(['a', 'b'], 1);
        expect(result).to.eql(['a', 'b']);
    });

    it('removes items from list if called again', async () => {
        let promise1 = debouncer.debounce(['a', 'b'], 1);
        let promise2 = debouncer.debounce(['b'], 1);

        expect(await promise1).to.eql(['a']);
        expect(await promise2).to.eql(['b']);
    });
});
