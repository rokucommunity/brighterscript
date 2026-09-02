import type { Range } from 'vscode-languageserver-protocol';
import { InlayHintKind } from 'vscode-languageserver-protocol';
import {
    isBrsFile,
    isClassStatement,
    isDottedGetExpression,
    isFunctionStatement,
    isMethodStatement,
    isNamespaceStatement,
    isNewExpression,
    isVariableExpression,
    isXmlScope
} from '../../astUtils/reflection';
import { WalkMode, createVisitor } from '../../astUtils/visitors';
import type { BrsFile } from '../../files/BrsFile';
import type { ProvideInlayHintsEvent } from '../../interfaces';
import type { CallExpression, CallfuncExpression, FunctionParameterExpression } from '../../parser/Expression';
import type { ClassStatement, FunctionStatement, MethodStatement, NamespaceStatement } from '../../parser/Statement';
import { ParseMode } from '../../parser/Parser';
import { util } from '../../util';
import type { XmlScope } from '../../XmlScope';

export class InlayHintProcessor {
    public constructor(
        public event: ProvideInlayHintsEvent
    ) { }

    public process() {
        if (!isBrsFile(this.event.file)) {
            return;
        }
        this.collectParameterNameHints(this.event.file);
    }

    private collectParameterNameHints(file: BrsFile) {
        const range = this.event.range;

        file.ast.walk(createVisitor({
            CallExpression: (call) => {
                if (!call.range || !util.rangesIntersectOrTouch(call.range, range)) {
                    return;
                }
                this.emitParameterNameHints(file, call);
            },
            CallfuncExpression: (call) => {
                if (!call.range || !util.rangesIntersectOrTouch(call.range, range)) {
                    return;
                }
                this.emitParameterNameHintsForCallfunc(file, call);
            }
        }), {
            walkMode: WalkMode.visitAllRecursive
        });
    }

    private emitParameterNameHints(file: BrsFile, call: CallExpression) {
        if (!call.args || call.args.length === 0) {
            return;
        }

        const params = this.resolveCallParameters(file, call);
        if (!params) {
            return;
        }

        this.pushHintsForArgs(call.args, params);
    }

    private emitParameterNameHintsForCallfunc(file: BrsFile, call: CallfuncExpression) {
        if (!call.args || call.args.length === 0) {
            return;
        }
        const name = call.methodName?.text;
        if (!name) {
            return;
        }
        const params = this.resolveCallfuncParameters(file, name);
        if (!params) {
            return;
        }
        this.pushHintsForArgs(call.args, params);
    }

    /**
     * For a CallExpression, find the function/method being called and return its parameter list,
     * or undefined if the target cannot be uniquely resolved.
     */
    private resolveCallParameters(file: BrsFile, call: CallExpression): FunctionParameterExpression[] | undefined {
        //constructor: `new Foo(...)`
        if (isNewExpression(call.parent)) {
            const className = call.parent.className.getName(ParseMode.BrighterScript);
            const classLink = file.getClassFileLink(className);
            if (!classLink) {
                return undefined;
            }
            const ctor = file.getClassMethod(classLink.item, 'new');
            return ctor?.func?.parameters;
        }

        const callee = call.callee;

        //plain function call: `foo(...)`
        if (isVariableExpression(callee)) {
            const name = callee.name.text;
            const containingNamespace = callee.findAncestor<NamespaceStatement>(isNamespaceStatement)?.getName(ParseMode.BrighterScript);
            return this.lookupFunctionParameters(file, name, containingNamespace);
        }

        //namespace call or method call: `ns.foo(...)` / `m.foo(...)` / `instance.foo(...)`
        if (isDottedGetExpression(callee)) {
            const name = callee.name.text;
            const parts = util.getAllDottedGetParts(callee);
            if (!parts || parts.length < 2) {
                return undefined;
            }
            //drop the last part (the function name) to get the namespace/receiver path
            const dotPart = parts.slice(0, parts.length - 1).map(x => x.text).join('.');

            //prefer namespace lookup when the dotPart is a known namespace
            const scope = file.program.getFirstScopeForFile(file);
            const namespace = scope?.namespaceLookup?.get(dotPart.toLowerCase());
            if (namespace) {
                return this.lookupFunctionParameters(file, name, dotPart);
            }

            //otherwise, treat as method call on m or another receiver - look across class methods
            return this.lookupClassMethodParameters(file, callee, name);
        }

        return undefined;
    }

    private lookupFunctionParameters(file: BrsFile, name: string, namespaceName?: string): FunctionParameterExpression[] | undefined {
        const matches = file.program.getStatementsByName(name, file, namespaceName);
        if (matches.length !== 1) {
            return undefined;
        }
        const statement = matches[0].item;
        if (isFunctionStatement(statement) || isMethodStatement(statement)) {
            return (statement as FunctionStatement | MethodStatement).func?.parameters;
        }
        return undefined;
    }

    /**
     * For a method call like `m.foo(...)`, find a uniquely-resolvable method statement.
     * If the receiver is `m`, prefer the enclosing class. Otherwise fall back to a name search
     * across all classes (only used when there's exactly one match).
     */
    private lookupClassMethodParameters(file: BrsFile, callee: { obj?: any }, name: string): FunctionParameterExpression[] | undefined {
        if (isVariableExpression(callee.obj) && callee.obj.name.text === 'm') {
            const enclosingClass = callee.obj.findAncestor<ClassStatement>(isClassStatement);
            if (enclosingClass) {
                const method = file.getClassMethod(enclosingClass, name, true);
                if (method) {
                    return method.func?.parameters;
                }
            }
        }

        //fallback: search all classes for a single matching method name
        const matches = file.program.getStatementsByName(name, file).filter(link => isClassStatement(link.item.parent));
        if (matches.length !== 1) {
            return undefined;
        }
        const statement = matches[0].item;
        if (isMethodStatement(statement) || isFunctionStatement(statement)) {
            return (statement as FunctionStatement | MethodStatement).func?.parameters;
        }
        return undefined;
    }

    private resolveCallfuncParameters(file: BrsFile, name: string): FunctionParameterExpression[] | undefined {
        //callfunc invocations are dispatched through XML components - look across xml scopes for a function with this name
        const matches = file.program.getScopes()
            .filter(scope => isXmlScope(scope))
            .flatMap(scope => file.program.getStatementsForXmlFile(scope as XmlScope, name));

        if (matches.length !== 1) {
            return undefined;
        }
        const statement = matches[0].item;
        if (isFunctionStatement(statement) || isMethodStatement(statement)) {
            return (statement as FunctionStatement | MethodStatement).func?.parameters;
        }
        return undefined;
    }

    private pushHintsForArgs(args: Array<{ range?: Range }>, params: FunctionParameterExpression[]) {
        for (let i = 0; i < args.length && i < params.length; i++) {
            const arg = args[i];
            const param = params[i];
            const paramName = param?.name?.text;
            if (!paramName || !arg?.range) {
                continue;
            }
            //skip when the argument is just an identifier that already matches the parameter name
            if (isVariableExpression(arg as any) && (arg as any).name?.text?.toLowerCase() === paramName.toLowerCase()) {
                continue;
            }
            this.event.inlayHints.push({
                position: arg.range.start,
                label: `${paramName}:`,
                kind: InlayHintKind.Parameter,
                paddingRight: true
            });
        }
    }
}

