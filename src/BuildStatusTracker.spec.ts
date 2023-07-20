import type { Connection } from 'vscode-languageserver';
import type { BuildStatusEvent } from './BuildStatusTracker';
import { BuildStatus, BuildStatusTracker } from './BuildStatusTracker';
import { createSandbox } from 'sinon';
import type { Project } from './LanguageServer';
import { tempDir } from './testHelpers.spec';
import { standardizePath as s } from './util';
import { expect } from 'chai';
import { Deferred } from './deferred';
const sinon = createSandbox();

describe('BuildStatusTracker', () => {
    let tracker: BuildStatusTracker;
    let connection = {
        sendNotification: () => { }
    } as any as Connection;

    const project1 = {
        projectNumber: 1,
        projectPath: s`${tempDir}/project1`
    } as Project;

    const project2 = {
        projectNumber: 2,
        projectPath: s`${tempDir}/project2`
    } as Project;

    const timeoutDurations: number[] = [];

    beforeEach(() => {
        tracker = new BuildStatusTracker(connection);
        sinon.stub(tracker as any, 'getDuration').callsFake(() => {
            return timeoutDurations.shift() ?? 30_000;
        });
    });

    it('supports tracking events without project info', () => {
        tracker.run(undefined, () => { });
        expect(tracker['buildEvent']()).to.eql({
            projectInfo: [{
                projectNumber: undefined,
                projectPath: undefined,
                statistics: {
                    average: 30_000,
                    count: 1,
                    max: 30_000,
                    min: 30_000
                }
            }],
            status: BuildStatus.success
        } as BuildStatusEvent);
    });

    it('tracks a single run', () => {
        tracker.run(project1, () => {
            //noop
        });
        expect(tracker['buildEvent']()).to.eql({
            projectInfo: [{
                ...project1,
                statistics: {
                    average: 30_000,
                    count: 1,
                    max: 30_000,
                    min: 30_000
                }
            }],
            status: BuildStatus.success
        } as BuildStatusEvent);
    });

    it('tracks a single async flow', async () => {
        const deferred = new Deferred();
        const finishedPromise = tracker.run(project1, () => {
            return deferred.promise;
        });
        //no data tracked yet
        expect(tracker['buildEvent']()).to.eql({
            projectInfo: [{
                ...project1,
                statistics: {
                    min: Number.MAX_SAFE_INTEGER,
                    max: 0,
                    average: 0,
                    count: 0
                }
            }],
            status: BuildStatus.building
        } as BuildStatusEvent);

        deferred.resolve();
        await finishedPromise;

        expect(tracker['buildEvent']()).to.eql({
            projectInfo: [{
                ...project1,
                statistics: {
                    min: 30_000,
                    max: 30_000,
                    average: 30_000,
                    count: 1
                }
            }],
            status: 'success'
        } as BuildStatusEvent);
    });

    it('independently tracks multiple runs for same program', () => {
        timeoutDurations.push(10_000, 20_000);
        tracker.run(project1, () => {
            //noop
        });
        tracker.run(project1, () => {
            //noop
        });
        expect(tracker['buildEvent']()).to.eql({
            projectInfo: [{
                ...project1,
                statistics: {
                    min: 10_000,
                    max: 20_000,
                    average: 15_000,
                    count: 2
                }
            }],
            status: 'success'
        } as BuildStatusEvent);
    });

    it('returns "building" when one of the runs is still pending', async () => {
        const deferred = new Deferred();
        tracker.run(project1, () => {
            //noop
        });
        const finishedPromise = tracker.run(project1, () => {
            return deferred.promise;
        });
        expect(tracker['buildEvent']()).to.eql({
            projectInfo: [{
                ...project1,
                statistics: {
                    min: 30_000,
                    max: 30_000,
                    average: 30_000,
                    count: 1
                }
            }],
            status: BuildStatus.building
        } as BuildStatusEvent);

        deferred.resolve();
        await finishedPromise;

        expect(tracker['buildEvent']()).to.eql({
            projectInfo: [{
                ...project1,
                statistics: {
                    min: 30_000,
                    max: 30_000,
                    average: 30_000,
                    count: 2
                }
            }],
            status: BuildStatus.success
        } as BuildStatusEvent);
    });

    it('handles error during synchronous flow', () => {
        try {
            tracker.run(project1, () => {
                throw new Error('Crash');
            });
        } catch { }

        expect(tracker['buildEvent']()).to.eql({
            projectInfo: [{
                ...project1,
                statistics: {
                    average: 30_000,
                    count: 1,
                    max: 30_000,
                    min: 30_000
                }
            }],
            status: BuildStatus.criticalError
        } as BuildStatusEvent);
    });

    it('handles error during async flow', async () => {
        try {
            await tracker.run(project1, () => {
                return Promise.reject(new Error('Crash'));
            });
        } catch { }

        expect(tracker['buildEvent']()).to.eql({
            projectInfo: [{
                ...project1,
                statistics: {
                    min: 30_000,
                    max: 30_000,
                    average: 30_000,
                    count: 1
                }
            }],
            status: BuildStatus.criticalError
        } as BuildStatusEvent);
    });

    it('only finalizes on the first call to finalize', () => {
        try {
            tracker.run(project1, (finalize) => {
                finalize();
                finalize();
            });
        } catch { }

        expect(tracker['buildEvent']()).to.eql({
            projectInfo: [{
                ...project1,
                statistics: {
                    min: 30_000,
                    max: 30_000,
                    average: 30_000,
                    count: 1
                }
            }],
            status: BuildStatus.success
        } as BuildStatusEvent);
    });

    it('supports multiple simultaneous projects', async () => {
        //run the projects out of order
        const deferred2 = new Deferred();
        const run1Promise = tracker.run(project2, () => {
            return deferred2.promise;
        });

        const deferred1 = new Deferred();
        const run2Promise = tracker.run(project1, () => {
            return deferred1.promise;
        });

        expect(tracker['buildEvent']()).to.eql({
            //the projects are sorted before being emitted
            projectInfo: [{
                ...project1,
                statistics: {
                    min: Number.MAX_SAFE_INTEGER,
                    max: 0,
                    average: 0,
                    count: 0
                }
            }, {
                ...project2,
                statistics: {
                    min: Number.MAX_SAFE_INTEGER,
                    max: 0,
                    average: 0,
                    count: 0
                }
            }],
            status: BuildStatus.building
        } as BuildStatusEvent);

        deferred1.resolve();
        deferred2.resolve();
        await Promise.all([run1Promise, run2Promise]);

        expect(tracker['buildEvent']()).to.eql({
            //the projects are sorted before being emitted
            projectInfo: [{
                ...project1,
                statistics: {
                    min: 30_000,
                    max: 30_000,
                    average: 30_000,
                    count: 1
                }
            }, {
                ...project2,
                statistics: {
                    min: 30_000,
                    max: 30_000,
                    average: 30_000,
                    count: 1
                }
            }],
            status: BuildStatus.success
        } as BuildStatusEvent);
    });

    it('getDuration returns a duration', () => {
        expect(
            new BuildStatusTracker(connection)['getDuration'](Date.now() - 500)
        ).to.be.gte(500);
    });
});
