/**
 * A cache that will call the factory to create the item if it doesn't exist
 */
export class Cache<TKey = any, TValue = any> extends Map<TKey, TValue> {

    /**
     * Get value from the cache if it exists,
     * otherwise call the factory function to create the value, add it to the cache, and return it.
     */
    public getOrAdd<R extends TValue = TValue>(key: TKey, factory: (key: TKey) => R): R {
        if (!super.has(key)) {
            const value = factory(key);
            super.set(key, value);
            return value;
        } else {
            return super.get(key) as R;
        }
    }

    /**
     * Get the item with the specified key.
     */
    public get<R extends TValue = TValue>(key: TKey) {
        return super.get(key) as R;
    }
}
