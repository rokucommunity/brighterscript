import type { Scope } from '../Scope';
import { DiagnosticMessages } from '../DiagnosticMessages';
import type { CallExpression } from '../parser/Expression';
import { ParseMode } from '../parser/Parser';
import type { ClassFieldStatement, ClassMethodStatement, ClassStatement } from '../parser/Statement';
import { CancellationTokenSource, Location } from 'vscode-languageserver';
import { URI } from 'vscode-uri';
import util from '../util';
import { isCallExpression, isClassFieldStatement, isClassMethodStatement, isCustomType } from '../astUtils/reflection';
import type { BscFile, BsDiagnostic } from '../interfaces';
import { createVisitor, WalkMode } from '../astUtils/visitors';
import type { BrsFile } from '../files/BrsFile';
import { TokenKind } from '../lexer';
import { getTypeFromContext } from '../types/BscType';
import type { TypeContext } from '../types/BscType';

export class BsClassValidator {
    private scope: Scope;
    private file: BrsFile;
    public diagnostics: BsDiagnostic[];
    private classes: Record<string, AugmentedClassStatement>;

    get typeContext(): TypeContext {
        return { scope: this.scope, file: this.file };
    }

    public validate(scope: Scope, file: BrsFile) {
        this.scope = scope;
        this.file = file;
        this.diagnostics = [];
        this.classes = {};

        this.findClasses();
        this.findNamespaceNonNamespaceCollisions();
        this.linkClassesWithParents();
        this.validateMemberCollisions();
        this.verifyChildConstructor();
        this.verifyNewExpressions();
        this.validateFieldTypes();

        this.cleanUp();
    }

    /**
     * Given a class name optionally prefixed with a namespace name, find the class that matches
     */
    private getClassByName(className: string, namespaceName?: string) {
        let fullName = util.getFullyQualifiedClassName(className, namespaceName);
        let cls = this.classes[fullName.toLowerCase()];
        //if we couldn't find the class by its full namespaced name, look for a global class with that name
        if (!cls) {
            cls = this.classes[className.toLowerCase()];
        }
        return cls;
    }


    /**
     * Find all "new" statements in the program,
     * and make sure we can find a class with that name
     */
    private verifyNewExpressions() {
        this.scope.enumerateBrsFiles((file) => {
            let newExpressions = file.parser.references.newExpressions;
            for (let newExpression of newExpressions) {
                let className = newExpression.className.getName(ParseMode.BrighterScript);
                let newableClass = this.getClassByName(
                    className,
                    newExpression.namespaceName?.getName(ParseMode.BrighterScript)
                );

                if (!newableClass) {
                    //try and find functions with this name.
                    let fullName = util.getFullyQualifiedClassName(className, newExpression.namespaceName?.getName(ParseMode.BrighterScript));
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
        });
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
                            URI.file(nonNamespaceClass.file.srcPath).toString(),
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
            const newMethod = classStatement.memberMap.new as ClassMethodStatement;

            if (
                //this class has a "new method"
                newMethod &&
                //this class has a parent class
                classStatement.parentClass
            ) {
                //prevent use of `m.` anywhere before the `super()` call
                const cancellationToken = new CancellationTokenSource();
                let superCall: CallExpression;
                newMethod.func.body.walk(createVisitor({
                    VariableExpression: (expression, parent) => {
                        const expressionNameLower = expression?.name?.text.toLowerCase();
                        if (expressionNameLower === 'm') {
                            this.diagnostics.push({
                                ...DiagnosticMessages.classConstructorIllegalUseOfMBeforeSuperCall(),
                                file: classStatement.file,
                                range: expression.range
                            });
                        }
                        if (isCallExpression(parent) && expressionNameLower === 'super') {
                            superCall = parent;
                            //stop walking
                            cancellationToken.cancel();
                        }
                    }
                }), {
                    walkMode: WalkMode.visitAll,
                    cancel: cancellationToken.token
                });

                //every child class constructor must include a call to `super()` (except for typedef files)
                if (!superCall && !(classStatement.file as BrsFile).isTypedef) {
                    this.diagnostics.push({
                        ...DiagnosticMessages.classConstructorMissingSuperCall(),
                        file: classStatement.file,
                        range: newMethod.range
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
                if (isClassMethodStatement(statement) || isClassFieldStatement(statement)) {
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

                    let memberType = isClassFieldStatement(member) ? 'field' : 'method';
                    let ancestorAndMember = this.getAncestorMember(classStatement, lowerMemberName);
                    if (ancestorAndMember) {
                        let ancestorMemberKind = isClassFieldStatement(ancestorAndMember.member) ? 'field' : 'method';

                        //mismatched member type (field/method in child, opposite in ancestor)
                        if (memberType !== ancestorMemberKind) {
                            this.diagnostics.push({
                                ...DiagnosticMessages.classChildMemberDifferentMemberTypeThanAncestor(
                                    memberType,
                                    ancestorMemberKind,
                                    ancestorAndMember.classStatement.getName(ParseMode.BrighterScript)
                                ),
                                file: classStatement.file,
                                range: member.range
                            });
                        }

                        //child field has same name as parent
                        if (isClassFieldStatement(member)) {
                            const ancestorFieldType = (ancestorAndMember.member as ClassFieldStatement).getType();
                            const childFieldType = member.getType();
                            if (!childFieldType.isAssignableTo(ancestorFieldType, this.typeContext)) {
                                //flag incompatible child field type to ancestor field type

                                const childFieldTypeName = childFieldType?.toString(this.typeContext) ?? member.type?.text;
                                const ancestorFieldTypeName = ancestorFieldType?.toString(this.typeContext) ?? (ancestorAndMember.member as ClassFieldStatement).type.text;
                                this.diagnostics.push({
                                    ...DiagnosticMessages.childFieldTypeNotAssignableToBaseProperty(
                                        classStatement.getName(ParseMode.BrighterScript),
                                        ancestorAndMember.classStatement.getName(ParseMode.BrighterScript),
                                        member.name.text,
                                        childFieldTypeName,
                                        ancestorFieldTypeName
                                    ),
                                    file: classStatement.file,
                                    range: member.range
                                });
                            }
                        }

                        //child method missing the override keyword
                        if (
                            //is a method
                            isClassMethodStatement(member) &&
                            //does not have an override keyword
                            !member.override &&
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

                        //child member has different visiblity
                        if (
                            //is a method
                            isClassMethodStatement(member) &&
                            (member.accessModifier?.kind ?? TokenKind.Public) !== (ancestorAndMember.member.accessModifier?.kind ?? TokenKind.Public)
                        ) {
                            this.diagnostics.push({
                                ...DiagnosticMessages.mismatchedOverriddenMemberVisibility(
                                    classStatement.name.text,
                                    ancestorAndMember.member.name?.text,
                                    member.accessModifier?.text || 'public',
                                    ancestorAndMember.member.accessModifier?.text || 'public',
                                    ancestorAndMember.classStatement.getName(ParseMode.BrighterScript)
                                ),
                                file: classStatement.file,
                                range: member.range
                            });
                        }
                    }

                    if (isClassMethodStatement(member)) {
                        methods[lowerMemberName] = member;

                    } else if (isClassFieldStatement(member)) {
                        fields[lowerMemberName] = member;
                    }
                }
            }
        }
    }


    /**
     * Check the types for fields, and validate they are valid types
     */
    private validateFieldTypes() {
        for (let key in this.classes) {
            let classStatement = this.classes[key];
            for (let statement of classStatement.body) {
                if (isClassFieldStatement(statement)) {
                    let fieldType = getTypeFromContext(statement.getType(), this.typeContext);
                    const fieldTypeName = fieldType?.toString(this.typeContext) ?? statement.type?.text;
                    const lowerFieldTypeName = fieldTypeName?.toLowerCase();

                    let addDiagnostic = false;
                    if (isCustomType(fieldType)) {
                        if (lowerFieldTypeName) {
                            const currentNamespaceName = classStatement.namespaceName?.getName(ParseMode.BrighterScript);
                            //check if this custom type is in our class map
                            if (!this.getClassByName(lowerFieldTypeName, currentNamespaceName)) {
                                addDiagnostic = true;
                            }
                        }
                    } else if (!fieldType) {
                        addDiagnostic = true;
                    }
                    if (addDiagnostic) {
                        this.diagnostics.push({
                            ...DiagnosticMessages.cannotFindType(fieldTypeName),
                            range: statement.type.range,
                            file: classStatement.file
                        });
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
        this.scope.enumerateBrsFiles((file) => {
            for (let x of file.parser.references.classStatements ?? []) {
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
                    classStatement.file = file;

                    //add a diagnostic about this class already existing
                } else {
                    this.diagnostics.push({
                        ...DiagnosticMessages.duplicateClassDeclaration(this.scope.name, name),
                        file: file,
                        range: classStatement.name.range,
                        relatedInformation: [{
                            location: Location.create(
                                URI.file(alreadyDefinedClass.file.srcPath).toString(),
                                this.classes[lowerName].range
                            ),
                            message: ''
                        }]
                    });
                }
            }
        });
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
    file: BscFile;
    parentClass: AugmentedClassStatement;
};
