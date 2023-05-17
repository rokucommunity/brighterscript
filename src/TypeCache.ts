import type { SymbolTable } from './SymbolTable';
import { SymbolTypeFlags } from './SymbolTable';
import { isReferenceType } from './astUtils/reflection';
import type { BscType } from './types/BscType';


export class TypeCache {

    private cache = new Map<SymbolTable, Map<string, Map<number, BscType>>>();

    stats = {
        getTypeFinds: 0,
        getTypeMisses: 0,

        setTypeNoType: 0,
        setTypeNoTable: 0,
        setTypeNoName: 0,
        setTypeCount: 0
    };

    getType(table: SymbolTable, name: string, flags: SymbolTypeFlags): BscType {
        const nameKey = name.toLowerCase();
        let cached = this.cache.get(table)?.get(nameKey)?.get(flags);

        if (cached) {
            this.stats.getTypeFinds++;
        } else {
            this.stats.getTypeMisses++;
        }
        return cached;
    }

    setType(table: SymbolTable, name: string, flags: SymbolTypeFlags, type: BscType) {
        while (isReferenceType(type)) {
            type = (type as any).getTarget();
        }
        if (!type) {
            this.stats.setTypeNoType++;
            return;
        }
        const nameKey = name.toLowerCase();
        let tableMap = this.cache.get(table);
        if (!tableMap) {
            tableMap = new Map<string, Map<number, BscType>>();
            this.stats.setTypeNoTable++;
            this.cache.set(table, tableMap);
        }
        let nameMap = tableMap.get(nameKey);
        if (!nameMap) {
            nameMap = new Map<number, BscType>();
            this.stats.setTypeNoName++;
            tableMap.set(nameKey, nameMap);
        }

        // eslint-disable-next-line no-bitwise
        if (SymbolTypeFlags.runtime & flags) {
            nameMap.set(SymbolTypeFlags.runtime, type);
        }
        // eslint-disable-next-line no-bitwise
        if (SymbolTypeFlags.typetime & flags) {
            nameMap.set(SymbolTypeFlags.typetime, type);
        }
        nameMap.set(flags, type);
        this.stats.setTypeCount++;
        return type;
    }

    clear() {
        console.log(this.stats);
        this.stats = {
            getTypeFinds: 0,
            getTypeMisses: 0,

            setTypeNoType: 0,
            setTypeNoTable: 0,
            setTypeNoName: 0,
            setTypeCount: 0
        };
        this.cache.clear();
    }
}
/**
 * A function that returns a symbol resolution function.
 */
export type TypeCacheProvider = () => TypeCache;
