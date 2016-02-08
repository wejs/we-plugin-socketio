(function (we) {

var authToken = $.cookie('weoauth');
// alias
we.io = window.io;
// save current connected socket
we.socket = window.io.connect({
  query: 'authToken=' + authToken
});

})(window.we);