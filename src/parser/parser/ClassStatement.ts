import { Token, Identifier } from '../lexer';
import { Statement } from './Statement';
import { TranspileState, FunctionExpression, indent } from './Expression';
import { SourceNode } from 'source-map';

export class ClassStatement implements Statement {

    constructor(
        readonly keyword: Token,
        readonly name: Identifier,
        readonly members: ClassMemberStatement[],
        readonly end: Token
    ) {
        this.members = this.members ?? [];
        for (let member of this.members) {
            if (member instanceof ClassMethodStatement) {
                this.methods.push(member);
            } else if (member instanceof ClassFieldStatement) {
                this.fields.push(member);
            } else {
                throw new Error(`Critical error: unknown member type added to class definition ${this.name}`);
            }
        }
    }

    public methods = [] as ClassMethodStatement[];
    public fields = [] as ClassFieldStatement[];

    get location() {
        return {
            file: this.keyword.location.file,
            start: this.keyword.location.start,
            end: this.end.location.end
        };
    }

    transpile(state: TranspileState): Array<SourceNode | string> {
        let result = [];
        //make the builder
        result.push(...this.getTranspiledBuilder(state));
        result.push(
            '\n',
            indent(state)
        );
        //make the class assembler (i.e. the public-facing class creator method)
        result.push(...this.getTranspiledAssembler(state));
        return result;
    }

    private get builderName() {
        return `__${this.name.text}_builder`;
    }

    /**
     * Get the constructor function for this class (if exists), or undefined if not exist
     */
    private getConstructorFunction() {
        for (let member of this.members) {
            if (member.name?.text?.toLowerCase() === 'new') {
                return member as ClassMethodStatement;
            }
        }
    }

    private getTranspiledBuilder(state: TranspileState) {
        let result = [];
        result.push(`function ${this.builderName}()\n`);
        state.blockDepth++;
        //indent
        result.push(indent(state));
        //create the instance
        result.push('instance = {}\n');
        result.push(indent(state));

        //if this class doesn't have a constructor function, create an empty one (to simplify the transpile process)
        if (!this.getConstructorFunction()) {
            result.push(
                `instance.new = sub()\n`,
                indent(state),
                'end sub'
            );
        }

        for (let member of this.members) {
            //fields
            if (member instanceof ClassFieldStatement) {
                // add and initialize all fields to null
                result.push(`instance.${member.name.text} = invalid\n`);

                //methods
            } else if (member instanceof ClassMethodStatement) {
                result.push(`instance.`);
                result.push(
                    new SourceNode(member.name.location.start.line, member.name.location.start.column, member.name.text),
                    ' = ',
                    ...member.func.transpile(state),
                    '\n'
                );
            }
            result.push(indent(state));
        }
        //return the instance
        result.push('return instance\n');
        state.blockDepth--;
        result.push(indent(state));
        result.push(`end function`);
        return result;
    }
    private getTranspiledAssembler(state: TranspileState) {
        let result = [];
        const constructorFunction = this.getConstructorFunction();
        const constructorParams = constructorFunction ? constructorFunction.func.parameters : [];

        result.push(`function ${this.name.text}(`);
        let i = 0;
        for (let param of constructorParams) {
            if (i > 0) {
                result.push(', ');
            }
            result.push(
                param.transpile(state)
            );
            i++;
        }
        result.push(
            ')',
            '\n'
        );

        state.blockDepth++;
        result.push(indent(state));
        result.push(`instance = ${this.builderName}()\n`);

        result.push(indent(state));
        result.push(`instance.new(`);

        //append constructor arguments
        i = 0;
        for (let param of constructorParams) {
            if (i > 0) {
                result.push(', ');
            }
            result.push(
                new SourceNode(param.location.start.line, param.location.start.column, param.name.text)
            );
            i++;
        }
        result.push(
            ')',
            '\n'
        );

        result.push(indent(state));
        result.push(`return instance\n`);

        state.blockDepth--;
        result.push(indent(state));
        result.push(`end function`);
        return result;
    }
}

export class ClassMethodStatement implements Statement {
    constructor(
        readonly accessModifier: Token,
        readonly name: Identifier,
        readonly func: FunctionExpression
    ) { }

    get location() {
        return {
            file: this.name.location.file,
            start: this.accessModifier ? this.accessModifier.location.start : this.func.location.start,
            end: this.func.location.end
        };
    }

    transpile(state: TranspileState): Array<SourceNode | string> {
        throw new Error('transpile not implemented for ' + Object.getPrototypeOf(this).constructor.name);
    }
}

export class ClassFieldStatement implements Statement {

    constructor(
        readonly accessModifier?: Token,
        readonly name?: Identifier,
        readonly as?: Token,
        readonly type?: Token
    ) {

    }

    get location() {
        return {
            file: this.name.location.file,
            start: this.accessModifier.location.start,
            end: this.type.location.end
        };
    }

    transpile(state: TranspileState): Array<SourceNode | string> {
        throw new Error('transpile not implemented for ' + Object.getPrototypeOf(this).constructor.name);
    }
}
export type ClassMemberStatement = ClassFieldStatement | ClassMethodStatement;
