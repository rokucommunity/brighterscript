/**
 * A cache that will call the factory to create the item if it doesn't exist
 */
export class Cache<TKey = any, TValue = any> {
    private cache = new Map<TKey, TValue>();

    /**
     * Get value from the cache if it exists,
     * otherwise call the factory function to create the value, add it to the cache, and return it.
     */
    public getOrAdd<K extends TKey, T extends TValue>(key: K, factory: (key: K) => T): T {
        if (!this.cache.has(key)) {
            const value = factory(key);
            this.cache.set(key, value);
            return value;
        } else {
            return this.cache.get(key) as T;
        }
    }
    /**
     * Clear the cache
     */
    public clear() {
        this.cache.clear();
    }
}
