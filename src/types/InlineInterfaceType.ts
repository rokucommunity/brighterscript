
import { SymbolTypeFlag } from '../SymbolTypeFlag';
import { InterfaceType } from './InterfaceType';

export class InlineInterfaceType extends InterfaceType {
    public constructor(
    ) {
        super('');
    }

    public toString() {
        const ownSymbols = this.getMemberTable().getOwnSymbols(SymbolTypeFlag.runtime);

        // eslint-disable-next-line no-bitwise
        const membersList = ownSymbols.map(s => `${s.flags & SymbolTypeFlag.optional ? 'optional ' : ''}${s.name} as ${s.type.toString()}`).join(', ');
        return `{${membersList}}`;
    }
}
