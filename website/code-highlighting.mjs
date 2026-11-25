/**
 * Syntax highlighting for code blocks, done at build time with Shiki (https://shiki.style).
 *
 * Shiki uses the same TextMate grammars and themes as VS Code, so BrightScript/BrighterScript code looks exactly like it does
 * in the vscode-brightscript-language extension. scripts/site.mjs downloads the latest grammar from that repo before every build.
 *
 * Supported code block options (same syntax as docusaurus):
 *   ```brighterscript title="source/main.bs"     a title bar above the code
 *   ```brighterscript {2,4-6}                    highlight lines 2 and 4 through 6
 *   ```brighterscript showLineNumbers            line numbers
 *   print "hi" ' [!code highlight]               highlight a single line from a comment in the code
 *
 * Use ```bsc-output for diagnostics printed by the bsc CLI.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import rehypeShiki from '@shikijs/rehype';
import { transformerMetaHighlight, transformerNotationHighlight } from '@shikijs/transformers';

const websiteDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Where scripts/site.mjs saves the downloaded brightscript grammar
 */
export const grammarPath = path.join(websiteDir, '.grammars', 'brightscript.tmLanguage.json');

/**
 * A committed copy of the grammar, for when the download fails
 */
export const fallbackGrammarPath = path.join(websiteDir, 'grammars', 'brightscript.tmLanguage.json');

/**
 * All the text in a hast node
 */
function toText(node) {
    if (node.type === 'text') {
        return node.value;
    }
    return (node.children ?? []).map(toText).join('');
}

/**
 * Docusaurus-style code block options that shiki doesn't handle on its own
 * @type {import('shiki').ShikiTransformer}
 */
const transformerDocusaurusMeta = {
    name: 'docusaurus-meta',
    pre(node) {
        //the code for the copy button: the rendered text, so it doesn't include `[!code ...]` comments (which shiki already removed)
        node.properties['data-code'] = toText(node);

        const meta = this.options.meta?.__raw ?? '';
        const title = /\btitle=(["'])(.*?)\1/.exec(meta)?.[2];
        if (title) {
            node.properties['data-title'] = title;
        }
        if (/\bshowLineNumbers\b/.test(meta)) {
            this.addClassToHast(node, 'line-numbers');
        }
    }
};

/**
 * Diagnostics printed by the `bsc` CLI, colored the same way the CLI colors them (see `printDiagnostic` in src/diagnosticUtils.ts).
 * Use it with ```bsc-output code blocks.
 */
const bscOutputGrammar = {
    name: 'bsc-output',
    scopeName: 'source.bsc-output',
    patterns: [
        //the first line of a diagnostic: `path:line:col - error BS1234: message`, where the location is optional
        {
            match: '^(?:(\\S+?)(:)(\\d+:\\d+)(\\s+-\\s+))?(?:(error)|(warning)|(info|hint))(\\s+)(BS\\d+)(:)',
            captures: {
                1: { name: 'entity.name.type.bsc-output' },
                3: { name: 'entity.name.function.bsc-output' },
                5: { name: 'invalid.illegal.error.bsc-output' },
                6: { name: 'string.warning.bsc-output' },
                7: { name: 'keyword.info.bsc-output' }
            }
        },
        //a related location: `path:line:col` on its own line
        {
            match: '^\\s*(\\S+?)(:)(\\d+:\\d+)\\s*$',
            captures: {
                1: { name: 'entity.name.type.bsc-output' },
                3: { name: 'entity.name.function.bsc-output' }
            }
        },
        //the line of code the diagnostic points at, with its line number
        {
            begin: '^\\s*(\\d+)(?=\\s)',
            beginCaptures: {
                1: { name: 'constant.numeric.line-number.bsc-output' }
            },
            end: '$',
            patterns: [{ include: 'source.brs' }]
        },
        //the squiggly underline
        {
            match: '^\\s*(~+)\\s*$',
            captures: {
                1: { name: 'invalid.illegal.squiggly.bsc-output' }
            }
        }
    ]
};

/**
 * The rehype plugin (and its options) that highlights every code block in the docs
 * @returns {[typeof rehypeShiki, import('@shikijs/rehype').RehypeShikiOptions]}
 */
export function getRehypeCodeHighlighting() {
    if (!fs.existsSync(grammarPath)) {
        throw new Error(`Missing the brightscript grammar at ${grammarPath}. Run the site through \`npm run docs\` or \`npm run build-docs\`, which downloads it.`);
    }
    const brightscriptGrammar = JSON.parse(fs.readFileSync(grammarPath, 'utf8'));
    const brightscriptLang = {
        ...brightscriptGrammar,
        name: 'brightscript',
        //the docs use all sorts of names for brightscript code blocks (and shiki is case sensitive)
        aliases: ['brighterscript', 'BrightScript', 'BrighterScript', 'brs', 'bs', 'vb']
    };

    return [rehypeShiki, {
        //VS Code's default themes. Dark mode swaps to the `--shiki-dark` colors (see custom.css)
        themes: {
            light: 'light-plus',
            dark: 'dark-plus'
        },
        langs: [
            brightscriptLang,
            {
                ...bscOutputGrammar,
                //the code lines in the output are highlighted as brightscript
                embeddedLangs: ['brightscript']
            },
            'typescript',
            'javascript',
            'json',
            'jsonc',
            'bash',
            'xml'
        ],
        fallbackLanguage: 'text',
        transformers: [
            transformerMetaHighlight(),
            transformerNotationHighlight({ matchAlgorithm: 'v3' }),
            transformerDocusaurusMeta
        ]
    }];
}
