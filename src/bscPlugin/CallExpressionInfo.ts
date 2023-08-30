import type { Expression } from '../parser/AstNode';
import type { CallExpression, CallfuncExpression, NewExpression, VariableExpression } from '../parser/Expression';
import type { ClassStatement, NamespaceStatement } from '../parser/Statement';
import { isCallExpression, isCallfuncExpression, isVariableExpression, isDottedGetExpression, isClassStatement, isNewExpression } from '../astUtils/reflection';
import type { BrsFile } from '../files/BrsFile';
import type { Position } from 'vscode-languageserver-protocol';
import { util } from '../util';
import { ParseMode } from '../parser/Parser';


export enum CallExpressionType {
    namespaceCall = 'namespaceCall',
    call = 'call',
    callFunc = 'callFunc',
    constructorCall = 'constructorCall',
    myClassCall = 'myClassCall',
    otherClassCall = 'otherClassCall',
    unknown = 'unknown'
}

//Util Class, for extracting info about an expression, which can be used in the IDE
export class CallExpressionInfo {
    //the expression that we asked about
    expression?: Expression;

    //the contextually relevant callExpression, which relates to it
    callExpression?: CallExpression | CallfuncExpression;
    type: CallExpressionType;

    file: BrsFile;
    myClass: ClassStatement;
    namespace: NamespaceStatement;
    dotPart: string;
    name: string;
    isCallingMethodOnMyClass: boolean;
    newExpression: NewExpression;

    //the index of expression, when considered as a param fo callExpression
    parameterIndex: number;

    private position: Position;

    constructor(file: BrsFile, position: Position) {
        this.expression = file.ast.findChildAtPosition<Expression>(position);
        this.file = file;
        this.position = position;
        this.process();
    }

    private process() {

        this.callExpression = this.ascertainCallExpression();
        let callExpression = this.callExpression;
        if (!callExpression) {
            this.type = CallExpressionType.unknown;
            return;
        }

        if (!this.isPositionBetweenParentheses()) {
            return;
        }
        this.isCallingMethodOnMyClass = false;

        if (isNewExpression(callExpression.parent)) {
            this.name = callExpression.parent.className.getName(ParseMode.BrighterScript);
            this.newExpression = callExpression.parent;
        }
        if (isCallfuncExpression(callExpression)) {
            this.name = callExpression.methodName.text;
        } else if (isVariableExpression(callExpression.callee)) {
            this.name = callExpression.callee.name.text;
        } else if (isVariableExpression(callExpression)) {
            this.name = (callExpression as VariableExpression).name.text;
        } else if (isDottedGetExpression(callExpression.callee)) {
            this.name = callExpression.callee.name.text;
            if (isDottedGetExpression(callExpression.callee) && isVariableExpression(callExpression.callee.obj)) {
                this.isCallingMethodOnMyClass = callExpression.callee.obj.name.text === 'm';

            } else {
                let parts = util.getAllDottedGetParts(callExpression.callee);
                parts.splice(parts?.length - 1, 1);
                this.dotPart = parts.map(x => x.text).join('.');
                this.namespace = this.getNamespace(this.dotPart, this.file);
            }
        }

        this.myClass = this.expression.findAncestor<ClassStatement>(isClassStatement);
        this.type = this.ascertainType();
        this.parameterIndex = this.getParameterIndex();
    }

    isPositionBetweenParentheses() {
        let boundingRange = util.createBoundingRange(this.callExpression.openingParen, this.callExpression.closingParen);
        return util.rangeContains(boundingRange, this.position);
    }

    ascertainCallExpression(): CallExpression | CallfuncExpression {
        let expression = this.expression;
        function isCallFuncOrCallExpression(expression: Expression) {
            return isCallfuncExpression(expression) || isCallExpression(expression);
        }

        let callExpression = expression?.findAncestor<CallExpression | CallfuncExpression>(isCallFuncOrCallExpression);
        if (callExpression && callExpression.callee === expression) {
            //this expression is the NAME of a CallExpression
            callExpression = expression.parent.findAncestor<CallExpression | CallfuncExpression>(isCallFuncOrCallExpression);
        } else if (isDottedGetExpression(expression.parent) && expression.parent.parent === callExpression) {
            callExpression = callExpression.findAncestor<CallExpression | CallfuncExpression>(isCallFuncOrCallExpression);
        }

        if (!callExpression && isCallExpression(expression)) {
            //let's check to see if we are in a space, in the args of a valid CallExpression
            let boundingRange = util.createBoundingRange(expression.openingParen, expression.closingParen);
            if (util.rangeContains(boundingRange, this.position)) {
                callExpression = expression;
            }
        }

        return callExpression;
    }

    ascertainType(): CallExpressionType {
        if (this.name) {
            //General case, for function calls
            if (this.newExpression) {
                return CallExpressionType.constructorCall;
            } else if (this.isCallingMethodOnMyClass && this.myClass) {
                return CallExpressionType.myClassCall;
            } else if (!this.namespace && isDottedGetExpression(this.callExpression)) {
                return CallExpressionType.otherClassCall;
            } else if (isCallfuncExpression(this.callExpression)) {
                return CallExpressionType.callFunc;

            } else if (this.namespace) {
                return CallExpressionType.namespaceCall;
            } else {
                return CallExpressionType.call;
            }
        }

        return CallExpressionType.unknown;

    }

    private getNamespace(dotPart: string, file: BrsFile): any {
        let scope = this.file.program.getFirstScopeForFile(this.file);
        return scope.namespaceLookup.get(this.dotPart);
    }

    private getParameterIndex() {
        for (let i = this.callExpression.args.length - 1; i > -1; i--) {
            let argExpression = this.callExpression.args[i];
            let comparison = util.comparePositionToRange(this.position, argExpression.range);
            if (comparison >= 0) {
                return i + comparison;
            }
        }

        return 0;

    }

}

