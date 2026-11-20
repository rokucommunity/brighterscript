/**
 * A webpack loader for the search plugin's SearchBar. The plugin only starts loading search (its scripts, its worker and the
 * search index) when you hover or focus the search box, so the first search after a page load has to wait for all of it.
 * This starts loading it in the background once the page is idle instead, so it's ready by the time you type.
 *
 * It fails the build if the plugin's code no longer looks as expected (i.e. after a plugin upgrade), rather than silently
 * going back to the old behavior. If that happens, update or remove this.
 */
const pattern = /const onInputMouseEnter = useCallback\(\(\) => \{\s*loadIndex\(\);\s*\}, \[loadIndex\]\);/;

const preload = `
    //(added by website/scripts/search-preload-loader.cjs) load search in the background once the page is idle
    useEffect(() => {
        if (typeof window.requestIdleCallback === "function") {
            const id = window.requestIdleCallback(() => loadIndex(), { timeout: 3000 });
            return () => window.cancelIdleCallback(id);
        }
        const id = setTimeout(() => loadIndex(), 1000);
        return () => clearTimeout(id);
    }, [loadIndex]);`;

module.exports = function searchPreloadLoader(source) {
    if (!pattern.test(source)) {
        throw new Error('search-preload-loader: the search plugin\'s SearchBar.jsx changed, so search can\'t be preloaded. See website/scripts/search-preload-loader.cjs');
    }
    return source.replace(pattern, (match) => match + preload);
};
