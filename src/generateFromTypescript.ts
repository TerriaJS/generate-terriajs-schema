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
    const properties = findNodesOfKind(source, ts.SyntaxKind.PropertyDeclaration);

    for (var i = 0; i < properties.length; ++i) {
        const property = <ts.PropertyDeclaration>properties[i];
        if (property.name.kind === ts.SyntaxKind.Identifier) {
            const propertyIdentifier = <ts.Identifier>property.name;
            console.log(propertyIdentifier.text);
        }
    }
}

function findNodesOfKind(node: ts.Node, kind: ts.SyntaxKind) {
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