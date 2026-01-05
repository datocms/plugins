# Copy Links

This plugin lets you copy linked record references from one field to another.

It is not for copying URLs (hyperlinks). 

## How to use
The plugin requires no configuration. After it's installed in your project, all single and multi-link fields should now have copy & paste options in their dropdown context menus (the three dots). See video for an example.

## Changelog

* v0.2.1: Fixed bug when pasting multiple links into a block field
* v0.2.0: Added support for link fields inside of blocks
* v0.1.1: Added readme
* v0.1.0: Initial release

## Supported operations

### From single-link fields
* To other single-link fields, replacing their content
* To multi-link fields, appending at the end if the link isn't already in there

### From multi-link fields
* To other multi-link fields, appending unique links to the end
* To single-link fields IF only a single link is copied

## Validation errors & incompatible models 
The plugin does not inherently check for incompatible references between fields that link to different models, but the built-in DatoCMS validation should catch that and warn you after the paste.