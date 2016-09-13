"use strict";
/*jshint -W030, node: true */

var esprima = require('esprima'),
    fs = require('fs'),
    jsdoc = require('jsdoc-parse'),
    path = require('path'),
    when = require('when'),
    node = require('when/node'),
    fsp = node.liftAll(require('fs')),
    glob = require('glob-all'); // promisified version of fs
var specialProperties = require('./specialProperties.json');

var argv;

function defined(x) {
    return x !== undefined;
}

function defaultValue(x, y, z) {
    if (defined(x)) {
        return x;
    } else if (defined(y)) {
        return y;
    } else
    return z;
}

// returns a custom @tag for a comment, or else the fallback value.
function getTag(item, tag, fallback) {
    try {
        return item.customTags.filter(eq('tag', tag))[0].value;
    } catch (e) {
        return fallback;
    }
}

// 'myWmsPropName' -> 'My WMS prop name'
function titleify(propName) {
    var s = propName[0].toUpperCase();
    for (var i = 1; i < propName.length; i++) {
        if (propName[i].match(/[A-Z]/)) {
            s += ' ' + propName[i].toLowerCase();
        } else {
            s += propName[i];
        }
    }
    return s.split(' ').map(function(word) {
        if (word.match(/^(wms|url|kml|csv|json|id|gpx|czml|csv|wfs|wmts|geojson|ckan)$/i)) {
            return word.toUpperCase();
        } else {
            return word;
        }
    }).join(' ');
}

// allows x.filter(eq('a.b.c', 3))
function eq(field, value) {
    return function(x) {
        var parts = field.split('.');
        while (parts.length > 1 && defined(x)) {
            x = x[parts[0]];
            parts = parts.slice(1);
        }
        if (!defined(x)) {
            return false;
        }
        return x[parts[0]] === value;
    };
}

function getTypeProp(source, typeProp) {
// Yes, we really are going to parse an entire JS file using Esprima, and navigate all the way down the hierarchy just to identify the magic
// statement that looks like `return 'geojson';`
    try {
        var r = source.body.filter(eq('expression.callee.name', 'defineProperties'))[0] // inside a defineProperties block
            .expression.arguments[1].properties.filter(eq('key.name', typeProp))[0]     // a property of the form '<typeProp>: { ... }'
            .value.properties[0].value.body.body[0].argument.value;                     // ........... return 'thebitwewant';
        return r;
    } catch (e) {
        return undefined; // if there's no such statement, it's probably not a real CatalogItem type.
    }
}

// Is the commented type of this property something we can edit?
function supportedType(type) {
    return !!type.match(/^(Boolean|Number|String|Object|LegendUrl|Array(\.<(String|Number|Object|GetFeatureInfoFormat)>)?)$/i);
}

// For consistent behaviour, '@editortype' is expressed as if it were '@type', and we process it into a JSDoc internal type.
function fromEditorTypes(types) {
    // Support either '{Number} this is ignored' or 'Number' formats.
    var found = types.match(/(\{(.*)\})?(.*)/);
    return defaultValue(found[2], found[3]).split('|').map(function(type) {
        if (type === 'Number[]')
            return 'Array.<Number>';
        else if (type === 'String[]')
            return 'Array.<String>';
        else if (type === 'Object[]')
            return 'Array.<Object>';
        else return type;
    });
}

// convert JSDoc type to JSON Editor type
function editorType(type) {
    if (type.match(/Array/i)) {
        return 'array';
    } else if (type.match(/LegendUrl/i)) {
        return 'string';
    } else {
        return type.toLowerCase();
    }
}

// Given an array type, return the appropriate JSON Editor json.
function editorArrayItems(prop) {
    var type = {
        'Array.<String>': 'string',
        'Array.<Number>': 'number',
        'Array.<GetFeatureInfoFormat>': 'enum',
        'Array.<Object>': 'object',
        'Array': 'string'
    }[prop.type];
    if (!defined(type)) {
        throw 'Not an array type: ' + prop.type;
    }
    var items = {};
    items.type = getTag(prop, 'editoritemstype', type);
    items.title = getTag(prop, 'editoritemstitle');
    items.description = getTag(prop, 'editoritemsdescription');
    if (!argv.quiet && items.title) {
        console.log(items.title);
    }
    if (prop.type === 'Array.<GetFeatureInfoFormat>') {
        items.enum = [ 'json', 'xml', 'html', 'text' ];
    }
    return items;
}

// Search the whole input file just to find the line where the class inherits from CatalogItem/CatalogGroup.
// Takes a function(err, result) callback.
function findInherits(fulltext, filename) {

    var searchRE = /inherit\s*\(([A-Za-z0-9_-]+).*Catalog/;
    if (filename.match(/CatalogMember\.js/)) {
        // CatalogMember has no parent...
        searchRE = /defineProperties\(CatalogMember\.prototype/;
    }

    var lines = fulltext.split('\n');

    for (var i = 0; i < lines.length; i++) {
        // hmm, some inherit from ImageryLayerCatalogItem...
        var m = lines[i].match(searchRE);
        if (m) {
            return { line: i, parent: m[1] };
        }
    }
    throw new Error("Couldn't find 'inherits' line in " + filename);
}

function findClassProp(comments, className, customTag, fallbackProp) {
    // Look for property 'customTag' in a comment on class 'className', else return property 'fallbackProp'
    // The comments before the main class seem to get split between a 'constructor' and 'class' kind. I don't know if
    // it's predictable, so we just look wherever.
    var r = comments.filter(eq('name', className)).reduce(function(val, x) {
        val = defaultValue(getTag(x, customTag, x[fallbackProp]), val);
        return val;
    }, undefined);
    return r;
}

// Get relevant properties on our class
function getClassProps(comments, className, inheritsLine) {
    return comments.filter(function(x) {
        // we only want props defined directly on the object, not in defineProperties etc. Maybe.
        return x.kind === 'member' && x.memberof === className && x.meta.lineno < inheritsLine;
    }).map(function(x) {
        x.type =  defined(x.type) ? x.type.names : [];
        if (x.type[0] === 'Rectangle') { // Yes, handling Rectangle is pretty messy.
            x.type = [ 'Array.<Number>', 'Array.<String>' ];
        }
        if (defined(getTag(x, 'editortype'))) { // this is not super robust.
            x.type = fromEditorTypes(getTag(x, 'editortype'));
        }
        return x;
    }).filter(function(x) {
        // assume any defined editortype is safe.
        return getTag(x, 'editortype', x.type.some(supportedType));
    });
}

function unarray(arr) {
    return arr.length === 1 ? arr[0] : arr;
}
/* Add special attributes if a property name is special. */
function specialProps(propName, p, className) {
    function clone(o) {
        return JSON.parse(JSON.stringify(o));
    }
    if (specialProperties[propName]) {
        Object.keys(specialProperties[propName]).forEach(function(k) {
            p[k] = clone(specialProperties[propName][k]);
        });
    }
    return p;
}

function replaceLinks(comment) {
    if (!defined(comment)) {
        return undefined;
    }
    return comment.replace(/\{@link ([^|}#]+)#([^}]*)\}/ig, "$1's $2")
        .replace(/\{@link ([^|}]+\|)?([^}]+)\}/ig, '$2');
}

function makeShellFile(model, mainOut, className, comments) {
    var out = {
        type: 'object',
        properties: {
            type: {
                options: { hidden: true },
                type: 'string',
                enum: [ model.typeId ]
            }

        },
        description: replaceLinks(findClassProp(comments, className, 'editordescription', 'description')),
        title: defaultValue(findClassProp(comments, className, 'editortitle'), model.typeName, className.replace(/Catalog(?!Member).*/, '')),
        // it seems redundant to include the ancestors again here, but it's needed for the editor to function.
        allOf: mainOut.allOf.concat({ $ref: model.name + '.json' } )
    };
    if (model.name === 'CatalogGroup') {
        // we're cheating a bit here.
        out.properties.items =  { "$ref": "items.json" };
    }
    return out;
}
/**
 * Turns JSDoc comments attached to a catalog item model into schema properties.
 * @param  {Object} model    [description]
 * @param  {Object[]} comments [description]
 */
function processText(model, comments) {
    var className, cls = comments.filter(eq('kind', 'class'))[0];
    if (cls) { className = cls.name; } else throw 'No @class comment in ' + model.name;

    /*** Generate JSON schema for the class-level parameters ***/
    var out = {
        type: 'object',
        defaultProperties: [
            'name', 'type', 'url' // do these always apply? Probably.
        ],
        properties: {}
    };
    if (model.name !== 'CatalogMember') {
        out.allOf = [];
        if (model.name.match(/.CatalogItem$/)) {
            out.allOf.push({ $ref: 'CatalogItem.json' });
        } else if (model.name.match(/.CatalogGroup$/)) {
            out.allOf.push({ $ref: 'CatalogGroup.json' });
        }
        if (!model.parent.match(/^(CatalogItem|CatalogGroup|CatalogMember)$/)) {
            out.allOf.push({ $ref: model.parent + '.json' });
        }
        out.allOf.push({ $ref: 'CatalogMember.json' });
    }
    var props;
    try {
        props = getClassProps(comments, className, model.inheritsLine);
    } catch (e) {
        throw Error("Error getting class properties for class " + className + ": " + e.message);
    }

    /*** Generate JSON schema for each of the class properties. ***/
    props.forEach(function(x) {
        var p = {
            type: unarray(x.type.filter(supportedType).map(editorType)),
            title: getTag(x, 'editortitle', titleify(x.name)),
            description: replaceLinks(getTag(x, 'editordescription', x.description
                .replace(/^Gets or sets the/, 'The')
                .replace(/^Gets or sets a/, 'A')
                .replace(/\s*This property is observable./,'')))
        };
        if (p.type === 'array') {
            p.format = 'tabs';
            p.items = editorArrayItems(x);
        } else if (p.type === 'boolean') {
            p.format = 'checkbox';
        } else if (p.type === 'string' && p.name === 'description') {
            p.format = 'textarea';
        }

        p.format = getTag(x, 'editorformat', p.format);
        if (p.format === 'textarea') {
            p.options = { expand_height: true };
        }

        p = specialProps(x.name, p, className);
        out.properties[x.name] = p;
    });
    delete (out.properties.typeName);

    !argv.quiet && console.log(model.name + new Array(32 - model.name.length).join(' ') +  Object.keys(out.properties).join(' '));
    model.outFile = argv.dest + '/' + model.name + '.json';
    if (model.typeId) {
        writeJson(argv.dest + '/' + model.name + '_type.json', makeShellFile(model, out, className, comments))
        .catch(showError);
    }
    model.description=undefined; //###testing
    model.title=undefined;
    writeJson(model.outFile, out).catch(showError);
}

function showError(err) {
    if (!err) {
        return false;
    }
    console.error(JSON.stringify(err));
    return err;
}

// Generate the contents of the special 'items' schema that says that each item in group can be any of the item types
// that we've processed today. Two very different formats depending on what 'argv.editor' is set to.
function makeItemsFile(models) {
    function sortModels(a, b) {
        return (a.$ref === 'CatalogGroup_type.json' ? -1 : 1);
    }
    function modelToItem(m) {

        // This seems convoluted, because it is. The logic is this:
        // Every item, for every catalog type, either:
        //   - a) does not have the type string; or
        //   - b) has the type string, and meet all the other requirements
        // We do it this way so that if an object fails part a), then any failure in part b) can instantly be flagged
        // as a genuine validation failure and alerted with useful context.
        var typeProp = {
            type: {
                enum: [ m.typeId ]
            }
        };
        if (!argv.editor) return {
            oneOf: [
                { not: { properties: typeProp }
                },
                { allOf: [
                    // we have to put the type here (and not in the relevant schema file) in order to handle catalog types
                    // that inherit from other types. Eg, abs-itt inherits from csv, but a type field can't be both csv and abs-itt.
                    { properties: typeProp },
                    { $ref: m.name + '_type.json' }
                ] }
            ]
        }; else
            return { $ref: m.name + '_type.json' };
    }
    var itemsOut = {
        title: 'Items',
        description: 'List of items or groups',
        type: 'array',
        format: 'tabs',
        items: {
            type: 'object',
            title: 'item',
            headerTemplate: '{{ self.name }}',
            required: [ 'name', 'type' ]
        }
    };
    if (argv.editor) {
        // for the editor, we construct "oneOf" choices
        itemsOut.items.allOf = [{ $ref: 'CatalogMember.json' }];
        itemsOut.items.oneOf = models.map(function(m) { return { $ref: m.name + '_type.json' }; })
            .sort(sortModels);
    } else {
        // for validation, we use an overall "allOf" list, with pairs of allOf/not in binary opposition, to give most useful feedback.
        itemsOut.items.allOf = [ { $ref: 'CatalogMember.json' }].concat(models.map(modelToItem));
    }
    return itemsOut;
}

/**
 * Scan the code for a catalog item type and return a useful chunk of processed data.
 * @param  {Object}   model      Object with a filename property
 * @return {Object}   model
 */
var processModelFile = node.lift(function(filename, i, callback) {
    var model = {
        name: path.basename(filename, '.js'),
        filename: filename,
    };
    return fsp.readFile(model.filename, 'utf8').then(function(data) {
        model.source = esprima.parse(data); // 1. Parse with esprima
        model.typeId = getTypeProp(model.source, 'type');
        if (!defined(model.typeId)) {
            // strip out any model that doesn't have a concrete static .type.
            // These are (hopefully all) intermediate classes like ImageryLayerCatalogItem
            !argv.quiet && console.log ('(' + model.name + ' has no type ID)');
        }
        var doc = jsdoc({src: model.filename}); // 2. parse from scratch with JSdoc
        var m = findInherits(data, model.filename); // 3. simple text scan
        model.inheritsLine = m.line;
        model.parent = m.parent;
        model.allText = '';
        model.typeName = getTypeProp(model.source, 'typeName');
        doc.on('data', function(chunk) {
            model.allText += chunk;
        });

        doc.on('end', function() {
            try {
                processText(model, JSON.parse(model.allText));
                callback(undefined, model);
            } catch (e) {
                console.error('Error processing ' + model.filename + ': ' + e.message);
                callback(e);
            }
        });
    });
});

function makeDir(dir) {
    return fsp.mkdir(dir).catch(function(e) {
        if (e.code === 'EEXIST') {
            return;
        } else if (e.code === 'ENOENT') {
            throw('Parent directory missing, so unable to create ' + dir);
        }
    });
}

function writeJson(filename, json) {
    return fsp.writeFile(filename, JSON.stringify(json, null, argv.jsonIndent), 'utf8');
}


function processModels() {
    function hasTypeId(model) {
        return model && model.typeId;
    }
    function isSchemable(modelName) {
        return modelName.match(/Catalog(Item|Group|Member)\.js$/) &&
              !modelName.match(/(ArcGisMapServerCatalogGroup|addUserCatalogMember)/);
    }

    var modelFiles;
    if (argv.sourceGlob) {
        modelFiles = glob.sync(argv.sourceGlob);
    } else {
        modelFiles = when.map(when.filter(fsp.readdir(argv.source + '/lib/Models'), isSchemable), function(name) {
            return argv.source + '/lib/Models/' + name;
        });
    }

    return when.map(modelFiles, processModelFile).then(function(models) {
            writeJson(argv.dest + '/items.json', makeItemsFile(models.filter(hasTypeId)));
            return models;
        });

}

function copyStaticFiles() {
    return when.map(fsp.readdir(path.join(__dirname, 'src')), function (filename) {
        return fsp.readFile(path.join(__dirname, 'src', filename), 'utf8').then(function(data) {
            return fsp.writeFile(path.join(argv.dest, filename), data, 'utf8').then(function() {
                !argv.quiet && console.log('Copied ' + filename);
            });
        });
    });
}

/**
 * Generate schema and write to files.
 * @param  {Object} options Yargs-style object, including
 * * source: source directory
 * * dest: target directory
 */
module.exports = function(options) {
    argv = options;
    if (!argv || (!argv.source && !argv.sourceGlob) || !argv.dest) {
        throw('Source and destination arguments required.');
    }
    argv.jsonIndent = (argv.minify ? 0 : 2);

    if (!argv.noversionsubdir) {
        try  {
            var terriajsPackage = (argv.source.match(/^[.\/]/) ? '' : './') + argv.source + '/package.json';
            argv.dest = path.join(argv.dest, JSON.parse(fs.readFileSync(terriajsPackage, 'utf8')).version);
            argv.quiet || console.log('Writing TerriaJS schema to: ' + argv.dest);
        } catch (e) {
            console.error("Couldn't access TerriaJS at " + argv.source + ". (" + e.message + ")");
            process.exit(1);
        }
    }

    return makeDir(argv.dest)
        .then(processModels)
        .then(copyStaticFiles)
        .yield(false)
        .catch(showError);
};