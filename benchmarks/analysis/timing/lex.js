//usage: node lex.js <bscDir> <projectDir>
const fg = require('fast-glob');
const fs = require('fs');
const dir = process.argv[3];
const files = fg.sync(['**/*.brs', '**/*.bs'], { cwd: dir, absolute: true, ignore: ['**/node_modules/**'] }).map(f => fs.readFileSync(f, 'utf8'));
const { Lexer } = require(process.argv[2]);
for (let i = 0; i < 5; i++) { for (const f of files) { Lexer.scan(f); } } //warm up
const times = [];
for (let r = 0; r < 15; r++) { const s = performance.now(); for (const f of files) { Lexer.scan(f); } times.push(performance.now() - s); }
times.sort((a, b) => a - b);
console.log(process.argv[2].split('/').pop().padEnd(12), files.length, 'files  median', times[7].toFixed(1), 'ms  min', times[0].toFixed(1), 'ms');
