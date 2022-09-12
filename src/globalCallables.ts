import { BrsFile } from './files/BrsFile';
import type { Callable } from './interfaces';
import { ArrayType } from './types/ArrayType';
import { BooleanType } from './types/BooleanType';
import { DynamicType } from './types/DynamicType';
import { FloatType } from './types/FloatType';
import { TypedFunctionType } from './types/TypedFunctionType';
import { IntegerType } from './types/IntegerType';
import { ObjectType } from './types/ObjectType';
import { StringType } from './types/StringType';
import { VoidType } from './types/VoidType';
import util from './util';

export let globalFile = new BrsFile('global', 'global', null);
globalFile.parse('');

type GlobalCallable = Pick<Callable, 'name' | 'shortDescription' | 'type' | 'file' | 'params' | 'documentation' | 'isDeprecated' | 'nameRange'>;

let mathFunctions: GlobalCallable[] = [{
    name: 'Abs',
    shortDescription: 'Returns the absolute value of the argument.',
    type: new TypedFunctionType(new FloatType()),
    file: globalFile,
    params: [{
        name: 'x',
        type: new FloatType(),
        isOptional: false
    }]
}, {
    name: 'Atn',
    shortDescription: 'Returns the arctangent (in radians) of the argument.',
    documentation: '`ATN(X)` returns "the angle whose tangent is X". To get arctangent in degrees, multiply `ATN(X)` by `57.29578`.',
    type: new TypedFunctionType(new FloatType()),
    file: globalFile,
    params: [{
        name: 'x',
        type: new FloatType(),
        isOptional: false
    }]
}, {
    name: 'Cdbl',
    shortDescription: 'Returns a single precision float representation of the argument. Someday may return double.',
    type: new TypedFunctionType(new FloatType()),
    file: globalFile,
    params: [{
        name: 'x',
        type: new IntegerType(),
        isOptional: false
    }]
}, {
    name: 'Cint',
    shortDescription: 'Returns an integer representation of the argument, rounding up from midpoints. CINT(2.1) returns 2; CINT(2.5) returns 3; CINT(-2.2) returns -2; CINT(-2.5) returns -2; CINT(-2.6) returns -3.',
    type: new TypedFunctionType(new IntegerType()),
    file: globalFile,
    params: [{
        name: 'x',
        type: new FloatType(),
        isOptional: false
    }]
}, {
    name: 'Cos',
    shortDescription: 'Returns the cosine of the argument (argument must be in radians). To obtain the cosine of X when X is in degrees, use CGS(X*.01745329).',
    type: new TypedFunctionType(new FloatType()),
    file: globalFile,
    params: [{
        name: 'x',
        type: new FloatType(),
        isOptional: false
    }]
}, {
    name: 'Csng',
    shortDescription: 'Returns a single-precision float representation of the argument.',
    type: new TypedFunctionType(new FloatType()),
    file: globalFile,
    params: [{
        name: 'x',
        type: new IntegerType(),
        isOptional: false
    }]
}, {
    name: 'Exp',
    shortDescription: 'Returns the "natural exponential" of X, that is, ex. This is the inverse of the LOG function, so X=EXP(LOG(X)).',
    type: new TypedFunctionType(new FloatType()),
    file: globalFile,
    params: [{
        name: 'x',
        type: new FloatType(),
        isOptional: false
    }]
}, {
    name: 'Fix',
    shortDescription: 'Returns a truncated representation of the argument. All digits to the right of the decimal point are simply chopped off, so the resultant value is an integer. For non-negative X, FIX(X)=lNT(X). For negative values of X, FIX(X)=INT(X)+1. For example, FIX(2.2) returns 2, and FIX(-2.2) returns -2.',
    type: new TypedFunctionType(new IntegerType()),
    file: globalFile,
    params: [{
        name: 'x',
        type: new FloatType(),
        isOptional: false
    }]
}, {
    name: 'Int',
    shortDescription: 'Returns an integer representation of the argument, using the largest whole number that is not greater than the argument.. INT(2.5) returns 2; INT(-2.5) returns -3; and INT(1000101.23) returns 10000101.',
    type: new TypedFunctionType(new IntegerType()),
    file: globalFile,
    params: [{
        name: 'x',
        type: new FloatType(),
        isOptional: false
    }]
}, {
    name: 'Log',
    shortDescription: 'Returns the natural logarithm of the argument, that is, loge(x) or ln(x). This is the inverse of the EXP function, so LOG(EXP(X)) = X. To find the logarithm of a number to another base b, use the formula logb(X) = loge(X) / loge(b). For example, LOG(32767) / LOG(2) returns the logarithm to base 2 of 32767.',
    type: new TypedFunctionType(new FloatType()),
    file: globalFile,
    params: [{
        name: 'x',
        type: new FloatType(),
        isOptional: false
    }]
}, {
    name: 'Rnd',
    shortDescription: 'Generates a pseudo-random number using the current pseudo-random "seed number" (generated internally and not accessible to user).returns an integer between 1 and integer inclusive . For example, RND(55) returns a pseudo-random integer greater than zero and less than 56.',
    type: new TypedFunctionType(new IntegerType()),
    file: globalFile,
    params: [{
        name: 'range',
        type: new IntegerType(),
        isOptional: false
    }]
}, {
    name: 'Rnd',
    shortDescription: 'Generates a pseudo-random number using the current pseudo-random "seed number" (generated internally and not accessible to user). Returns a float value between 0 and 1.',
    type: new TypedFunctionType(new FloatType()),
    file: globalFile,
    params: [{
        name: '0',
        type: new IntegerType(),
        isOptional: false
    }]
}, {
    name: 'Sgn',
    shortDescription: 'The "sign" function: returns -1 for X negative, 0 for X zero, and +1 for X positive.',
    type: new TypedFunctionType(new IntegerType()),
    file: globalFile,
    params: [{
        name: 'x',
        type: new FloatType(),
        isOptional: false
    }]
}, {
    name: 'Sgn',
    shortDescription: 'The "sign" function: returns -1 for X negative, 0 for X zero, and +1 for X positive.',
    type: new TypedFunctionType(new IntegerType()),
    file: globalFile,
    params: [{
        name: 'x',
        type: new IntegerType(),
        isOptional: false
    }]
}, {
    name: 'Sin',
    shortDescription: 'Returns the sine of the argument (argument must be in radians). To obtain the sine of X when X is in degrees, use SIN(X*.01745329).',
    type: new TypedFunctionType(new FloatType()),
    file: globalFile,
    params: [{
        name: 'x',
        type: new FloatType(),
        isOptional: false
    }]
}, {
    name: 'Sqr',
    shortDescription: 'Returns the square root of the argument. SQR(X) is the same as X ^ (1/2), only faster.',
    type: new TypedFunctionType(new FloatType()),
    file: globalFile,
    params: [{
        name: 'x',
        type: new FloatType(),
        isOptional: false
    }]
}, {
    name: 'Tan',
    shortDescription: 'Returns the tangent of the argument (argument must be in radians). To obtain the tangent of X when X is in degrees, use TAN(X*.01745329).',
    type: new TypedFunctionType(new FloatType()),
    file: globalFile,
    params: [{
        name: 'x',
        type: new FloatType(),
        isOptional: false
    }]
}];

let runtimeFunctions: GlobalCallable[] = [{
    name: 'CreateObject',
    shortDescription: 'Creates a BrightScript Component of class classname specified. Return invalid if the object creation fails. Some Objects have optional parameters in their constructor that are passed after name.',
    type: new TypedFunctionType(new ObjectType()),
    file: globalFile,
    params: [{
        name: 'name',
        type: new StringType(),
        isOptional: false
    }, {
        name: 'param2',
        type: new DynamicType(),
        isOptional: true
    }, {
        name: 'param3',
        type: new DynamicType(),
        isOptional: true
    }, {
        name: 'param4',
        type: new DynamicType(),
        isOptional: true
    }, {
        name: 'param5',
        type: new DynamicType(),
        isOptional: true
    }, {
        name: 'param6',
        type: new DynamicType(),
        isOptional: true
    }]
}, {
    name: 'Type',
    shortDescription: 'Returns the type of a variable and/or object. See the BrightScript Component specification for a list of types.',
    type: new TypedFunctionType(new StringType()),
    file: globalFile,
    params: [{
        name: 'variable',
        type: new ObjectType(),
        isOptional: false
    }, {
        name: 'version',
        type: new StringType(),
        isOptional: true
    }]
}, {
    name: 'GetGlobalAA',
    shortDescription: 'Each script has a global Associative Array. It can be fetched with this function. ',
    type: new TypedFunctionType(new ObjectType()),
    file: globalFile,
    params: []
}, {
    name: 'Box',
    shortDescription: 'Box() will return an object version of an intrinsic type, or pass through an object if given one.',
    type: new TypedFunctionType(new ObjectType()),
    file: globalFile,
    params: [{
        name: 'x',
        type: new DynamicType(),
        isOptional: false
    }]
}, {
    name: 'Run',
    shortDescription: `The Run function can be used to compile and run a script dynamically.\nThe file specified by that path is compiled and run.\nArguments may be passed to the script's Main function, and that script may return a result value.'`,
    type: new TypedFunctionType(new DynamicType()),
    file: globalFile,
    params: [{
        name: 'filename',
        type: new StringType(),
        isOptional: false
    }, {
        name: 'arg',
        type: new DynamicType(),
        isRestArgument: true,
        isOptional: false
    }]
}, {
    name: 'Run',
    shortDescription: `The Run function can be used to compile and run a script dynamically.\nAll files specified are compiled together, then run.\nArguments may be passed to the script's Main function, and that script may return a result value.'`,
    type: new TypedFunctionType(new DynamicType()),
    file: globalFile,
    params: [{
        name: 'filename',
        type: new ArrayType(new StringType()),
        isOptional: false
    }, {
        name: 'arg',
        type: new DynamicType(),
        isRestArgument: true,
        isOptional: true
    }]
}, {
    name: 'Eval',
    shortDescription: `Eval can be used to run a code snippet in the context of the current function. It performs a compile, and then the bytecode execution.\nIf a compilation error occurs, no bytecode execution is performed, and Eval returns an roList with one or more compile errors. Each list entry is an roAssociativeArray with ERRNO and ERRSTR keys describing the error.\nIf compilation succeeds, bytecode execution is performed and the integer runtime error code is returned. These are the same error codes as returned by GetLastRunRuntimeError().\nEval() can be usefully in two cases. The first is when you need to dynamically generate code at runtime.\nThe other is if you need to execute a statement that could result in a runtime error, but you don't want code execution to stop. '`,
    type: new TypedFunctionType(new DynamicType()),
    file: globalFile,
    isDeprecated: true,
    params: [{
        name: 'code',
        type: new StringType(),
        isOptional: false
    }]
}, {
    name: 'GetLastRunCompileError',
    shortDescription: 'Returns an roList of compile errors, or invalid if no errors. Each list entry is an roAssociativeArray with the keys: ERRNO, ERRSTR, FILESPEC, and LINENO.',
    type: new TypedFunctionType(new ObjectType()),
    file: globalFile,
    params: []
}, {
    name: 'GetLastRunRuntimeError',
    shortDescription: 'Returns an error code result after the last script Run().These are normal:\\,&hFF==ERR_OKAY\\n&hFC==ERR_NORMAL_END\\n&hE2==ERR_VALUE_RETURN',
    type: new TypedFunctionType(new IntegerType()),
    file: globalFile,
    params: []
}];

let globalUtilityFunctions: GlobalCallable[] = [
    {
        name: 'Sleep',
        shortDescription: 'This function causes the script to pause for the specified time, without wasting CPU cycles. There are 1000 milliseconds in one second.',
        type: new TypedFunctionType(new VoidType()),
        file: globalFile,
        params: [{
            name: 'milliseconds',
            type: new IntegerType(),
            isOptional: false
        }]
    }, {
        name: 'Wait',
        shortDescription: 'This function waits on objects that are "waitable" (those that have a MessagePort interface). Wait() returns the event object that was posted to the message port. If timeout is zero, "wait" will wait for ever. Otherwise, Wait will return after timeout milliseconds if no messages are received. In this case, Wait returns a type "invalid".',
        type: new TypedFunctionType(new ObjectType()),
        file: globalFile,
        params: [{
            name: 'timeout',
            type: new IntegerType(),
            isOptional: false
        }, {
            name: 'port',
            type: new ObjectType(),
            isOptional: false
        }]
    }, {
        name: 'GetInterface',
        shortDescription: 'Each BrightScript Component has one or more interfaces. This function returns a value of type "Interface". \nNote that generally BrightScript Components allow you to skip the interface specification. In which case, the appropriate interface within the object is used. This works as long as the function names within the interfaces are unique.',
        type: new TypedFunctionType(new ObjectType()),
        file: globalFile,
        params: [{
            name: 'object',
            type: new ObjectType(),
            isOptional: false
        }, {
            name: 'ifname',
            type: new StringType(),
            isOptional: false
        }]
    }, {
        name: 'FindMemberFunction',
        shortDescription: 'Returns the interface from the object that provides the specified function, or invalid if not found.',
        type: new TypedFunctionType(new ObjectType()),
        file: globalFile,
        params: [{
            name: 'object',
            type: new ObjectType(),
            isOptional: false
        }, {
            name: 'functionName',
            type: new StringType(),
            isOptional: false
        }]
    }, {
        name: 'UpTime',
        shortDescription: 'Returns the uptime of the system since the last reboot in seconds.',
        type: new TypedFunctionType(new FloatType()),
        file: globalFile,
        params: [{
            name: 'dummy',
            type: new IntegerType(),
            isOptional: false
        }]
    }, {
        name: 'RebootSystem',
        shortDescription: 'Requests the system to perform a soft reboot. The Roku platform has disabled this feature.',
        type: new TypedFunctionType(new VoidType()),
        file: globalFile,
        params: []
    }, {
        name: 'ListDir',
        shortDescription: 'Returns a List object containing the contents of the directory path specified.',
        type: new TypedFunctionType(new ObjectType()),
        file: globalFile,
        params: [{
            name: 'path',
            type: new StringType(),
            isOptional: false
        }]
    }, {
        name: 'ReadAsciiFile',
        shortDescription: 'This function reads the specified file and returns the data as a string.\nThe file can be encoded as either UTF-8 (which includes the 7-bit ASCII subset) or UTF-16.\nAn empty string is returned if the file can not be read.',
        type: new TypedFunctionType(new StringType()),
        file: globalFile,
        params: [{
            name: 'filePath',
            type: new StringType(),
            isOptional: false
        }]
    }, {
        name: 'WriteAsciiFile',
        shortDescription: 'This function writes the specified string data to a file at the specified location.\nThe string data is written as UTF-8 encoded (which includes the 7-bit ASCII subset).\nThe function returns true if the file was successfully written.',
        type: new TypedFunctionType(new BooleanType()),
        file: globalFile,
        params: [{
            name: 'filePath',
            type: new StringType(),
            isOptional: false
        }, {
            name: 'text',
            type: new StringType(),
            isOptional: false
        }]
    }, {
        name: 'CopyFile',
        shortDescription: 'Make a copy of a file.',
        type: new TypedFunctionType(new BooleanType()),
        file: globalFile,
        params: [{
            name: 'source',
            type: new StringType(),
            isOptional: false
        }, {
            name: 'destination',
            type: new StringType(),
            isOptional: false
        }]
    }, {
        name: 'MoveFile',
        shortDescription: 'Rename a file.',
        type: new TypedFunctionType(new BooleanType()),
        file: globalFile,
        params: [{
            name: 'source',
            type: new StringType(),
            isOptional: false
        }, {
            name: 'destination',
            type: new StringType(),
            isOptional: false
        }]
    }, {
        name: 'MatchFiles',
        shortDescription:
            `Search a directory for filenames that match a certain pattern. Pattern is a wildmat expression. Returns a List object.
This function checks all the files in the directory specified against the pattern specified and places any matches in the returned roList.

The returned list contains only the part of the filename that is matched against the pattern not the full path.
The pattern may contain certain special characters:

A '?' matches any single character.
A '*' matches zero or more arbitrary characters.
The character class '[...]' matches any single character specified within the brackets. The closing bracket is treated as a member of the character class if it immediately follows the opening bracket. i.e. '[]]' matches a single close bracket. Within the class '-' can be used to specify a range unless it is the first or last character. e.g. '[A-Cf-h]' is equivalent to '[ABCfgh]'.
A character class can be negated by specifying '^' as the first character. To match a literal '^' place it elsewhere within the class.
The characters '?', '*' and '[' lose their special meaning if preceded by a single '\\'. A single '\\' can be matched as '\\\\'.`,
        type: new TypedFunctionType(new ArrayType(new StringType())),
        file: globalFile,
        params: [{
            name: 'path',
            type: new StringType(),
            isOptional: false
        }, {
            name: 'pattern_in',
            type: new StringType(),
            isOptional: false
        }]
    }, {
        name: 'DeleteFile',
        shortDescription: 'Delete the specified file.',
        type: new TypedFunctionType(new BooleanType()),
        file: globalFile,
        params: [{
            name: 'file',
            type: new StringType(),
            isOptional: false
        }]
    }, {
        name: 'DeleteDirectory',
        shortDescription: 'Deletes the specified directory.  It is only possible to delete an empty directory.',
        type: new TypedFunctionType(new BooleanType()),
        file: globalFile,
        params: [{
            name: 'dir',
            type: new StringType(),
            isOptional: false
        }]
    }, {
        name: 'CreateDirectory',
        shortDescription: 'Creates the specified Directory. Only one directory can be created at a time',
        type: new TypedFunctionType(new BooleanType()),
        file: globalFile,
        params: [{
            name: 'dir',
            type: new StringType(),
            isOptional: false
        }]
    }, {
        name: 'FormatDrive',
        shortDescription: 'Formats a specified drive using the specified filesystem.',
        type: new TypedFunctionType(new BooleanType()),
        file: globalFile,
        params: [{
            name: 'drive',
            type: new StringType(),
            isOptional: false
        }, {
            name: 'fs_type',
            type: new StringType(),
            isOptional: false
        }]
    }, {
        name: 'StrToI',
        shortDescription: 'Return the integer value of the string, or 0 if nothing is parsed.',
        type: new TypedFunctionType(new IntegerType()),
        file: globalFile,
        params: [{
            name: 'str',
            type: new StringType(),
            isOptional: false
        }]
    }, {
        name: 'RunGarbageCollector',
        shortDescription: `This function runs the garbage collector. It returns and Associative Array with some statistics regarding the garbage collection. \nSee the Garbage Collection section of the manual for more detail. You don't normally need to call this function.`,
        type: new TypedFunctionType(new ObjectType()),
        file: globalFile,
        params: []
    }, {
        name: 'ParseJson',
        shortDescription:
            `This function will parse a string formatted according to RFC4627 and return an equivalent BrightScript object (consisting of booleans, integer and floating point numbers, strings, roArray, and roAssociativeArray objects).  If the string is not syntactically correct, Invalid will be returned.  A few other things to note:

Any roAssociativeArray objects in the returned objects will be case sensitive. As of Roku OS 9.4, to return a case-insensitive structure, set the flags parameter to "i".
If the "i" option is used, and the jsonString includes multiple keys that match case-insensitively, duplicates are overwritten and only the last matching values are preserved.
An error will be returned if arrays/associative arrays are nested more than 256 levels deep.`,
        type: new TypedFunctionType(new ObjectType()),
        file: globalFile,
        params: [{
            name: 'jsonString',
            type: new StringType(),
            isOptional: false
        },
        {
            name: 'flags',
            type: new StringType(),
            isOptional: true
        }]
    }, {
        name: 'FormatJson',
        shortDescription:
            `Formats a supported data type as a JSON string.

Data types supported are booleans, integer and floating point numbers, strings, roArray, and roAssociativeArray objects.

An error will be returned if arrays/associative arrays are nested more than 256 levels deep.

If an error occurs an empty string will be returned.

Normally non-ASCII characters are escaped in the output string as "\\uXXXX" where XXXX is the hexadecimal representation of the Unicode character value.  If flags=1, non-ASCII characters are not escaped.`,
        type: new TypedFunctionType(new StringType()),
        file: globalFile,
        params: [{
            name: 'object',
            type: new ObjectType(),
            isOptional: false
        }, {
            name: 'flags',
            type: new StringType(),
            isOptional: true
        }]
    }, {
        name: 'Tr',
        shortDescription:
            `Translates the source string into the language of the current locale. The function looks for a translations.xml file in the XLIFF format in the pkg:/locale subdirectory named for the current locale (see ifDeviceInfo.GetCurrentLocale for the list of currently-supported locales). If the translations.xml file exists for the current locale, and contains the source string with a translated string, the function returns the translated string. Otherwise, the function returns the original source string.

In some cases you may want to include a placeholder marker in a localizable string that gets dynamically substituted with a value at runtime.
One way to accomplish that is to use the Replace method on the string value returned from the Tr() lookup.`,
        type: new TypedFunctionType(new StringType()),
        file: globalFile,
        params: [{
            name: 'source',
            type: new StringType(),
            isOptional: false
        }]
    }
];

let globalStringFunctions: GlobalCallable[] = [
    {
        name: 'UCase',
        shortDescription: 'Converts the string to all upper case.',
        type: new TypedFunctionType(new StringType()),
        file: globalFile,
        params: [{
            name: 's',
            type: new StringType(),
            isOptional: false
        }]
    }, {
        name: 'LCase',
        shortDescription: 'Converts the string to all lower case.',
        type: new TypedFunctionType(new StringType()),
        file: globalFile,
        params: [{
            name: 's',
            type: new StringType(),
            isOptional: false
        }]
    }, {
        name: 'Asc',
        shortDescription: 'Returns the Unicode ("ASCII") value for the first character of the specified string\n An empty string argument will return 0.',
        type: new TypedFunctionType(new IntegerType()),
        file: globalFile,
        params: [{
            name: 'letter',
            type: new StringType(),
            isOptional: false
        }]
    }, {
        name: 'Chr',
        shortDescription:
            `Performs the inverse of the Asc function: returns a one-character string whose character has the specified Unicode value. Returns empty string if the specified value is 0 or an invalid Unicode value.

 print Chr(67) ' prints: C

By using Chr, you can create strings containing characters which cannot be contained in quotes, such as newline or the quote character itself.

 print (Chr(34) + "hello" + Chr(34))  ' prints: "hello"`,
        type: new TypedFunctionType(new StringType()),
        file: globalFile,
        params: [{
            name: 'ch',
            type: new IntegerType(),
            isOptional: false
        }]
    }, {
        name: 'Instr',
        shortDescription: 'Returns the position of the first instances of substring within text, starting at the specified start position.\nReturns 0 if the substring is not found. Unlike the ifString.Instr() method, the first position is 1.',
        type: new TypedFunctionType(new IntegerType()),
        file: globalFile,
        params: [{
            name: 'start',
            type: new IntegerType(),
            isOptional: false
        }, {
            name: 'text',
            type: new StringType(),
            isOptional: false
        }, {
            name: 'substring',
            type: new StringType(),
            isOptional: false
        }]
    }, {
        name: 'Left',
        shortDescription: 'Returns the first n characters of s. ',
        type: new TypedFunctionType(new StringType()),
        file: globalFile,
        params: [{
            name: 's',
            type: new StringType(),
            isOptional: false
        }, {
            name: 'n',
            type: new IntegerType(),
            isOptional: false
        }]
    }, {
        name: 'Len',
        shortDescription: 'Returns the number of characters in the specified string.',
        type: new TypedFunctionType(new IntegerType()),
        file: globalFile,
        params: [{
            name: 's',
            type: new StringType(),
            isOptional: false
        }]
    }, {
        name: 'Mid',
        shortDescription: 'Returns a substring of s with length n and starting at position p.\nn may be omitted, in which case the string starting at p and ending at the end of the string is returned.\nUnlike the ifString.Mid() method, the first character in the string is position 1.',
        type: new TypedFunctionType(new StringType()),
        file: globalFile,
        params: [{
            name: 's',
            type: new StringType(),
            isOptional: false
        }, {
            name: 'p',
            //description: '1-based position',
            isOptional: false,
            type: new IntegerType()
        }, {
            name: 'n',
            type: new IntegerType(),
            isOptional: true
        }]
    }, {
        name: 'Right',
        shortDescription: 'Returns the last n characters of s.',
        type: new TypedFunctionType(new StringType()),
        file: globalFile,
        params: [{
            name: 's',
            type: new StringType(),
            isOptional: false
        }, {
            name: 'n',
            type: new IntegerType(),
            isOptional: false
        }]
    }, {
        name: 'Str',
        shortDescription: 'Converts a value to a string. Str(A), for example, returns a string equal to the decimal representation of the numeric value of A.\nNote: for non-negative numbers, a leading blank is inserted before the value string as a sign placeholder.',
        type: new TypedFunctionType(new StringType()),
        file: globalFile,
        params: [{
            name: 'value',
            type: new FloatType(),
            isOptional: false
        }]
    }, {
        name: 'StrI',
        shortDescription: 'Converts a value to a string. Str(A), for example, returns a string equal to the decimal representation of the numeric value of A.\nNote: for non-negative numbers, a leading blank is inserted before the value string as a sign placeholder. If the radix parameter is provided, then converts the integer value into a string representation using the given radix.\nIf radix is not 2 .. 36 then an empty string is returned.\nNote that the returned string does not include a base prefix and uses lowercase letters to represent those digits in bases greater than 10.',
        type: new TypedFunctionType(new StringType()),
        file: globalFile,
        params: [{
            name: 'value',
            type: new IntegerType(),
            isOptional: false
        }, {
            name: 'radix',
            type: new IntegerType(),
            isOptional: true
        }]
    }, {
        name: 'string',
        shortDescription: 'Returns a string composed of n copies of the second argument concatenated together.',
        type: new TypedFunctionType(new StringType()),
        file: globalFile,
        params: [{
            name: 'n',
            type: new IntegerType(),
            isOptional: false
        }, {
            name: 'str',
            type: new StringType(),
            isOptional: false
        }]
    }, {
        name: 'StringI',
        shortDescription: 'Returns a string composed of n copies of the character whose Unicode value is the second argument.',
        type: new TypedFunctionType(new StringType()),
        file: globalFile,
        params: [{
            name: 'n',
            type: new IntegerType(),
            isOptional: false
        }, {
            name: 'ch',
            type: new IntegerType(),
            isOptional: false
        }]
    }, {
        name: 'Val',
        shortDescription: 'Performs the inverse of the STR function: returns the number represented by the characters in a string argument.\nFor example, if A$="12" and B$="34" then VAL(A$+ "."+B$) returns the number 12.34.',
        type: new TypedFunctionType(new FloatType()),
        file: globalFile,
        params: [{
            name: 'str',
            type: new StringType(),
            isOptional: false
        }]
    }, {
        name: 'Val',
        shortDescription: 'Returns the integer value from parsing the string with the specified radix.\nRadix should be 2 .. 36 or the special value 0 (which automatically identified hexadecimal or octal numbers based on 0x or 0 prefixes respectively).\nLeading whitespace is ignored then as much of the rest of the string will be parsed as valid.',
        type: new TypedFunctionType(new IntegerType()),
        file: globalFile,
        params: [{
            name: 'str',
            type: new StringType(),
            isOptional: false
        }, {
            name: 'radix',
            type: new IntegerType(),
            isOptional: true
        }]
    }, {
        name: 'Substitute',
        shortDescription: 'Replaces all instances of {0} or ^0 in str with arg0.  Similarly, replaces all instances of {1} or ^1 with arg1, {2} or ^2 with arg2, and {3} or ^3 with arg3.',
        type: new TypedFunctionType(new StringType()),
        file: globalFile,
        params: [{
            name: 'str',
            type: new StringType(),
            isOptional: false
        }, {
            name: 'arg0',
            type: new StringType(),
            isOptional: false
        }, {
            name: 'arg1',
            type: new StringType(),
            isOptional: true
        }, {
            name: 'arg2',
            type: new StringType(),
            isOptional: true
        }, {
            name: 'arg3',
            type: new StringType(),
            isOptional: true
        }]
    }
];


let programStatementFunctions = [
    {
        name: 'Tab',
        shortDescription: 'Moves the cursor to the specified position on the current line (modulo the width of your console if you specify TAB positions greater than the console width). TAB may be used several times in a PRINT list. No punctuation is required after a TAB modifier. Numerical expressions may be used to specify a TAB position. TAB cannot be used to move the cursor to the left. If the cursor is beyond the specified position, the TAB is ignored.',
        type: new TypedFunctionType(new VoidType()),
        file: globalFile,
        params: [{
            name: 'expression',
            type: new IntegerType(),
            isOptional: false
        }]
    }, {
        name: 'Pos',
        shortDescription: 'Returns a number from 0 to window width, indicating the current cursor position on the cursor. Requires a "dummy argument" (any numeric expression).',
        type: new TypedFunctionType(new VoidType()),
        file: globalFile,
        params: [{
            name: 'x',
            type: new IntegerType(),
            isOptional: false
        }]
        //TODO this is a temporary fix for library imported files. Eventually this should be moved into `Roku_Ads.brs` and handled by the `Library` statement
    }, {
        name: 'Roku_Ads',
        shortDescription: 'The main entry point for instantiating the ad interface. This object manages ad server requests, parses ad structure, schedules and renders ads, and triggers tracking beacons.\n\nThe Roku ad parser/renderer object returned has global scope because it is meant to represent interaction with external resources (the ad server and any tracking services) that have persistence and state independent of the ad rendering within a client application.',
        type: new TypedFunctionType(new ObjectType()),
        file: globalFile,
        params: []
    }, { //TODO Same as the Roku_Ads.brs (RAF) library above, the following functions are from the 'v30/bslCore.brs' library
        name: 'bslBrightScriptErrorCodes',
        shortDescription: 'Returns an roAssociativeArray with name value pairs of the error name and corresponding integer value, for example ERR_OKAY = &hFF.',
        type: new TypedFunctionType(new ObjectType()),
        file: globalFile,
        params: []
    }, {
        name: 'bslGeneralConstants',
        shortDescription: 'Returns an roAssociativeArray with name value pairs of system constants, for example MAX_INT = 2147483647.',
        type: new TypedFunctionType(new ObjectType()),
        file: globalFile,
        params: []
    }, {
        name: 'bslUniversalControlEventCodes',
        shortDescription: 'Returns an roAssociativeArray with name value pairs of the remote key code (buttons) constants, for example BUTTON_SELECT_PRESSED = 6.',
        type: new TypedFunctionType(new ObjectType()),
        file: globalFile,
        params: []
    },
    {
        name: 'AsciiToHex',
        shortDescription: 'Returns the hex encoded string, for example AsciiToHex("Hi!") = "486921".',
        type: new TypedFunctionType(new StringType()),
        file: globalFile,
        params: [{
            name: 'ascii',
            type: new StringType(),
            isOptional: false
        }]
    }, {
        name: 'HexToAscii',
        shortDescription: 'Returns a string that is the hex decoded string, for example HexToAscii("486921") = "Hi!".',
        type: new TypedFunctionType(new StringType()),
        file: globalFile,
        params: [{
            name: 'hex',
            type: new StringType(),
            isOptional: false
        }]
    },
    {
        name: 'HexToInteger',
        shortDescription: 'Returns the integer value of the passed in hex string.',
        type: new TypedFunctionType(new IntegerType()),
        file: globalFile,
        params: [{
            name: 'hex',
            type: new StringType(),
            isOptional: false
        }]
    }, {
        name: 'HexToInteger',
        shortDescription: 'Returns a string that is the hex decoded string, for example HexToAscii("486921") = "Hi!".',
        type: new TypedFunctionType(new IntegerType()),
        file: globalFile,
        params: [{
            name: 'hex',
            type: new StringType(),
            isOptional: false
        }]
    }, {
        name: 'dfNewBitmapSet',
        shortDescription: `The goal is to enable simple xml descriptions of graphics resources like bitmaps, regions, sprites, animations, and layouts to be used in your games. The library handles parsing, loading, rendering, and animation of sprites sheets (multiple images in a single png file).
Filename is the path to an XML file that contains info about bitmap regions, animation frames, and ExtraInfo metadata (any fields you would like) about resources used in 2d games.
Returns an roAssociativeArray with the following name value pairs:
ExtraInfo: roAssociativeArray
Regions: roAssociativeArray of name, roRegions pairs
Animations: roAssociativeArray of name, roArray of roRegion pairs.
Backgrounds: roAssociativeArray of name, path pairs.`,
        type: new TypedFunctionType(new ObjectType()),
        file: globalFile,
        params: [{
            name: 'filename',
            type: new StringType(),
            isOptional: false
        }]
    }, {
        name: 'dfDrawMessage',
        shortDescription: 'dest is an roScreen/roBitmap/roRegion and region is an roRegion.\nGreys the entire dest region and draws it the region centered on the drawable dest.',
        type: new TypedFunctionType(new VoidType()),
        file: globalFile,
        params: [{
            name: 'dest',
            type: new ObjectType(),
            isOptional: false
        }, {
            name: 'region',
            type: new ObjectType(),
            isOptional: false
        }]
    }, {
        name: 'dfDrawImage',
        shortDescription: 'Returns True if successful.\nCreates a bitmap out of the image stored in the filename "path" and draws it at position (x,y) of the drawable dest.',
        type: new TypedFunctionType(new BooleanType()),
        file: globalFile,
        params: [{
            name: 'dest',
            type: new ObjectType(),
            isOptional: false
        }, {
            name: 'path',
            type: new StringType(),
            isOptional: false
        }, {
            name: 'x',
            type: new IntegerType(),
            isOptional: false
        }, {
            name: 'y',
            type: new IntegerType(),
            isOptional: false
        }]
    }, {
        name: 'dfSetupDisplayRegions',
        shortDescription: `Helper function to setup screen scaling with supplied pillar box or letterbox images to fill the entire screen.
screen is an roScreen
topx and topy are the coordinates of the upper left hand corner of the main drawing region
Width and height is the size of the main drawing region

Returns an associative array containing the following roRegions
Main: main drawable region
Left: left region if there is pillar box area on the left
Right: right region if there is a pillar box area on the right
Upper: upper region if there is a letterbox area at thetop
Lower: lower region if there is a letterbox area at the bottom
When using these regions as drawables, your graphics will be translated and clipped to these regions.`,
        type: new TypedFunctionType(new ObjectType()),
        file: globalFile,
        params: [{
            name: 'screen',
            type: new ObjectType(),
            isOptional: false
        }, {
            name: 'topx',
            type: new IntegerType(),
            isOptional: false
        }, {
            name: 'topy',
            type: new IntegerType(),
            isOptional: false
        }, {
            name: 'width',
            type: new IntegerType(),
            isOptional: false
        }, {
            name: 'height',
            type: new IntegerType(),
            isOptional: false
        }]
    }, {
        name: 'dfSetBackground',
        shortDescription: `dfSetBackground helps manage the limited video memory. The video memory does not currently run a defragmenter, and is very limited. These constraints make it important that large bitmaps (like backgrounds that fill the entire screen) are only allocated when needed. It is also helpful if you set your first initial background very early in your program, and then immediately replace the background after it is no longer in use. This helper function supports this background management for your application.
backgroundName is a key for the Backgrounds roAssociative array of backgrounds.
Backgrounds is an roAssociative array of background name keys and file path string values
This function creates an roBitmap out of the background image file and returns a region the size of the entire roBitmap.`,
        type: new TypedFunctionType(new ObjectType()),
        file: globalFile,
        params: [{
            name: 'backgroundName',
            type: new StringType(),
            isOptional: false
        }, {
            name: 'backgrounds',
            type: new ObjectType(),
            isOptional: false
        }]
    }
] as Callable[];

export let globalCallables = [...mathFunctions, ...runtimeFunctions, ...globalUtilityFunctions, ...globalStringFunctions, ...programStatementFunctions];
for (let callable of globalCallables) {
    //give each callable a dummy location
    callable.nameRange = util.createRange(0, 0, 0, callable.name.length);

    //add each parameter to the type
    for (let param of callable.params) {
        callable.type.addParameter(param);
    }

    //set name in type
    callable.type.setName(callable.name);

    (callable as Callable).getName = function getName() {
        return this.name;
    };

}
globalFile.callables = globalCallables as Callable[];
for (const callable of globalCallables) {
    globalFile.parser.symbolTable.addSymbol(callable.name, undefined, callable.type);
}

/**
 * A map of all built-in function names. We use this extensively in scope validation
 * so keep a single copy in memory to improve performance
 */
export const globalCallableMap = globalCallables.reduce((map, x) => {
    map.set(x.name.toLowerCase(), x as Callable);
    return map;
}, new Map<string, Callable>());
