import type { Scope } from '../Scope';
import { DiagnosticMessages } from '../DiagnosticMessages';
import type { CallExpression } from '../parser/Expression';
import { ParseMode } from '../parser/Parser';
import type { ClassStatement, FieldStatement, InterfaceStatement, MemberFieldStatement, MemberMethodStatement, MethodStatement, Statement } from '../parser/Statement';
import type { DiagnosticSeverity } from 'vscode-languageserver';
import { CancellationTokenSource } from 'vscode-languageserver';
import { URI } from 'vscode-uri';
import util from '../util';
import { isCallExpression, isCustomType, isFieldStatement, isInterfaceFieldStatement, isInterfaceMethodStatement, isInterfaceType, isMethodStatement } from '../astUtils/reflection';
import type { BscFile, BsDiagnostic } from '../interfaces';
import { createVisitor, WalkMode } from '../astUtils/visitors';
import type { BrsFile } from '../files/BrsFile';
import { TokenKind } from '../lexer/TokenKind';
import { DynamicType } from '../types/DynamicType';
import type { BscType, TypeContext } from '../types/BscType';
import { getTypeFromContext } from '../types/BscType';
import type { Identifier } from '../lexer/Token';
import type { References } from '../parser/Parser';


export class BsClassValidator implements BsClassValidator {
    private scope: Scope;
    private file: BrsFile;
    public diagnostics: BsDiagnostic[];
    /**
     * The key is the namespace-prefixed class name. (i.e. `NameA.NameB.SomeClass` or `CoolClass`)
     */
    private classes: Map<string, AugmentedClassStatement>;
    private interfaces: Map<string, AugmentedInterfaceStatement>;

    get typeContext(): TypeContext {
        return { scope: this.scope, file: this.file };
    }

    public validate(scope: Scope, file: BrsFile) {
        this.scope = scope;
        this.file = file;
        this.diagnostics = [];

        this.findClasses();
        this.findInterfaces();
        this.findNamespaceNonNamespaceCollisions();
        this.linkWithParents(this.classes);
        this.linkWithParents(this.interfaces);
        this.detectCircularReferences();
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
        let cls = this.classes.get(fullName.toLowerCase());
        //if we couldn't find the class by its full namespaced name, look for a global class with that name
        if (!cls) {
            cls = this.classes.get(className.toLowerCase());
        }
        return cls;
    }

    /**
    * Given an interface name optionally prefixed with a namespace name, find the interface that matches
    */
    private getInterfaceByName(ifaceName: string, namespaceName?: string) {
        let fullName = util.getFullyQualifiedClassName(ifaceName, namespaceName);
        let iface = this.interfaces.get(fullName.toLowerCase());
        //if we couldn't find the interface by its full namespaced name, look for a global interface with that name
        if (!iface) {
            iface = this.interfaces.get(ifaceName.toLowerCase());
        }
        return iface;
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

                    } else {
                        //could not find a class with this name (handled by ScopeValidator)
                    }
                }
            }
        });
    }

    private findNamespaceNonNamespaceCollisions() {
        for (const [className, classStatement] of this.classes) {
            //catch namespace class collision with global class
            let nonNamespaceClass = this.classes.get(util.getTextAfterFinalDot(className).toLowerCase());
            if (classStatement.namespaceName && nonNamespaceClass) {
                this.diagnostics.push({
                    ...DiagnosticMessages.namespacedClassCannotShareNamewithNonNamespacedClass(
                        nonNamespaceClass.name.text
                    ),
                    file: classStatement.file,
                    range: classStatement.name.range,
                    relatedInformation: [{
                        location: util.createLocation(
                            URI.file(nonNamespaceClass.file.srcPath).toString(),
                            nonNamespaceClass.name.range
                        ),
                        message: 'Original class declared here'
                    }]
                });
            }
        }
        for (const [ifaceName, ifaceStatement] of this.interfaces) {
            //catch namespace class collision with global class
            let nonNamespaceInterface = this.interfaces.get(util.getTextAfterFinalDot(ifaceName).toLowerCase());
            if (ifaceStatement.namespaceName && nonNamespaceInterface) {
                this.diagnostics.push({
                    ...DiagnosticMessages.namespacedInterfaceCannotShareNameWithNonNamespacedInterface(
                        nonNamespaceInterface.tokens.name.text
                    ),
                    file: ifaceStatement.file,
                    range: ifaceStatement.tokens.name.range,
                    relatedInformation: [{
                        location: util.createLocation(
                            URI.file(nonNamespaceInterface.file.srcPath).toString(),
                            nonNamespaceInterface.tokens.name.range
                        ),
                        message: 'Original interface declared here'
                    }]
                });
            }
        }
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

    private detectCircularReferences() {
        for (let [, cls] of this.classes) {
            const names = new Map<string, string>();
            do {
                const className = cls.getName(ParseMode.BrighterScript);
                const lowerClassName = className.toLowerCase();
                //if we've already seen this class name before, then we have a circular dependency
                if (names.has(lowerClassName)) {
                    this.diagnostics.push({
                        ...DiagnosticMessages.circularReferenceDetected([
                            ...names.values(),
                            className
                        ], this.scope.name),
                        file: cls.file,
                        range: cls.name.range
                    });
                    break;
                }
                names.set(lowerClassName, className);
                cls = cls.parentClass;
            } while (cls);
        }
    }

    private isMemberFieldStatement(stmt: Statement): stmt is MemberFieldStatement {
        return isFieldStatement(stmt) || isInterfaceFieldStatement(stmt);
    }

    private isMemberMethodStatement(stmt: Statement): stmt is MemberMethodStatement {
        return isMethodStatement(stmt) || isInterfaceMethodStatement(stmt);
    }

    private isMemberStatement(stmt: Statement): stmt is Statement & MemberFieldOrMethod {
        return isFieldStatement(stmt) || isMethodStatement(stmt);
    }

    private validateMemberCollisionsForStatements<T extends AugmentedClassStatement | AugmentedInterfaceStatement>(map: Map<string, T>) {
        for (const [, bodyStatement] of map) {
            let methods = {};
            let fields = {};

            for (let statement of bodyStatement.body) {
                if (this.isMemberStatement(statement)) {
                    let member = statement;
                    let lowerMemberName = member.name.text.toLowerCase();

                    //catch duplicate member names on same class
                    if (methods[lowerMemberName] || fields[lowerMemberName]) {
                        this.diagnostics.push({
                            ...DiagnosticMessages.duplicateIdentifier(member.name.text),
                            file: bodyStatement.file,
                            range: member.name.range
                        });
                    }

                    let memberType = this.isMemberFieldStatement(member) ? 'field' : 'method';
                    let ancestorAndMember = this.getAncestorMember(bodyStatement, lowerMemberName);
                    if (ancestorAndMember) {
                        let ancestorMemberKind = this.isMemberFieldStatement(ancestorAndMember.member) ? 'field' : 'method';

                        //mismatched member type (field/method in child, opposite in ancestor)
                        if (memberType !== ancestorMemberKind) {
                            this.diagnostics.push({
                                ...DiagnosticMessages.classChildMemberDifferentMemberTypeThanAncestor(
                                    memberType,
                                    ancestorMemberKind,
                                    ancestorAndMember.ancestorStatement.getName(ParseMode.BrighterScript)
                                ),
                                file: bodyStatement.file,
                                range: member.range
                            });
                        }

                        //child field has same name as parent
                        if (this.isMemberFieldStatement(member)) {
                            let ancestorMemberType: BscType = new DynamicType();
                            if (this.isMemberFieldStatement(ancestorAndMember.member)) {
                                ancestorMemberType = ancestorAndMember.member.getType();
                            } else if (this.isMemberMethodStatement(ancestorAndMember.member)) {
                                ancestorMemberType = ancestorAndMember.member.func.getFunctionType();
                            }
                            const childFieldType = member.getType();
                            if (!childFieldType.isAssignableTo(ancestorMemberType, this.typeContext)) {
                                //flag incompatible child field type to ancestor field type

                                const childFieldTypeName = childFieldType?.toString(this.typeContext) ?? member.type?.getText();
                                const ancestorFieldTypeName = ancestorMemberType?.toString(this.typeContext) ?? (ancestorAndMember.member as FieldStatement).type.getText();
                                this.diagnostics.push({
                                    ...DiagnosticMessages.childFieldTypeNotAssignableToBaseProperty(
                                        bodyStatement.getName(ParseMode.BrighterScript),
                                        ancestorAndMember.ancestorStatement.getName(ParseMode.BrighterScript),
                                        member.name.text,
                                        childFieldTypeName,
                                        ancestorFieldTypeName
                                    ),
                                    file: bodyStatement.file,
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
                                    ancestorAndMember.ancestorStatement.getName(ParseMode.BrighterScript)
                                ),
                                file: bodyStatement.file,
                                range: member.range
                            });
                        }

                        //child member has different visiblity
                        if (
                            //is a method
                            isMethodStatement(member) && isMethodStatement(ancestorAndMember.member) &&
                            (member.accessModifier?.kind ?? TokenKind.Public) !== (ancestorAndMember.member.accessModifier?.kind ?? TokenKind.Public)
                        ) {
                            this.diagnostics.push({
                                ...DiagnosticMessages.mismatchedOverriddenMemberVisibility(
                                    bodyStatement.name.text,
                                    ancestorAndMember.member.name?.text,
                                    member.accessModifier?.text || 'public',
                                    ancestorAndMember.member.accessModifier?.text || 'public',
                                    ancestorAndMember.ancestorStatement.getName(ParseMode.BrighterScript)
                                ),
                                file: bodyStatement.file,
                                range: member.range
                            });
                        }
                    }

                    if (this.isMemberMethodStatement(member)) {
                        methods[lowerMemberName] = member;

                    } else if (this.isMemberFieldStatement(member)) {
                        fields[lowerMemberName] = member;
                    }
                }
            }
        }
    }

    private validateMemberCollisions() {
        this.validateMemberCollisionsForStatements(this.classes);
        this.validateMemberCollisionsForStatements(this.interfaces);
    }


    private validateFieldTypesForStatements<T extends AugmentedClassStatement | AugmentedInterfaceStatement>(map: Map<string, T>) {
        for (const [, statement] of map) {
            for (let bodyStatement of statement.body) {
                if (this.isMemberFieldStatement(bodyStatement)) {
                    let fieldType = getTypeFromContext(bodyStatement.getType(), this.typeContext);
                    const fieldTypeName = fieldType?.toString(this.typeContext) ?? bodyStatement.type?.getText();
                    const lowerFieldTypeName = fieldTypeName?.toLowerCase();

                    let addDiagnostic = false;
                    if (isCustomType(fieldType)) {
                        if (lowerFieldTypeName) {
                            const currentNamespaceName = bodyStatement.namespaceName?.getName(ParseMode.BrighterScript);
                            //check if this custom type is in our class map
                            if (!this.getClassByName(lowerFieldTypeName, currentNamespaceName)) {
                                addDiagnostic = true;
                            }
                        }
                    } else if (isInterfaceType(fieldType)) {
                        if (lowerFieldTypeName) {
                            const currentNamespaceName = bodyStatement.namespaceName?.getName(ParseMode.BrighterScript);
                            //check if this custom type is in our class map
                            if (!this.getInterfaceByName(lowerFieldTypeName, currentNamespaceName)) {
                                addDiagnostic = true;
                            }
                        }
                    } else if (!fieldType) {
                        addDiagnostic = true;
                    }
                    if (addDiagnostic) {
                        this.diagnostics.push({
                            ...DiagnosticMessages.cannotFindType(fieldTypeName),
                            range: bodyStatement.type.range,
                            file: statement.file
                        });
                    }
                }
            }
        }
    }

    /**
     * Check the types for fields, and validate they are valid types
     */
    private validateFieldTypes() {
        this.validateFieldTypesForStatements(this.classes);
        this.validateFieldTypesForStatements(this.interfaces);
    }

    /**
     * Get the closest member with the specified name (case-insensitive)
     */
    private getAncestorMember(classStatement: AugmentedClassStatement | AugmentedInterfaceStatement, memberName: string) {
        let lowerMemberName = memberName.toLowerCase();
        let ancestor = classStatement.parentClass;
        while (ancestor) {
            let member = ancestor.memberMap[lowerMemberName];
            if (member) {
                return {
                    member: member,
                    ancestorStatement: ancestor
                };
            }
            ancestor = ancestor.parentClass !== ancestor ? ancestor.parentClass : null;
        }
    }

    private cleanUp() {
        //unlink all classes from their parents so it doesn't mess up the next scope
        for (const [, classStatement] of this.classes) {
            delete classStatement.parentClass;
            delete classStatement.file;
        }
        //unlink all interfaces from their parents so it doesn't mess up the next scope
        for (const [, interfaceStatement] of this.interfaces) {
            delete interfaceStatement.parentClass;
            delete interfaceStatement.file;
        }
    }


    private findStatements<T extends AugmentedClassStatement | AugmentedInterfaceStatement>(referencesFunc: (references: References) => T[], dupeDiagnosticFunc: (a: string, b: string) => { message: string; code: number; severity: DiagnosticSeverity }): Map<string, T> {
        const map = new Map();
        this.scope.enumerateBrsFiles((file) => {
            const references = referencesFunc(file.parser.references);
            for (let x of references ?? []) {
                let classStatement = x;
                let name = classStatement.getName(ParseMode.BrighterScript);
                //skip this class if it doesn't have a name
                if (!name) {
                    continue;
                }
                let lowerName = name.toLowerCase();
                //see if this class was already defined
                let alreadyDefinedClass = map.get(lowerName);

                //if we don't already have this class, register it
                if (!alreadyDefinedClass) {
                    map.set(lowerName, classStatement);
                    classStatement.file = file;

                    //add a diagnostic about this class already existing
                } else {
                    this.diagnostics.push({
                        ...dupeDiagnosticFunc(this.scope.name, name),
                        file: file,
                        range: classStatement.name.range,
                        relatedInformation: [{
                            location: util.createLocation(
                                URI.file(alreadyDefinedClass.file.srcPath).toString(),
                                map.get(lowerName).range
                            ),
                            message: ''
                        }]
                    });
                }
            }
        });
        return map;
    }

    private findClasses() {
        this.classes = this.findStatements(
            (references) => references.classStatements as any,
            DiagnosticMessages.duplicateClassDeclaration
        );
    }

    private findInterfaces() {
        this.interfaces = this.findStatements(
            (references) => references.interfaceStatements as any,
            DiagnosticMessages.duplicateInterfaceDeclaration
        );
    }

    private linkWithParents<T extends AugmentedClassStatement | AugmentedInterfaceStatement>(map: Map<string, T>) {
        //link all classes with their parents
        for (const [, classStatement] of map) {
            if (classStatement.hasParent()) {
                let parentNames = classStatement.getPossibleFullParentNames();
                let parentClass: T;
                for (const parentName of parentNames) {
                    parentClass = map.get(parentName.toLowerCase());
                    if (parentClass) {
                        break;
                    }
                }
                if (parentClass) {
                    classStatement.parentClass = parentClass;
                } else {
                    //couldn't find the parent class (validated in ScopeValidator)
                }
            }
        }
    }
}

type AugmentedClassStatement = ClassStatement & {
    file?: BscFile;
    parentClass?: AugmentedClassStatement;
};


type AugmentedInterfaceStatement = InterfaceStatement & {
    file?: BscFile;
    parentClass?: AugmentedInterfaceStatement;
};

interface MemberFieldOrMethod {
    name: Identifier;
}
