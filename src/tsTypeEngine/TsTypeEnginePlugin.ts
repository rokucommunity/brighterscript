import type { AfterValidateProgramEvent, Plugin } from '../interfaces';
import type { Program } from '../Program';
import { TsTypeEngine } from './TsTypeEngine';

const DIAGNOSTIC_TAG = 'bsc-ts';

/**
 * Experimental: adds the TypeScript type engine's diagnostics alongside the built-in validator's.
 * Enable it with `"plugins": ["brighterscript/dist/tsTypeEngine/TsTypeEnginePlugin"]` in bsconfig.json
 */
export class TsTypeEnginePlugin implements Plugin {
    public name = 'TsTypeEnginePlugin';

    private engines = new WeakMap<Program, TsTypeEngine>();

    public afterValidateProgram(event: AfterValidateProgramEvent) {
        let engine = this.engines.get(event.program);
        if (!engine) {
            engine = new TsTypeEngine(event.program);
            this.engines.set(event.program, engine);
        }
        event.program.diagnostics.clearForTag(DIAGNOSTIC_TAG);
        event.program.diagnostics.register(engine.getDiagnostics(), { tags: [DIAGNOSTIC_TAG] });
    }
}

export default function createTsTypeEnginePlugin() {
    return new TsTypeEnginePlugin();
}
