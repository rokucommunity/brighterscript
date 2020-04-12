import { Scope } from '../Scope';
import { ClassStatement, ClassMethodStatement, ClassFieldStatement } from '../parser/ClassStatement';
import { XmlFile } from '../files/XmlFile';
import { BrsFile } from '../files/BrsFile';
import { DiagnosticMessages } from '../DiagnosticMessages';
import { BsDiagnostic } from '..';

export class BsClassValidator {
    private scope: Scope;
    public diagnostics: BsDiagnostic[];
    private classes: { [lowerClassName: string]: AugmentedClassStatement };

    public validate(scope: Scope) {
        this.scope = scope;
        this.diagnostics = [];
        this.classes = {};

        this.findClasses();
        this.linkClassesWithParents();
        this.validateMemberCollisions();


        this.cleanUp();
    }

    private validateMemberCollisions() {
        for (let key in this.classes) {
            let classStatement = this.classes[key];
            let methods = {};
            let fields = {};

            for (let member of classStatement.members) {
                let lowerMemberName = member.name.text.toLowerCase();

                //catch duplicate member names on same class
                if (methods[lowerMemberName] || fields[lowerMemberName]) {
                    this.diagnostics.push({
                        ...DiagnosticMessages.duplicateIdentifier(member.name.text),
                        file: classStatement.file,
                        range: member.name.range
                    });
                }

                //handle collisions in parent
                let ancestorClass = classStatement.parentClass;
                while (ancestorClass) {
                    //if the ancestor has the same named field as
                    if (ancestorClass.memberMap[lowerMemberName]) {
                    }
                    ancestorClass = classStatement.parentClass;
                }
                if (member instanceof ClassMethodStatement) {
                    methods[lowerMemberName] = member;

                } else if (member instanceof ClassFieldStatement) {
                    fields[lowerMemberName] = member;
                }
            }
        }
    }

    private cleanUp() {
        //unlink all classes from their parents so it doesn't mess up the next scope
        for (let key in this.classes) {
            let classStatement = this.classes[key];
            delete classStatement.parentClass;
            delete classStatement.file;
        }
    }

    private findClasses() {
        this.classes = {};

        for (let key in this.scope.files) {
            let file = this.scope.files[key];

            for (let x of file.file.classStatements) {
                let classStatement = x as AugmentedClassStatement;
                this.classes[classStatement.name.text.toLowerCase()] = classStatement;
                classStatement.file = file.file;
            }
        }
    }

    private linkClassesWithParents() {
        //link all classes with their parents
        for (let key in this.classes) {
            let classStatement = this.classes[key];
            let parentClassName = classStatement.extendsIdentifier?.text;
            if (parentClassName) {
                let parentClass = this.classes[parentClassName.toLowerCase()];

                //detect unknown parent class
                if (!parentClass) {
                    this.diagnostics.push({
                        ...DiagnosticMessages.classCouldNotBeFound(parentClassName, this.scope.name),
                        file: classStatement.file,
                        range: classStatement.extendsIdentifier.range
                    });
                }
                classStatement.parentClass = parentClass;
            }
        }
    }

}
type AugmentedClassStatement = ClassStatement & {
    file: BrsFile | XmlFile;
    parentClass: AugmentedClassStatement;
};
