import { CacheVerifier } from './CacheVerifier';
import { isReferenceType } from './astUtils/reflection';
import type { ExtraSymbolData, GetTypeOptions } from './interfaces';
import type { BscType } from './types/BscType';

export class TypeCache {

    /**
     * Used to invalidate the cache for this symbol table.
     *
     */
    static cacheVerifier = new CacheVerifier();

    /* Scope.name  ->
     *      symbolTypeFlag->
     *              symbolName ->
     *                      TypeCacheEntry
     */
    cache = new Map<string, Map<number, Map<string, TypeCacheEntry>>>();

    cacheTokens = new Map<string, string>();

    private resetTypeCache() {
        const lowerScopeName = TypeCache.cacheVerifier.activeScope?.name?.toLowerCase();
        this.cache.get(lowerScopeName)?.clear();
        const tokenForScope = TypeCache.cacheVerifier?.getToken();
        if (tokenForScope) {
            this.cacheTokens.set(lowerScopeName, tokenForScope);
        }
    }

    getCachedType(name: string, options: GetTypeOptions): TypeCacheEntry {
        if (!TypeCache.cacheVerifier) {
            // no cache verifier
            return;
        }
        const lowerScopeName = TypeCache.cacheVerifier.activeScope?.name?.toLowerCase();
        if (!TypeCache.cacheVerifier?.checkToken(this.cacheTokens.get(lowerScopeName))) {
            // we have a bad token
            this.resetTypeCache();
            return;
        }
        return this.cache.get(lowerScopeName)?.get(options.flags)?.get(name.toLowerCase());
    }

    setCachedType(name: string, cacheEntry: TypeCacheEntry, options: GetTypeOptions) {
        if (!cacheEntry) {
            return;
        }
        if (!TypeCache.cacheVerifier) {
            // no cache verifier
            return;
        }
        const lowerScopeName = TypeCache.cacheVerifier.activeScope?.name?.toLowerCase();
        const lowerSymbolName = name.toLowerCase();
        if (!TypeCache.cacheVerifier?.checkToken(this.cacheTokens.get(lowerScopeName))) {
            // we have a bad token - remove caches for current scope
            this.resetTypeCache();
        }
        let existingCachedValue = this.cache.get(lowerScopeName)?.get(options.flags)?.get(lowerSymbolName);
        if (isReferenceType(cacheEntry.type) && !isReferenceType(existingCachedValue)) {
            // No need to overwrite a non-referenceType with a referenceType
            return;
        }
        const typeMap = this.getCacheMapForScopeAndOptions(lowerScopeName, options);
        return typeMap?.set(name.toLowerCase(), cacheEntry);
    }

    /**
     * Gets the cache for a given scope and symbol type flags
     */
    private getCacheMapForScopeAndOptions(lowerScopeName: string, options: GetTypeOptions) {
        if (!this.cache.has(lowerScopeName)) {
            this.cache.set(lowerScopeName, new Map<number, Map<string, TypeCacheEntry>>());
        }
        const scopeCache = this.cache.get(lowerScopeName);
        if (!scopeCache?.has(options.flags)) {
            scopeCache.set(options.flags, new Map<string, TypeCacheEntry>());
        }
        return scopeCache?.get(options.flags);
    }

}

export interface TypeCacheEntry {
    type: BscType;
    data?: ExtraSymbolData;
}
