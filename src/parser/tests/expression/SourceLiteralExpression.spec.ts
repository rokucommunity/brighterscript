import { getTestTranspile } from '../../../files/BrsFile.spec';
import { Program } from '../../../Program';
import { standardizePath as s } from '../../../util';

describe('SourceLiteralExpression', () => {
    let rootDir = process.cwd();
    let program: Program;
    let testTranspile = getTestTranspile(() => [program, rootDir]);

    beforeEach(() => {
        program = new Program({ rootDir: rootDir });
    });
    afterEach(() => {
        program.dispose();
    });

    describe('transpile', () => {

        it('allows bs source literals local vars in brs mode', async () => {
            await testTranspile(`
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
            `, undefined, 'none', 'main.brs');
        });

        it('computes SOURCE_FILE_PATH', async () => {
            await testTranspile(`
                sub main()
                    print SOURCE_FILE_PATH
                end sub
            `, `
                sub main()
                    print "file:/${s`${rootDir}/source/main.bs`}"
                end sub
            `, undefined, 'source/main.bs');
        });

        it('computes SOURCE_LINE_NUM', async () => {
            await testTranspile(`
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

        it('computes FUNCTION_NAME', async () => {
            await testTranspile(`
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

        it('computes SOURCE_FUNCTION_NAME', async () => {
            await testTranspile(`
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

        it('SOURCE_FUNCTION_NAME computes nested anon', async () => {
            await testTranspile(`
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

        it('computes SOURCE_LOCATION', async () => {
            await testTranspile(`
                sub main()
                    print SOURCE_LOCATION
                end sub
            `, `
                sub main()
                    print "file:/${s`${rootDir}/source/main.bs:3`}"
                end sub
            `, undefined, 'source/main.bs');
        });

        it('computes PKG_PATH', async () => {
            await testTranspile(`
                sub main()
                    print PKG_PATH
                end sub
            `, `
                sub main()
                    print "pkg:/source/main.brs"
                end sub
            `, undefined, 'source/main.bs');
        });

        it('computes PKG_LOCATION', async () => {
            await testTranspile(`
                sub main()
                    print PKG_LOCATION
                end sub
            `, `
                sub main()
                    print "pkg:/source/main.brs:" + str(LINE_NUM)
                end sub
            `, undefined, 'source/main.bs');
        });

        it('retains LINE_NUM', async () => {
            await testTranspile(`
                sub main()
                    print LINE_NUM
                end sub
            `);
        });
    });
});
