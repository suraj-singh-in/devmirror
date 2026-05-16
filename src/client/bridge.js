// devmirror phone bridge script.
// Injected into every HTML page served by the proxy.
// Runs in the phone browser — no Node APIs, no imports, no globals.
// __BRIDGE_HOST__ and __BRIDGE_PORT__ are replaced by the proxy at serve time.

(function () {
  var BRIDGE_HOST = '__BRIDGE_HOST__';
  var BRIDGE_PORT = '__BRIDGE_PORT__';
  var RECONNECT_DELAY_MS = 2000;
  var RESIZE_DEBOUNCE_MS = 250;

  var socket = null;
  var resizeTimer = null;

  // Build a dimensions payload from the current window/screen state.
  function buildDimensions() {
    return {
      type: 'dimensions',
      width: screen.width,
      height: screen.height,
      vw: window.innerWidth,
      vh: window.innerHeight,
      dpr: window.devicePixelRatio,
      ua: navigator.userAgent,
    };
  }

  // Send a JSON message on the socket if it is open.
  function send(message) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  // Handle an incoming command from the DevTools panel.
  function handleMessage(event) {
    var message;
    try {
      message = JSON.parse(event.data);
    } catch (e) {
      return; // Ignore malformed frames.
    }

    if (message.type === 'reload') {
      window.location.reload();
    }
    // highlight and request_dom are handled in v0.3.
  }

  // Open a WebSocket connection to the bridge server.
  // Called on first load and again after every unexpected close.
  function connect() {
    socket = new WebSocket('ws://' + BRIDGE_HOST + ':' + BRIDGE_PORT);

    socket.onopen = function () {
      send({ type: 'identify', role: 'phone' });
      send(buildDimensions());
    };

    socket.onmessage = handleMessage;

    socket.onclose = function () {
      // Wait before reconnecting — avoids a tight loop if the server is down.
      setTimeout(connect, RECONNECT_DELAY_MS);
    };

    socket.onerror = function () {
      // Errors always precede a close event; reconnection is handled in onclose.
    };
  }

  // Re-send dimensions when the viewport changes (e.g. rotation, zoom).
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      send(buildDimensions());
    }, RESIZE_DEBOUNCE_MS);
  });

  connect();
})();
