//usage: node parse.js <bscDir> <projectDir> <passes>   (add --cpu-prof to profile it)
//lex+parse every brs/bs file in a project repeatedly (for CPU profiling the parser)
const fg = require('fast-glob');
const fs = require('fs');
const bsc = require(process.argv[2]);
const files = fg.sync(['**/*.brs', '**/*.bs'], { cwd: process.argv[3], absolute: true, ignore: ['**/node_modules/**'] }).map(f => ({ f: f, text: fs.readFileSync(f, 'utf8') }));
const lexed = files.map(x => ({ ...x, tokens: bsc.Lexer.scan(x.text, { srcPath: x.f }).tokens }));
const parseAll = () => { for (const x of lexed) { bsc.Parser.parse(x.tokens, { mode: x.f.endsWith('.bs') ? bsc.ParseMode.BrighterScript : bsc.ParseMode.BrightScript, srcPath: x.f }); } };
for (let i = 0; i < 3; i++) { parseAll(); }
const times = [];
for (let i = 0; i < +process.argv[4]; i++) { const s = performance.now(); parseAll(); times.push(performance.now() - s); }
times.sort((a, b) => a - b);
console.log(`${files.length} files, parse median ${times[Math.floor(times.length / 2)].toFixed(1)}ms min ${times[0].toFixed(1)}ms`);
