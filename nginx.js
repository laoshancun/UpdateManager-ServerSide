/*
 * 核心模块 涉及到文件同步、nginx服务器重启等操作
 * 
 * 
 */

"use strict";
var util = require("./util");
var schedule = require('node-schedule');
var nginx = {};
nginx.reloadService = function (serverip) {
    /// <summary>重新加载nginx服务器配置</summary>

    return util.Promise
        .all([
            util.C('rshFile'),
            util.C('serverid'),
            util.C('serverkey')
        ])
        .spread(function (rshFile,serverid, serverkey) {
            var cmd = [
                '/usr/bin/expect ',
                rshFile,
                ' ',
                serverid,
                ' ',
                serverkey,
                ' ',
                serverip,
                ' service nginx reload'
            ].join('');
            return util.execCommand(cmd);
        });
};

nginx.buildConf = function (siteName, servers) {
    /// <summary>生成nginx Upstream配置文件</summary>

    return util.Promised.then(function () {
        if (servers && util.isArray(servers)) {
            var list = {
                'current': [],
                'update': []
            };
            servers.forEach(function (item) {
                if (item['Group'] == 'current') {
                    list.current.push('server ' + item['ServerName'] + ';');
                } else {
                    list.update.push('server ' + item['ServerName'] + ';');
                }
            });
            return list;
        } else {
            return nginx.getServerstatus(siteName)
                .then(function (servers) {
                    if (servers.length < 1) {
                        throw new Error('empty nginx status list');
                    }
                    var server = servers[0];
                    var list = {
                        'current': [],
                        'update': []
                    },
                        item,
                        key;
                    for (key in server) {
                        if (!server.hasOwnProperty(key)) {
                            continue;
                        }
                        item = server[key];
                        if (item.role !== 'current') {
                            list.current.push('server ' + key + ';');
                        } else {
                            list.update.push('server ' + key + ';');
                        }
                    }
                    return list;
                });
        }
    })
    .then(function (list) {
        return util.Promise.all(['upstreamtemplate', 'upstreamconf'].map(function (name) {
            return util.C(name);
        })).spread(function (upstreamtemplate, upstreamconf) {
            return util.readFile(upstreamtemplate, { 'encoding': 'utf-8' })
                .then(function (content) {
                    content = content.replace(/{\$host}/g, siteName);
                    content = content.replace('{$currentlist}', list.current.join('\n    '));
                    content = content.replace('{$updatelist}', list.update.join('\n    '));
                    return content;
                })
                .then(function (content) {
                    upstreamconf = util.formatString(upstreamconf, siteName);
                    return util.writeFile(upstreamconf, content, { 'encoding': 'utf-8' })
                        .then(function () {
                            return upstreamconf;
                        });
                });
        });
    });
};

nginx.publish = function (siteName, time) {
    /// <summary>同步服务器配置</summary>

    if (time && !util.isArray(time)) {
        time = new Date(time);
        console.log(time);
        return util.Promised.then(function () {
            return util.addSchedule(siteName, time, function () {
                nginx.publish(siteName, null);
            });
        });
    }
    return nginx.buildConf(siteName, time)
        .then(function (confPath) {
            return util.C('servers|tengine|' + siteName)
                .then(function (tengines) {
                    return util.Promise.all((tengines || []).map(function (tengine) {
                        return nginx.processConf(confPath, tengine)
                            .then(function () {
                                return nginx.reloadService(tengine);
                            });
                    }));
                });
        });
};

nginx.changeServer = function (siteName, list) {
    return nginx.publish(siteName, list);
};

nginx.fallBack = function (siteName, time) {
    /// <summary>回退服务器配置</summary>

    if (!time) {
        return nginx.publish(siteName, null);
    } else {
        if (util.isScheduled(siteName)) {
            return util.Promised.then(function () {
                return util.cancelSchedule(siteName);
            });
        } else {
            return nginx.publish(siteName, null);
        }
    }
};

nginx.getStatus = function (server) {
    /// <summary>获取nginx服务器统计信息</summary>

    return util.Promise
        .all([
            util.C('ngxStatusPort'),
            util.C('ngxStatusPath')
        ])
        .spread(function (port, path) {
            return ['http://', server, ':', port, path].join('');
        })
        .then(function (url) {
            return util.request(url)
                .then(function (res) {

                    var json = JSON.parse(res);
                    var servers = {};
                    json.servers.server.forEach(function (item) {
                        servers[item.name] = { 'state': item.status, 'role': item.upstream };
                    });
                    return servers;
                });
        });
};

nginx.getServerstatus = function (siteName) {
    /// <summary>获取nginx集群服务器状态</summary>

    return util.Promised
        .then(function () {
            return util.C('servers|tengine|' + siteName);
        })
        .then(function (servers) {
            return util.Promise
                .all((servers || []).map(function (server) {
                    return nginx.getStatus(server);
                }));
        });
};

nginx.processConf = function (src, dest) {
    /// <summary>同步配置文件</summary>

    return util.C('rsyncPwdFile')
        .then(function (rsyncPwdFile) {
            return util.rsync({ 'src': src, 'dest': 'rsync@' + dest + '::nginx/upstream.conf', 'passwordFile': rsyncPwdFile });
        });
};

nginx.unZip = function (fileName, siteName) {
    /// <summary>同步源码</summary>

    return util.C('sourcePath')
        .then(function (sourcePath) {
            return sourcePath + siteName + '/';
        }).then(function (path) {
            return ['unzip -ouq ', fileName, ' -d ', path].join('');
        }).then(util.execCommand)
    .catch(function (err) {
        if (!err.message.indexOf('appears to use backslashes as path separators') > 0) {
            throw err;
        }
    });
};

nginx.start = function (fileName, siteName) {
    /// <summary>开始执行同步</summary>

    return nginx.unZip(fileName, siteName)
        .then(function () {
            return nginx.getServerstatus(siteName)
                .then(function (servers) {
                    if (servers.length < 1) {
                        throw new Error('empty nginx status list');
                    }
                    var server = servers[0];

                    if (util.isEmptyObject(server)) {
                        throw new Error('empty nginx upstream list ');
                    }
                    var serverlist = [];
                    for (var key in server) {
                        if (!server.hasOwnProperty(key)) {
                            continue;
                        }
                        var item = server[key];
                        if (item.role != 'update') {
                            continue;
                        }
                        serverlist.push(key);
                    }
                    return serverlist;
                }).then(function (list) {
                    return util.Promise.all(['sourcePath', 'defaultMountPoint', 'rsyncPwdFile'].map(function (name) {
                        return util.C(name);
                    })).spread(function (sourcePath, defaultMountPoint, rsyncPwdFile) {

                        return util.Promise.all((list || []).map(function (key) {
                            var server = key.substr(0, key.indexOf(':'));
                            var path = '//' + server + '/' + siteName + '/';
                            return util.mount(server, path)
                                .then(function () {
                                    var conf = {
                                        'src': sourcePath + siteName + '/',
                                        'dest': defaultMountPoint + server,
                                        'rsyncPwdFile': rsyncPwdFile
                                    };
                                    return util.rsync(conf)
                                        .finally(function () {
                                            return util.umount(server);
                                        }).then(function () {
                                            return { "server": server, "state": true };
                                        });
                                });
                        })).spread(function () {
                            var arr = util.argsToArray(arguments);
                            arr = arr.filter(function (arg) {
                                return !arg.state;
                            });
                            if (arr.length > 0) {
                                var err = [];
                                arr.map(function (item) {
                                    err.push(item.server);
                                });
                                throw new Error(err.join(' ') + '更新失败');
                            }
                            return true;
                        });

                    });
                });
        });
};

module.exports = nginx;