import { expect } from 'chai';
import { assert } from 'sinon';
import { objectToMap } from '../testHelpers.spec';
import type { BscType } from './BscType';
import { DynamicType } from './DynamicType';
import { IntegerType } from './IntegerType';
import { InterfaceType } from './InterfaceType';
import { ObjectType } from './ObjectType';
import { StringType } from './StringType';

describe('InterfaceType', () => {
    describe('toString', () => {
        it('returns empty curly braces when no members', () => {
            expect(iface({}).toString()).to.eql('{}');
        });

        it('includes member types', () => {
            expect(iface({ name: new StringType() }).toString()).to.eql('{ name: string; }');
        });

        it('includes nested object types', () => {
            expect(
                iface({
                    name: new StringType(),
                    parent: iface({
                        age: new IntegerType()
                    })
                }
                ).toString()
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
            expect(
                new InterfaceType(new Map([
                    ['name', new StringType()],
                    ['age', new IntegerType()]
                ])).isAssignableTo(new InterfaceType(new Map([
                    ['age', new IntegerType()],
                    ['name', new StringType()]
                ])))
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

function iface(members: Record<string, BscType>) {
    return new InterfaceType(
        objectToMap(members)
    );
}

function expectAssignable(targetMembers: Record<string, BscType>, sourceMembers: Record<string, BscType>) {
    const targetIface = iface(targetMembers);
    const sourceIface = iface(sourceMembers);
    if (!sourceIface.isAssignableTo(targetIface)) {
        assert.fail(`expected type ${targetIface.toString()} to be assignable to type ${sourceIface.toString()}`);
    }
}

function expectNotAssignable(targetMembers: Record<string, BscType>, sourceMembers: Record<string, BscType>) {
    const targetIface = iface(targetMembers);
    const sourceIface = iface(sourceMembers);
    if (sourceIface.isAssignableTo(targetIface)) {
        assert.fail(`expected type ${targetIface.toString()} to not be assignable to type ${sourceIface.toString()}`);
    }
}
