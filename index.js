var fs = require('fs');
var async = require('async');
var OnigRegExp = require('oniguruma').OnigRegExp;
var Map = require('collections/fast-map');
var moment = require('moment-jdateformatparser');
import _ from 'lodash'

function partitionBy(arr, func) {
    if (_.isEmpty(arr)) {
        return arr
    }
    let toComp = func(arr[0], 0);
    let partial0 = _.takeWhile(arr, (e, idx) => _.isEqual(toComp, func(e, idx)));

    let tookCount = partial0.length;
    return [partial0, ...partitionBy(_.drop(arr, tookCount), (e, idx) => func(e, tookCount + idx))]
}

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
  byte: _.toSafeInteger,
  boolean: toBoolean,
  short: _.toSafeInteger,
  int: _.toSafeInteger,
  long: _.toSafeInteger,
  float: _.toNumber,
  double: _.toNumber,
  date: toTimestamp,
  datetime: toTimestamp,
  string: _.identity,
  json: toJSON
};

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

        let typeDict = t.typeDict;
        let datePatternDict = t.datePatternDict;

        t.regexp.search(str, function(err, result) {
            if (err || !result)
                return next(err, result);

            let r = {};

            result.forEach(function(item, index) {
                let field = t.fields[index];
                if (field && field !== 'UNWANTED' && (item.match || field in typeDict)) {
                    let matchVal = item.match || null;
                    let type = typeDict[field];
                    if (type && type in TypeConverter) {
                        if (type === 'date' || type === 'datetime') {
                            r[field] = TypeConverter[type](matchVal, datePatternDict[field]);
                        } else {
                            r[field] = TypeConverter[type](matchVal);
                        }
                    } else {
                        r[field] = matchVal;
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

        let result = t.regexp.searchSync(str);

        if (!result)
            return null;

        let r = {};
        let typeDict = t.typeDict;
        let datePatternDict = t.datePatternDict;

        result.forEach(function(item, index) {
            let field = t.fields[index];
            if (field && field !== 'UNWANTED' && (item.match || field in typeDict)) {
                let matchVal = item.match || null;
                let type = typeDict[field];
                if (type && type in TypeConverter) {
                    if (type === 'date' || type === 'datetime') {
                        r[field] = TypeConverter[type](matchVal, datePatternDict[field]);
                    } else {
                        r[field] = TypeConverter[type](matchVal);
                    }
                } else {
                    r[field] = matchVal;
                }
            }
        });

        return r;
    };

    t.debug = function(str, grokCollector) {
        let debugPatt = grokCollector.createPattern(expression, undefined, true);

        if (!debugPatt.regexp) {
            debugPatt.regexp = new OnigRegExp(debugPatt.resolved);
        }

        let result = debugPatt.regexp.searchSync(str) || [];

        let canNotMatchPatterns = [];

        // 看哪些 pattern 不能匹配
        result.forEach(function(item, index) {
            let field = debugPatt.fields[index];
            if (field && field !== 'UNWANTED' && !item.match) {
                canNotMatchPatterns.push(field)
            }
        });

        if (canNotMatchPatterns.length !== 0) {
            return 'Can not match pattern: ' + canNotMatchPatterns.join(', ')
        }
        // 其他字符影响了匹配，查找策略：找出能够单独匹配的所有子 pattern，逐个匹配，直到无法匹配为止

        // 'p1 \[p2\] "p3" ((p4|x)|p5) ' -> ['p1 \[', 'p2\] "', 'p3" ', '((p4|x)|p5) ']

        // 'a\nc' -> [{char: 'a'}, {char: 'n', escaped: true}, {char: 'c'}]
        let exprCharsWithEscaped = expression.split('').reduce((acc, char, idx, chars) => {
            if (idx !== 0 && chars[idx - 1] === '\\') {
                acc.pop();
                acc.push({char: char, escaped: true})
            } else {
                acc.push({char: char})
            }
            return acc;
        }, []);

        // '%{xx} ' -> [{char: '%', depthStack: ['{']}, ..., {char: '}', depthStack: ['{']}, {char: ' ', depthStack: []}]
        const pairDict = {'(': ')', '[': ']', '{': '}'};
        let exprCharsWithDepth = exprCharsWithEscaped.reduce((acc, charObj, idx) => {
            let {char: prevChar, escaped: prevCharEscaped, depthStack: prevCharDepthStack} = acc[idx - 1] || {depthStack: []};
            let {char, escaped} = charObj;
            let nextDepthStack;
            if (!prevCharEscaped && prevChar === pairDict[_.last(prevCharDepthStack)]) {
                nextDepthStack = _.dropRight(prevCharDepthStack, 1)
            } else {
                nextDepthStack = prevCharDepthStack
            }
            if (!escaped && (char === '{' || char === '[' || char === '(') && _.last(prevCharDepthStack) !== '[') {
                // 如果是 %{ 则 % 字符深度跟后面的 { 一致
                nextDepthStack = [...nextDepthStack, char];
                if (char === '{' && prevChar === '%' && !prevCharEscaped) {
                    acc.pop();
                    acc.push({char: prevChar, escaped: prevCharEscaped, depthStack: nextDepthStack})
                }
            }
            acc.push({char, escaped, depthStack: nextDepthStack});
            return acc
        }, []);

        // 以 depthStack[0] 分组
        let charObjGroups = partitionBy(exprCharsWithDepth, (charObj) => _.first(charObj.depthStack));
        let groupStrs = charObjGroups.map(arr => {
            return arr.map(charObj => charObj.escaped ? `\\${charObj.char}` : charObj.char).join('')
        });

        let groupCanNotMatchIdx = _.findIndex(groupStrs, (subPattern, idx) => {
            let patt = grokCollector.createPattern(_.take(groupStrs, idx + 1).join(''));
            return _.isEmpty(patt.parseSync(str))
        });

        if (groupCanNotMatchIdx === -1) {
            return `Regex parse error: ${expression}`
        } else if (groupCanNotMatchIdx === 0) {
            let hint = `Can not match partial regex: “${groupStrs[0]}”, at: 0`;
            if (groupStrs[1]) {
                hint += `, before: “${groupStrs[1]}”`
            }
            return hint
        } else {
            let at = _.sum(_.take(groupStrs, groupCanNotMatchIdx).map(s => s.length));
            return `Can not match partial regex: “${groupStrs[groupCanNotMatchIdx]}”, at: ${at}, after: “${groupStrs[groupCanNotMatchIdx - 1]}”`;
        }
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

    function resolvePattern (pattern, forDebug /* optional */) {
        pattern = resolveSubPatterns(pattern, forDebug);
        pattern = resolveFieldNames(pattern);
        pattern.debug = _.partialRight(pattern.debug, t);
        return pattern;
    }

    // detect references to other patterns
    function resolveSubPatterns (pattern, forDebug /* optional */) {
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
            var fieldName  = patternGroups[2] || subPatternName;
            var valType = patternGroups[3];
            var dateParseFormat = patternGroups[4];

            var subPattern = patterns.get(subPatternName);
            if (!subPattern) {
                throw new Error('Error: pattern "' + subPatternName + '" not found!');
            }

            // heganjie: 将 valType 和 dateParseFormat 保存到 typeDict 和 datePatternDict
            if (valType) {
                if (!(valType in TypeConverter)) {
                    throw new Error('Type not support: ' + valType)
                }
                typeDict[fieldName] = valType;
            } else {
                typeDict[fieldName] = 'string';
            }
            if (dateParseFormat) {
                datePatternDict[fieldName] = mObj.toMomentFormatString(dateParseFormat);
            }

            if (!subPattern.resolved) {
                resolvePattern(subPattern, forDebug);
            }

            if (forDebug) {
                expression = expression.replace(matched, '(?<' + fieldName + '>' + subPattern.resolved + ')?');
            } else {
                expression = expression.replace(matched, '(?<' + fieldName + '>' + subPattern.resolved + ')');
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

    t.createPattern = function (expression, id, forDebug /* optional */) {
        id = id || 'pattern-' + patterns.length;
        if (patterns.has(id)) {
            console.error('Error: pattern with id %s already exists', id);
        } else {
            var pattern = new GrokPattern(expression, id);
            resolvePattern(pattern, forDebug);
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