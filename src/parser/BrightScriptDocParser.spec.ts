import { expect } from 'chai';
import { brsDocParser } from './BrightScriptDocParser';
import { Parser } from './Parser';
import { expectTypeToBe } from '../testHelpers.spec';
import { SymbolTypeFlag } from '../SymbolTypeFlag';
import { IntegerType } from '../types/IntegerType';
import { UnionType } from '../types/UnionType';
import { isReferenceType } from '../astUtils/reflection';

describe('BrightScriptDocParser', () => {


    it('should get a comment', () => {
        const doc = brsDocParser.parse('this is a comment');
        expect(doc.description).to.equal('this is a comment');
    });

    it('should get a tag', () => {
        const doc = brsDocParser.parse(`
            this is a comment
            @sometag here is the rest
        `);
        expect(doc.description).to.equal('this is a comment');
        expect(doc.tags.length).to.equal(1);
        expect(doc.tags[0].tagName).to.equal('sometag');
        expect(doc.tags[0].detail).to.equal('here is the rest');
        expect(doc.getTag('sometag').detail).to.equal('here is the rest');
    });

    it('ignores leading apostrophes ', () => {
        const doc = brsDocParser.parse(`
            ' this is a comment
            ' @sometag here is the rest
        `);
        expect(doc.description).to.equal('this is a comment');
        expect(doc.tags.length).to.equal(1);
        expect(doc.tags[0].tagName).to.equal('sometag');
        expect(doc.tags[0].detail).to.equal('here is the rest');
        expect(doc.getTag('sometag').detail).to.equal('here is the rest');
    });

    it('should get a multiline comment', () => {
        const doc = brsDocParser.parse(`
            this is a comment
            this is some more of a comment
        `);
        expect(doc.description).to.equal('this is a comment\nthis is some more of a comment');
    });

    describe('parseParam', () => {

        it('should find @param tags of various types', () => {
            const doc = brsDocParser.parse(`
                this is a comment
                @param p1
                @param p2 description of p2
                @param {some.type} p3
                @param {some.type} p4 description of p4
                @param [p5] optional p5
                @param {some.type} [p6] optional with type p6
                @param p7 multi line description
                       of p7
                @param p8
                        description of p8
            `);

            expect(doc.getAllTags('param').length).to.equal(8);

            expect(doc.getParam('p1').description).to.equal('');
            expect(doc.getParam('p1').typeString).to.equal('');

            expect(doc.getParam('p2').description).to.equal('description of p2');
            expect(doc.getParam('p2').typeString).to.equal('');

            expect(doc.getParam('p3').description).to.equal('');
            expect(doc.getParam('p3').typeString).to.equal('some.type');

            expect(doc.getParam('p4').description).to.equal('description of p4');
            expect(doc.getParam('p4').typeString).to.equal('some.type');

            expect(doc.getParam('p5').description).to.equal('optional p5');
            expect(doc.getParam('p5').typeString).to.be.equal('');
            expect(doc.getParam('p5').optional).to.be.true;

            expect(doc.getParam('p6').description).to.equal('optional with type p6');
            expect(doc.getParam('p6').typeString).to.be.equal('some.type');
            expect(doc.getParam('p6').optional).to.be.true;

            expect(doc.getParam('p7').description).to.equal('multi line description\nof p7');
            expect(doc.getParam('p7').typeString).to.be.equal('');
            expect(doc.getParam('p7').optional).to.be.false;

            expect(doc.getParam('p8').description).to.equal('description of p8');
            expect(doc.getParam('p8').typeString).to.equal('');
        });
    });

    it('includes the @description tag in the description', () => {
        const doc = brsDocParser.parse(`
            this is a comment
            @description this is a description
        `);
        expect(doc.description).to.equal('this is a comment\nthis is a description');
    });

    it('includes the @description tag in the description when multiline', () => {
        const doc = brsDocParser.parse(`
            this is a comment

            above space intentionally blank
            @description this is a description

             above space intentionally blank again
            @param whatever
             this will be the description of whatever

        `);
        expect(doc.description).to.equal('this is a comment\n\nabove space intentionally blank\nthis is a description\n\nabove space intentionally blank again');
    });

    it('includes the @return tag', () => {
        const doc = brsDocParser.parse(`
            this is a comment
            @return this is a return
        `);
        expect(doc.getReturn().description).to.equal('this is a return');
    });

    it('includes the @return tag when it has a type', () => {
        const doc = brsDocParser.parse(`
            this is a comment
            @return {some.thing.here} this is a return
        `);
        expect(doc.getReturn().description).to.equal('this is a return');
        expect(doc.getReturn().typeString).to.equal('some.thing.here');
    });

    it('includes the @return tag when it only has a type', () => {
        const doc = brsDocParser.parse(`
            this is a comment
            @return {some.thing.here}
        `);
        expect(doc.getReturn().description).to.equal('');
        expect(doc.getReturn().typeString).to.equal('some.thing.here');
    });

    it('allows the @returns (with an s)', () => {
        const doc = brsDocParser.parse(`
            this is a comment
            @returns {some.thing.here} this is a returns
        `);
        expect(doc.getReturn().description).to.equal('this is a returns');
        expect(doc.getReturn().typeString).to.equal('some.thing.here');
    });


    it('finds the type tag', () => {
        const doc = brsDocParser.parse(`
            @type {integer}
        `);
        expect(doc.getTypeTag().typeString).to.equal('integer');
    });

    it('is case INSENSITIVE for param names', () => {
        const doc = brsDocParser.parse(`
            @param {integer} ALLCAPS
        `);
        expect(doc.getParam('allcaps').typeString).to.equal('integer');
    });

    it('is case SENSITIVE for tag names', () => {
        const doc = brsDocParser.parse(`
            @ALLCAPS
        `);
        expect(doc.getTag('allcaps')).to.be.undefined;
    });

    describe('nodes', () => {
        const parser = new Parser();

        it('should get documentation from an ast node', () => {
            let { ast } = parser.parse(`
                ' this is a comment
                sub foo()
                end sub
            `);

            const doc = brsDocParser.parseNode(ast.statements[0]);
            expect(doc.description).to.equal('this is a comment');
        });

        it('should get documentation from a function', () => {
            let { ast } = parser.parse(`
                ' My description
                ' of this function
                ' @param p1 this is p1
                ' @param p2 this is p2
                ' @return {integer} sum of p1 and p2
                function foo(p1, p2)
                    return p1 + p2
                end function
            `);

            const doc = brsDocParser.parseNode(ast.statements[0]);
            expect(doc.description).to.equal('My description\nof this function');
            expect(doc.getAllTags('param').length).to.equal(2);
            expect(doc.getParam('p1').description).to.equal('this is p1');
            expect(doc.getParam('p2').description).to.equal('this is p2');
            expect(doc.getReturn().description).to.equal('sum of p1 and p2');
            expect(doc.getReturn().typeString).to.equal('integer');
        });

        it('should get documentation when it is wrapped in jsdoc /** */', () => {
            let { ast } = parser.parse(`
                ' /**
                '  * My description
                '  * of this function
                '  * @param p1 this is p1
                '  * @param p2 this is p2
                '  * @return {integer} sum of p1 and p2
                '  */
                function foo(p1, p2)
                    return p1 + p2
                end function
            `);

            const doc = brsDocParser.parseNode(ast.statements[0]);
            expect(doc.description).to.equal('My description\nof this function');
            expect(doc.getAllTags('param').length).to.equal(2);
            expect(doc.getParam('p1').description).to.equal('this is p1');
            expect(doc.getParam('p2').description).to.equal('this is p2');
            expect(doc.getReturn().description).to.equal('sum of p1 and p2');
            expect(doc.getReturn().typeString).to.equal('integer');
        });

        it('should get types from the context of the node with teh documentation', () => {
            let { ast } = parser.parse(`
                '  @param {List} p1 this is p1
                '  @param {integer} p2 this is p2
                '  @return {integer} sum of p1 and p2
                function foo(p1, p2)
                    return p1.next.value + p2
                end function

                class List
                    next as Bar
                    value as integer
                end class
            `);

            const doc = brsDocParser.parseNode(ast.statements[0]);
            expect(doc.getAllTags('param').length).to.equal(2);
            expect(isReferenceType(doc.getParamBscType('p1', { flags: SymbolTypeFlag.typetime }))).to.be.true;
        });

    });

    describe('Types', () => {
        const parser = new Parser();

        it('should get a type expression from a tag with a type', () => {
            const doc = brsDocParser.parse(`
                @type {integer}
            `);
            expect(doc.getTypeTag().typeExpression).to.be.ok;
        });

        it('should get a BscType from a tag with a type', () => {
            const doc = brsDocParser.parse(`
                @param {integer} test
            `);
            expectTypeToBe(doc.getParamBscType('test', { flags: SymbolTypeFlag.typetime }), IntegerType);
        });

        it('should get a union type from a tag with a types with "or"', () => {
            const doc = brsDocParser.parse(`
                @param {integer or String} test
            `);
            expectTypeToBe(doc.getParamBscType('test', { flags: SymbolTypeFlag.typetime }), UnionType);
        });


        it('should get documentation from a function', () => {
            let { ast } = parser.parse(`
                ' My description
                ' of this function
                ' @param p1 this is p1
                ' @param p2 this is p2
                ' @return {integer} sum of p1 and p2
                function foo(p1, p2)
                    return p1 + p2
                end function
            `);

            const doc = brsDocParser.parseNode(ast.statements[0]);
            expect(doc.description).to.equal('My description\nof this function');
            expect(doc.getAllTags('param').length).to.equal(2);
            expect(doc.getParam('p1').description).to.equal('this is p1');
            expect(doc.getParam('p2').description).to.equal('this is p2');
            expect(doc.getReturn().description).to.equal('sum of p1 and p2');
            expect(doc.getReturn().typeString).to.equal('integer');
        });

        it('should get documentation when it is wrapped in jsdoc /** */', () => {
            let { ast } = parser.parse(`
                ' /**
                '  * My description
                '  * of this function
                '  * @param p1 this is p1
                '  * @param p2 this is p2
                '  * @return {integer} sum of p1 and p2
                '  */
                function foo(p1, p2)
                    return p1 + p2
                end function
            `);

            const doc = brsDocParser.parseNode(ast.statements[0]);
            expect(doc.description).to.equal('My description\nof this function');
            expect(doc.getAllTags('param').length).to.equal(2);
            expect(doc.getParam('p1').description).to.equal('this is p1');
            expect(doc.getParam('p2').description).to.equal('this is p2');
            expect(doc.getReturn().description).to.equal('sum of p1 and p2');
            expect(doc.getReturn().typeString).to.equal('integer');
        });

    });
});
