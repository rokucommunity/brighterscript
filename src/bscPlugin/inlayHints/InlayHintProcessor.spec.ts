import { expect } from '../../chai-config.spec';
import { Program } from '../../Program';
import { util } from '../../util';
import { rootDir, trim } from '../../testHelpers.spec';
import type { InlayHint } from 'vscode-languageserver-types';
import { InlayHintKind } from 'vscode-languageserver-types';

describe('InlayHintProcessor', () => {
    let program: Program;

    beforeEach(() => {
        program = new Program({ rootDir: rootDir });
    });

    afterEach(() => {
        program.dispose();
    });

    function getInlayHints(filePath: string, code: string): InlayHint[] {
        const file = program.setFile(filePath, code);
        program.validate();
        const lines = code.split('\n');
        const range = util.createRange(0, 0, lines.length, 0);
        return program.getInlayHints(file.pathAbsolute, range);
    }

    it('returns empty array when no calls exist', () => {
        const hints = getInlayHints('source/main.bs', trim`
            sub main()
                x = 1
            end sub
        `);
        expect(hints).to.eql([]);
    });

    it('emits parameter name hints for a regular function call', () => {
        const hints = getInlayHints('source/main.bs', trim`
            sub main()
                sayHello("world", 42)
            end sub
            sub sayHello(name as string, age as integer)
            end sub
        `);
        expect(hints.map(h => h.label)).to.eql(['name:', 'age:']);
        expect(hints.every(h => h.kind === InlayHintKind.Parameter)).to.be.true;
        expect(hints.every(h => h.paddingRight === true)).to.be.true;
    });

    it('positions hints at the start of each argument', () => {
        const hints = getInlayHints('source/main.bs', trim`
            sub main()
                sayHello("world", 42)
            end sub
            sub sayHello(name as string, age as integer)
            end sub
        `);
        expect(hints[0].position).to.eql(util.createPosition(1, 13));
        //"world" is 7 chars, so 42 starts at column 13 + 7 + 2 = 22
        expect(hints[1].position).to.eql(util.createPosition(1, 22));
    });

    it('skips hints when the argument is a variable matching the parameter name', () => {
        const hints = getInlayHints('source/main.bs', trim`
            sub main()
                name = "world"
                sayHello(name, 42)
            end sub
            sub sayHello(name as string, age as integer)
            end sub
        `);
        //first arg matches param name and should be suppressed; second arg should still emit
        expect(hints.map(h => h.label)).to.eql(['age:']);
    });

    it('limits hints to the requested range', () => {
        const code = trim`
            sub main()
                sayHello("world", 42)
                sayHello("again", 99)
            end sub
            sub sayHello(name as string, age as integer)
            end sub
        `;
        const file = program.setFile('source/main.bs', code);
        program.validate();
        //range only covers line 1 (the first call)
        const range = util.createRange(1, 0, 1, 100);
        const hints = program.getInlayHints(file.pathAbsolute, range);
        expect(hints.map(h => h.label)).to.eql(['name:', 'age:']);
        expect(hints.every(h => h.position.line === 1)).to.be.true;
    });

    it('emits hints for namespace calls', () => {
        const hints = getInlayHints('source/main.bs', trim`
            sub main()
                math.add(1, 2)
            end sub
            namespace math
                sub add(left as integer, right as integer)
                end sub
            end namespace
        `);
        expect(hints.map(h => h.label)).to.eql(['left:', 'right:']);
    });

    it('emits hints for class constructor calls', () => {
        const hints = getInlayHints('source/main.bs', trim`
            sub main()
                p = new Person("Alice", 30)
            end sub
            class Person
                sub new(name as string, age as integer)
                end sub
            end class
        `);
        expect(hints.map(h => h.label)).to.eql(['name:', 'age:']);
    });

    it('emits hints for m.method() calls inside a class', () => {
        const hints = getInlayHints('source/main.bs', trim`
            class Greeter
                sub greet()
                    m.sayHello("world", 42)
                end sub
                sub sayHello(name as string, age as integer)
                end sub
            end class
        `);
        expect(hints.map(h => h.label)).to.eql(['name:', 'age:']);
    });

    it('does not emit hints when the function is unknown', () => {
        const hints = getInlayHints('source/main.bs', trim`
            sub main()
                unknownFunction(1, 2)
            end sub
        `);
        expect(hints).to.eql([]);
    });

    it('does not emit hints for excess arguments past the parameter list', () => {
        const hints = getInlayHints('source/main.bs', trim`
            sub main()
                takesOne(1, 2, 3)
            end sub
            sub takesOne(only as integer)
            end sub
        `);
        expect(hints.map(h => h.label)).to.eql(['only:']);
    });

    it('does not crash on calls with no arguments', () => {
        const hints = getInlayHints('source/main.bs', trim`
            sub main()
                noArgs()
            end sub
            sub noArgs()
            end sub
        `);
        expect(hints).to.eql([]);
    });
});
