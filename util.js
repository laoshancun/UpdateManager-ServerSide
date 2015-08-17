"use strict";
var http = require('http'),
    url = require('url'),
    exec = require("child_process").exec,
    Q = require('q'),
    querystring = require('querystring'),
    config = require('./config'),
    fs = require('fs'),
    rsync = require("rsyncwrapper").rsync,
    schedule = require('node-schedule'),
    Promised = Q.resolve();
var utils = {
    Promise: Q,
    Promised: Promised,
    ScheduleList: schedule.scheduledJobs,
    isScheduled: function (name) {
        return (name in schedule.scheduledJobs && schedule.scheduledJobs.hasOwnProperty(name));
    },
    addSchedule: function(name,rule,callback) {
        if (utils.isScheduled(name)) {
            //utils.cancelSchedule(name);
        }
        return new schedule.scheduleJob(name, rule, callback);
    },
    cancelSchedule: function(name) {
        return schedule.cancelJob(name);
    },
    execCommand: function execCommand(cmd) {
        /* 执行命令 */
        return new Q.Promise(function (resolve, reject) {
            exec(cmd, function callback(err, stdout, stderr) {
                if (!err) {
                    resolve(stdout);
                } else {
                    reject(new Error('[' + cmd + ']' + (stderr || err)));
                }
            });
        })
        .then(function (out) {
            return out;
        }, function (err) {
            throw err;
        });
    },
    rsync: function (options) {
        return new Q.Promise(function (resolve, reject) {
            var conf = {
                'src': options.src,
                'dest': options.dest,
                'recursive': true
            };
            if (options['passwordFile']) {
                conf['passwordFile'] = options['passwordFile'];
            }
            rsync(conf, function (err, stdout, stderr, cmd) {
                if (err) {
                    reject(new Error('[' + cmd + ']' + (stderr || err.message)));
                } else {
                    resolve(stdout);
                }
            });
        })
        .then(function (out) {
            return out;
        }, function (err) {
            throw err;
        });

    },
    mount: function (siteName, url) {
        /// <summary>挂载共享目录</summary>

        var cfg = ['nfsUser', 'nfsPassword', 'defaultMountPoint'];
        return utils.Promise
            .all(cfg.map(function (name) {
                return utils.C(name);
            }))
            .spread(function (nfsUser, nfsPassword, defaultMountPoint) {
                return utils.mkdir(defaultMountPoint + siteName).catch(function () {

                }).then(function () {
                    return ['mount -t cifs', ' -o username=', nfsUser, ',password=', nfsPassword, ' ', url, ' ', defaultMountPoint, siteName].join('');
                });
            }).then(utils.execCommand);
    },
    umount: function (siteName) {
        /// <summary>取消挂载同步目录</summary>

        return utils.C('defaultMountPoint')
            .then(function (defaultMountPoint) {
                return utils.execCommand('umount ' + defaultMountPoint + siteName);
            });
    },
    request: function request(urlString, method, data) {
        /// <summary>http请求</summary>

        return new Q.Promise(function (resolve, reject) {
            var json = url.parse(urlString);
            var options = {
                host: json.hostname,
                port: json.port,
                path: json.path,
                method: method || 'GET'
            },
                postdata;
            if (method === 'POST') {
                postdata = querystring.stringify(data || {});
                options.headers = {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Content-Length': postdata.length
                };
            }
            var req = http.request(options, function (res) {
                if (res.statusCode === 200 || res.statusCode === 304) {
                    var content = [];
                    res.on('data', function (chunk) {
                        content.push(chunk);
                    });
                    res.on('end', function () {
                        resolve(content.join(''));
                    });
                } else {
                    reject(new Error(urlString + ' request error with code:' + res.statusCode));
                }
            });
            req.on('error', function (err) {
                reject(err);
            });
            if (method === 'POST') {
                req.write(postdata);
            }
            req.end();
        }).then(function (html) {
            return html;
        }, function (err) {
            throw err;
        });
    },
    formatString: function () {
        var args = utils.argsToArray(arguments);
        var result = args.splice(0, 1).pop();
        if (arguments.length > 1) {
            var reg;
            if (arguments.length == 2 && typeof (args[0]) == "object") {
                for (var key in args[0]) {
                    if (args[0][key] != undefined) {
                        reg = new RegExp("({" + key + "})", "g");
                        result = result.replace(reg, args[0][key]);
                    }
                }
            }
            else {
                for (var i = 0; i < args.length; i++) {
                    if (args[i] != undefined) {
                        reg = new RegExp("({[" + i + "]})", "g");
                        result = result.replace(reg, args[i]);
                    }
                }
            }
        }
        return result;
    },
    C: function (path, value) {
        return Promised
            .then(function () {
                if (!config) {
                    throw new Error('config file error');
                }
                return config;
            }).then(function (con) {
                if (value === undefined) {
                    var names = path.split('|').reverse();
                    var name;
                    while ((name = names.pop()) && !!con) {
                        con = con[name];
                    }
                    return con;
                } else {
                    // todo: set config value;
                    throw new Error('method not Implemented');
                    var o = con, j = 0, d;
                    if (path.indexOf('|') > -1) {
                        d = path.split('|');
                        for (j; j < d.length; j++) {
                            o[d[j]] = o[d[j]] || {};
                            o = o[d[j]];

                        }
                    } else {
                        o[path] = o[path] || {};
                        o = o[path];
                    }
                    o = value;
                    return o;
                }
            });
    },
    extend: function extend(t) {
        var a = arguments, notCover = this.isBoolean(a[a.length - 1]) ? a[a.length - 1] : false, len = this.isBoolean(a[a.length - 1]) ? a.length - 1 : a.length;
        for (var i = 1; i < len; i++) {
            var x = a[i];
            for (var k in x) {
                if (!notCover || !t.hasOwnProperty(k)) {
                    t[k] = x[k];
                }
            }
        }
        return t;
    },
    uniqueSort: function (results) {
        var elem,
        duplicates = [],
            i = 1,
            j = 0;

        // Unless we *know* we can detect duplicates, assume their presence
        results.sort(sortOrder);

        for (;
        (elem = results[i]) ; i++) {
            if (elem === results[i - 1]) {
                j = duplicates.push(i);
            }
        }
        while (j--) {
            results.splice(duplicates[j], 1);
        }

        return results;
    },
    trim: function (str) {
        return str.replace(/(^[ \t\n\r]+)|([ \t\n\r]+$)/g, '');
    },
    proxy: function (fn, context) {
        return function () {
            return fn.apply(context, arguments);
        };
    },
    clonePlainObject: function (source, target) {
        var tmp;
        target = target || {};
        for (var i in source) {
            if (source.hasOwnProperty(i)) {
                tmp = source[i];
                if (utils.isObject(tmp) || utils.isArray(tmp)) {
                    target[i] = utils.isArray(tmp) ? [] : {};
                    utils.clonePlainObject(source[i], target[i]);
                } else {
                    target[i] = tmp;
                }
            }
        }
        return target;
    },
    isEmptyObject: function (obj) {
        if (obj == null) return true;
        if (this.isArray(obj) || this.isString(obj)) return obj.length === 0;
        for (var key in obj)
            if (obj.hasOwnProperty(key)) return false;
        return true;
    },
    clone: function (source, target) {
        var tmp;
        target = target || {};
        for (var i in source) {
            if (source.hasOwnProperty(i)) {
                tmp = source[i];
                if (typeof tmp == 'object') {
                    target[i] = utils.isArray(tmp) ? [] : {};
                    utils.clone(source[i], target[i]);
                } else {
                    target[i] = tmp;
                }
            }
        }
        return target;
    },
    each: function (obj, iterator, context) {
        if (obj == null) return false;
        if (obj.length === +obj.length) {
            for (var i = 0, l = obj.length; i < l; i++) {
                if (iterator.call(context, i, obj[i], obj) === false)
                    return false;
            }
        } else {
            for (var key in obj) {
                if (obj.hasOwnProperty(key)) {
                    if (iterator.call(context, key, obj[key], obj) === false)
                        return false;
                }
            }
        }
    },
    argsToArray: function (args, index) {
        return Array.prototype.slice.call(args, index || 0);
    },
    cloneArr: function (arr) {
        return [].concat(arr);
    },
    clearWhitespace: function (str) {
        return str.replace(/[\u200b\t\r\n]/g, '');
    },
    openFile: Q.denodeify(fs.open),
    closeFile: Q.denodeify(fs.close),
    mkdir: Q.denodeify(fs.mkdir),
    write: Q.denodeify(fs.write),
    read: Q.denodeify(fs.read),
    readFile: Q.denodeify(fs.readFile),
    writeFile: Q.denodeify(fs.writeFile),
    rename: Q.denodeify(fs.rename),
    unlink: Q.denodeify(fs.unlink)
};

utils.each(['String', 'Function', 'Array', 'Number', 'RegExp', 'Object', 'Boolean'], function (i, v) {
    utils['is' + v] = function (obj) {
        return Object.prototype.toString.apply(obj) == '[object ' + v + ']';
    };
});

module.exports = utils;