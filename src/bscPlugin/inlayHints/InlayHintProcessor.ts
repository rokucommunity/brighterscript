import { InlayHintKind } from 'vscode-languageserver-protocol';
import {
    isBrsCodeSegment,
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
import type { BrsCodeSegment } from '../../files/BrsCodeSegment';
import type { ProvideInlayHintsEvent } from '../../interfaces';
import type { CallExpression, CallfuncExpression, DottedGetExpression, FunctionParameterExpression } from '../../parser/Expression';
import type { Expression } from '../../parser/AstNode';
import type { ClassStatement, FunctionStatement, MethodStatement, NamespaceStatement } from '../../parser/Statement';
import { ParseMode } from '../../parser/Parser';
import { util } from '../../util';
import type { XmlScope } from '../../XmlScope';

export class InlayHintProcessor {
    public constructor(
        public event: ProvideInlayHintsEvent
    ) { }

    public process() {
        if (!isBrsCodeSegment(this.event.codeSegment)) {
            return;
        }
        this.collectParameterNameHints(this.event.codeSegment);
    }

    private collectParameterNameHints(code: BrsCodeSegment) {
        const range = this.event.range;

        code.ast.walk(createVisitor({
            CallExpression: (call) => {
                if (!call.location?.range || !util.rangesIntersectOrTouch(call.location.range, range)) {
                    return;
                }
                this.emitParameterNameHints(code, call);
            },
            CallfuncExpression: (call) => {
                if (!call.location?.range || !util.rangesIntersectOrTouch(call.location.range, range)) {
                    return;
                }
                this.emitParameterNameHintsForCallfunc(code, call);
            }
        }), {
            walkMode: WalkMode.visitAllRecursive
        });
    }

    private emitParameterNameHints(code: BrsCodeSegment, call: CallExpression) {
        if (!call.args || call.args.length === 0) {
            return;
        }

        const params = this.resolveCallParameters(code, call);
        if (!params) {
            return;
        }

        this.pushHintsForArgs(call.args, params);
    }

    private emitParameterNameHintsForCallfunc(code: BrsCodeSegment, call: CallfuncExpression) {
        if (!call.args || call.args.length === 0) {
            return;
        }
        const name = call.tokens.methodName?.text;
        if (!name) {
            return;
        }
        const params = this.resolveCallfuncParameters(code, name);
        if (!params) {
            return;
        }
        this.pushHintsForArgs(call.args, params);
    }

    /**
     * For a CallExpression, find the function/method being called and return its parameter list,
     * or undefined if the target cannot be uniquely resolved.
     */
    private resolveCallParameters(code: BrsCodeSegment, call: CallExpression): FunctionParameterExpression[] | undefined {
        //constructor: `new Foo(...)`
        if (isNewExpression(call.parent)) {
            const className = call.parent.className.getName(ParseMode.BrighterScript);
            const classLink = code.getClassFileLink(className);
            if (!classLink) {
                return undefined;
            }
            const ctor = code.getClassMethod(classLink.item, 'new');
            return ctor?.func?.parameters;
        }

        const callee = call.callee;

        //plain function call: `foo(...)`
        if (isVariableExpression(callee)) {
            const name = callee.tokens.name.text;
            const containingNamespace = callee.findAncestor<NamespaceStatement>(isNamespaceStatement)?.getName(ParseMode.BrighterScript);
            return this.lookupFunctionParameters(code, name, containingNamespace);
        }

        //namespace call or method call: `ns.foo(...)` / `m.foo(...)` / `instance.foo(...)`
        if (isDottedGetExpression(callee)) {
            const name = callee.tokens.name.text;
            const parts = util.getAllDottedGetParts(callee);
            if (!parts || parts.length < 2) {
                return undefined;
            }
            //drop the last part (the function name) to get the namespace/receiver path
            const dotPart = parts.slice(0, parts.length - 1).map(x => x.text).join('.');

            //prefer namespace lookup when the dotPart is a known namespace
            const scope = code.program.getFirstScopeForCodeSegment(code);
            const namespace = scope?.namespaceLookup?.get(dotPart.toLowerCase());
            if (namespace) {
                return this.lookupFunctionParameters(code, name, dotPart);
            }

            //otherwise, treat as method call on m or another receiver - look across class methods
            return this.lookupClassMethodParameters(code, callee, name);
        }

        return undefined;
    }

    private lookupFunctionParameters(code: BrsCodeSegment, name: string, namespaceName?: string): FunctionParameterExpression[] | undefined {
        const matches = code.program.getStatementsByName(name, code, namespaceName);
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
    private lookupClassMethodParameters(code: BrsCodeSegment, callee: DottedGetExpression, name: string): FunctionParameterExpression[] | undefined {
        if (isVariableExpression(callee.obj) && callee.obj.tokens.name.text === 'm') {
            const enclosingClass = callee.obj.findAncestor<ClassStatement>(isClassStatement);
            if (enclosingClass) {
                const method = code.getClassMethod(enclosingClass, name, true);
                if (method) {
                    return method.func?.parameters;
                }
            }
        }

        //fallback: search all classes for a single matching method name
        const matches = code.program.getStatementsByName(name, code).filter(link => isClassStatement(link.item.parent));
        if (matches.length !== 1) {
            return undefined;
        }
        const statement = matches[0].item;
        if (isMethodStatement(statement) || isFunctionStatement(statement)) {
            return (statement as FunctionStatement | MethodStatement).func?.parameters;
        }
        return undefined;
    }

    private resolveCallfuncParameters(code: BrsCodeSegment, name: string): FunctionParameterExpression[] | undefined {
        //callfunc invocations are dispatched through XML components - look across xml scopes for a function with this name
        const matches = code.program.getScopes()
            .filter(scope => isXmlScope(scope))
            .flatMap(scope => code.program.getStatementsForXmlFile(scope as XmlScope, name));

        if (matches.length !== 1) {
            return undefined;
        }
        const statement = matches[0].item;
        if (isFunctionStatement(statement) || isMethodStatement(statement)) {
            return (statement as FunctionStatement | MethodStatement).func?.parameters;
        }
        return undefined;
    }

    private pushHintsForArgs(args: Expression[], params: FunctionParameterExpression[]) {
        for (let i = 0; i < args.length && i < params.length; i++) {
            const arg = args[i];
            const param = params[i];
            const paramName = param?.tokens?.name?.text;
            const argRange = arg?.location?.range;
            if (!paramName || !argRange) {
                continue;
            }
            //skip when the argument is just an identifier that already matches the parameter name
            if (isVariableExpression(arg) && arg.tokens.name?.text?.toLowerCase() === paramName.toLowerCase()) {
                continue;
            }
            this.event.inlayHints.push({
                position: argRange.start,
                label: `${paramName}:`,
                kind: InlayHintKind.Parameter,
                paddingRight: true
            });
        }
    }
}

