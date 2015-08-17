"use strict";
var util = require('./util'),
    socket = require('socket.io'),
    nginx = require('./nginx'),
    resumable = require('./resumable');

util.Promise
    .all(['port', 'uploadTempPath'].map(function (name) {
        return util.C(name);
    })).spread(function (port, uploadTempPath) {
        var io = socket(port || 80);
        var uploader = resumable(uploadTempPath || '/data/www/tmp/');

        io.on('error', function errorHandler(err) {
            console.error(err);
        });

        io.of('manager', function managerHandler(socket) {

            socket.on('error', function errorHandler(msg) {
                console.log('error: ' + msg);
            });

            socket.on('fileInfo', function (json) {
                uploader.info(json)
                .then(function (data) {
                    socket.emit('fileInfo', { 'state': true, 'data': data });
                }).catch(function (err) {
                    console.error('fileInfo', err);
                    socket.emit('fileInfo', { 'state': false, 'msg': err.message });
                });
            });

            socket.on('sendBlock', function (json) {
                uploader.post(json).then(function (data) {
                    socket.emit('sendBlock', { 'state': true, 'data': data });
                }).catch(function (err) {
                    console.error('sendBlock', err);
                    socket.emit('sendBlock', { 'state': false, 'msg': err.message });
                });
            });

            socket.on('rsync', function rsyncHandler(json) {

                nginx.start(json.fileName, json.siteName)
                    .then(function (data) {
                        socket.emit('rsync', { 'state': true, 'data': data });
                    }).catch(function (err) {
                        console.error('rsync', err);
                        socket.emit('rsync', { 'state': false, 'msg': err.message });
                    });
            });


            socket.on('publish', function (json) {

                nginx.publish(json.siteName, json.time)
                    .then(function (data) {
                        socket.emit('publish', { 'state': true, 'data': data });
                    }).catch(function (err) {
                        console.error('publish', err);
                        socket.emit('publish', { 'state': false, 'msg': err.message });
                    });
            });
            socket.on('fallback', function (json) {

                nginx.fallBack(json.siteName, json.timed)
                .then(function (data) {
                    socket.emit('fallback', { 'state': true, 'data': data });
                }).catch(function (err) {
                    console.error('fallback', err);
                    socket.emit('fallback', { 'state': false, 'msg': err.message });
                });
            });

            socket.on('changeServer', function (json) {

                nginx.changeServer(json.siteName, json.list)
                .then(function (data) {
                    socket.emit('changeServer', { 'state': true, 'data': data });
                }).catch(function (err) {
                    console.error('changeServer', err);
                    socket.emit('changeServer', { 'state': false, 'msg': err.message });
                });
            });


            socket.on('serverStatus', function (siteName) {

                function getState(name) {
                    nginx.getServerstatus(name)
                        .then(function (list) {
                            var servers = [];
                            list = util.isArray(list) ? list : [list];
                            if (list.length > 0) {
                                util.each(list.pop(), function (key, value) {
                                    servers.push({ "ServerName": key, "Group": value['role'], "Status": value['state'] == 'up' });
                                });
                            }
                            socket.emit('serverStatus', { 'state': true, 'data': servers });
                        }).catch(function (err) {
                            console.error('serverStatus', err);
                            socket.emit('serverStatus', { 'state': false, 'msg': err.message });
                        });
                }
                util.addSchedule('serverStatus', '* * * * *', function () {
                    getState(siteName);
                });
                getState(siteName);
            });

        });
    }).catch(function (err) {
        console.error(err);
    });
