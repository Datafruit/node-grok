var fs = require('fs');
var async = require('async');
var OnigRegExp = require('oniguruma').OnigRegExp;
var Map = require('collections/fast-map');
var toNumber = require('lodash/toNumber');
var toInt = require('lodash/toSafeInteger');
var identity = require('lodash/identity');
var moment = require('moment-jdateformatparser');

function toBoolean(str) {
    return str === 'true'
}

function toJSON(str) {
    try {
      return JSON.parse(str)
    } catch (e) {
        return null
    }
}

function toTimestamp(str, pattern) {
  if (pattern) {
    return moment(str, pattern).valueOf()
  }
  return moment(str).valueOf()
}

const TypeConverter = {
  byte: toInt,
  boolean: toBoolean,
  short: toInt,
  int: toInt,
  long: toInt,
  float: toNumber,
  double: toNumber,
  date: toTimestamp,
  datetime: toTimestamp,
  string: identity,
  json: toJSON
}

function GrokPattern(expression, id) {
    var t = this;
    t.id = id;
    t.expression = expression;
    t.fields = [ null ]; // add a dummy entry at the beginning to swallow the fully captured expression
    t.typeDict = {};
    t.datePatternDict = {};
    t.resolved = null;
    t.regex = null;
    
    t.parse = function(str, next) {
        if (!t.regexp) {
            t.regexp = new OnigRegExp(t.resolved);
        }

        var typeDict = t.typeDict;
        var datePatternDict = t.datePatternDict;

        t.regexp.search(str, function(err, result) {
            if (err || !result)
                return next(err, result);

            var r = {};

            result.forEach(function(item, index) {
                var field = t.fields[index];
                if (field && field !== 'UNWANTED' && item.match) {
                    var type = typeDict[field];
                    if (type && type in TypeConverter) {
                        if (type === 'date' || type === 'datetime') {
                            r[field] = TypeConverter[type](item.match, datePatternDict[field]);
                        } else {
                            r[field] = TypeConverter[type](item.match);
                        }
                    } else {
                        r[field] = item.match;
                    }
                }
            });

            return next(err, r, result);
        });
    };

    t.parseSync = function(str) {
        if (!t.regexp) {
            t.regexp = new OnigRegExp(t.resolved);
        }

        var result = t.regexp.searchSync(str);

        if(!result)
            return null;

        var r = {};
        var typeDict = t.typeDict;
        var datePatternDict = t.datePatternDict;

        result.forEach(function(item, index) {
            var field = t.fields[index];
            if (field && field !== 'UNWANTED' && item.match) {
                var type = typeDict[field];
                if (type && type in TypeConverter) {
                    if (type === 'date' || type === 'datetime') {
                        r[field] = TypeConverter[type](item.match, datePatternDict[field]);
                    } else {
                        r[field] = TypeConverter[type](item.match);
                    }
                } else {
                    r[field] = item.match;
                }
            }
        });

        return r;
    };
}

// var subPatternsRegex      = /%\{[A-Z0-9_]+(?::[A-Za-z0-9_]+)?\}/g; // %{subPattern} or %{subPattern:fieldName}

// %{subPattern} or %{subPattern:fieldName} or %{NOTSPACE:upstream_response_time:float} or %{CUSTOM_TIMESTAMP_ISO8601:logtime;date;yyyy-MM-dd'T'HH:mm:ssXXX}
var subPatternsRegex      = /%{[A-Z0-9_]+(?:[:;][^;]+?)?(?:[:;][^;]+?)?(?:[:;][^;]+?)?}/g;
var subPatternGroupRegex      = /^%{([A-Z0-9_]+)(?:[:;]([^;]+?))?(?:[:;]([^;]+?))?(?:[:;]([^;]+?))?}$/;
var nestedFieldNamesRegex = /(\(\?<([A-Za-z0-9_]+)>)|\(\?:|\(\?>|\(\?!|\(\?<!|\(|\\\(|\\\)|\)|\[|\\\[|\\\]|\]/g;

function GrokCollection() {
    var t = this;

    var patterns = new Map();

    function resolvePattern (pattern) {
        pattern = resolveSubPatterns(pattern);
        pattern = resolveFieldNames(pattern);
        return pattern;
    }

    // detect references to other patterns
    // TODO: support automatic type conversion (e.g., "%{NUMBER:duration:float}"; see: https://www.elastic.co/guide/en/logstash/current/plugins-filters-grok.html)
    function resolveSubPatterns (pattern) {
        if(!pattern) { return; }

        var expression  = pattern.expression;
        var typeDict = pattern.typeDict;
        var datePatternDict = pattern.datePatternDict;
        var subPatterns = expression.match(subPatternsRegex) || [];

        var mObj = moment();

        subPatterns.forEach(function (matched) {
            // matched is: %{subPatternName} or %{subPatternName:fieldName}
            var patternGroups = matched.match(subPatternGroupRegex);

            var subPatternName = patternGroups[1];
            var fieldName  = patternGroups[2];
            var valType = patternGroups[3];
            var dateParseFormat = patternGroups[4];

            var subPattern = patterns.get(subPatternName);
            if (!subPattern) {
                // console.error('Error: pattern "' + subPatternName + '" not found!');
                throw new Error('Error: pattern "' + subPatternName + '" not found!');
            }

            // heganjie: 将 valType 和 dateParseFormat 保存到 typeDict 和 datePatternDict
            if (valType) {
                if (!(valType in TypeConverter)) {
                    throw new Error('Type not support: ' + valType)
                }
                typeDict[fieldName] = valType;
            }
            if (dateParseFormat) {
                datePatternDict[fieldName] = mObj.toMomentFormatString(dateParseFormat);
            }

            if (!subPattern.resolved) {
                resolvePattern(subPattern);
            }

            if (fieldName) {
                expression = expression.replace(matched, '(?<' + fieldName + '>' + subPattern.resolved + ')');
            } else {
                expression = expression.replace(matched, subPattern.resolved);
            }
        });

        pattern.resolved = expression;
        return pattern;
    }

    // create mapping table for the fieldNames to capture
    function resolveFieldNames (pattern) {
        if(!pattern) { return; }

        var nestLevel = 0;
        var inRangeDef = 0;
        var matched;
        while ((matched = nestedFieldNamesRegex.exec(pattern.resolved)) !== null) {
            switch(matched[0]) {
                case '(':    { if(!inRangeDef) { ++nestLevel; pattern.fields.push(null); } break; }
                case '\\(':  break; // can be ignored
                case '\\)':  break; // can be ignored
                case ')':    { if(!inRangeDef) { --nestLevel; } break; }
                case '[':    { ++inRangeDef; break; }
                case '\\[':  break; // can be ignored
                case '\\]':  break; // can be ignored
                case ']':    { --inRangeDef; break; }
                case '(?:':  // fallthrough                              // group not captured
                case '(?>':  // fallthrough                              // atomic group
                case '(?!':  // fallthrough                              // negative look-ahead
                case '(?<!': { if(!inRangeDef) { ++nestLevel; } break; } // negative look-behind
                default:     { ++nestLevel; pattern.fields.push(matched[2]); break; }
            }
        }

        return pattern;
    }

    var patternLineRegex = /^([A-Z0-9_]+)\s+(.+)/;
    var splitLineRegex = /\r?\n/;

    function doLoad(file) {
        var i = 0;

        if (file) {
            var lines = file.toString().split(splitLineRegex);
            if (lines && lines.length) {
                lines.forEach(function (line) {
                    var elements = patternLineRegex.exec(line);
                    if (elements && elements.length > 2) {
                        var pattern = new GrokPattern(elements[2], elements[1]);
                        patterns.set(pattern.id, pattern);
                        i++;
                    }
                });
            }
        }

        return i;
    }

    t.createPattern = function (expression, id) {
        id = id || 'pattern-' + patterns.length;
        if (patterns.has(id)) {
            console.error('Error: pattern with id %s already exists', id);
        } else {
            var pattern = new GrokPattern(expression, id);
            resolvePattern(pattern);
            patterns.set(id, pattern);
            return pattern;
        }
    };

    t.getPattern = function (id) {
        return patterns.get(id);
    };

    t.load = function (filePath, callback) {
        fs.readFile(filePath, function(err, file) {
            if(err)
                return callback(err);

            doLoad(file);
            return callback();
        });
    };

    t.loadSync = function(filePath) {
        return doLoad(fs.readFileSync(filePath));
    };

    t.count = function () {
        return patterns.length;
    };
}

var patternsDir = __dirname + '/patterns/';

function doLoadDefaultSync(loadModules) {
    var result = new GrokCollection();

    var files = fs.readdirSync(patternsDir);
    if (files && files.length) {
        files.filter(function(file) {
            return !loadModules || !loadModules.length || loadModules.indexOf(file) !== -1;
        }).forEach(function (file) {
            result.loadSync(patternsDir + file);
        })
    }

    return result;
}

function doLoadDefault(loadModules, callback) {
    return fs.readdir(patternsDir, function(err, files) {
        if(err)
            return callback(err);

        var result = new GrokCollection();

        return async.parallel(
            files.filter(function(file) {
                return !loadModules || !loadModules.length || loadModules.indexOf(file) !== -1;
            }).map(function (file) {
                return function(callback) {
                    return result.load(patternsDir + file, callback);
                };
            }),
            function(err) {
                if(err)
                    return callback(err);

                return callback(null, result);
            });
    });
}

module.exports = {
    loadDefault: function (loadModules, callback) {
        if(arguments.length < 2) {
            callback = loadModules;
            loadModules = null;
        }

        doLoadDefault(loadModules, callback);
    },

    loadDefaultSync: doLoadDefaultSync,

    GrokCollection: GrokCollection
};