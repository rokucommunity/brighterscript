import { Program } from '../../../Program';
import { standardizePath as s } from '../../../util';
import * as fileUrl from 'file-url';
import { getTestTranspile } from '../../../testHelpers.spec';

describe('SourceLiteralExpression', () => {
    let rootDir = s`${process.cwd()}/rootDir`;
    let program: Program;
    let testTranspile = getTestTranspile(() => [program, rootDir]);

    beforeEach(() => {
        program = new Program({ rootDir: rootDir });
    });
    afterEach(() => {
        program.dispose();
    });

    describe('transpile', () => {

        it('allows bs source literals local vars in brs mode', () => {
            testTranspile(`
                sub main()
                    source_file_path = true
                    source_line_num = true
                    function_name = true
                    source_function_name = true
                    source_location = true
                    pkg_path = true
                    pkg_location = true

                    print line_num
                    print source_file_path
                    print source_line_num
                    print function_name
                    print source_function_name
                    print source_location
                    print pkg_path
                    print pkg_location
                end sub
            `, undefined, 'none', 'source/main.brs');
        });

        it('computes SOURCE_FILE_PATH', () => {
            testTranspile(`
                sub main()
                    print SOURCE_FILE_PATH
                end sub
            `, `
                sub main()
                    print "${fileUrl(`${rootDir}/source/main.bs`).substring(0, 4)}" + "${fileUrl(`${rootDir}/source/main.bs`).substring(4)}"
                end sub
            `, undefined, 'source/main.bs');
        });

        it('computes SOURCE_LINE_NUM', () => {
            testTranspile(`
                sub main()
                    print SOURCE_LINE_NUM
                    print "hello world"
                    print SOURCE_LINE_NUM
                end sub
            `, `
                sub main()
                    print 3
                    print "hello world"
                    print 5
                end sub
            `);
        });

        it('computes FUNCTION_NAME', () => {
            testTranspile(`
                sub main1()
                    print FUNCTION_NAME
                end sub
                namespace Human.Versus.Zombie
                    sub main2()
                        print FUNCTION_NAME
                    end sub
                end namespace
            `, `
                sub main1()
                    print "main1"
                end sub
                sub Human_Versus_Zombie_main2()
                    print "Human_Versus_Zombie_main2"
                end sub
            `);
        });

        it('computes SOURCE_FUNCTION_NAME', () => {
            testTranspile(`
                sub main1()
                    print SOURCE_FUNCTION_NAME
                end sub
                namespace Human.Versus.Zombie
                    sub main2()
                        print SOURCE_FUNCTION_NAME
                    end sub
                end namespace
            `, `
                sub main1()
                    print "main1"
                end sub
                sub Human_Versus_Zombie_main2()
                    print "Human.Versus.Zombie.main2"
                end sub
            `);
        });

        it('SOURCE_FUNCTION_NAME computes nested anon', () => {
            testTranspile(`
                namespace NameA
                    sub main()
                        speak = sub()
                            innerSpeak = sub()
                                print SOURCE_FUNCTION_NAME
                                print FUNCTION_NAME
                            end sub
                        end sub
                    end sub
                end namespace
            `, `
                sub NameA_main()
                    speak = sub()
                        innerSpeak = sub()
                            print "NameA.main$anon0$anon0"
                            print "NameA_main$anon0$anon0"
                        end sub
                    end sub
                end sub
            `);
        });

        it('computes SOURCE_LOCATION', () => {
            testTranspile(`
                sub main()
                    print SOURCE_LOCATION
                end sub
            `, `
                sub main()
                    print "${fileUrl(`${rootDir}/source/main.bs`).substring(0, 4)}" + "${fileUrl(`${rootDir}/source/main.bs`).substring(4)}:3"
                end sub
            `, undefined, 'source/main.bs');
        });

        it('computes PKG_PATH', () => {
            testTranspile(`
                sub main()
                    print PKG_PATH
                end sub
            `, `
                sub main()
                    print "pkg:/source/main.brs"
                end sub
            `, undefined, 'source/main.bs');
        });

        it('computes PKG_LOCATION', () => {
            testTranspile(`
                sub main()
                    print PKG_LOCATION
                end sub
            `, `
                sub main()
                    print "pkg:/source/main.brs:" + str(LINE_NUM)
                end sub
            `, undefined, 'source/main.bs');
        });

        it('retains LINE_NUM', () => {
            testTranspile(`
                sub main()
                    print LINE_NUM
                end sub
            `);
        });

        it('accounts for sourceRoot in SOURCE_FILE_PATH', () => {
            let sourceRoot = s`${process.cwd()} / sourceRoot`;
            program = new Program({
                rootDir: rootDir,
                sourceRoot: sourceRoot
            });
            testTranspile(`
                sub main()
                    print SOURCE_FILE_PATH
                end sub
            `, `
                sub main()
                    print "${fileUrl(s`${sourceRoot}/source/main.bs`).substring(0, 4)}" + "${fileUrl(s`${sourceRoot}/source/main.bs`).substring(4)}"
                end sub
            `, undefined, 'source/main.bs');
        });

        it('accounts for sourceRoot in SOURCE_LOCATION', () => {
            let sourceRoot = s`${process.cwd()} / sourceRoot`;
            program = new Program({
                rootDir: rootDir,
                sourceRoot: sourceRoot
            });
            testTranspile(`
                sub main()
                    print SOURCE_LOCATION
                end sub
            `, `
                sub main()
                    print "${fileUrl(s`${sourceRoot}/source/main.bs`).substring(0, 4)}" + "${fileUrl(s`${sourceRoot}/source/main.bs`).substring(4)}:3"
                end sub
            `, undefined, 'source/main.bs');
        });
    });
});
