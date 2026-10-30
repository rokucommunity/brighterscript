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

    private collectParameterNameHints(codeSegment: BrsCodeSegment) {
        const range = this.event.range;

        codeSegment.ast.walk(createVisitor({
            CallExpression: (call) => {
                const callRange = util.getLocation(call)?.range;
                if (!callRange || !util.rangesIntersectOrTouch(callRange, range)) {
                    return;
                }
                this.emitParameterNameHints(codeSegment, call);
            },
            CallfuncExpression: (call) => {
                const callRange = util.getLocation(call)?.range;
                if (!callRange || !util.rangesIntersectOrTouch(callRange, range)) {
                    return;
                }
                this.emitParameterNameHintsForCallfunc(codeSegment, call);
            }
        }), {
            walkMode: WalkMode.visitAllRecursive
        });
    }

    private emitParameterNameHints(codeSegment: BrsCodeSegment, call: CallExpression) {
        if (!call.args || call.args.length === 0) {
            return;
        }

        const params = this.resolveCallParameters(codeSegment, call);
        if (!params) {
            return;
        }

        this.pushHintsForArgs(call.args, params);
    }

    private emitParameterNameHintsForCallfunc(codeSegment: BrsCodeSegment, call: CallfuncExpression) {
        if (!call.args || call.args.length === 0) {
            return;
        }
        const name = call.tokens.methodName?.text;
        if (!name) {
            return;
        }
        const params = this.resolveCallfuncParameters(codeSegment, name);
        if (!params) {
            return;
        }
        this.pushHintsForArgs(call.args, params);
    }

    /**
     * For a CallExpression, find the function/method being called and return its parameter list,
     * or undefined if the target cannot be uniquely resolved.
     */
    private resolveCallParameters(codeSegment: BrsCodeSegment, call: CallExpression): FunctionParameterExpression[] | undefined {
        //constructor: `new Foo(...)`
        if (isNewExpression(call.parent)) {
            const className = call.parent.className.getName(ParseMode.BrighterScript);
            const classLink = codeSegment.getClassFileLink(className);
            if (!classLink) {
                return undefined;
            }
            const ctor = codeSegment.getClassMethod(classLink.item, 'new');
            return ctor?.func?.parameters;
        }

        const callee = call.callee;

        //plain function call: `foo(...)`
        if (isVariableExpression(callee)) {
            const name = callee.tokens.name.text;
            const containingNamespace = callee.findAncestor<NamespaceStatement>(isNamespaceStatement)?.getName(ParseMode.BrighterScript);
            return this.lookupFunctionParameters(codeSegment, name, containingNamespace);
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
            const scope = codeSegment.program.getFirstScopeForCodeSegment(codeSegment);
            const namespace = scope?.namespaceLookup?.get(dotPart.toLowerCase());
            if (namespace) {
                return this.lookupFunctionParameters(codeSegment, name, dotPart);
            }

            //otherwise, treat as method call on m or another receiver - look across class methods
            return this.lookupClassMethodParameters(codeSegment, callee, name);
        }

        return undefined;
    }

    private lookupFunctionParameters(codeSegment: BrsCodeSegment, name: string, namespaceName?: string): FunctionParameterExpression[] | undefined {
        const matches = codeSegment.program.getStatementsByName(name, codeSegment, namespaceName);
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
    private lookupClassMethodParameters(codeSegment: BrsCodeSegment, callee: DottedGetExpression, name: string): FunctionParameterExpression[] | undefined {
        if (isVariableExpression(callee.obj) && callee.obj.tokens.name.text === 'm') {
            const enclosingClass = callee.obj.findAncestor<ClassStatement>(isClassStatement);
            if (enclosingClass) {
                const method = codeSegment.getClassMethod(enclosingClass, name, true);
                if (method) {
                    return method.func?.parameters;
                }
            }
        }

        //fallback: search all classes for a single matching method name
        const matches = codeSegment.program.getStatementsByName(name, codeSegment).filter(link => isClassStatement(link.item.parent));
        if (matches.length !== 1) {
            return undefined;
        }
        const statement = matches[0].item;
        if (isMethodStatement(statement) || isFunctionStatement(statement)) {
            return (statement as FunctionStatement | MethodStatement).func?.parameters;
        }
        return undefined;
    }

    private resolveCallfuncParameters(codeSegment: BrsCodeSegment, name: string): FunctionParameterExpression[] | undefined {
        //callfunc invocations are dispatched through XML components - look across xml scopes for a function with this name
        const matches = codeSegment.program.getScopes()
            .filter(scope => isXmlScope(scope))
            .flatMap(scope => codeSegment.program.getStatementsForXmlFile(scope as XmlScope, name));

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
            const argRange = util.getLocation(arg)?.range;
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

