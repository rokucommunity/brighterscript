export class KeyedDebouncer<T> {
    /**
     * Every key can be a member of exactly one collection of keys. If the key shows up in a new keys collection, it will
     * need to be removed from the previous collection. This keeps track of the last-seen collection for a given key
     */
    private collectionForKey = new Map<T, T[]>();
    /**
     * Debounce the list of keys. Returns a promise that is resolved once the timer has expired.
     * If a key is passed in to a future debounce, it will be removed from this debouce,
     * so is critical that you only operate on the list of keys returned.
     * @param keys - the list of keys that should be debounced. This list must be unique.
     * @param delay - the number of milliseconds these keys should be debounced
     */
    public debounce(keys: T[], timeout: number): Promise<T[]> {
        for (let key of keys) {
            if (this.collectionForKey.has(key)) {
                let collection = this.collectionForKey.get(key);
                //remove the key from the previous collection
                collection.splice(collection.indexOf(key), 1);
            }
            //set the latest collection for this key
            this.collectionForKey.set(key, keys);
        }
        return new Promise<T[]>((resolve) => {
            setTimeout(() => {
                resolve(keys);
            }, timeout);
        });
    }
}
