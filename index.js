var path = require('path');
var map = fis.compile.lang;
var componentsInfo, componentsDir, ld, rd;

var exports = module.exports = function (content, file, settings) {
    buildComponentsInfo();

    if (!ld) {
        ld = settings.left_delimiter || fis.config.get('settings.smarty.left_delimiter') || fis.config.get('settings.template.left_delimiter') || '{%';
        rd = settings.right_delimiter || fis.config.get('settings.smarty.right_delimiter') || fis.config.get('settings.template.right_delimiter') || '%}';
        ld = fis.util.escapeReg(ld);
        rd = fis.util.escapeReg(rd);
    }

    // 先让 fis compile 走一遍。
    if (file.isHtmlLike) {
        content = exports.extHtml(content);
    } else if (file.isJsLike) {
        content = exports.extJs(content);
    } else if (file.isCssLike) {
        content = exports.extCss(content);
    }

    content = exports.parse(content, file, settings);
    content = content.replace(/\<\<\<(\w+)\:([\s\S]*?)\>\>\>/ig, function(all, type, value) {
        var fn = exports['replace' + ucfirst(type) ] || exports.replace;

        if (fn && typeof fn === 'function') {
            value = fn(value, file);
        }

        return value;
    });
    return content;
};

function buildComponentsInfo() {
    if (componentsInfo) {
        return componentsInfo;
    }

    componentsInfo = {};
    componentsDir = (fis.config.get('component.dir') || '/components').replace(/\/$/, '');

    if (componentsDir[0] !== '/') {
        componentsDir = '/' + componentsDir;
    }

    var root = fis.project.getProjectPath();
    var includer =  new RegExp('^' + fis.util.escapeReg(root + componentsDir + '/') + '.*?component\.json$', 'i');

    fis.util.find(root, includer).forEach(function(file){
        var cName = path.basename(path.dirname(file));
        var json;

        try {
            json =require(file)
        } catch (e) {
            fis.log.warning('unable to load component.json of [' + cName + ']');
        }

        json.name = json.name || cName;
        componentsInfo[cName] = json;
    });
}


function ucfirst(str) {
    return str.substring(0, 1).toUpperCase() + str.substring(1);
}

function findResource(name, file, finder) {
    finder = finder || fis.uri;
    var extList = ['.js', '.css', '.html', '.tpl', '.vm'];
    var info = finder(name, file.dirname);

    for (var i = 0, len = extList.length; i < len && !info.file; i++) {
        info = finder(name + extList[i], file.dirname);
    }

    return info;
}

// 扩展
exports.parse = function(content, file, settings) {
    return content;
}

exports.replaceRequire = function(value, file) {
    var info = fis.uri.getId(value, file.dirname);
    var quote = info.quote;
    var m;

    // 如果找不到，则尝试短路径。
    if (!info.file && (m = /^([0-9a-z-_]+)(?:\/(.+))?$/.exec(info.rest))) {
        var cName = m[1];
        var subpath = m[2];
        var config = componentsInfo[cName];
        var resolved;

        if (!config) {
            return value;
        }

        if (subpath) {
            resolved = findResource(componentsDir + '/' + cName + '/' + subpath, file, fis.uri.getId);
        } else {
            resolved = findResource(componentsDir + '/' + cName + '/' + (config.main || 'main'), file, fis.uri.getId);
        }

        // 根据规则找到了。
        if (resolved.file) {
            return quote + resolved.file.getId() + quote;
        }
    }

    return value;
};

exports.replace = function(value, file) {
    var info = fis.uri(value, file.dirname);
    var quote = info.quote;
    var m;

    // 如果找不到，则尝试短路径。
    if (!info.file && (m = /^([0-9a-z-_]+)(?:\/(.+))?$/.exec(info.rest))) {
        var cName = m[1];
        var subpath = m[2];
        var config = componentsInfo[cName];
        var resolved;

        if (!config) {
            return value;
        }

        if (subpath) {
            resolved = findResource(componentsDir + '/' + cName + '/' + subpath, file);
        } else {
            resolved = findResource(componentsDir + '/' + cName + '/' + (config.main || 'main'), file);
        }

        // 根据规则找到了。
        if (resolved.file) {
            return quote + resolved.file.subpath + quote;
        }
    }

    return value;
};

function addAsync(value) {
    var hasBrackets = false;
    var values = [];
    value = value.trim().replace(/(^\[|\]$)/g, function(m, v) {
        if (v) {
            hasBrackets = true;
        }
        return '';
    });
    values = value.split(/\s*,\s*/);
    values = values.map(function(v) {
        return '<<<require:' + v + '>>>';
    });

    return {
        values: values,
        hasBrackets: hasBrackets
    };
}

//"abc?__inline" return true
//"abc?__inlinee" return false
//"abc?a=1&__inline"" return true
function isInline(info){
    return /[?&]__inline(?:[=&'"]|$)/.test(info.query);
}

exports.compileHtmlReplaceCallback = function compileHtmlReplaceCallback(m, $1, $2, $3, $4, $5, $6, $7, $8){
    if($1){//<script>
        var embed = '';
        $1 = $1.replace(/(\s(?:data-)?src\s*=\s*)('[^']+'|"[^"]+"|[^\s\/>]+)/ig, function(m, prefix, value){
            if(isInline(fis.util.query(value))){
                embed += map.embed.ld + value + map.embed.rd;
                return '';
            } else {
                return prefix + map.uri.ld + value + map.uri.rd;
            }
        });
        if(embed){
            //embed file
            m = $1 + embed;
        } else if(!/\s+type\s*=/i.test($1) || /\s+type\s*=\s*(['"]?)text\/javascript\1/i.test($1)) {
            //without attrubite [type] or must be [text/javascript]
            m = $1 + exports.extJs($2);
        } else {
            //other type as html
            m = $1 + exports.extHtml($2);
        }
    } else if($3){//<style>
        m = $3 + exports.extCss($4);
    } else if($5){//<img|embed|audio|video|link|object|source>
        var tag = $5.toLowerCase();
        if(tag === 'link'){
            var inline = '', isCssLink = false, isImportLink = false;
            var result = m.match(/\srel\s*=\s*('[^']+'|"[^"]+"|[^\s\/>]+)/i);
            if(result && result[1]){
                var rel = result[1].replace(/^['"]|['"]$/g, '').toLowerCase();
                isCssLink = rel === 'stylesheet';
                isImportLink = rel === 'import';
            }
            m = m.replace(/(\s(?:data-)?href\s*=\s*)('[^']+'|"[^"]+"|[^\s\/>]+)/ig, function(_, prefix, value){
                if((isCssLink || isImportLink) && isInline(fis.util.query(value))){
                    if(isCssLink) {
                        inline += '<style' + m.substring(5).replace(/\/(?=>$)/, '').replace(/\s+(?:charset|href|data-href|hreflang|rel|rev|sizes|target)\s*=\s*(?:'[^']+'|"[^"]+"|[^\s\/>]+)/ig, '');
                    }
                    inline += map.embed.ld + value + map.embed.rd;
                    if(isCssLink) {
                        inline += '</style>';
                    }
                    return '';
                } else {
                    return prefix + map.uri.ld + value + map.uri.rd;
                }
            });
            m = inline || m;
        } else if(tag === 'object'){
            m = m.replace(/(\sdata\s*=\s*)('[^']+'|"[^"]+"|[^\s\/>]+)/ig, function(m, prefix, value){
                return prefix + map.uri.ld + value + map.uri.rd;
            });
        } else {
            m = m.replace(/(\s(?:data-)?src\s*=\s*)('[^']+'|"[^"]+"|[^\s\/>]+)/ig, function(m, prefix, value){
                var key = isInline(fis.util.query(value)) ? 'embed' : 'uri';
                return prefix + map[key]['ld'] + value + map[key]['rd'];
            });
        }
    } else if($6){
        m = map.embed.ld + $6 + map.embed.rd;
    } else if($7){
        m = '<!--' + $7 + $8;
    }
    return m;
}

exports.extHtml = function(content, callback) {
    content = fis.compile.extHtml(content, callback || exports.compileHtmlReplaceCallback);

    // 扩展 smarty 中的 js 和 css 代码块的识别。
    var reg = new RegExp('('+ld+'script(?:(?=\\s)[\\s\\S]*?["\'\\s\\w]'+rd+'|'+rd+'))([\\s\\S]*?)(?='+ld+'\\/script'+rd+'|$)|('+ld+'style(?:(?=\\s)[\\s\\S]*?["\'\\s\\w\\-]'+rd+'|'+rd+'))([\\s\\S]*?)(?='+ld+'\\/style\\s*'+rd+'|$)', 'ig');

    content = content.replace(reg, function(m, $1, $2, $3, $4){
        if ($1) {
            m = $1 + exports.extJs($2);
        } else if($3){
            m = $3 + exports.extCss($4);
        }
        return m;
    });


    // 扩展 swig 中的 js 和 css 代码块的识别。
    reg = new RegExp('('+ld+'script(?:(?=\\s)[\\s\\S]*?["\'\\s\\w]'+rd+'|'+rd+'))([\\s\\S]*?)(?='+ld+'endscript'+rd+'|$)|('+ld+'style(?:(?=\\s)[\\s\\S]*?["\'\\s\\w\\-]'+rd+'|'+rd+'))([\\s\\S]*?)(?='+ld+'endstyle\\s*'+rd+'|$)', 'ig');

    content = content.replace(reg, function(m, $1, $2, $3, $4){
        if ($1) {
            m = $1 + exports.extJs($2);
        } else if($3){
            m = $3 + exports.extCss($4);
        }
        return m;
    });


    return content;
};

exports.extJs = function(content, callback) {
    content = fis.compile.extJs(content, callback);

    // 扩展 require.async(xxx), require([xxx])
    var reg = /"(?:[^\\"\r\n\f]|\\[\s\S])*"|'(?:[^\\'\n\r\f]|\\[\s\S])*'|(\/\/[^\r\n\f]+|\/\*[\s\S]+?(?:\*\/|$))|\b(require\.async|require)\s*\(\s*("(?:[^\\"\r\n\f]|\\[\s\S])*"|'(?:[^\\'\n\r\f]|\\[\s\S])*'|\[[\s\S]*?\])\s*/g;

    content = content.replace(reg, function(m, comment, type, value) {
        if(type){
            var res = addAsync(value);

            if (res.hasBrackets) {
                m = 'require.async([' + res.values.join(', ') + ']';
            } else {
                m = 'require.async(' + res.values.join(', ');
            }
        }

        return m;
    });

    return content;
};

exports.extCss = function(content, callback) {
    content = fis.compile.extCss(content, callback);

    return content;
};