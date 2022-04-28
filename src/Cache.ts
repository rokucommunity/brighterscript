/**
 * A cache that will call the factory to create the item if it doesn't exist
 */
export class Cache<TKey = any, TValue = any> extends Map<TKey, TValue> {

    /**
     * Get value from the cache if it exists,
     * otherwise call the factory function to create the value, add it to the cache, and return it.
     */
    public getOrAdd<R extends TValue = TValue>(key: TKey, factory: (key: TKey) => R): R {
        if (!this.has(key)) {
            const value = factory(key);
            this.set(key, value);
            return value;
        } else {
            return this.get(key) as R;
        }
    }
}
