import type { Scope } from '../Scope';
import { DiagnosticMessages } from '../DiagnosticMessages';
import type { CallExpression } from '../parser/Expression';
import { ParseMode } from '../parser/Parser';
import type { ClassStatement, MethodStatement, NamespaceStatement } from '../parser/Statement';
import { CancellationTokenSource } from 'vscode-languageserver';
import util from '../util';
import { isCallExpression, isFieldStatement, isMethodStatement, isNamespaceStatement } from '../astUtils/reflection';
import type { BsDiagnostic } from '../interfaces';
import { createVisitor, WalkMode } from '../astUtils/visitors';
import type { BrsFile } from '../files/BrsFile';
import { TokenKind } from '../lexer/TokenKind';
import { DynamicType } from '../types/DynamicType';
import type { BscType } from '../types/BscType';
import { SymbolTypeFlag } from '../SymbolTable';
import type { BscFile } from '../files/BscFile';

export class BsClassValidator {
    private scope: Scope;
    public diagnostics: BsDiagnostic[];
    /**
     * The key is the namespace-prefixed class name. (i.e. `NameA.NameB.SomeClass` or `CoolClass`)
     */
    private classes: Map<string, AugmentedClassStatement> = new Map();

    public constructor(scope: Scope) {
        this.scope = scope;
        this.diagnostics = [];
    }

    public validate() {
        this.findClasses();
        this.linkClassesWithParents();
        this.detectCircularReferences();
        this.validateMemberCollisions();
        this.verifyChildConstructor();
        this.verifyNewExpressions();

        this.cleanUp();
    }

    /**
     * Given a class name optionally prefixed with a namespace name, find the class that matches
     */
    private getClassByName(className: string, namespaceName?: string) {
        let fullName = util.getFullyQualifiedClassName(className, namespaceName);
        let cls = this.classes.get(fullName.toLowerCase());
        //if we couldn't find the class by its full namespaced name, look for a global class with that name
        if (!cls) {
            cls = this.classes.get(className.toLowerCase());
        }
        return cls;
    }


    /**
     * Find all "new" statements in the program,
     * and make sure we can find a class with that name
     */
    private verifyNewExpressions() {
        this.scope.enumerateBrsFiles((file) => {
            // eslint-disable-next-line @typescript-eslint/dot-notation
            let newExpressions = file['_cachedLookups'].newExpressions;
            for (let newExpression of newExpressions) {
                let className = newExpression.className.getName(ParseMode.BrighterScript);
                const namespaceName = newExpression.findAncestor<NamespaceStatement>(isNamespaceStatement)?.getName(ParseMode.BrighterScript);
                let newableClass = this.getClassByName(
                    className,
                    namespaceName
                );

                if (!newableClass) {
                    //try and find functions with this name.
                    let fullName = util.getFullyQualifiedClassName(className, namespaceName);
                    let callable = this.scope.getCallableByName(fullName);
                    //if we found a callable with this name, the user used a "new" keyword in front of a function. add error
                    if (callable) {
                        this.diagnostics.push({
                            ...DiagnosticMessages.expressionIsNotConstructable(callable.isSub ? 'sub' : 'function'),
                            file: file,
                            range: newExpression.className.range
                        });

                    } else {
                        //could not find a class with this name (handled by ScopeValidator)
                    }
                }
            }
        });
    }

    private verifyChildConstructor() {
        for (const [, classStatement] of this.classes) {
            const newMethod = classStatement.memberMap.new as MethodStatement;

            if (
                //this class has a "new method"
                newMethod &&
                //this class has a parent class
                classStatement.parentClass
            ) {
                //prevent use of `m.` anywhere before the `super()` call
                const cancellationToken = new CancellationTokenSource();
                let superCall: CallExpression | undefined;
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

    private detectCircularReferences() {
        for (let [, cls] of this.classes) {
            const names = new Map<string, string>();
            do {
                const className = cls.getName(ParseMode.BrighterScript);
                if (!className) {
                    break;
                }
                const lowerClassName = className.toLowerCase();
                //if we've already seen this class name before, then we have a circular dependency
                if (lowerClassName && names.has(lowerClassName)) {
                    this.diagnostics.push({
                        ...DiagnosticMessages.circularReferenceDetected(
                            Array.from(names.values()).concat(className), this.scope.name),
                        file: cls.file,
                        range: cls.name.range
                    });
                    break;
                }
                names.set(lowerClassName, className);

                if (!cls.parentClass) {
                    break;
                }

                cls = cls.parentClass;
            } while (cls);
        }
    }

    private validateMemberCollisions() {
        for (const [, classStatement] of this.classes) {
            let methods = {};
            let fields = {};

            for (let statement of classStatement.body) {
                if (isMethodStatement(statement) || isFieldStatement(statement)) {
                    let member = statement;
                    let memberName = member.name;

                    if (!memberName) {
                        continue;
                    }

                    let lowerMemberName = memberName.text.toLowerCase();

                    //catch duplicate member names on same class
                    if (methods[lowerMemberName] || fields[lowerMemberName]) {
                        this.diagnostics.push({
                            ...DiagnosticMessages.duplicateIdentifier(memberName.text),
                            file: classStatement.file,
                            range: memberName.range
                        });
                    }

                    let memberType = isFieldStatement(member) ? 'field' : 'method';
                    let ancestorAndMember = this.getAncestorMember(classStatement, lowerMemberName);
                    if (ancestorAndMember) {
                        let ancestorMemberKind = isFieldStatement(ancestorAndMember.member) ? 'field' : 'method';

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
                        if (isFieldStatement(member)) {
                            let ancestorMemberType: BscType = new DynamicType();
                            if (isFieldStatement(ancestorAndMember.member)) {
                                ancestorMemberType = ancestorAndMember.member.getType({ flags: SymbolTypeFlag.typetime });
                            } else if (isMethodStatement(ancestorAndMember.member)) {
                                ancestorMemberType = ancestorAndMember.member.func.getType({ flags: SymbolTypeFlag.typetime });
                            }
                            const childFieldType = member.getType({ flags: SymbolTypeFlag.typetime });
                            if (childFieldType && !ancestorMemberType.isTypeCompatible(childFieldType)) {
                                //flag incompatible child field type to ancestor field type
                                this.diagnostics.push({
                                    ...DiagnosticMessages.childFieldTypeNotAssignableToBaseProperty(
                                        classStatement.getName(ParseMode.BrighterScript) ?? '',
                                        ancestorAndMember.classStatement.getName(ParseMode.BrighterScript),
                                        memberName.text,
                                        childFieldType.toString(),
                                        ancestorMemberType.toString()
                                    ),
                                    file: classStatement.file,
                                    range: member.range
                                });
                            }
                        }

                        //child method missing the override keyword
                        if (
                            //is a method
                            isMethodStatement(member) &&
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
                            isMethodStatement(member) &&
                            (member.accessModifier?.kind ?? TokenKind.Public) !== (ancestorAndMember.member.accessModifier?.kind ?? TokenKind.Public)
                        ) {
                            this.diagnostics.push({
                                ...DiagnosticMessages.mismatchedOverriddenMemberVisibility(
                                    classStatement.name.text,
                                    ancestorAndMember.member.name?.text,
                                    member.accessModifier?.text ?? 'public',
                                    ancestorAndMember.member.accessModifier?.text || 'public',
                                    ancestorAndMember.classStatement.getName(ParseMode.BrighterScript)
                                ),
                                file: classStatement.file,
                                range: member.range
                            });
                        }
                    }

                    if (isMethodStatement(member)) {
                        methods[lowerMemberName] = member;

                    } else if (isFieldStatement(member)) {
                        fields[lowerMemberName] = member;
                    }
                }
            }
        }
    }

    /**
     * Get the closest member with the specified name (case-insensitive)
     */
    getAncestorMember(classStatement, memberName) {
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
            ancestor = ancestor.parentClass !== ancestor ? ancestor.parentClass : null;
        }
    }

    private cleanUp() {
        //unlink all classes from their parents so it doesn't mess up the next scope
        for (const [, classStatement] of this.classes) {
            delete classStatement.parentClass;
            delete (classStatement as any).file;
        }
    }

    private findClasses() {
        this.classes = new Map();
        this.scope.enumerateBrsFiles((file) => {

            // eslint-disable-next-line @typescript-eslint/dot-notation
            for (let x of file['_cachedLookups'].classStatements ?? []) {
                let classStatement = x as AugmentedClassStatement;
                let name = classStatement.getName(ParseMode.BrighterScript);
                //skip this class if it doesn't have a name
                if (!name) {
                    continue;
                }
                let lowerName = name.toLowerCase();
                //see if this class was already defined
                let alreadyDefinedClass = this.classes.get(lowerName);

                //if we don't already have this class, register it
                if (!alreadyDefinedClass) {
                    this.classes.set(lowerName, classStatement);
                    classStatement.file = file;
                }
            }
        });
    }

    private linkClassesWithParents() {
        //link all classes with their parents
        for (const [, classStatement] of this.classes) {
            let parentClassName = classStatement.parentClassName?.getName();
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
                    const namespace = classStatement.findAncestor<NamespaceStatement>(isNamespaceStatement);
                    if (namespace) {
                        absoluteName = `${namespace.getName(ParseMode.BrighterScript)}.${parentClassName}`;
                    } else {
                        absoluteName = parentClassName;
                    }
                    relativeName = parentClassName;
                }

                let relativeParent = this.classes.get(relativeName.toLowerCase());
                let absoluteParent = this.classes.get(absoluteName.toLowerCase());

                let parentClass: AugmentedClassStatement | undefined;
                //if we found a relative parent class
                if (relativeParent) {
                    parentClass = relativeParent;

                    //we found an absolute parent class
                } else if (absoluteParent) {
                    parentClass = absoluteParent;

                } else {
                    //couldn't find the parent class (validated in ScopeValidator)
                }
                classStatement.parentClass = parentClass;
            }
        }
    }
}

type AugmentedClassStatement = ClassStatement & {
    file: BscFile;
    parentClass: AugmentedClassStatement | undefined;
};
