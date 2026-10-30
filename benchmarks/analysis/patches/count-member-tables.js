//usage: BSC_PATH=<bscDir> COUNT_OUT=<dir> npm run benchmark:scenarios -- run ... --require <this file>
const path = require('path');
require(path.join(process.env.BSC_PATH, 'dist', 'index'));
const { BscType } = require(path.join(process.env.BSC_PATH, 'dist', 'types/BscType'));
const { TypesCreated } = require(path.join(process.env.BSC_PATH, 'dist', 'types/helpers'));
const desc = Object.getOwnPropertyDescriptor(BscType.prototype, 'memberTable');
let made = 0;
Object.defineProperty(BscType.prototype, 'memberTable', {
    get() { if (!this._memberTable) { made++; } return desc.get.call(this); }
});
process.on('exit', () => {
    const total = Object.values(TypesCreated).reduce((a, b) => a + b, 0);
    require('fs').writeFileSync(path.join(process.env.COUNT_OUT || '.', 'counts.json'), JSON.stringify({ total, made, byType: TypesCreated }, null, 1));
});
