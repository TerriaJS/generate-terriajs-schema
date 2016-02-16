## Generate-TerriaJS-Schema

This utility scans the TerriaJS source code in order to build a JSON Schema that validates catalog "init" files. This has two purposes:

1. Automatically generating an editor for catalog files (included in NationalMap at `.../editor`)
2. Validating catalog files.

### Tags

It uses JSdoc-style tags embedded as comments in the source code.

These class-level tags are supported:

* `@editortitle` (uses class name, munged, if not present)
* `@editordescription` (uses JSdoc description, if not present)

These property-level tags are supported:

* `@type`
* `@editortype` (in same format as `@type,` uses `@type` if not present)
* `@editordescription`
* `@editorformat` (customising the choice of editor, eg `tabs`, `table`, `checkbox`)
* `@editoritemstype` (type of each thing in the array. Generally better to use `@type {Number[]}` where possible.
* `@editoritemstitle` (name of each thing in the array, like `Filter`)
* `@editoritemsdescription` (description of each thing in the array)
  
### Command-line usage
```
generate-terriajs-schema v1.1.1
gen-schema [options] --source <dir> --dest <dir>

Options:
  --source           TerriaJS directory to scan.        [default: "../terriajs"]
  --minify           Generate minified JSON
  --dest             Output directory                      [default: "./schema"]
  --quiet            Suppress non-error output.                        [boolean]
  --editor           Generates JSON-editor friendly version of schema. [boolean]
  --noversionsubdir  Don't add TerriaJS version as subdirectory.       [boolean]
  --help             Show help                                         [boolean]
```