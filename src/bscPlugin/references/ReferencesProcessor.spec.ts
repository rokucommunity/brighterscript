import { expect } from '../../chai-config.spec';
import { Program } from '../../Program';
import { util } from '../../util';
import { createSandbox } from 'sinon';
import { rootDir } from '../../testHelpers.spec';
// import { Reference } from '../..';
let sinon = createSandbox();

describe.only('ReferencesProcessor', () => {
    let program: Program;
    beforeEach(() => {
        program = new Program({ rootDir: rootDir, sourceMap: true });
    });
    afterEach(() => {
        sinon.restore();
        program.dispose();
    });

    describe('local variables', () => {
        it('provides references for local variable', () => {
            const file = program.setFile('source/main.bs', `
            sub main()
                hello = 1
                print hello
            end sub
        `);
            const references = program.getReferences({
                srcPath: file.srcPath,
                position: util.createPosition(3, 25)
            });
            expect(
                references
            ).to.eql([{
                srcPath: file.srcPath,
                range: util.createRange(2, 16, 2, 21)
            }, {
                srcPath: file.srcPath,
                range: util.createRange(3, 22, 3, 27)
            }]);
        });
        it('provides multiple references for local variable', () => {
            const file = program.setFile('source/main.bs', `
            sub main()
                hello = 1
                print hello
                speech = hello + " world"
                print left(hello, 20)
            end sub
        `);
            const references = program.getReferences({
                srcPath: file.srcPath,
                position: util.createPosition(3, 25)
            });
            expect(
                references
            ).to.eql([
                {
                    srcPath: file.srcPath,
                    range: util.createRange(2, 16, 2, 21)
                },
                {
                    srcPath: file.srcPath,
                    range: util.createRange(3, 22, 3, 27)
                },
                {
                    srcPath: file.srcPath,
                    range: util.createRange(4, 25, 4, 30)
                },
                {
                    srcPath: file.srcPath,
                    range: util.createRange(5, 27, 5, 32)
                }
            ]);
        });
    });
    describe('globally scoped functions', () => {
        it('provides reference from function definition', () => {
            const file = program.setFile('source/main.bs', `
            function getName()
                return "John Doe"
            end function

            sub main()
                print getName()
                len(getName())
                myFunc = getName
                return {
                    getName: getName
                    getName: getName()
                }
            end sub

        `);
            const references = program.getReferences({
                srcPath: file.srcPath,
                position: util.createPosition(1, 25)
            });
            expect(
                references
            ).to.eql([
                {
                    srcPath: file.srcPath,
                    range: util.createRange(6, 22, 6, 29)
                },
                {
                    srcPath: file.srcPath,
                    range: util.createRange(7, 20, 7, 27)
                },
                {
                    srcPath: file.srcPath,
                    range: util.createRange(8, 25, 8, 32)
                },
                {
                    srcPath: file.srcPath,
                    range: util.createRange(10, 29, 10, 36)
                },
                {
                    srcPath: file.srcPath,
                    range: util.createRange(11, 29, 11, 36)
                }
            ]

            );
        });
        it.only('provides reference from function call', () => {
            const file = program.setFile('source/main.bs', `
            function getName()
                return "John Doe"
            end function

            sub main()
                print getName()
                len(getName())
                myFunc = getName
                return {
                    getName: getName
                    getName: getName()
                }
            end sub

        `);
            let references = program.getReferences({
                srcPath: file.srcPath,
                position: util.createPosition(6, 25)
            });
            expect(
                references
            ).to.eql([
                {
                    srcPath: file.srcPath,
                    range: util.createRange(6, 22, 6, 29)
                },
                {
                    srcPath: file.srcPath,
                    range: util.createRange(7, 20, 7, 27)
                },
                {
                    srcPath: file.srcPath,
                    range: util.createRange(8, 25, 8, 32)
                },
                {
                    srcPath: file.srcPath,
                    range: util.createRange(10, 29, 10, 36)
                },
                {
                    srcPath: file.srcPath,
                    range: util.createRange(11, 29, 11, 36)
                }
            ]);


            references = program.getReferences({
                srcPath: file.srcPath,
                position: util.createPosition(10, 30)
            });
            expect(
                references
            ).to.eql([{
                srcPath: file.srcPath,
                range: util.createRange(2, 16, 2, 21)
            }, {
                srcPath: file.srcPath,
                range: util.createRange(3, 22, 3, 27)
            }]);
        });

        it('provides multiple references for local variable', () => {
            const file = program.setFile('source/main.bs', `
            sub main()
                hello = 1
                print hello
                speech = hello + " world"
                print left(hello, 20)
            end sub
        `);
            const references = program.getReferences({
                srcPath: file.srcPath,
                position: util.createPosition(3, 25)
            });
            expect(
                references
            ).to.eql([
                {
                    srcPath: file.srcPath,
                    range: util.createRange(6, 22, 6, 29)
                },
                {
                    srcPath: file.srcPath,
                    range: util.createRange(7, 20, 7, 27)
                },
                {
                    srcPath: file.srcPath,
                    range: util.createRange(8, 25, 8, 32)
                },
                {
                    srcPath: file.srcPath,
                    range: util.createRange(10, 29, 10, 36)
                },
                {
                    srcPath: file.srcPath,
                    range: util.createRange(11, 29, 11, 36)
                }
            ]);
        });
    });
});


// function dumpReferences(references: Reference[]) {
//     return '[\n' + references.map((r) => `{
//         srcPath: file.srcPath,
//         range: util.createRange(${r.range.start.line}, ${r.range.start.character}, ${r.range.end.line}, ${r.range.end.character})
//     }`).join(',\n') + '\n]\n';
// }
