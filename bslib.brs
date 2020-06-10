' Utility functions for the BrighterScript language

'
' Stringifies transpiled template strings.
' @param string[] quasis - an array of strings from the template literal. We trust these are always strings.
' @param dynamic[] values - the array of values from the template literal. This will contain 1 less value than the quasis
' @return string - the stringified value
function bslib_templateString(quasis, values) as string
    result = ""
    for i = 0 to quasis.count() - 1
        result = result + quasis[i] + bslib_varToString(values[i])
    end for
    result += quasis[i]
    return result
end function

'
' Convert a value into a string. For non-primitive values, this will return the type instead of its value in most cases.
' @param dynamic value - the value to be turned into a string.
' @return string - the string representation of `value`
'
function bslib_toString(value)
    valueType = type(value)
    'if the var supports `toStr()`
    if valueType = "<uninitialized>" then
        return valueType
    else if value = invalid then
        return "<invalid>"
    else if GetInterface(value, "ifToStr") <> invalid then
        return value.toStr()
    else if valueType = "roSGNode"
        return "Node(" + value.subType() + ")"
    end if
    'TODO add class name for objects once we have reflection implemented

    'when all else fails, just return the type
    return "<" + valueType + ">"
end function