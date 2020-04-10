// const { preprocessor } = require("brs");
// const { getManifest, getBsConst } = preprocessor;

// jest.mock("fs");
// const fs = require("fs");

// describe("manifest support", () => {
//     afterEach(() => {
//         fs.readFile.mockRestore();
//     });

//     describe("manifest parser", () => {
//         it("returns an empty map if manifest not found", () => {
//             fs.readFile.mockImplementation((filename, encoding, cb) =>
//                 cb(new Error("File not found"), null)
//             );

//             return expect(getManifest("/no/manifest/here")).resolves.toEqual(new Map());
//         });

//         it("rejects key-value pairs with no '='", () => {
//             fs.readFile.mockImplementation((filename, encoding, cb) =>
//                 cb(/* no error */ null, "no_equal")
//             );

//             return expect(getManifest("/has/key/but/no/equal")).rejects.toThrowError(
//                 "No '=' detected"
//             );
//         });

//         it("ignores comments", () => {
//             fs.readFile.mockImplementation((filename, encoding, cb) =>
//                 cb(/* no error */ null, "# this line is ignored!")
//             );

//             return expect(getManifest("/has/a/manifest")).resolves.toEqual(new Map());
//         });

//         it("ignores empty keys and values", () => {
//             fs.readFile.mockImplementation((filename, encoding, cb) =>
//                 cb(/* no error */ null, ["  =lorem", "ipsum=  "].join("\n"))
//             );

//             return expect(getManifest("/has/blank/keys/and/values")).resolves.toEqual(new Map());
//         });

//         it("trims whitespace from keys and values", () => {
//             fs.readFile.mockImplementation((filename, encoding, cb) =>
//                 cb(/* no error */ null, "    key = value    ")
//             );

//             return expect(getManifest("/has/extra/whitespace")).resolves.toEqual(
//                 new Map([["key", "value"]])
//             );
//         });

//         it("parses key-value pairs", () => {
//             fs.readFile.mockImplementation((filename, encoding, cb) =>
//                 cb(
//                     /* no error */ null,
//                     ["foo=bar=baz", "lorem=true", "five=5", "six=6.000", "version=1.2.3"].join("\n")
//                 )
//             );

//             return expect(getManifest("/has/a/manifest")).resolves.toEqual(
//                 new Map([
//                     ["foo", "bar=baz"],
//                     ["lorem", true],
//                     ["five", 5],
//                     ["six", 6],
//                     ["version", "1.2.3"],
//                 ])
//             );
//         });
//     });

//     describe("bs_const parser", () => {
//         it("returns an empty map if 'bs_const' isn't found", () => {
//             let manifest = new Map([["containsBsConst", false]]);
//             expect(getBsConst(manifest)).toEqual(new Map());
//         });

//         it("requires a string value for 'bs_const' attributes", () => {
//             let manifest = new Map([["bs_const", 1.2345]]);
//             expect(() => getBsConst(manifest)).toThrowError("Invalid bs_const right-hand side");
//         });

//         it("ignores empty key-value pairs", () => {
//             let manifest = new Map([["bs_const", ";;;;"]]);
//             expect(getBsConst(manifest)).toEqual(new Map());
//         });

//         it("rejects key-value pairs with no '='", () => {
//             let manifest = new Map([["bs_const", "i-have-no-equal"]]);
//             expect(() => getBsConst(manifest)).toThrowError("No '=' detected");
//         });

//         it("trims whitespace from keys and values", () => {
//             let manifest = new Map([["bs_const", "   key   =  true  "]]);
//             expect(getBsConst(manifest)).toEqual(new Map([["key", true]]));
//         });

//         it("rejects non-boolean values", () => {
//             let manifest = new Map([["bs_const", "string=word"]]);

//             expect(() => getBsConst(manifest)).toThrowError(
//                 "Invalid value for bs_const key 'string'"
//             );
//         });

//         it("allows case-insensitive booleans", () => {
//             let manifest = new Map([["bs_const", "foo=true;bar=FalSE"]]);

//             expect(getBsConst(manifest)).toEqual(
//                 new Map([
//                     ["foo", true],
//                     ["bar", false],
//                 ])
//             );
//         });
//     });
// });