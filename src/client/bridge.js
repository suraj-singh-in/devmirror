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

  // Serialize a single value to a JSON-safe string for transmission.
  function serialize(value) {
    if (value === null)      { return 'null'; }
    if (value === undefined) { return 'undefined'; }
    if (typeof value === 'function') {
      return '[Function' + (value.name ? ': ' + value.name : '') + ']';
    }
    if (typeof value !== 'object') { return String(value); }
    if (value instanceof Error) {
      return value.stack || (value.name + ': ' + value.message);
    }
    if (typeof Node !== 'undefined' && value instanceof Node) {
      var desc = value.nodeName;
      if (value.id)        { desc += '#' + value.id; }
      if (value.className) { desc += '.' + String(value.className).trim().split(/\s+/).join('.'); }
      return desc;
    }
    // Arrays: recurse per-item so non-serializable elements still show.
    if (Array.isArray(value)) {
      try { return JSON.stringify(value); } catch (ae) {
        var items = [];
        for (var ai = 0; ai < Math.min(value.length, 20); ai++) {
          try { items.push(serialize(value[ai])); } catch (aie) { items.push('?'); }
        }
        if (value.length > 20) { items.push('…' + (value.length - 20) + ' more'); }
        return '[' + items.join(', ') + ']';
      }
    }
    try {
      return JSON.stringify(value);
    } catch (e) {
      // Circular refs or non-serializable (events, DOM refs, etc.)
      // Build a readable shallow summary of own enumerable keys.
      var name = (value.constructor && value.constructor.name) || 'Object';
      try {
        var pairs = [];
        var ks = Object.keys(value);
        for (var ki = 0; ki < ks.length; ki++) {
          var k = ks[ki];
          if (k[0] === '_') { continue; } // skip private/internal fields
          try {
            var v = value[k];
            if (typeof v === 'function') { continue; }
            var vs;
            if (v === null || v === undefined)            { vs = String(v); }
            else if (typeof v === 'boolean' || typeof v === 'number') { vs = String(v); }
            else if (typeof v === 'string')               { vs = JSON.stringify(v); }
            else if (typeof Node !== 'undefined' && v instanceof Node) {
              var nd = v.nodeName;
              if (v.id) { nd += '#' + v.id; }
              vs = nd;
            } else if (typeof v === 'object') {
              try {
                var inner = JSON.stringify(v);
                vs = (inner && inner.length <= 80) ? inner
                   : '[' + ((v.constructor && v.constructor.name) || 'Object') + ']';
              } catch (ie) {
                vs = '[' + ((v.constructor && v.constructor.name) || 'Object') + ']';
              }
            }
            if (vs !== undefined) { pairs.push(k + ': ' + vs); }
            if (pairs.length >= 15) { break; }
          } catch (pe) {}
        }
        return name + (pairs.length ? ' {' + pairs.join(', ') + '}' : ' {}');
      } catch (e2) { return '[' + name + ']'; }
    }
  }

  function serializeArgs(args) {
    return Array.prototype.map.call(args, serialize);
  }

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

  // Patch console.log/warn/error to forward output to the DevTools panel.
  // Always calls the original first so the phone's own console is unaffected.
  (function patchConsole() {
    ['log', 'warn', 'error'].forEach(function (level) {
      var original = console[level];
      console[level] = function () {
        try { original.apply(console, arguments); } catch (e) {}
        try {
          send({ type: 'console', level: level, args: serializeArgs(arguments), timestamp: Date.now() });
        } catch (e) {}
      };
    });
  })();

  // Forward touch events (touchstart/move/end) to the DevTools panel.
  ['touchstart', 'touchmove', 'touchend'].forEach(function (kind) {
    document.addEventListener(kind, function (e) {
      try {
        var t = e.touches[0] || e.changedTouches[0];
        if (!t) { return; }
        send({ type: 'touch', kind: kind, x: t.clientX, y: t.clientY, timestamp: Date.now() });
      } catch (err) {}
    }, { passive: true });
  });

  // Re-send dimensions when the viewport changes (e.g. rotation, zoom).
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      send(buildDimensions());
    }, RESIZE_DEBOUNCE_MS);
  });

  connect();
})();
