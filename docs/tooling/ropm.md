# ropm Support

BrighterScript features that need runtime support (like the [null-coalescing operator](../language-features/null-coalescing-operator.md)) call functions in [bslib](https://github.com/rokucommunity/bslib/blob/master/source/bslib.brs), BrighterScript's BrightScript runtime library. For BrighterScript-transpiled projects to work as [ropm](https://github.com/rokucommunity/ropm) modules, they need a reference to bslib in their package. As ropm and BrighterScript become more popular, this could result in many duplicate copies of `bslib.brs`.

To reduce that duplication, BrighterScript has built-in support for loading `bslib` from ropm:

1. If your program does not use ropm, or _does_ use ropm but does not directly reference bslib, then the BrighterScript compiler copies bslib to `pkg:/source/bslib.brs` at transpile time.
2. If your program uses ropm and has installed `bslib` as a dependency, then the BrighterScript compiler does _not_ emit a copy of bslib at `pkg:/source/bslib.brs`, and instead uses the version from ropm at `pkg:/source/roku_modules/bslib/bslib.brs`.

## Installing bslib in your ropm-enabled project

bslib is published to npm as [@rokucommunity/bslib](https://npmjs.com/package/@rokucommunity/bslib). We recommend installing it with the `bslib` alias, since it produces smaller transpiled code (a `bslib_` prefix instead of `rokucommunity_bslib_`):

```bash
ropm install bslib@npm:@rokucommunity/bslib
```

Installing it without the alias works too, it just produces longer names:

```bash
ropm install @rokucommunity/bslib
```

See also the [`bslibDestinationDir`](bsconfig.md#bslibdestinationdir) option, which controls where the compiler puts its copy of bslib.
