# Async/Await
Async functions let you write code that waits on promises as if it ran top to bottom, instead of nesting callbacks. BrighterScript converts them into promise chains that use the [@rokucommunity/promises](https://github.com/rokucommunity/promises) library.

## Basic usage
Mark a function with `async`, then use `await` to wait for a promise to finish. `await` gives you the promise's value, or throws if the promise was rejected.

```brighterscript
async function getAuthToken()
    try
        username = await getUsernameAsync()
        password = await promptForPassword(username)
        authToken = await requestAuthToken(username, password)
        return authToken
    catch e
        print e
    end try
end function
```

<details>
  <summary>View the transpiled BrightScript code</summary>

```brightscript
function getAuthToken()
    __bsc_scope = {}
    return promises_chain(promises_try(function(__bsc_value, __bsc_scope)
        return getUsernameAsync()
    end function, [invalid, __bsc_scope]), __bsc_scope).then(function(__bsc_value, __bsc_scope)
        __bsc_scope.username = __bsc_value
        return promptForPassword(__bsc_scope.username)
    end function).then(function(__bsc_value, __bsc_scope)
        password = __bsc_value
        return requestAuthToken(__bsc_scope.username, password)
    end function).then(function(__bsc_value, __bsc_scope)
        authToken = __bsc_value
        return authToken
    end function).catch(function(e, __bsc_scope)
        print e
    end function).toPromise()
end function
```

</details>

An async function always returns a promise, even when it never awaits anything. The value it `return`s is what the promise resolves to, and an error it throws rejects the promise. Code before the first `await` runs right away, like a regular function.

`async` works on named functions, `sub`s, class methods, and anonymous functions:

```brighterscript
class UserService
    async function load()
        m.user = await fetchUserAsync()
    end function
end class

sub main()
    onLoad = async sub()
        await loadEverythingAsync()
    end sub
end sub
```

A class constructor (`sub new()`) can't be async.

## Where you can use `await`
`await` only works inside an async function. For now it's supported in these forms:

```brighterscript
async sub main()
    await doWorkAsync()                 'standalone, ignoring the value
    user = await getUserAsync()         'assigned to a variable
    m.user = await getUserAsync()       'assigned to a property
    m.users["bob"] = await getUserAsync() 'assigned to an index
    return await getUserAsync()         'returned
end sub
```

Each of these has to be directly in the body of the async function, or directly in a `try` block that is itself directly in the body. Anywhere else (inside an `if`, a loop, a `catch` block, or in the middle of a larger expression like `print await getUserAsync()`) is an error for now. Support for more places is planned. Until then, assign the awaited value to a variable first:

```brighterscript
async sub main()
    user = await getUserAsync()
    if user <> invalid then
        print user.name
    end if
end sub
```

Control flow that doesn't contain an `await` (`if`, loops, `try`/`catch`, and early `return`s) works anywhere in an async function.

`async` and `await` are still allowed as variable, function, and property names everywhere else. Inside an async function, `await` followed by a value is always an `await`.

## Types
The return type you declare on an async function is the type of the value its promise resolves to. Calling the function gives you the promise (typed `dynamic`), and `await`ing the call gives you the declared type:

```brighterscript
async function getName() as string
    return "bob"
end function

async sub main()
    promise = getName()     'dynamic (a promise)
    name = await getName()  'string
end sub
```

`await`ing a value that isn't a promise (like a number or a string) gives the value back unchanged.

## The promises library
The transpiled code calls the [@rokucommunity/promises](https://github.com/rokucommunity/promises) library. When any file in your project has an async function, BrighterScript adds the library to your build and, like `bslib.brs`, imports it into every component automatically. Projects without async functions don't get it:

- `source/promises.brs` (move it with the [`promisesDestinationDir`](../tooling/bsconfig.md#promisesdestinationdir) option)
- `components/promises/Promise.xml`, the `promises_Promise` node that the library creates

If you already install the library with [ropm](https://github.com/rokucommunity/ropm) (`source/roku_modules/promises` or `source/roku_modules/rokucommunity_promises`), BrighterScript uses your copy instead of adding its own.

Promises resolve through node observers, so a task thread that awaits needs its message port set up the way the library [describes](https://github.com/rokucommunity/promises#promises-in-tasks).

## How it works
BrightScript functions can't see the variables of the function they're created in, so each part of an async function between `await`s becomes its own callback, and they all share a `__bsc_scope` object:

- Parameters, and any variable used in more than one callback, are stored on `__bsc_scope` (variables used in only one callback stay local)
- `m` is stored on `__bsc_scope` too, because the callbacks run with the global `m` instead of your object's
- When a `return` can be followed by more callbacks, the callbacks that come after it skip their work and pass the returned value along
