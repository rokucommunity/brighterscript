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
        'runtask'
    ]);

    // Fully-qualified lowercased function names (BrighterScript style, dots) → statement + file + brsName
    private allFunctions = new Map<string, { statement: FunctionStatement; file: BrsFile; brsName: string }>();

    // Names referenced in CallExpression nodes (both full namespaced and simple names)
    private calledNames = new Set<string>();

    // String literal values that look like identifiers (potential dynamic callFunc / observeField targets)
    private stringRefs = new Set<string>();

    // Functions declared in XML <interface><function name="..."/> elements
    private xmlInterfaceFunctions = new Set<string>();

    // Functions explicitly annotated with @keep — never removed regardless of references
    private keepAnnotated = new Set<string>();

    // Normalized keep rules from config
    private keepRules: NormalizedKeepRule[] = [];

    // Resolved rootDir for src-path matching
    private rootDir = '';

    reset() {
        this.allFunctions.clear();
        this.calledNames.clear();
        this.stringRefs.clear();
        this.xmlInterfaceFunctions.clear();
        this.keepAnnotated.clear();
        this.keepRules = [];
        this.rootDir = '';
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
     */
    analyze(program: Program, keepRules: NormalizedKeepRule[]) {
        this.reset();
        this.keepRules = keepRules;
        this.rootDir = program.options.rootDir ?? process.cwd();

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
    }

    // -------------------------------------------------------------------------
    // Pass 1
    // -------------------------------------------------------------------------

    private collectDefinitions(file: BrsFile) {
        file.ast.walk(createVisitor({
            FunctionStatement: (stmt) => {
                const bsName = stmt.getName(ParseMode.BrighterScript)?.toLowerCase();
                const brsName = stmt.getName(ParseMode.BrightScript)?.toLowerCase();
                if (bsName && brsName) {
                    this.allFunctions.set(bsName, { statement: stmt, file: file, brsName: brsName });
                    if (stmt.annotations?.find(a => a.name.toLowerCase() === 'keep')) {
                        this.keepAnnotated.add(bsName);
                    }
                }
            }
        }), { walkMode: WalkMode.visitStatements });
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
                    // Keep both the fully-qualified name and just the final segment
                    const full = parts.map(p => p.text).join('.').toLowerCase();
                    const simple = parts[parts.length - 1].text.toLowerCase();
                    this.calledNames.add(full);
                    this.calledNames.add(simple);
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
                // named as a string.  We only check names that are actually defined
                // functions to avoid bloating calledNames with every local variable.
                const name = (expr as any).name?.text?.toLowerCase();
                if (name && this.allFunctions.has(name)) {
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
                    if (this.allFunctions.has(full) || this.allFunctions.has(simple)) {
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
     * Returns true when the function with the given fully-qualified lowercased name
     * has no known callers and is not a recognized entry point.
     */
    isUnused(bsName: string): boolean {
        const simpleName = bsName.split('.').pop() ?? bsName;
        return (
            !this.keepAnnotated.has(bsName) &&
            !this.keepAnnotated.has(simpleName) &&
            !TreeShaker.ENTRY_POINTS.has(simpleName) &&
            !TreeShaker.ENTRY_POINTS.has(bsName) &&
            !this.calledNames.has(bsName) &&
            !this.calledNames.has(simpleName) &&
            !this.stringRefs.has(bsName) &&
            !this.stringRefs.has(simpleName) &&
            !this.xmlInterfaceFunctions.has(bsName) &&
            !this.xmlInterfaceFunctions.has(simpleName)
        );
    }

    /**
     * Returns true when the function matches any keep rule from config.
     * Rule fields are ANDed; rules across the list are ORed.
     */
    isKept(bsName: string, brsName: string, file: BrsFile): boolean {
        for (const rule of this.keepRules) {
            if (this.ruleMatches(rule, brsName, file)) {
                return true;
            }
        }
        return false;
    }

    private ruleMatches(rule: NormalizedKeepRule, brsName: string, file: BrsFile): boolean {
        // functions: exact name match (BrightScript/transpiled names)
        if (rule.functions) {
            if (!rule.functions.includes(brsName)) {
                return false;
            }
        }

        // matches: glob/wildcard against function name
        if (rule.matches) {
            const matched = rule.matches.some(pattern => minimatch(brsName, pattern, { nocase: true })
            );
            if (!matched) {
                return false;
            }
        }

        // src: glob against source file path (relative patterns resolved from rootDir)
        if (rule.src) {
            const srcPath = file.srcPath;
            const matched = rule.src.some(pattern => {
                const resolved = path.isAbsolute(pattern)
                    ? pattern
                    : `${this.rootDir}/${pattern}`;
                return minimatch(srcPath, resolved, { nocase: true });
            });
            if (!matched) {
                return false;
            }
        }

        // dest: glob against package-relative destination path (pkgPath)
        if (rule.dest) {
            const pkgPath = file.pkgPath;
            const matched = rule.dest.some(pattern => minimatch(pkgPath, pattern, { nocase: true })
            );
            if (!matched) {
                return false;
            }
        }

        return true;
    }

    // -------------------------------------------------------------------------
    // Shake
    // -------------------------------------------------------------------------

    /**
     * Walk the file and replace every unused FunctionStatement with an EmptyStatement,
     * effectively removing it from transpiled output.
     */
    shake(file: BscFile, editor: AstEditor) {
        if (!isBrsFile(file)) {
            return;
        }

        file.ast.walk(createVisitor({
            FunctionStatement: (stmt) => {
                const bsName = stmt.getName(ParseMode.BrighterScript)?.toLowerCase();
                if (!bsName) {
                    return;
                }
                const entry = this.allFunctions.get(bsName);
                const brsName = entry?.brsName ?? bsName;
                if (this.isUnused(bsName) && !this.isKept(bsName, brsName, file)) {
                    return new EmptyStatement();
                }
            }
        }), { walkMode: WalkMode.visitStatements, editor: editor });
    }
}
