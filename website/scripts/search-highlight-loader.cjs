/**
 * A webpack loader for the search plugin's worker (the code that runs the search). Search is fuzzy, so "sprea" can match
 * "speak", but the plugin highlights (and links with `?_highlight=`) the words you TYPED, so the page you land on highlights
 * nothing. This makes each result carry the words that actually matched instead, taken from lunr's match positions.
 *
 * It fails the build if the plugin's code no longer looks as expected (i.e. after a plugin upgrade), rather than silently
 * going back to the old behavior. If that happens, check whether the plugin fixed this itself, and update or remove this.
 */
const pattern = /metadata: result\.matchData\.metadata,(\s*)tokens,/;

const matchedWords = `
//(added by website/scripts/search-highlight-loader.cjs)
function __matchedWords(document, metadata, tokens) {
    const words = new Set();
    for (const term of Object.values(metadata || {})) {
        for (const position of (term.t && term.t.position) || []) {
            words.add(document.t.substr(position[0], position[1]).toLowerCase());
        }
    }
    //(highlight() wants lower case, longest first)
    return words.size > 0 ? Array.from(words).sort((a, b) => b.length - a.length) : tokens;
}
`;

module.exports = function searchHighlightLoader(source) {
    if (!pattern.test(source)) {
        throw new Error('search-highlight-loader: the search plugin\'s worker.js changed, so the matched-word highlighting can\'t be applied. See website/scripts/search-highlight-loader.cjs');
    }
    return source.replace(pattern, 'metadata: result.matchData.metadata,$1tokens: __matchedWords(document, result.matchData.metadata, tokens),') + matchedWords;
};
