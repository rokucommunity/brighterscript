import type { Position } from 'vscode-languageserver-protocol';
import { CancellationTokenSource } from 'vscode-languageserver-protocol';
import type { Expression } from '../parser/Expression';
import type { Body, Statement } from '../parser/Statement';
import util from '../util';
import { isCallfuncExpression, isClassStatement, isFunctionExpression, isNewExpression, isCallExpression } from './reflection';
import { WalkMode } from './visitors';


export enum ExpressionChainStatementInfoType {
    none = 'none',
    callFunc = 'callFunc',
    dottedGet = 'dottedGet',
    enum = 'enum',
    interface = 'interface',
    new = 'new'
}

export interface ExpressionChainStatementInfo {
    argIndex: number;
    statementType: ExpressionChainStatementInfoType;
    name: string;
    dotPart: string;
    expression?: Expression | Statement;
}
export default class ExpressionChain {

    expressions: Array<Expression | Statement> = [];
    position: Position;

    constructor(ast: Body, position: Position) {
        this.expressions = this.findExpressionsAtPosition(ast, position);
        this.position = position;
    }

    public getClosestAstNode<T>(matcher: (item: Expression | Statement) => boolean = () => true) {
        return this.expressions.reverse().find(matcher) as unknown as T;
    }
    public getClosestStatementInfo<T>(matcher: (item: Expression | Statement) => boolean = () => true): ExpressionChainStatementInfo {
        let info: ExpressionChainStatementInfo = {
            argIndex: 0,
            statementType: ExpressionChainStatementInfoType.none,
            name: '',
            dotPart: ''
        };
        let expression: Expression | Statement = this.getClosestAstNode(matcher);
        info.expression = expression;
        if (isNewExpression(info.expression)) {
            let parts = util.getAllDottedGetParts(info.expression.call.callee);
            info.statementType = ExpressionChainStatementInfoType.new;
            info.name = parts.pop().text;
            info.dotPart = parts.join('.');
            info.argIndex = this.getArgIndex(info.expression.call.args, this.position);
        } else if (isCallfuncExpression(info.expression)) {
            let parts = util.getAllDottedGetParts(info.expression.callee);
            info.statementType = ExpressionChainStatementInfoType.callFunc;
            info.name = info.expression.methodName.text;
            info.dotPart = parts.join('.');
            info.argIndex = this.getArgIndex(info.expression.args, this.position);
        } else if (isCallExpression(info.expression)) {
            let parts = util.getAllDottedGetParts(info.expression.callee);
            info.statementType = ExpressionChainStatementInfoType.dottedGet;
            info.name = parts.pop().text;
            info.dotPart = parts.join('.');
            info.argIndex = this.getArgIndex(info.expression.args, this.position);
        }
        return info;
    }

    private getArgIndex(args: Expression[], position: Position) {
        for (let index = args.length - 1; index >= 0; index--) {
            if (util.rangeContains(args[index].range, position)) {
                return index;
            }
        }
        return 0;
    }

    private findExpressionsAtPosition(ast: Body, position: Position) {
        let expressionChain: Array<Expression | Statement> = [];
        let cancellationToken = new CancellationTokenSource();
        ast.walk((expression) => {
            if (isClassStatement(expression)) {

                if (expression.parentClassName && util.rangeContains(expression.parentClassName?.range, position)) {
                    expressionChain.push(expression);
                    expressionChain.push(expression.parentClassName);
                } else if (util.rangeContains(expression.name.range, position)) {
                    //do we want to add the name directly here?
                    expressionChain.push(expression);
                } else if (util.rangeContains(expression.range, position)) {
                    expressionChain.push(expression);
                }
            } else if (util.rangeContains(expression.range, position)) {
                expressionChain.push(expression);
            } else if (isFunctionExpression(expression) && util.rangeContains(expression.functionStatement.name.range, position)) {
                expressionChain.push(expression);
            } else {
                // if (expressionChain.length) {
                //     cancellationToken.cancel();
                // }
            }
        }, { walkMode: WalkMode.visitAllRecursive, cancel: cancellationToken.token });

        return expressionChain;
    }

}
