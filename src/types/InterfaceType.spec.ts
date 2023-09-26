import { expect } from '../chai-config.spec';
import { assert } from 'sinon';
import type { BscType } from './BscType';
import { DynamicType } from './DynamicType';
import { IntegerType } from './IntegerType';
import { InterfaceType } from './InterfaceType';
import { ObjectType } from './ObjectType';
import { StringType } from './StringType';
import type { ReferenceType } from './ReferenceType';
import { SymbolTypeFlag } from '../SymbolTable';

describe('InterfaceType', () => {
    describe('toJSString', () => {
        it('returns empty curly braces when no members', () => {
            expect((iface({}) as any).toJSString()).to.eql('{}');
        });

        it('includes member types', () => {
            expect((iface({ name: new StringType() }) as any).toJSString()).to.eql('{ name: string; }');
        });

        it('includes nested object types', () => {
            expect(
                (iface({
                    name: new StringType(),
                    parent: iface({
                        age: new IntegerType()
                    })
                }
                ) as any).toJSString()
            ).to.eql('{ name: string; parent: { age: integer; }; }');
        });
    });

    describe('isTypeCompatible', () => {
        it('works', () => {
            expectCompatible({
                name: new StringType()
            }, {
                name: new StringType()
            });
        });
    });

    describe('equals', () => {
        it('matches same objects', () => {
            const ifaceObj = iface({ name: new StringType() });
            expect(ifaceObj.isEqual(ifaceObj)).to.be.true;
        });
        it('does not match interfaces with same members', () => {
            expect(
                iface({ name: new StringType() }).isEqual(iface({ name: new StringType() }))
            ).to.be.false;
        });


        it('does not match inequal objects', () => {
            expect(
                iface({ name: new StringType() }).isEqual(iface({ name: new IntegerType() }))
            ).to.be.false;
        });
    });

    describe('isTypeCompatible', () => {
        it('rejects being able to assign other types to this', () => {
            expect(
                iface({
                    name: new StringType()
                }).isTypeCompatible(new IntegerType())
            ).to.be.false;
        });

        it('matches exact properties', () => {
            expectCompatible({
                name: new StringType()
            }, {
                name: new StringType()
            });
        });

        it('matches an object with more properties being assigned to an object with less', () => {
            expectCompatible({
                name: new StringType()
            }, {
                name: new StringType(),
                age: new IntegerType()
            });
        });

        it('rejects assigning an object with less properties to one with more', () => {
            expectNotCompatible({
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

            expect(ifaceOne.isTypeCompatible(ifaceTwo)).to.be.true;
            expect(ifaceTwo.isTypeCompatible(ifaceOne)).to.be.true;
        });

        it('rejects with member having mismatched type', () => {
            expectNotCompatible({
                name: new StringType()
            }, {
                name: new IntegerType()
            });
        });

        it('rejects with object member having mismatched type', () => {
            expectNotCompatible({
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
            expectNotCompatible({
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
            expectCompatible({
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
            expectCompatible({
                parent: new DynamicType()
            }, {
                parent: iface({
                    name: new StringType(),
                    age: new IntegerType()
                })
            });
        });

        it('accepts with target member having dynamic prop type', () => {
            expectCompatible({
                parent: iface({
                    name: new StringType(),
                    age: new IntegerType()
                })
            }, {
                parent: new DynamicType()
            });
        });

        it('accepts with target member having "object" prop type', () => {
            expectCompatible({
                parent: iface({
                    name: new StringType(),
                    age: new IntegerType()
                })
            }, {
                parent: new ObjectType()
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
        ifaceType.addMember(key, null, members[key], SymbolTypeFlag.runtime);
    }
    return ifaceType;
}

function expectCompatible(targetMembers: Record<string, BscType>, sourceMembers: Record<string, BscType>) {
    const targetIface = iface(targetMembers);
    const sourceIface = iface(sourceMembers);
    if (!sourceIface.isTypeCompatible(targetIface)) {
        assert.fail(`expected type ${(targetIface as any).toJSString()} to be assignable to type ${(sourceIface as any).toJSString()}`);
    }
}

function expectNotCompatible(targetMembers: Record<string, BscType>, sourceMembers: Record<string, BscType>) {
    const targetIface = iface(targetMembers);
    const sourceIface = iface(sourceMembers);
    if (sourceIface.isTypeCompatible(targetIface)) {
        assert.fail(`expected type ${(targetIface as any).toJSString()} to not be assignable to type ${(sourceIface as any).toJSString()}`);
    }
}
