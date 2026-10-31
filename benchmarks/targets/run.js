const { createBuilder, getConfig } = require('../helpers');

module.exports = async (options) => {
    const { suite, fullName, suiteOptions } = options;

    let builder;
    suite.add(fullName, (deferred) => {
        builder = createBuilder(options);
        //full build, including emit
        builder.run({ ...getConfig(options), noEmit: false, ...options.additionalConfig }).finally(() => {
            deferred.resolve();
        });
    }, {
        ...suiteOptions,
        'defer': true
    });
};
