/// <reference path="../typings/node/node.d.ts" />

import * as ts from "typescript";
import * as fs from "fs";

interface DocEntry {
    name?: string,
    fileName?: string,
    documentation?: string,
    type?: string,
    constructors?: DocEntry[],
    parameters?: DocEntry[],
    returnType?: string
};

/** Generate documention for all classes in a set of .ts files */
function generateDocumentation(fileNames: string[], options: ts.CompilerOptions): void {
    // Build a program using the set of root file names in fileNames
    let program = ts.createProgram(fileNames, options);

    // Get the checker, we will use it to find more about classes
    let checker = program.getTypeChecker();

    let output: DocEntry[] = [];

    // Visit every sourceFile in the program
    for (const sourceFile of program.getSourceFiles()) {
        // Walk the tree to search for classes
        ts.forEachChild(sourceFile, visit);
    }

    // print out the doc
    fs.writeFileSync("classes.json", JSON.stringify(output, undefined, 4));

    return;

    /** visit nodes finding exported classes */
    function visit(node: ts.Node) {
        // Only consider exported nodes
        if (!isNodeExported(node)) {
            return;
        }

        if (node.kind === ts.SyntaxKind.ClassDeclaration) {
            // This is a top level class, get its symbol
            let symbol = checker.getSymbolAtLocation((<ts.ClassDeclaration>node).name);
            output.push(serializeClass(symbol));
            // No need to walk any further, class expressions/inner declarations
            // cannot be exported
        }
        else if (node.kind === ts.SyntaxKind.ModuleDeclaration) {
            // This is a namespace, visit its children
            ts.forEachChild(node, visit);
        }
    }

    /** Serialize a symbol into a json object */
    function serializeSymbol(symbol: ts.Symbol): DocEntry {
        return {
            name: symbol.getName(),
            documentation: ts.displayPartsToString(symbol.getDocumentationComment()),
            type: checker.typeToString(checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration))
        };
    }

    /** Serialize a class symbol infomration */
    function serializeClass(symbol: ts.Symbol) {
        let details = serializeSymbol(symbol);

        // Get the construct signatures
        let constructorType = checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration);
        details.constructors = constructorType.getConstructSignatures().map(serializeSignature);
        return details;
    }

    /** Serialize a signature (call or construct) */
    function serializeSignature(signature: ts.Signature) {
        return {
            paramters: signature.parameters.map(serializeSymbol),
            returnType: checker.typeToString(signature.getReturnType()),
            documentation: ts.displayPartsToString(signature.getDocumentationComment())
        };
    }

    /** True if this is visible outside this file, false otherwise */
    function isNodeExported(node: ts.Node): boolean {
        return (node.flags & ts.NodeFlags.Export) !== 0 || (node.parent && node.parent.kind === ts.SyntaxKind.SourceFile);
    }
}

generateDocumentation(process.argv.slice(2), {
    target: ts.ScriptTarget.ES5, module: ts.ModuleKind.CommonJS
});

export function parse(filename: string, sourceCode: string) {
    const source = ts.createSourceFile(filename, sourceCode, ts.ScriptTarget.ES2015);
    const classes = findNodesOfKind(source, ts.SyntaxKind.ClassDeclaration);

    if (classes.length === 0) {
        console.log(filename + ' has no classes!');
    } else if (classes.length > 1) {
        console.log(filename + ' has ' + classes.length + ' classes.  Only the first will be used.');
    }

    return classes[0];
}

export function getTypeProp(source: ts.ClassDeclaration, propertyName: string) {
    const getAccessors = <ts.GetAccessorDeclaration[]>findNodesOfKind(source, ts.SyntaxKind.GetAccessor);
    const typeAccessor = getAccessors.filter(function(getAccessor: ts.GetAccessorDeclaration) {
        if (getAccessor.name.kind === ts.SyntaxKind.Identifier) {
            const methodIdentifier = <ts.Identifier>getAccessor.name;
            if (methodIdentifier.text === propertyName) {
                return true;
            }
        }
        return false;
    })[0];

    if (!typeAccessor) {
        return undefined;
    }

    const returnStatement = <ts.ReturnStatement>findNodesOfKind(typeAccessor, ts.SyntaxKind.ReturnStatement)[0];
    if (!returnStatement || !returnStatement.expression || returnStatement.expression.kind !== ts.SyntaxKind.StringLiteral) {
        return undefined;
    }

    const literalExpression = <ts.StringLiteral>returnStatement.expression;
    return literalExpression.text;
}

/**
 * Turns JSDoc comments attached to a catalog item model into schema properties.
 * @param  {Object} model    [description]
 */
export function processText(model: {program: ts.Program, typeChecker: ts.TypeChecker, source: ts.ClassDeclaration}) {
    console.log(model.source);

    // var className, cls = comments.filter(eq('kind', 'class'))[0];
    // if (cls) { className = cls.name; } else throw 'No @class comment in ' + model.name;

    // /*** Generate JSON schema for the class-level parameters ***/
    // var out = {
    //     type: 'object',
    //     defaultProperties: [
    //         'name', 'type', 'url' // do these always apply? Probably.
    //     ],
    //     properties: {}
    // };
    // if (model.name !== 'CatalogMember') {
    //     out.allOf = [];
    //     if (model.name.match(/.CatalogItem$/)) {
    //         out.allOf.push({ $ref: 'CatalogItem.json' });
    //     } else if (model.name.match(/.CatalogGroup$/)) {
    //         out.allOf.push({ $ref: 'CatalogGroup.json' });
    //     }
    //     if (!model.parent.match(/^(CatalogItem|CatalogGroup|CatalogMember)$/)) {
    //         out.allOf.push({ $ref: model.parent + '.json' });
    //     }
    //     out.allOf.push({ $ref: 'CatalogMember.json' });
    // }
    // var props;
    // try {
    //     props = getClassProps(comments, className, model.inheritsLine);
    // } catch (e) {
    //     throw Error("Error getting class properties for class " + className + ": " + e.message);
    // }

    // /*** Generate JSON schema for each of the class properties. ***/
    // props.forEach(function(x) {
    //     var p = {
    //         type: unarray(x.type.filter(supportedType).map(editorType)),
    //         title: getTag(x, 'editortitle', titleify(x.name)),
    //         description: replaceLinks(getTag(x, 'editordescription', x.description
    //             .replace(/^Gets or sets the/, 'The')
    //             .replace(/^Gets or sets a/, 'A')
    //             .replace(/\s*This property is observable./, '')))
    //     };
    //     if (p.type === 'array') {
    //         p.format = 'tabs';
    //         p.items = editorArrayItems(x);
    //     } else if (p.type === 'boolean') {
    //         p.format = 'checkbox';
    //     } else if (p.type === 'string' && p.name === 'description') {
    //         p.format = 'textarea';
    //     }

    //     p.format = getTag(x, 'editorformat', p.format);
    //     if (p.format === 'textarea') {
    //         p.options = { expand_height: true };
    //     }

    //     p = specialProps(x.name, p, className);
    //     out.properties[x.name] = p;
    // });
    // delete (out.properties.typeName);

    // !argv.quiet && console.log(model.name + new Array(32 - model.name.length).join(' ') + Object.keys(out.properties).join(' '));
    // model.outFile = argv.dest + '/' + model.name + '.json';
    // if (model.typeId) {
    //     writeJson(argv.dest + '/' + model.name + '_type.json', makeShellFile(model, out, className, comments))
    //         .catch(showError);
    // }
    // model.description = undefined; //###testing
    // model.title = undefined;
    // writeJson(model.outFile, out).catch(showError);
}

function findNodesOfKind(node: ts.Node, kind: ts.SyntaxKind): ts.Node[] {
    const result = [];

    ts.forEachChild(node, visit);

    function visit(node: ts.Node) {
        if (node.kind === kind) {
            result.push(node);
        } else {
            ts.forEachChild(node, visit);
        }
    }

    return result;
}