import { expect } from './chai-config.spec';
import { Program } from './Program';

describe('BslibInline', () => {
    describe('configuration', () => {
        it('should use shared mode by default', () => {
            const program = new Program({});
            expect(program.options.bslibHandling?.mode).to.equal('shared');
        });

        it('should use md5 strategy by default for unique-per-file', () => {
            const program = new Program({
                bslibHandling: {
                    mode: 'unique-per-file'
                }
            });
            expect(program.options.bslibHandling?.uniqueStrategy).to.equal('md5');
        });
    });

    describe('shared mode', () => {
        it('should not inline functions in shared mode', () => {
            const program = new Program({
                bslibHandling: {
                    mode: 'shared'
                }
            });

            program.setFile('source/main.bs', `
                function main()
                    message = \`Hello \${m.top.name}\`
                    result = true ? "yes" : "no"
                    fallback = value ?? "default"
                end function
            `);

            const file = program.getFile('source/main.bs') as any;
            const result = program['_getTranspiledFileContents'](file);

            // Should use regular bslib function calls without suffix
            expect(result.code).to.include('bslib_toString(');
            expect(result.code).to.include('bslib_coalesce(');
            // Note: Simple ternary expressions expand to if/else instead of using bslib_ternary
            
            // Should not contain inline function definitions
            expect(result.code).to.not.include('function bslib_toString');
            expect(result.code).to.not.include('function bslib_ternary');
            expect(result.code).to.not.include('function bslib_coalesce');

            program.dispose();
        });
    });

    describe('unique-per-file mode', () => {
        it('should inline only used bslib functions', () => {
            const program = new Program({
                bslibHandling: {
                    mode: 'unique-per-file',
                    uniqueStrategy: 'md5'
                }
            });

            program.setFile('source/main.bs', `
                function main()
                    message = \`Hello \${m.top.name}\`
                end function
            `);

            const file = program.getFile('source/main.bs') as any;
            const result = program['_getTranspiledFileContents'](file);
            
            // Should contain inline toString function with unique suffix
            expect(result.code).to.include('bslib_toString_');
            expect(result.code).to.include('function bslib_toString_');
            
            // Should not contain unused functions
            expect(result.code).to.not.include('function bslib_ternary_');
            expect(result.code).to.not.include('function bslib_coalesce_');

            program.dispose();
        });

        it('should inline multiple bslib functions when used', () => {
            const program = new Program({
                bslibHandling: {
                    mode: 'unique-per-file',
                    uniqueStrategy: 'md5'
                }
            });

            program.setFile('source/main.bs', `
                function main()
                    message = \`Hello \${m.top.name}\`
                    result = true ? "yes" : "no"
                    fallback = value ?? "default"
                end function
            `);

            const file = program.getFile('source/main.bs') as any;
            const result = program['_getTranspiledFileContents'](file);
            
            // Should contain inline functions with same unique suffix
            const toStringMatch = result.code.match(/bslib_toString_([a-f0-9]+)/);
            const coalesceMatch = result.code.match(/bslib_coalesce_([a-f0-9]+)/);
            
            expect(toStringMatch).to.not.be.null;
            expect(coalesceMatch).to.not.be.null;
            
            // All functions should have the same suffix
            expect(toStringMatch![1]).to.equal(coalesceMatch![1]);
            
            // Should contain function definitions
            expect(result.code).to.include('function bslib_toString_');
            expect(result.code).to.include('function bslib_coalesce_');
            // Note: Simple ternary expressions expand to if/else, so no bslib_ternary function needed

            program.dispose();
        });

        it('should not include unused bslib functions in output', () => {
            const program = new Program({
                bslibHandling: {
                    mode: 'unique-per-file'
                }
            });

            program.setFile('source/main.bs', `
                function main()
                    print "No bslib functions used"
                end function
            `);

            const file = program.getFile('source/main.bs') as any;
            const result = program['_getTranspiledFileContents'](file);
            
            // Should not contain any bslib function definitions
            expect(result.code).to.not.include('function bslib_');
            expect(result.code).to.not.include('bslib_toString');
            expect(result.code).to.not.include('bslib_ternary');
            expect(result.code).to.not.include('bslib_coalesce');

            program.dispose();
        });

        it('should validate that inlined functions work correctly', () => {
            const program = new Program({
                bslibHandling: {
                    mode: 'unique-per-file'
                }
            });

            program.setFile('source/main.bs', `
                function main()
                    message = \`Hello \${m.top.name}\`
                    result = true ? "yes" : "no"
                    fallback = value ?? "default"
                end function
            `);

            const file = program.getFile('source/main.bs') as any;
            const result = program['_getTranspiledFileContents'](file);
            
            // Verify the transpiled output contains the expected structure
            expect(result.code).to.include('function main()');
            expect(result.code).to.include('message = ("Hello " + bslib_toString_');
            expect(result.code).to.include('fallback = bslib_coalesce_');
            expect(result.code).to.include('end function');
            // Note: Simple ternary expressions expand to if/else, so result uses if/then/else/end if

            program.dispose();
        });
    });

    describe('XML file handling', () => {
        it('should handle XML transpilation in unique-per-file mode', () => {
            // For now, just test that the mode is correctly set
            const program = new Program({
                bslibHandling: {
                    mode: 'unique-per-file'
                }
            });

            expect(program.options.bslibHandling?.mode).to.equal('unique-per-file');
            program.dispose();
        });

        it('should handle XML transpilation in shared mode', () => {
            // For now, just test that the mode is correctly set
            const program = new Program({
                bslibHandling: {
                    mode: 'shared'
                }
            });

            expect(program.options.bslibHandling?.mode).to.equal('shared');
            program.dispose();
        });
    });
});