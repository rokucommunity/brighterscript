import * as minimatch from 'minimatch';
import * as path from 'path';
import type { AstEditor } from '../../astUtils/AstEditor';
import { isBrsFile, isDottedGetExpression, isLiteralString, isXmlFile } from '../../astUtils/reflection';
import { WalkMode, createVisitor } from '../../astUtils/visitors';
import type { BrsFile } from '../../files/BrsFile';
import type { XmlFile } from '../../files/XmlFile';
import type { NormalizedKeepRule } from '../../BsConfig';
import type { BscFile } from '../../interfaces';
import type { CallfuncExpression } from '../../parser/Expression';
import { ParseMode } from '../../parser/Parser';
import { EmptyStatement } from '../../parser/Statement';
import type { FunctionStatement } from '../../parser/Statement';
import type { Program } from '../../Program';
import util from '../../util';
import type { Logger } from '../../logging';

/**
 * Keep rule with patterns pre-compiled and src paths pre-resolved.
 * Built once per analyze() call so per-function matching is pure set/matcher lookups.
 */
interface CompiledRule {
    /** Lowercased exact BrightScript names — O(1) Set lookup replaces Array.includes. */
    functionsSet?: Set<string>;
    /** Pre-compiled minimatch instances for `matches` glob patterns. */
    matchesMatchers?: minimatch.Minimatch[];
    /** Pre-compiled minimatch instances for `src` patterns, already resolved to absolute paths. */
    srcMatchers?: minimatch.Minimatch[];
    /** Pre-compiled minimatch instances for `dest` patterns, normalized to forward slashes. */
    destMatchers?: minimatch.Minimatch[];
}

export class TreeShaker {
    /**
     * Roku lifecycle callbacks and framework entry points that must always be kept.
     * These are never removed regardless of whether they appear in call expressions.
     */
    private static readonly ENTRY_POINTS = new Set([
        'main',
        'init',
        'onkeyevent',
        'onmessage',
        'runuserinterface',
        'runscreensaver',
        'runtask'
    ]);

    // Fully-qualified lowercased function names (BrighterScript style, dots) → brsName
    private allFunctions = new Map<string, string>();

    // Simple (unqualified) names of every known function — the last dot-segment of each bsName.
    // A separate set is needed because allFunctions is keyed by fully-qualified names, so
    // allFunctions.has('helper') returns false for 'ns.helper'. Without this, a namespaced
    // function passed by reference using its relative name (e.g. observeField("x", helper)
    // from inside namespace ns) would not be detected by the VariableExpression/
    // DottedGetExpression gates and could be incorrectly removed.
    private allSimpleNames = new Set<string>();

    // Every function statement across all files, in collection order.
    // allFunctions stores only one entry per bsName (last write wins for name-only checks),
    // but allStatements retains every definition so computeRemovals() can evaluate each
    // (bsName, file) pair independently — required for correct src/dest keep-rule scoping
    // when multiple files define a function with the same name.
    private allStatements: Array<{ bsName: string; brsName: string; stmt: FunctionStatement; file: BrsFile }> = [];

    // Names referenced in CallExpression nodes (both full namespaced and simple names)
    private calledNames = new Set<string>();

    // String literal values that look like identifiers (potential dynamic callFunc / observeField targets)
    private stringRefs = new Set<string>();

    // Functions declared in XML <interface><function name="..."/> elements
    private xmlInterfaceFunctions = new Set<string>();

    // Functions marked with a `bs:keep` comment — never removed regardless of references
    private keepCommented = new Set<string>();

    // Keep rules with patterns pre-compiled — built once at the start of analyze()
    private compiledRules: CompiledRule[] = [];

    // Normalized file paths per BrsFile — computed once, reused across all rule checks for that file
    private filePathCache = new Map<BrsFile, { srcPath: string; pkgPath: string }>();

    // FunctionStatements to remove — keyed on the statement object so same-named functions
    // in different files are tracked independently; shake() is a single Set lookup per statement
    private toRemove = new Set<FunctionStatement>();

    // Files that have at least one function to remove — shake() skips files not in this set,
    // guaranteeing needsTranspiled is never touched on fully-protected files (e.g. a .brs SDK
    // covered entirely by a src keep rule)
    private filesToShake = new Set<BrsFile>();

    // Resolved rootDir for src-path matching
    private rootDir = '';

    // Logger sourced from the Program — set at the start of analyze()
    private logger: Logger | undefined;

    // Removals accumulated across shake() calls — keyed by pkgPath for the summary log
    private removalLog = new Map<string, string[]>();

    reset() {
        this.allFunctions.clear();
        this.allSimpleNames.clear();
        this.allStatements = [];
        this.calledNames.clear();
        this.stringRefs.clear();
        this.xmlInterfaceFunctions.clear();
        this.keepCommented.clear();
        this.compiledRules = [];
        this.filePathCache.clear();
        this.toRemove.clear();
        this.filesToShake.clear();
        this.rootDir = '';
        this.removalLog.clear();
    }

    /**
     * Two-pass analysis of the entire program:
     *
     * Pass 1 — collect every function definition so we have the complete set
     *           of names before any reference pass runs.
     *
     * Pass 2 — collect call sites, string literals (dynamic dispatch / observeField),
     *           and VariableExpression references.  The VariableExpression check is
     *           gated on the name matching a known function so that passing a function
     *           by reference (e.g. sgnode.observe(node, "field", onContentChanged))
     *           is detected even when the name never appears as a string literal or
     *           direct call.
     *
     * After both passes, the removal set is precomputed so shake() is a single
     * set lookup per function rather than re-running all decision logic per file.
     */
    analyze(program: Program, keepRules: NormalizedKeepRule[]) {
        this.reset();
        this.logger = program.logger;
        this.rootDir = program.options.rootDir ?? process.cwd();

        // Compile patterns and resolve src paths once — before any per-function work
        this.compiledRules = this.compileRules(keepRules);

        // Pass 1 – definitions + XML interfaces
        for (const file of Object.values(program.files)) {
            if (isBrsFile(file)) {
                this.collectDefinitions(file);
            } else if (isXmlFile(file)) {
                this.collectXmlFile(file as XmlFile);
            }
        }

        // Pass 2 – references (definitions must be complete before this runs)
        for (const file of Object.values(program.files)) {
            if (isBrsFile(file)) {
                this.collectReferences(file);
            }
        }

        // Precompute removal decisions so shake() is O(1) per function
        this.computeRemovals();
    }

    /**
     * Compile NormalizedKeepRules into CompiledRules.
     * - `functions` arrays become Sets for O(1) membership testing.
     * - `matches`/`src`/`dest` glob strings become pre-compiled Minimatch instances.
     * - `src` patterns are resolved to absolute paths against rootDir up front.
     */
    private compileRules(rules: NormalizedKeepRule[]): CompiledRule[] {
        return rules.map(rule => {
            const compiled: CompiledRule = {};

            if (rule.functions) {
                compiled.functionsSet = new Set(rule.functions); // already lowercased by normalizer
            }

            if (rule.matches) {
                compiled.matchesMatchers = rule.matches.map(
                    p => new minimatch.Minimatch(p, { nocase: true })
                );
            }

            if (rule.src) {
                compiled.srcMatchers = rule.src.map(pattern => {
                    const resolved = path.isAbsolute(pattern)
                        ? pattern
                        : path.resolve(this.rootDir, pattern);
                    // Normalize to forward slashes: util.standardizePath uses path.win32.normalize
                    // which produces backslashes on Windows, and minimatch treats \ as an escape
                    // character rather than a path separator unless paths are normalized first.
                    return new minimatch.Minimatch(util.standardizePath(resolved).replace(/\\/g, '/'), { nocase: true });
                });
            }

            if (rule.dest) {
                compiled.destMatchers = rule.dest.map(p => {
                    // Normalize backslashes and strip optional pkg:/ scheme prefix so
                    // patterns like "pkg:/source/**/*.brs" and "source/**/*.brs" both work.
                    const normalized = p.replace(/\\/g, '/').replace(/^pkg:\//i, '');
                    return new minimatch.Minimatch(normalized, { nocase: true });
                });
            }

            return compiled;
        });
    }

    /**
     * Returns the normalized srcPath and deployedPkgPath for a file, computing and
     * caching them on first access so repeated rule checks for the same file pay no
     * extra cost.
     *
     * pkgPath uses the *deployed* extension: .bs files transpile to .brs, so
     * `source/foo.bs` becomes `source/foo.brs`.  This matches what users naturally
     * write in dest glob patterns (e.g. `source/vendor/**\/*.brs`).
     */
    private getFilePaths(file: BrsFile): { srcPath: string; pkgPath: string } {
        let cached = this.filePathCache.get(file);
        if (!cached) {
            const rawPkg = file.pkgPath.replace(/\\/g, '/');
            cached = {
                srcPath: util.standardizePath(file.srcPath).replace(/\\/g, '/'),
                pkgPath: rawPkg.replace(/\.bs$/i, '.brs')
            };
            this.filePathCache.set(file, cached);
        }
        return cached;
    }

    /**
     * After both analysis passes, iterate every collected statement and compute which
     * should be removed.  Each (bsName, file) pair is evaluated independently so that
     * src/dest keep rules correctly scope to the file that actually defines the function —
     * this handles cases where multiple files define a function with the same name.
     * Storing results keyed on the FunctionStatement object means shake() needs only a
     * single Set lookup per statement rather than re-running all decision logic per file.
     */
    private computeRemovals() {
        for (const { bsName, brsName, stmt, file } of this.allStatements) {
            if (this.isUnused(bsName, brsName) && !this.isKept(brsName, file)) {
                this.toRemove.add(stmt);
                this.filesToShake.add(file);
            }
        }
    }

    // -------------------------------------------------------------------------
    // Pass 1
    // -------------------------------------------------------------------------

    private collectDefinitions(file: BrsFile) {
        // Collect all function statements first so we can sort by source order.
        // Sorting is required for the prev-end-line region check used by `bs:keep`.
        const collected: Array<{ bsName: string; brsName: string; stmt: FunctionStatement }> = [];

        file.ast.walk(createVisitor({
            FunctionStatement: (stmt) => {
                const bsName = stmt.getName(ParseMode.BrighterScript)?.toLowerCase();
                const brsName = stmt.getName(ParseMode.BrightScript)?.toLowerCase();
                if (bsName && brsName) {
                    this.allFunctions.set(bsName, brsName);
                    this.allSimpleNames.add(bsName.split('.').pop()!);
                    this.allStatements.push({ bsName: bsName, brsName: brsName, stmt: stmt, file: file });
                    collected.push({ bsName: bsName, brsName: brsName, stmt: stmt });
                }
            }
        }), { walkMode: WalkMode.visitStatements });

        // Walk functions in source order to detect `bs:keep` comments.
        // A `bs:keep` on line N applies to a function F when:
        //   • N == F.startLine  (same-line inline comment), OR
        //   • prevFunctionEndLine < N <= F.startLine  (comment in the header region above F)
        collected.sort((a, b) => a.stmt.range.start.line - b.stmt.range.start.line);

        // Sort keep-flag lines once so we can advance a pointer linearly O(functions + keepLines).
        const keepLines = [...file.keepFlagLines].sort((a, b) => a - b);
        let keepIdx = 0;

        let prevEndLine = -1;
        for (const { bsName, stmt } of collected) {
            const startLine = stmt.range.start.line;
            // Skip any keep lines that fall before or inside the previous function.
            while (keepIdx < keepLines.length && keepLines[keepIdx] <= prevEndLine) {
                keepIdx++;
            }
            // If the next keep line is within (prevEndLine, startLine], this function is kept.
            if (keepIdx < keepLines.length && keepLines[keepIdx] <= startLine) {
                this.keepCommented.add(bsName);
            }
            prevEndLine = stmt.range.end.line;
        }
    }

    private collectXmlFile(file: XmlFile) {
        const component = file.parser.ast.component as any;

        // Collect functions exposed through <interface><function name="..."/></interface>
        if (Array.isArray(component?.api?.functions)) {
            for (const func of component.api.functions) {
                const name: string | undefined = func?.name;
                if (name) {
                    this.xmlInterfaceFunctions.add(name.toLowerCase());
                }
            }
        }

        // Collect onChange="callbackName" from <interface><field onChange="..."/> elements.
        // These are the most common observer callbacks in Roku components — they fire
        // whenever the field value changes and are invisible to the BrightScript AST walker.
        if (Array.isArray(component?.api?.fields)) {
            for (const field of component.api.fields) {
                const onChange: string | undefined = field?.onChange;
                if (onChange && /^[a-z_][a-z0-9_.]*$/i.test(onChange)) {
                    this.xmlInterfaceFunctions.add(onChange.toLowerCase());
                }
            }
        }

        // Collect onChange="callbackName" attribute values from any element in the
        // component <children> tree (e.g. inline node definitions with onChange set).
        this.collectXmlOnChangeCallbacks(component?.children);
    }

    private collectXmlOnChangeCallbacks(children: any) {
        if (!Array.isArray(children?.children)) {
            return;
        }
        for (const child of children.children) {
            if (Array.isArray(child.attributes)) {
                for (const attr of child.attributes) {
                    const key: string | undefined = attr?.key?.text;
                    if (key?.toLowerCase() === 'onchange') {
                        const value: string | undefined = attr?.value?.text;
                        if (value && /^[a-z_][a-z0-9_.]*$/i.test(value)) {
                            this.xmlInterfaceFunctions.add(value.toLowerCase());
                        }
                    }
                }
            }
            // Recurse into nested elements
            this.collectXmlOnChangeCallbacks(child);
        }
    }

    // -------------------------------------------------------------------------
    // Pass 2
    // -------------------------------------------------------------------------

    private collectReferences(file: BrsFile) {
        file.ast.walk(createVisitor({
            CallExpression: (call) => {
                const parts = util.getAllDottedGetParts(call.callee);
                if (parts?.length) {
                    // Always record the call target unconditionally. Gating on known
                    // function names would miss transpiled underscore calls from .brs
                    // files (e.g. utils_helper()) since that form doesn't appear in
                    // allFunctions or allSimpleNames.
                    const full = parts.map(p => p.text).join('.').toLowerCase();
                    const simple = parts[parts.length - 1].text.toLowerCase();
                    this.calledNames.add(full);
                    this.calledNames.add(simple);
                    // Also record the underscore-joined form so that namespace calls like
                    // promises.chain() correctly retain a pre-compiled .brs library function
                    // named promises_chain. Without this, bsName='promises_chain' would not
                    // match calledNames={'promises.chain','chain'} and would be removed.
                    if (parts.length > 1) {
                        this.calledNames.add(parts.map(p => p.text).join('_').toLowerCase());
                    }
                }
            },

            LiteralExpression: (expr) => {
                if (isLiteralString(expr)) {
                    // Strip surrounding quotes and capture identifier-shaped strings.
                    // This conservatively retains functions referenced via observeField,
                    // callFunc, and similar dynamic dispatch patterns.
                    const raw = expr.token.text ?? '';
                    const text = raw.length >= 2 ? raw.slice(1, -1).toLowerCase() : '';
                    if (text && /^[a-z_][a-z0-9_.]*$/.test(text)) {
                        this.stringRefs.add(text);
                    }
                }
            },

            VariableExpression: (expr) => {
                // Detect simple function-reference patterns such as:
                //   sgnode.observe(node, "field", onContentChanged)
                //   callbacks = [onFoo, onBar]
                // where the function is passed by reference rather than called or
                // named as a string.  Gate on allSimpleNames (not allFunctions) so that
                // namespaced functions referenced by their relative/simple name from
                // within the same namespace are correctly detected — allFunctions only
                // stores fully-qualified names so allFunctions.has('helper') would miss
                // a function defined as 'ns.helper'.
                const name = (expr as any).name?.text?.toLowerCase();
                if (name && (this.allFunctions.has(name) || this.allSimpleNames.has(name))) {
                    this.calledNames.add(name);
                }
            },

            DottedGetExpression: (expr) => {
                // Detect namespaced function-reference patterns such as:
                //   sgnode.observe(node, "field", myNs.onContentChanged)
                // The node is not a CallExpression callee here, so it would
                // otherwise be invisible to the CallExpression walker above.
                if (!isDottedGetExpression(expr)) {
                    return;
                }
                const parts = util.getAllDottedGetParts(expr);
                if (parts?.length) {
                    const full = parts.map(p => p.text).join('.').toLowerCase();
                    const simple = parts[parts.length - 1].text.toLowerCase();
                    if (this.allFunctions.has(full) || this.allSimpleNames.has(simple)) {
                        this.calledNames.add(full);
                        this.calledNames.add(simple);
                    }
                }
            },

            CallfuncExpression: (expr) => {
                // Detect the @. callFunc shorthand:
                //   m.blockContainer@.renderBlocks(blocksToRender)
                // This is a CallfuncExpression, not a CallExpression, so the
                // CallExpression visitor above never sees the method name.
                const name = (expr as unknown as CallfuncExpression).methodName?.text?.toLowerCase();
                if (name) {
                    this.calledNames.add(name);
                }
            }
        }), { walkMode: WalkMode.visitAllRecursive });
    }

    // -------------------------------------------------------------------------
    // Decision
    // -------------------------------------------------------------------------

    /**
     * Returns true when the function has no known callers and is not a recognized entry point.
     *
     * Three name forms are checked against each relevant set:
     *   bsName     — fully-qualified BrighterScript name (e.g. "utils.helper")
     *   simpleName — final dot-segment (e.g. "helper")
     *   brsName    — transpiled BrightScript name (e.g. "utils_helper")
     *
     * The brsName check is required because .brs files call functions by their transpiled
     * underscore name (e.g. utils_helper()), which lands in calledNames/stringRefs as
     * "utils_helper" — a form that neither bsName nor simpleName would match.
     */
    isUnused(bsName: string, brsName: string): boolean {
        const simpleName = bsName.split('.').pop() ?? bsName;
        const isGlobalName = !bsName.includes('.');
        const isEntryPoint =
            (isGlobalName && TreeShaker.ENTRY_POINTS.has(simpleName)) ||
            TreeShaker.ENTRY_POINTS.has(brsName);
        if (isEntryPoint) {
            // Lifecycle entry points are always considered used.
            return false;
        }
        return (
            !this.keepCommented.has(bsName) &&
            !this.keepCommented.has(simpleName) &&
            !this.calledNames.has(bsName) &&
            !this.calledNames.has(simpleName) &&
            !this.calledNames.has(brsName) &&
            !this.stringRefs.has(bsName) &&
            !this.stringRefs.has(simpleName) &&
            !this.stringRefs.has(brsName) &&
            !this.xmlInterfaceFunctions.has(bsName) &&
            !this.xmlInterfaceFunctions.has(simpleName) &&
            !this.xmlInterfaceFunctions.has(brsName)
        );
    }

    /**
     * Returns true when the function matches any compiled keep rule from config.
     * Rule fields are ANDed; rules across the list are ORed.
     */
    isKept(brsName: string, file: BrsFile): boolean {
        if (this.compiledRules.length === 0) {
            return false;
        }
        const { srcPath, pkgPath } = this.getFilePaths(file);
        for (const rule of this.compiledRules) {
            if (this.ruleMatches(rule, brsName, srcPath, pkgPath)) {
                return true;
            }
        }
        return false;
    }

    private ruleMatches(rule: CompiledRule, brsName: string, srcPath: string, pkgPath: string): boolean {
        // functions: O(1) Set lookup
        if (rule.functionsSet && !rule.functionsSet.has(brsName)) {
            return false;
        }

        // matches: pre-compiled glob matchers
        if (rule.matchesMatchers && !rule.matchesMatchers.some(m => m.match(brsName))) {
            return false;
        }

        // src: pre-compiled matchers against already-standardized absolute path
        if (rule.srcMatchers && !rule.srcMatchers.some(m => m.match(srcPath))) {
            return false;
        }

        // dest: pre-compiled matchers against already-normalized pkgPath
        if (rule.destMatchers && !rule.destMatchers.some(m => m.match(pkgPath))) {
            return false;
        }

        return true;
    }

    // -------------------------------------------------------------------------
    // Shake
    // -------------------------------------------------------------------------

    /**
     * Walk the file and replace every unused FunctionStatement with an EmptyStatement,
     * effectively removing it from transpiled output.
     * The removal set was precomputed in analyze(), so this is a single Set lookup
     * per function with no rule evaluation or path normalization at shake time.
     */
    shake(file: BscFile, editor: AstEditor) {
        if (!isBrsFile(file)) {
            return;
        }

        // Skip files with nothing to remove — this guarantees needsTranspiled is never
        // set on fully-protected files (e.g. a .brs SDK covered by a src keep rule),
        // preventing the BrighterScript transpiler from running on them.
        if (!this.filesToShake.has(file)) {
            return;
        }

        const removed: string[] = [];

        file.ast.walk(createVisitor({
            FunctionStatement: (stmt) => {
                if (this.toRemove.has(stmt)) {
                    if (removed.length === 0) {
                        // ensure modified AST is emitted for .brs files
                        editor.setProperty(file, 'needsTranspiled', true);
                    }
                    removed.push(stmt.getName(ParseMode.BrightScript) ?? '?');
                    return new EmptyStatement();
                }
            }
        }), { walkMode: WalkMode.visitStatements, editor: editor });

        if (removed.length > 0) {
            this.removalLog.set(file.pkgPath, removed);
        }
    }

    /**
     * Log a single consolidated summary of every function removed across all files.
     * Call this after the shake() loop in Program.beforeProgramTranspile.
     */
    logSummary() {
        if (this.removalLog.size === 0 || !this.logger) {
            return;
        }
        const totalRemoved = [...this.removalLog.values()].reduce((sum, fns) => sum + fns.length, 0);
        this.logger.log(`tree shaker removed ${totalRemoved} function(s) across ${this.removalLog.size} file(s):`);
        for (const [pkgPath, fns] of this.removalLog) {
            this.logger.log(`  ${pkgPath}: ${fns.join(', ')}`);
        }
    }
}
