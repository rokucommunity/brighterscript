import { expect } from '../../chai-config.spec';
import { Lexer } from '../brs/lexer/Lexer';
import { standardizePath as s } from '../../util';
import { rootDir } from '../../testHelpers.spec';
import { TranspileState } from './TranspileState';

describe('TranspileState', () => {
    const srcPath = s`${rootDir}/source/main.brs`;

    it('maps code from a file to its position', () => {
        const state = new TranspileState(srcPath, {});
        const token = Lexer.scan('\n    print', { srcPath: srcPath }).tokens[1];
        const node = state.tokenToSourceNode(token);
        expect([node.line, node.column]).to.eql([2, 4]);
        expect(state.sourceNode(token, 'print').line).to.eql(2);
    });

    it('does not map code parsed from a snippet, since its position is not in any file', () => {
        const state = new TranspileState(srcPath, {});
        const token = Lexer.scan('\n    print').tokens[1];
        expect(token.sourceInfo).to.exist;
        expect(state.tokenToSourceNode(token).line).to.be.null;
        expect(state.sourceNode(token, 'print').line).to.be.null;
    });
});
