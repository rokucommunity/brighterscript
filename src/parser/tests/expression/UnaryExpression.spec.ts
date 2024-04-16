import { expectZeroDiagnostics, getTestTranspile } from '../../../testHelpers.spec';
import { rootDir } from '../../../testHelpers.spec';
import { Program } from '../../../Program';

describe('UnaryExpression', () => {
    let program: Program;
    const testTranspile = getTestTranspile(() => [program, rootDir]);
    beforeEach(() => {
        program = new Program({
            rootDir: rootDir
        });
    });

    it('handles advanced cases', async () => {
        const { file } = await testTranspile(`
            Sub Main()
                x = 96
                y = 56
                w = 1088
                h = 608
                Offset(-x + 96, -y + 56, -w + 1088, -h + 608)
                print -1000 +1000
                foo = 5
                if not foo = 1
                    print "foo is not 1"
                end if
            End Sub
            Sub Offset(x, y, w, h)
                print x.toStr() + y.toStr() + w.toStr() + h.toStr()
            End Sub
        `, `
            Sub Main()
                x = 96
                y = 56
                w = 1088
                h = 608
                Offset(-x + 96, -y + 56, -w + 1088, -h + 608)
                print -1000 + 1000
                foo = 5
                if not foo = 1
                    print "foo is not 1"
                end if
            End Sub

            Sub Offset(x, y, w, h)
                print x.toStr() + y.toStr() + w.toStr() + h.toStr()
            End Sub
        `);
        expectZeroDiagnostics(program);
    });
});
