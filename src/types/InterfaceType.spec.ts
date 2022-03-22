import { expect } from 'chai';
import { assert } from 'sinon';
import { SymbolTable } from '../SymbolTable';
import type { BscType } from './BscType';
import { CustomType } from './CustomType';
import { DynamicType } from './DynamicType';
import { IntegerType } from './IntegerType';
import { InterfaceType } from './InterfaceType';
import { ObjectType } from './ObjectType';
import { StringType } from './StringType';

describe('InterfaceType', () => {
    describe('toString', () => {
        it('returns empty curly braces when no members', () => {
            expect(iface({}).toJsString()).to.eql('{}');
        });

        it('includes member types', () => {
            expect(iface({ name: new StringType() }).toJsString()).to.eql('{ name: string; }');
        });

        it('includes nested object types', () => {
            expect(
                iface({
                    name: new StringType(),
                    parent: iface({
                        age: new IntegerType()
                    })
                }
                ).toJsString()
            ).to.eql('{ name: string; parent: { age: integer; }; }');
        });
    });

    describe('isConvertibleTo', () => {
        it('works', () => {
            expectAssignable({
                name: new StringType()
            }, {
                name: new StringType()
            });
        });
    });

    describe('equals', () => {
        it('matches equal objects', () => {
            expect(
                iface({ name: new StringType() }).equals(iface({ name: new StringType() }))
            ).to.be.true;
        });

        it('does not match inequal objects', () => {
            expect(
                iface({ name: new StringType() }).equals(iface({ name: new IntegerType() }))
            ).to.be.false;
        });

        it('ignores order', () => {
            expect(
                iface({ name: new StringType(), age: new IntegerType(), data: new CustomType('data') }).equals(iface({ age: new IntegerType(), data: new CustomType('data'), name: new StringType() }))
            ).to.be.true;
        });
    });

    describe('isAssignableTo', () => {
        it('rejects being assignable to other types', () => {
            expect(
                iface({
                    name: new StringType()
                }).isAssignableTo(new IntegerType())
            ).to.be.false;
        });

        it('matches exact properties', () => {
            expectAssignable({
                name: new StringType()
            }, {
                name: new StringType()
            });
        });

        it('matches an object with more properties being assigned to an object with less', () => {
            expectAssignable({
                name: new StringType()
            }, {
                name: new StringType(),
                age: new IntegerType()
            });
        });

        it('rejects assigning an object with less properties to one with more', () => {
            expectNotAssignable({
                name: new StringType(),
                age: new IntegerType()
            }, {
                name: new StringType()
            });
        });

        it('matches properties in mismatched order', () => {
            const symbolTable1 = makeSymbolTable({
                name: new StringType(),
                age: new IntegerType()
            });
            const symbolTable2 = makeSymbolTable({
                age: new IntegerType(),
                name: new StringType()
            });

            expect(
                new InterfaceType('interfaceOne', symbolTable1).isAssignableTo(new InterfaceType('interfaceTwo', symbolTable2))
            ).to.be.true;
        });

        it('rejects with member having mismatched type', () => {
            expectNotAssignable({
                name: new StringType()
            }, {
                name: new IntegerType()
            });
        });

        it('rejects with object member having mismatched type', () => {
            expectNotAssignable({
                parent: iface({
                    name: new StringType()
                })
            }, {
                parent: iface({
                    name: new IntegerType()
                })
            });
        });

        it('rejects with object member having missing prop type', () => {
            expectNotAssignable({
                parent: iface({
                    name: new StringType(),
                    age: new IntegerType()
                })
            }, {
                parent: iface({
                    name: new StringType()
                })
            });
        });

        it('accepts with object member having same prop types', () => {
            expectAssignable({
                parent: iface({
                    name: new StringType(),
                    age: new IntegerType()
                })
            }, {
                parent: iface({
                    name: new StringType(),
                    age: new IntegerType()
                })
            });
        });

        it('accepts with source member having dynamic prop type', () => {
            expectAssignable({
                parent: iface({
                    name: new StringType(),
                    age: new IntegerType()
                })
            }, {
                parent: new DynamicType()
            });
        });

        it('accepts with target member having dynamic prop type', () => {
            expectAssignable({
                parent: new DynamicType()
            }, {
                parent: iface({
                    name: new StringType(),
                    age: new IntegerType()
                })
            });
        });

        it('accepts with target member having "object" prop type', () => {
            expectAssignable({
                parent: new ObjectType()
            }, {
                parent: iface({
                    name: new StringType(),
                    age: new IntegerType()
                })
            });
        });
    });
});

let ifaceCount = 0;

function iface(members: Record<string, BscType>, name?: string) {
    name = name ?? 'SomeIFace' + ifaceCount;
    ifaceCount++;
    return new InterfaceType(name, makeSymbolTable(members));
}

function makeSymbolTable(members: Record<string, BscType>) {
    const symbols = new SymbolTable();

    for (const key in members) {
        symbols.addSymbol(key, null, members[key]);
    }
    return symbols;
}

function expectAssignable(targetMembers: Record<string, BscType>, sourceMembers: Record<string, BscType>) {
    const targetIface = iface(targetMembers);
    const sourceIface = iface(sourceMembers);
    if (!sourceIface.isAssignableTo(targetIface)) {
        assert.fail(`expected type ${targetIface.toJsString()} to be assignable to type ${sourceIface.toJsString()}`);
    }
}

function expectNotAssignable(targetMembers: Record<string, BscType>, sourceMembers: Record<string, BscType>) {
    const targetIface = iface(targetMembers);
    const sourceIface = iface(sourceMembers);
    if (sourceIface.isAssignableTo(targetIface)) {
        assert.fail(`expected type ${targetIface.toJsString()} to not be assignable to type ${sourceIface.toJsString()}`);
    }
}
