/**
 * A webpack loader for the search plugin's generated files (.docusaurus/@easyops-cn/...), which import modules by absolute path.
 * On Windows those paths can come out with a lowercase drive letter (`c:\` rather than `C:\`), and webpack then loads the same
 * module twice and warns about "multiple modules with names that only differ in casing". This rewrites each absolute path to
 * its true casing on disk.
 */
const fs = require('fs');

module.exports = function pathCasingLoader(source) {
    //a JSON-escaped windows path in a string, i.e. "c:\\projects\\...\\lunr.js"
    return source.replace(/"[a-zA-Z]:(?:\\\\[^"\\]+)+"/g, (match) => {
        try {
            return JSON.stringify(fs.realpathSync.native(JSON.parse(match)));
        } catch {
            return match;
        }
    });
};
