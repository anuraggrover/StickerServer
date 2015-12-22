(function () {
    'use strict';

    var express = require('express'),
        mongoose = require('mongoose'),
        multer = require('multer'),
        passport = require('passport'),
        Strategy = require('passport-local').Strategy,
        session = require('express-session'),
        cors = require('cors');

    var PENDING = 'pending',
        APPROVED = 'approved',
        REJECTED = 'rejected';

    var storage = multer.diskStorage({
        destination: function (req, file, cb) {
            cb(null, 'public/uploads')
        },
        filename: function (req, file, cb) {
            cb(null, Date.now() + file.originalname.substr(file.originalname.indexOf('.')));
        }
    });

    var upload = multer({ storage: storage}).single('sticker');

    var db = mongoose.connection;

    var app = express(),
        stickerPackSchema, userSchema, StickerPack, UserModel;

    app.use(cors());

    function initDb() {
        db.on('error', function () {
            console.log('error opening db connection');
        });

        db.once('open', function () {
            console.log('successfully opened mongoose connection');

            stickerPackSchema = new mongoose.Schema({
                name: String,
                desc: String,
                stickerId: String,
                authorId: String,
                path: String,
                approvalStatus: String,
                tags: Array,
                location: {lat: String, long: String},
                lifespan: {start: String, end: String},
                events: Array
            });

            userSchema = new mongoose.Schema({
                username: {type: String},
                password: {type: String},
                type: {type: String},
                name: {type: String}
            });

            StickerPack = mongoose.model('stickerpacks', stickerPackSchema);
            UserModel = mongoose.model('users', userSchema);

            registerRoutes();
        });

        mongoose.connect('mongodb://172.16.2.20:27017/stickers');
    }
    
    function normalizeStickerPack(stickerPack) {
        return {
            id: stickerPack.stickerId,
            path: '/static/uploads/' + stickerPack.path,
            approvalStatus: stickerPack.approvalStatus,
            events: stickerPack.events,
            lifespan: stickerPack.lifespan,
            tags: stickerPack.tags
        };
    }

    function validateStickerData(file, stickerData) {
        var data = {
            name: stickerData['name'],
            desc: stickerData.desc || '',
            stickerId: file.filename.substr(0, file.filename.indexOf('.')),
            path: file.filename,
            approvalStatus: PENDING,
            authorId: stickerData.authorId
        };

        stickerData.lifespan && (data.lifespan = stickerData.lifespan);
        stickerData.location && (data.location = stickerData.location);
        stickerData.events && (data.events = stickerData.events.replace(/ /g, '').split(','));
        stickerData.tags && (data.tags = stickerData.tags.replace(/ /g, '').split(','));

        return data;
    }

    function initRestApi() {
        app.use('/static', express.static('public'));

        app.post('/stickers', function (req, res, next) {
            upload(req, res, function (err) {
                var stickerPack, stickerData = JSON.parse(req.body.metadata);

                if (!req.file || !stickerData.authorId) {
                    console.log('Insufficent data', req.file, req.body.authorId);
                    res.sendStatus(500);
                    return;

                }

                console.log('in callback', req.file.filename, req.file.originalname, req.file.path, req.body['name']);

                if (err) {
                    console.log('got error', err);
                    res.sendStatus(500);

                } else {
                    console.log('Got value', typeof req.body.lifespan);

                    stickerPack = new StickerPack(validateStickerData(req.file, stickerData));

                    stickerPack.save(function (err, stickerPack) {
                        if (err) {
                            console.error(err);

                            res.sendStatus(500);

                            return;
                        }

                        res.sendStatus(200);
                    });
                }
            })
        });

        app.get('/stickers', function (req, res) {
            StickerPack.find(function (err, stickerPacks) {
                var packs = [],
                    authorId = req.query.authorId;

                if (err) {
                    console.log('got error', err);
                    return;
                }

                console.log('user id:', authorId);

                UserModel.findById(authorId, function (err, doc) {
                    if (err || !doc) {
                        console.log('user not found');

                        res.sendStatus(500);

                        return;
                    }

                    stickerPacks.forEach(function (stickerPack) {
                        if (stickerPack.authorId === authorId) {
                            packs.push(normalizeStickerPack(stickerPack));
                        }
                    });

                    res.end(JSON.stringify(packs));
                });

            });
        });

        app.delete('/stickers/:stickerId', function (req, res) {
            var stickerId = req.params.stickerId;

            console.log('sticker id', stickerId);

            StickerPack.findOne({
                stickerId: stickerId
            }, function (err, sticker) {
                if (err) {
                    res.sendStatus(500);
                    return;
                }

                sticker.remove();
                res.sendStatus(200);
            });

        });

        app.post('/stickers/approve/:stickerId', function (req, res) {
            var stickerId = req.params.stickerId;

            console.log('sticker id', stickerId);

            StickerPack.findOneAndUpdate({
                stickerId: stickerId
            }, {
                approvalStatus: APPROVED
            }, {new: true}, function (err, sticker) {
                if (err) {
                    res.sendStatus(500);
                    return;
                }

                res.end(JSON.stringify(normalizeStickerPack(sticker)));
            });
        });

        app.post('/stickers/reject/:stickerId', function (req, res) {
            var stickerId = req.params.stickerId;

            console.log('sticker id', stickerId);

            StickerPack.findOneAndUpdate({
                stickerId: stickerId
            }, {
                approvalStatus: REJECTED
            }, {new: true}, function (err, sticker) {
                if (err) {
                    res.sendStatus(500);
                    return;
                }

                res.end(JSON.stringify(normalizeStickerPack(sticker)));
            });
        });
    }

    function initLogin() {
        passport.use(new Strategy(
            function(username, password, cb) {
                console.log('in strategy callback');

                UserModel.find({username: username, password: password}, function(err, user) {
                    console.log('in find callback', err, user);

                    if (err) { return cb(err); }

                    if (!user[0]) { return cb(null, false); }

                    console.log('success');

                    return cb(null, user);
                });
            }));

        passport.serializeUser(function(user, done) {
            done(null, user);
        });

        passport.deserializeUser(function(user, done) {
            done(null, user);
        });

        // Initialize Passport and restore authentication state, if any, from the
        // session.
        app.use(passport.initialize());
        app.use(passport.session());

        // Use application-level middleware for common functionality, including
        // logging, parsing, and session handling.
        app.use(require('morgan')('combined'));
        app.use(require('cookie-parser')());
        app.use(require('body-parser').urlencoded({ extended: true }));
        app.use(require('express-session')({ secret: 'keyboard cat', resave: false, saveUninitialized: false }));


        app.post('/login',
            passport.authenticate('local', { failureRedirect: '/static/login.html', session: true }),
            function(req, res) {
                console.log('got in');

                res.redirect('/static/index.html');
            });
    }

    function registerRoutes () {
        initLogin();
        initRestApi();
    }

    initDb();

    var server = app.listen(3000, function () {
        var host = server.address().address;
        var port = server.address().port;

        console.log('Example app listening at http://%s:%s', host, port);
    });

    module.exports = app;
})();
