import { Scope } from '../Scope';
import { ClassStatement, ClassMethodStatement, ClassFieldStatement } from '../parser/ClassStatement';
import { XmlFile } from '../files/XmlFile';
import { BrsFile } from '../files/BrsFile';
import { DiagnosticMessages } from '../DiagnosticMessages';
import { BsDiagnostic } from '..';
import { CallExpression, VariableExpression } from '../parser';

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
        this.verifyChildConstructor();

        this.cleanUp();
    }

    private verifyChildConstructor() {
        for (let key in this.classes) {
            let classStatement = this.classes[key];
            let newMethod = classStatement.memberMap.new;
            let ancestorNewMethod = this.getAncestorMember(classStatement, 'new');

            if (
                //this class has a "new method"
                newMethod &&
                //this class has a parent class
                classStatement.parentClass &&
                //this class's ancestors have a "new" method
                ancestorNewMethod
            ) {
                //verify there's a `super()` as the first statement in this member's "new" method
                let firstStatement = (newMethod as ClassMethodStatement).func?.body?.statements[0] as CallExpression;

                //if the first statement isn't a call
                if (firstStatement instanceof CallExpression === false) {
                    this.diagnostics.push({
                        ...DiagnosticMessages.classConstructorMissingSuperCall(),
                        file: classStatement.file,
                        range: newMethod.range
                    });

                    //if the first statement's left-hand-side callee isn't a variable
                } else if (firstStatement.callee instanceof VariableExpression === false) {
                    this.diagnostics.push({
                        ...DiagnosticMessages.classConstructorSuperMustBeFirstStatement(),
                        file: classStatement.file,
                        range: firstStatement.range
                    });

                    //if the method is not called "super"
                } else if ((firstStatement.callee as VariableExpression).name.text.toLowerCase() !== 'super') {
                    this.diagnostics.push({
                        ...DiagnosticMessages.classConstructorSuperMustBeFirstStatement(),
                        file: classStatement.file,
                        range: firstStatement.range
                    });
                }
            }
        }
    }

    private validateMemberCollisions() {
        for (let key in this.classes) {
            let classStatement = this.classes[key];
            let methods = {};
            let fields = {};

            for (let statement of classStatement.body) {
                if (statement instanceof ClassMethodStatement || statement instanceof ClassFieldStatement) {
                    let member = statement;
                    let lowerMemberName = member.name.text.toLowerCase();

                    //catch duplicate member names on same class
                    if (methods[lowerMemberName] || fields[lowerMemberName]) {
                        this.diagnostics.push({
                            ...DiagnosticMessages.duplicateIdentifier(member.name.text),
                            file: classStatement.file,
                            range: member.name.range
                        });
                    }

                    let memberType = member instanceof ClassFieldStatement ? 'field' : 'method';
                    let ancestorAndMember = this.getAncestorMember(classStatement, lowerMemberName);
                    if (ancestorAndMember) {
                        let ancestorMemberType = ancestorAndMember.member instanceof ClassFieldStatement ? 'field' : 'method';

                        //mismatched member type (field/method in child, opposite in parent)
                        if (memberType !== ancestorMemberType) {
                            this.diagnostics.push({
                                ...DiagnosticMessages.classChildMemberDifferentMemberTypeThanAncestor(
                                    memberType,
                                    ancestorMemberType,
                                    ancestorAndMember.classStatement.name.text
                                ),
                                file: classStatement.file,
                                range: member.range
                            });
                        }

                        //child field has same name as parent
                        if (member instanceof ClassFieldStatement) {
                            this.diagnostics.push({
                                ...DiagnosticMessages.memberAlreadyExistsInParentClass(
                                    memberType,
                                    ancestorAndMember.classStatement.name.text
                                ),
                                file: classStatement.file,
                                range: member.range
                            });
                        }

                        //child method missing the override keyword
                        if (
                            //is a method
                            member instanceof ClassMethodStatement &&
                            //does not have an override keyword
                            !member.overrides &&
                            //is not the constructur function
                            member.name.text.toLowerCase() !== 'new'
                        ) {
                            this.diagnostics.push({
                                ...DiagnosticMessages.missingOverrideKeyword(
                                    ancestorAndMember.classStatement.name.text
                                ),
                                file: classStatement.file,
                                range: member.range
                            });
                        }
                    }

                    if (member instanceof ClassMethodStatement) {
                        methods[lowerMemberName] = member;

                    } else if (member instanceof ClassFieldStatement) {
                        fields[lowerMemberName] = member;
                    }
                }
            }
        }
    }

    /**
     * Get the closest member with the specified name (case-insensitive)
     */
    private getAncestorMember(classStatement: AugmentedClassStatement, memberName: string) {
        let lowerMemberName = memberName.toLowerCase();
        let ancestor = classStatement.parentClass;
        while (ancestor) {
            let member = ancestor.memberMap[lowerMemberName];
            if (member) {
                return {
                    member: member,
                    classStatement: ancestor
                };
            }
            ancestor = ancestor.parentClass;
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
