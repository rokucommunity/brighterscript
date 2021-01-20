/**
 * Synchronous cache
 */
export class Cache {
    private cache = {} as Record<string, any>;

    /**
     * Get value from the cache if it exists,
     * otherwise call the factory function to create the value, add it to the cache, and return it.
     */
    public getOrAdd<T>(key: string, factory: (key: string) => T) {
        if (this.cache[key] === undefined) {
            this.cache[key] = factory(key);
        }
        return this.cache[key] as T;
    }
    /**
     * Clear the cache
     */
    public clear() {
        this.cache = {};
    }
}
