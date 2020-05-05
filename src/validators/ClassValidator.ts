import { Scope } from '../Scope';
import { ClassStatement, ClassMethodStatement, ClassFieldStatement } from '../parser/ClassStatement';
import { XmlFile } from '../files/XmlFile';
import { BrsFile } from '../files/BrsFile';
import { DiagnosticMessages } from '../DiagnosticMessages';
import { BsDiagnostic } from '..';
import { CallExpression, VariableExpression, ParseMode, ExpressionStatement } from '../parser';
import { Location } from 'vscode-languageserver';
import { URI } from 'vscode-uri';
import util from '../util';

export class BsClassValidator {
    private scope: Scope;
    public diagnostics: BsDiagnostic[];
    private classes: { [lowerClassName: string]: AugmentedClassStatement };

    public validate(scope: Scope) {
        this.scope = scope;
        this.diagnostics = [];
        this.classes = {};

        this.findClasses();
        this.findNamespaceNonNamespaceCollisions();
        this.linkClassesWithParents();
        this.validateMemberCollisions();
        this.verifyChildConstructor();
        this.verifyNewExpressions();

        this.cleanUp();
    }

    /**
     * Given a class name optionally prefixed with a namespace name, find the class that matches
     */
    private getClassByName(className: string, namespaceName?: string) {
        let fullName = util.getFulllyQualifiedClassName(className, namespaceName);
        return this.classes[fullName.toLowerCase()];
    }

    /**
     * Find all "new" statements in the program,
     * and make sure we can find a class with that name
     */
    private verifyNewExpressions() {
        for (let key in this.scope.files) {
            let file = this.scope.files[key].file;
            let newExpressions = file.parser.newExpressions;
            for (let newExpression of newExpressions) {
                let className = newExpression.className.getName(ParseMode.BrighterScript);
                let newableClass = this.getClassByName(
                    className,
                    newExpression.namespaceName?.getName(ParseMode.BrighterScript)
                );

                if (!newableClass) {
                    //try and find functions with this name.
                    let fullName = util.getFulllyQualifiedClassName(className, newExpression.namespaceName?.getName(ParseMode.BrighterScript));
                    let callable = this.scope.getCallableByName(fullName);
                    //if we found a callable with this name, the user used a "new" keyword in front of a function. add error
                    if (callable) {
                        this.diagnostics.push({
                            ...DiagnosticMessages.expressionIsNotConstructable(callable.isSub ? 'sub' : 'function'),
                            file: file,
                            range: newExpression.className.range
                        });

                        //could not find a class with this name
                    } else {
                        this.diagnostics.push({
                            ...DiagnosticMessages.classCouldNotBeFound(className, this.scope.name),
                            file: file,
                            range: newExpression.className.range
                        });
                    }
                }
            }
        }
    }

    private findNamespaceNonNamespaceCollisions() {
        for (let name in this.classes) {
            let classStatement = this.classes[name];
            //catch namespace class collision with global class
            let nonNamespaceClass = this.classes[util.getTextAfterFinalDot(name).toLowerCase()];
            if (classStatement.namespaceName && nonNamespaceClass) {
                this.diagnostics.push({
                    ...DiagnosticMessages.namespacedClassCannotShareNamewithNonNamespacedClass(
                        nonNamespaceClass.name.text
                    ),
                    file: classStatement.file,
                    range: classStatement.name.range,
                    relatedInformation: [{
                        location: Location.create(
                            URI.file(nonNamespaceClass.file.pathAbsolute).toString(),
                            nonNamespaceClass.name.range
                        ),
                        message: 'Original class declared here'
                    }]
                });
            }
        }
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
                let firstStatement = ((newMethod as ClassMethodStatement).func?.body?.statements[0] as ExpressionStatement)?.expression as CallExpression;

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
                                    ancestorAndMember.classStatement.getName(ParseMode.BrighterScript)
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
                                    ancestorAndMember.classStatement.getName(ParseMode.BrighterScript)
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
                                    ancestorAndMember.classStatement.getName(ParseMode.BrighterScript)
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

            for (let x of file.file.parser.classStatements) {
                let classStatement = x as AugmentedClassStatement;
                let name = classStatement.getName(ParseMode.BrighterScript);
                //skip this class if it doesn't have a name
                if (!name) {
                    continue;
                }
                let lowerName = name.toLowerCase();
                //see if this class was already defined
                let alreadyDefinedClass = this.classes[lowerName];

                //if we don't already have this class, register it
                if (!alreadyDefinedClass) {
                    this.classes[lowerName] = classStatement;
                    classStatement.file = file.file;

                    //add a diagnostic about this class already existing
                } else {
                    this.diagnostics.push({
                        ...DiagnosticMessages.duplicateClassDeclaration(this.scope.name, name),
                        file: file.file,
                        range: classStatement.name.range,
                        relatedInformation: [{
                            location: Location.create(
                                URI.file(alreadyDefinedClass.file.pathAbsolute).toString(),
                                this.classes[lowerName].range
                            ),
                            message: ''
                        }]
                    });
                }
            }
        }
    }

    private linkClassesWithParents() {
        //link all classes with their parents
        for (let key in this.classes) {
            let classStatement = this.classes[key];
            let parentClassName = classStatement.parentClassName?.getName(ParseMode.BrighterScript);
            if (parentClassName) {
                let relativeName: string;
                let absoluteName: string;

                //if the parent class name was namespaced in the declaration of this class,
                //compute the relative name of the parent class and the absolute name of the parent class
                if (parentClassName.indexOf('.') > 0) {
                    absoluteName = parentClassName;
                    let parts = parentClassName.split('.');
                    relativeName = parts[parts.length - 1];

                    //the parent class name was NOT namespaced.
                    //compute the relative name of the parent class and prepend the current class's namespace
                    //to the beginning of the parent class's name
                } else {
                    if (classStatement.namespaceName) {
                        absoluteName = `${classStatement.namespaceName.getName(ParseMode.BrighterScript)}.${parentClassName}`;
                    } else {
                        absoluteName = parentClassName;
                    }
                    relativeName = parentClassName;
                }

                let relativeParent = this.classes[relativeName.toLowerCase()];
                let absoluteParent = this.classes[absoluteName.toLowerCase()];

                let parentClass: AugmentedClassStatement;
                //if we found a relative parent class
                if (relativeParent) {
                    parentClass = relativeParent;

                    //we found an absolute parent class
                } else if (absoluteParent) {
                    parentClass = absoluteParent;

                    //couldn't find the parent class
                } else {
                    this.diagnostics.push({
                        ...DiagnosticMessages.classCouldNotBeFound(parentClassName, this.scope.name),
                        file: classStatement.file,
                        range: classStatement.parentClassName.range
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
