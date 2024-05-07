import * as fsExtra from 'fs-extra';
import { standardizePath as rokuDeployStandardizePath } from 'roku-deploy';


function driveLetterToLower(fullPath: string) {
    if (fullPath) {
        let firstCharCode = fullPath.charCodeAt(0);
        if (
            //is upper case A-Z
            firstCharCode >= 65 && firstCharCode <= 90 &&
            //next char is colon
            fullPath[1] === ':'
        ) {
            fullPath = fullPath[0].toLowerCase() + fullPath.substring(1);
        }
    }
    return fullPath;
}

function standardizePath(stringParts, ...expressions: any[]) {
    let result: string[] = [];
    for (let i = 0; i < stringParts.length; i++) {
        result.push(stringParts[i], expressions[i]);
    }
    return driveLetterToLower(
        rokuDeployStandardizePath(
            result.join('')
        )
    );
}

const dataJsonPath = standardizePath(`${__dirname}/../src/roku-types/data.json`);

if (!fsExtra.existsSync(dataJsonPath)) {
    fsExtra.outputJSONSync(dataJsonPath, {});
}
