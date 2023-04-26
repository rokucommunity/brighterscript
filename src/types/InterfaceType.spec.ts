import { expect } from '../chai-config.spec';
import { assert } from 'sinon';
import type { BscType } from './BscType';
import { DynamicType } from './DynamicType';
import { IntegerType } from './IntegerType';
import { InterfaceType } from './InterfaceType';
import { ObjectType } from './ObjectType';
import { StringType } from './StringType';
import type { ReferenceType } from './ReferenceType';
import { SymbolTypeFlags } from '../SymbolTable';

describe('InterfaceType', () => {
    describe('toJSString', () => {
        it('returns empty curly braces when no members', () => {
            expect(iface({}).toJSString()).to.eql('{}');
        });

        it('includes member types', () => {
            expect(iface({ name: new StringType() }).toJSString()).to.eql('{ name: string; }');
        });

        it('includes nested object types', () => {
            expect(
                iface({
                    name: new StringType(),
                    parent: iface({
                        age: new IntegerType()
                    })
                }
                ).toJSString()
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
            const ifaceOne = iface({
                name: new StringType(),
                age: new IntegerType()
            });
            const ifaceTwo = iface({
                age: new IntegerType(),
                name: new StringType()
            });

            expect(ifaceOne.isAssignableTo(ifaceTwo)).to.be.true;
            expect(ifaceTwo.isAssignableTo(ifaceOne)).to.be.true;
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

        it('accepts with source member having dyanmic prop type', () => {
            expectAssignable({
                parent: iface({
                    name: new StringType(),
                    age: new IntegerType()
                })
            }, {
                parent: new DynamicType()
            });
        });

        it('accepts with target member having dyanmic prop type', () => {
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

function iface(members: Record<string, BscType>, name?: string, parentType?: InterfaceType | ReferenceType) {
    name = name ?? 'SomeIFace' + ifaceCount;
    ifaceCount++;
    const ifaceType = new InterfaceType(name, parentType);

    for (const key in members) {
        ifaceType.addMember(key, null, members[key], SymbolTypeFlags.runtime);
    }
    return ifaceType;
}

function expectAssignable(targetMembers: Record<string, BscType>, sourceMembers: Record<string, BscType>) {
    const targetIface = iface(targetMembers);
    const sourceIface = iface(sourceMembers);
    if (!sourceIface.isAssignableTo(targetIface)) {
        assert.fail(`expected type ${targetIface.toJSString()} to be assignable to type ${sourceIface.toJSString()}`);
    }
}

function expectNotAssignable(targetMembers: Record<string, BscType>, sourceMembers: Record<string, BscType>) {
    const targetIface = iface(targetMembers);
    const sourceIface = iface(sourceMembers);
    if (sourceIface.isAssignableTo(targetIface)) {
        assert.fail(`expected type ${targetIface.toJSString()} to not be assignable to type ${sourceIface.toJSString()}`);
    }
}
