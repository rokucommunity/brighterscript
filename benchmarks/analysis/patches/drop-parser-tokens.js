//usage: BSC_PATH=<bscDir> npm run benchmark:scenarios -- run ... --require <this file>
//EXPERIMENT ONLY: empty every BrsFile's parser.tokens right after it parses, to measure what keeping the array costs
require(process.env.BSC_PATH + '/dist/index');
const { BrsFile } = require(process.env.BSC_PATH + '/dist/files/BrsFile');
const parse = BrsFile.prototype.parse;
BrsFile.prototype.parse = function (...args) {
    const result = parse.apply(this, args);
    if (this._parser) {
        this._parser.tokens = [];
    }
    return result;
};
