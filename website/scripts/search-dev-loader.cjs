/**
 * `npm run docs` only: a webpack loader for the search plugin's client code. The plugin turns search off unless
 * NODE_ENV is production, but the dev server does get a real search index (see scripts/site.mjs), so turn it back on.
 */
module.exports = function searchDevLoader(source) {
    return source.replace(/process\.env\.NODE_ENV\s*===\s*["']production["']/g, 'true');
};
