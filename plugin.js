/**
 * We.js socket.io plugin
 *
 * Add socket.io with suport to sesstion and token authentications
 *
 * see http://wejs.org/docs/we/extend.plugin
 */

var socketIo = require('socket.io');
var sharedsession = require('express-socket.io-session');

var weIo = {
  tokenStrategy: function tokenStrategy(token, done) {
    var we = this.we;
    return we.db.models.accesstoken.find({ where: {
      token: token, isValid: true
    }}).then(function (tokenObj) {
      if (!tokenObj) return done(null, false);

      var accessTokenTime = we.config.passport.accessTokenTime;

      var notIsExpired = we.auth.util.checkIfTokenIsExpired(tokenObj, accessTokenTime);
      if (!notIsExpired) return done(null, false);

      we.db.models.user.find({
        where: {id: tokenObj.userId},
        include: [ { model: we.db.models.role, as: 'roles'} ]
      }).then(function (user) {
        if (!user) return done(null, false);
        // TODO add suport to scopes
        return done(null, user, { scope: 'all' });
      });
    });
  },
  sessionStrategy: function sessionStrategy(userId, done) {
    var we = this.we;
    we.db.models.user.find({
      where: { id: userId },
      include: [ { model: we.db.models.role, as: 'roles'} ]
    }).then(function (user) {
      done(null, user);
    });
  }
};

/**
 * Add socket.io in http
 */
weIo.load = function load(we, server) {
  we.io = socketIo(server);

  we.io.use(sharedsession(we.session, {
    autoSave: true
  }));

  we.events.emit('we:after:load:socket.io', { we: we, server: server } );

  we.io.onlineusers = {};

  // socket.io authToken middleware
  we.io.use(function (socket, next) {
    if (!socket.handshake.query.authToken) return next();
    // token strategy
    weIo.tokenStrategy.bind({we: we})(socket.handshake.query.authToken, function (err, user) {
      if (err) return next(err);
      if (!user) return next();

      socket.authToken = socket.handshake.query.authToken;
      socket.user = user;

      next();
    });
  });
  // socket.io session middleware
  we.io.use(function (socket, next) {
    if (
      !we.config.passport.enableSession ||
      !socket.handshake.session ||
      !socket.handshake.session.passport ||
      !socket.handshake.session.passport.user
    ) {
      return next();
    }

    var userId = socket.handshake.session.passport.user;
    // sessinIdStrategy strategy
    weIo.sessionStrategy.bind({we: we})(userId, function (err, user) {
      if (err) return next(err);
      if (!user) return next();

      socket.userId = userId;
      socket.user = user;

      next();
    });
  });

  we.io.on('connection', function (socket) {
    we.log.verbose('a user connected:', socket.id);

    if (socket.user && socket.user.id) {
      // join user exclusive room to allow others users send
      // mesages to this user
      socket.join('user_' + socket.user.id);
    }
    // global socket to system calls
    socket.join('global');
    // Public room
    socket.join('public');

    socket.on('auth:login:token', function(data) {
      if (!data.authToken) return;
      we.log.verbose('auth:login:token', data);

      weIo.tokenStrategy.bind({we: we})(data.authToken, function(err, user) {
        if (err) {
          return we.log.error('auth:login:token: we.auth.tokenStrategy:', err);
        }
        if (!user) return;

        socket.authToken = data.authToken;
        socket.user = user;
        socket.send('auth:authenticated', {
          user: user,
          token: socket.authToken
        });
      });
    });

    socket.on('disconnect', function() {
      we.log.verbose('user disconnected', socket.id, socket.user);
      we.io.removeFromOnlineUsers(socket);
    });
  });

  we.io.removeFromOnlineUsers = function removeFromOnlineUsers(socket) {
    if (!socket.user || !socket.user.id) return;
    if (typeof we.io.onlineusers[socket.user.id] === 'undefined') return;

    if (we.io.onlineusers[socket.user.id]) {
      var index = we.io.onlineusers[socket.user.id].sockets.indexOf(socket.id);
      if (index >-1 ) we.io.onlineusers[socket.user.id].sockets.splice(index, 1);

      if (!we.io.onlineusers[socket.user.id].sockets.length)
        delete we.io.onlineusers[socket.user.id];
    }

    if (!we.io.isOnline(socket.user.id) ) {
      we.events.emit('socket.io:on:user:disconnect', { socket: socket, we: we });
    }
  }

  we.io.isOnline = function isOnline(userId) {
    if (we.utils._.isEmpty(we.io.onlineusers[userId])) {
      return false;
    } else {
      return true;
    }
  }
}

module.exports = function loadPlugin(projectPath, Plugin) {
  var plugin = new Plugin(__dirname);
  // set plugin configs
  // plugin.setConfigs({
  // });

  plugin.addJs('socket.io', {
    type: 'plugin', weight: 4, pluginName: 'we-plugin-socketio',
    path: 'files/public/js/socket.io.js'
  });

  plugin.events.on('we:after:load:plugins', function (we) {
    we.io = { socketio: socketIo, weIo: weIo };
  });

  plugin.events.on('we:server:after:create', function (data) {
    weIo.load(data.we, data.server);
  });

  return plugin;
};