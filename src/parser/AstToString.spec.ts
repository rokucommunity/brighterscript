import { expect } from '../chai-config.spec';
import { Parser, ParseMode } from './Parser';

describe('AST toString', () => {
    /**
     * Helper function to test that parsing and then converting back to string
     * produces the same output as the input
     */
    function testRoundTrip(text: string, mode: ParseMode = ParseMode.BrighterScript) {
        const parser = Parser.parse(text, { mode: mode });
        const result = parser.ast.toString();
        expect(result).to.eql(text);
    }

    describe('UnaryExpression', () => {
        it('preserves spacing for unary minus with literal', () => {
            testRoundTrip(`
                sub test()
                    x = -5
                end sub
            `);
        });

        it('preserves spacing for unary minus with variable', () => {
            testRoundTrip(`
                sub test()
                    y = -foo
                end sub
            `);
        });

        it('preserves spacing for "not" keyword', () => {
            testRoundTrip(`
                sub test()
                    result = not true
                end sub
            `);
        });

        it('handles consecutive unary operators', () => {
            testRoundTrip(`
                sub test()
                    x = - - -5
                end sub
            `);
        });

        it('handles nested unary expressions', () => {
            testRoundTrip(`
                sub test()
                    x = not not true
                end sub
            `);
        });

        it('preserves spacing in complex expressions', () => {
            testRoundTrip(`
                sub test()
                    result = -x + 10
                end sub
            `);
        });

        it('handles unary in function call arguments', () => {
            testRoundTrip(`
                sub test()
                    foo(-5, not bar)
                end sub
            `);
        });

        it('handles unary with grouping', () => {
            testRoundTrip(`
                sub test()
                    x = -(5 + 3)
                end sub
            `);
        });

        it('preserves different whitespace amounts', () => {
            testRoundTrip(`
                sub test()
                    x = -  5
                    y = not  true
                end sub
            `);
        });
    });

    describe('BinaryExpression', () => {
        it('preserves simple addition', () => {
            testRoundTrip(`
                sub test()
                    x = 1 + 2
                end sub
            `);
        });

        it('preserves complex expressions', () => {
            testRoundTrip(`
                sub test()
                    result = 1 + 2 * 3 - 4 / 5
                end sub
            `);
        });

        it('preserves whitespace around operators', () => {
            testRoundTrip(`
                sub test()
                    x = 1+2
                    y = 3  +  4
                end sub
            `);
        });
    });

    describe('Comments and Trivia', () => {
        it('preserves line comments', () => {
            testRoundTrip(`
                sub test()
                    'this is a comment
                    x = 5
                end sub
            `);
        });

        it('preserves inline comments', () => {
            testRoundTrip(`
                sub test()
                    x = 5 'inline comment
                end sub
            `);
        });

        it('preserves multiple consecutive comments', () => {
            testRoundTrip(`
                'comment 1
                'comment 2
                'comment 3
                sub test()
                end sub
            `);
        });

        it('preserves blank lines', () => {
            testRoundTrip(`
                sub test()
                    x = 1

                    y = 2
                end sub
            `);
        });
    });

    describe('Function and Sub definitions', () => {
        it('preserves function with parameters', () => {
            testRoundTrip(`
                function add(a, b)
                    return a + b
                end function
            `);
        });

        it('preserves typed parameters', () => {
            testRoundTrip(`
                function add(a as integer, b as integer) as integer
                    return a + b
                end function
            `);
        });

        it('preserves default parameter values', () => {
            testRoundTrip(`
                function greet(name = "World")
                    return "Hello, " + name
                end function
            `);
        });

        it('preserves sub with no parameters', () => {
            testRoundTrip(`
                sub test()
                    print "test"
                end sub
            `);
        });
    });

    describe('Literals', () => {
        it('preserves string literals', () => {
            testRoundTrip(`
                sub test()
                    x = "hello world"
                end sub
            `);
        });

        it('preserves number literals', () => {
            testRoundTrip(`
                sub test()
                    a = 42
                    b = 3.14
                    c = &hFF
                end sub
            `);
        });

        it('preserves boolean literals', () => {
            testRoundTrip(`
                sub test()
                    a = true
                    b = false
                end sub
            `);
        });

        it('preserves array literals', () => {
            testRoundTrip(`
                sub test()
                    arr = [1, 2, 3]
                end sub
            `);
        });

        it('preserves empty array literals', () => {
            testRoundTrip(`
                sub test()
                    arr = []
                end sub
            `);
        });

        it('preserves AA literals', () => {
            testRoundTrip(`
                sub test()
                    obj = {
                        name: "test",
                        value: 42
                    }
                end sub
            `);
        });

        it('preserves empty AA literals', () => {
            testRoundTrip(`
                sub test()
                    obj = {}
                end sub
            `);
        });
    });

    describe('Control Flow', () => {
        it('preserves if statement', () => {
            testRoundTrip(`
                sub test()
                    if true
                        print "yes"
                    end if
                end sub
            `);
        });

        it('preserves if-else statement', () => {
            testRoundTrip(`
                sub test()
                    if true
                        print "yes"
                    else
                        print "no"
                    end if
                end sub
            `);
        });

        it('preserves if-else if-else chain', () => {
            testRoundTrip(`
                sub test()
                    if x = 1
                        print "one"
                    else if x = 2
                        print "two"
                    else
                        print "other"
                    end if
                end sub
            `);
        });

        it('preserves for loop', () => {
            testRoundTrip(`
                sub test()
                    for i = 0 to 10 step 1
                        print i
                    end for
                end sub
            `);
        });

        it('preserves for each loop', () => {
            testRoundTrip(`
                sub test()
                    for each item in items
                        print item
                    end for
                end sub
            `);
        });

        it('preserves while loop', () => {
            testRoundTrip(`
                sub test()
                    while true
                        print "loop"
                    end while
                end sub
            `);
        });
    });

    describe('Call Expressions', () => {
        it('preserves function calls with no args', () => {
            testRoundTrip(`
                sub test()
                    doSomething()
                end sub
            `);
        });

        it('preserves function calls with args', () => {
            testRoundTrip(`
                sub test()
                    add(1, 2, 3)
                end sub
            `);
        });

        it('preserves chained calls', () => {
            testRoundTrip(`
                sub test()
                    obj.method1().method2()
                end sub
            `);
        });

        it('preserves dotted access', () => {
            testRoundTrip(`
                sub test()
                    x = obj.prop.nested
                end sub
            `);
        });

        it('preserves indexed access', () => {
            testRoundTrip(`
                sub test()
                    x = arr[0]
                end sub
            `);
        });
    });

    describe('Template Strings', () => {
        it('preserves simple template string', () => {
            testRoundTrip(`
                sub test()
                    x = \`hello world\`
                end sub
            `);
        });

        it('preserves template string with expression', () => {
            testRoundTrip(`
                sub test()
                    x = \`hello \${name}\`
                end sub
            `);
        });

        it('preserves template string with multiple expressions', () => {
            testRoundTrip(`
                sub test()
                    x = \`\${first} \${last}\`
                end sub
            `);
        });
    });

    describe('Classes', () => {
        it('preserves empty class', () => {
            testRoundTrip(`
                class Movie
                end class
            `);
        });

        it('preserves class with fields', () => {
            testRoundTrip(`
                class Movie
                    title as string
                    duration as integer
                end class
            `);
        });

        it('preserves class with methods', () => {
            testRoundTrip(`
                class Movie
                    sub play()
                        print "playing"
                    end sub
                end class
            `);
        });

        it('preserves class with access modifiers', () => {
            testRoundTrip(`
                class Movie
                    public title as string
                    private duration as integer
                    protected sub play()
                    end sub
                end class
            `);
        });

        it('preserves class inheritance', () => {
            testRoundTrip(`
                class Movie extends Video
                end class
            `);
        });
    });

    describe('Interfaces', () => {
        it('preserves empty interface', () => {
            testRoundTrip(`
                interface IMovie
                end interface
            `);
        });

        it('preserves interface with fields', () => {
            testRoundTrip(`
                interface IMovie
                    title as string
                    duration as integer
                end interface
            `);
        });

        it('preserves interface with methods', () => {
            testRoundTrip(`
                interface IMovie
                    function getDuration() as integer
                    function getTitle() as string
                end interface
            `);
        });
    });

    describe('Complex Real-World Scenarios', () => {
        it('handles mixed expressions with operators and unary', () => {
            testRoundTrip(`
                sub Offset(x, y, w, h)
                    result = -x + 96
                    result2 = -y + 56
                    result3 = -w + 1088
                    result4 = -h + 608
                end sub
            `);
        });

        it('preserves function with complex logic', () => {
            testRoundTrip(`
                function calculate(a, b, c)
                    if a < 0
                        a = -a
                    end if
                    result = -a + b * c
                    if not (result > 0)
                        result = 0
                    end if
                    return result
                end function
            `);
        });

        it('preserves nested structures', () => {
            testRoundTrip(`
                sub test()
                    obj = {
                        nested: {
                            value: [1, 2, 3]
                        }
                    }
                end sub
            `);
        });
    });
});
