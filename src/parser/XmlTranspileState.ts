import type { XmlFile } from '../files/XmlFile';
import { TranspileState } from './TranspileState';

/**
 * Holds the state of an xml file's transpile operation
 */
export class XmlTranspileState extends TranspileState {
    public constructor(
        /**
         * The xml file being transpiled. Its `<script>` elements use it to find the code embedded in them
         */
        public file: XmlFile
    ) {
        super(file.srcPath, file.program.options);
    }
}
