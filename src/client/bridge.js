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
  var highlightTimer   = null; // setTimeout handle for the active highlight
  var highlightRestore = null; // closure that removes the active highlight

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
    } else if (message.type === 'request_dom') {
      setTimeout(function () {
        send({ type: 'dom', html: document.documentElement.outerHTML });
      }, 0);
    } else if (message.type === 'request_styles') {
      var styleEl = document.querySelector(message.selector);
      if (!styleEl) {
        send({ type: 'styles', selector: message.selector, seq: message.seq, inline: {}, rules: [] });
        return;
      }
      // Collect inline styles from the live element
      var inlineStyles = {};
      var sd = styleEl.style;
      for (var si = 0; si < sd.length; si++) {
        var sp = sd[si];
        inlineStyles[sp] = { value: sd.getPropertyValue(sp), important: sd.getPropertyPriority(sp) === 'important' };
      }
      // Walk all stylesheets for rules matching this element
      var matchedRules = [];
      for (var ssi = 0; ssi < document.styleSheets.length; ssi++) {
        var sheet = document.styleSheets[ssi];
        var cssRules;
        try { cssRules = sheet.cssRules || sheet.rules; } catch (e) { continue; }
        if (!cssRules) { continue; }
        for (var ri = 0; ri < cssRules.length; ri++) {
          var rule = cssRules[ri];
          if (!rule.selectorText) { continue; }
          try {
            if (!styleEl.matches(rule.selectorText)) { continue; }
          } catch (e) { continue; }
          var props = [];
          var rs = rule.style;
          for (var pi = 0; pi < rs.length; pi++) {
            var rp = rs[pi];
            props.push({ property: rp, value: rs.getPropertyValue(rp), important: rs.getPropertyPriority(rp) === 'important' });
          }
          if (!props.length) { continue; }
          var href = sheet.href;
          var src = href ? href.split('/').pop().split('?')[0] : '(index)';
          matchedRules.push({ selector: rule.selectorText, source: src, properties: props });
        }
      }
      send({ type: 'styles', selector: message.selector, seq: message.seq, inline: inlineStyles, rules: matchedRules });
    } else if (message.type === 'highlight') {
      var el = document.querySelector(message.selector);
      if (!el) { return; }
      // If a previous highlight is active, cancel it and restore that element first.
      if (highlightTimer !== null) {
        clearTimeout(highlightTimer);
        highlightTimer = null;
        if (highlightRestore) { highlightRestore(); }
        highlightRestore = null;
      }
      var savedOutline = el.style.outline;
      var savedOffset  = el.style.outlineOffset;
      el.style.outline       = '2px solid #1D9E75';
      el.style.outlineOffset = '2px';
      highlightRestore = function () {
        el.style.outline       = savedOutline;
        el.style.outlineOffset = savedOffset;
      };
      highlightTimer = setTimeout(function () {
        highlightRestore();
        highlightTimer   = null;
        highlightRestore = null;
      }, 2000);
    }
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

  // ── Network interception helpers ─────────────────────────────────────────

  function generateRequestId() {
    return Math.random().toString(36).slice(2, 10);
  }

  function resolveUrl(input) {
    if (input && typeof input === 'object' && typeof input.url === 'string') { return input.url; }
    try { return new URL(String(input), location.href).href; } catch (e) { return String(input); }
  }

  function headersToObject(headers) {
    var result = {};
    try { headers.forEach(function(value, key) { result[key] = value; }); } catch (e) {}
    return result;
  }

  function parseXhrResponseHeaders(raw) {
    var result = {};
    if (!raw) { return result; }
    raw.trim().split(/[\r\n]+/).forEach(function(line) {
      var idx = line.indexOf(': ');
      if (idx > -1) { result[line.slice(0, idx).toLowerCase()] = line.slice(idx + 2); }
    });
    return result;
  }

  function serializeBody(body) {
    if (body === null || body === undefined) { return null; }
    if (typeof body === 'string') { return { type: 'text', content: body.slice(0, 50000) }; }
    if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
      return { type: 'text', content: body.toString() };
    }
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      var entries = {};
      try { body.forEach(function(value, key) { entries[key] = String(value); }); } catch (e) {}
      return { type: 'formdata', content: entries };
    }
    return { type: 'binary', content: '[Binary data]' };
  }

  function safeReadBody(response) {
    var MAX_BYTES = 100 * 1024;
    return response.arrayBuffer().then(function(buffer) {
      var text;
      try { text = new TextDecoder().decode(buffer.slice(0, MAX_BYTES)); } catch (e) { text = ''; }
      return { text: text, byteLength: buffer.byteLength, truncated: buffer.byteLength > MAX_BYTES };
    }).catch(function() {
      return { text: '[Could not read response body]', byteLength: 0, truncated: false };
    });
  }

  function safeGetXhrBody(xhr) {
    var MAX_CHARS = 100 * 1024;
    try {
      var text = xhr.responseText || '';
      return { text: text.slice(0, MAX_CHARS), byteLength: text.length, truncated: text.length > MAX_CHARS };
    } catch (e) {
      return { text: '[Could not read response body]', byteLength: 0, truncated: false };
    }
  }

  function getResourceTiming(url, requestStartTime) {
    try {
      var entries = performance.getEntriesByName(url, 'resource');
      if (!entries.length) { return null; }
      var entry = null;
      for (var i = 0; i < entries.length; i++) {
        var diff = Math.abs(entries[i].startTime - requestStartTime);
        if (!entry || diff < Math.abs(entry.startTime - requestStartTime)) { entry = entries[i]; }
      }
      if (!entry || entry.responseEnd === 0) { return null; }
      return {
        dns:      Math.round(entry.domainLookupEnd  - entry.domainLookupStart),
        connect:  Math.round(entry.connectEnd       - entry.connectStart),
        ssl:      entry.secureConnectionStart > 0 ? Math.round(entry.connectEnd - entry.secureConnectionStart) : 0,
        ttfb:     Math.round(entry.responseStart    - entry.requestStart),
        download: Math.round(entry.responseEnd      - entry.responseStart),
        total:    Math.round(entry.responseEnd      - entry.startTime),
      };
    } catch (e) {
      return null;
    }
  }

  function detectResourceType(contentType, url) {
    if (!contentType) {
      var path = url.split('?')[0].toLowerCase();
      if (path.slice(-3) === '.js' || path.slice(-4) === '.mjs') { return 'js'; }
      if (path.slice(-4) === '.css') { return 'css'; }
      if (/\.(png|jpg|jpeg|gif|webp|svg|ico)$/.test(path)) { return 'img'; }
      return 'other';
    }
    var ct = contentType.toLowerCase();
    if (ct.indexOf('application/json') !== -1 || ct.indexOf('text/plain') !== -1) { return 'fetch'; }
    if (ct.indexOf('javascript') !== -1) { return 'js'; }
    if (ct.indexOf('css') !== -1) { return 'css'; }
    if (ct.indexOf('image/') !== -1) { return 'img'; }
    if (ct.indexOf('text/html') !== -1) { return 'other'; }
    return 'other';
  }

  // ── Fetch interception ───────────────────────────────────────────────────

  if (typeof window.fetch === 'function') {
    var originalFetch = window.fetch.bind(window);
    window.fetch = function devmirrorFetch(input, init) {
      if (init === undefined) { init = {}; }
      var requestId = generateRequestId();
      var method = ((init && init.method) || 'GET').toUpperCase();
      var url = resolveUrl(input);
      var startTime = performance.now();
      var requestHeaders = headersToObject(new Headers(init.headers || {}));
      var requestBody = serializeBody(init.body !== undefined ? init.body : null);

      send({
        type: 'network_request_start',
        requestId: requestId, method: method, url: url,
        requestHeaders: requestHeaders, requestBody: requestBody,
        startTime: startTime, initiator: 'fetch',
      });

      return originalFetch(input, init).then(function(response) {
        var endTime = performance.now();
        var status = response.status;
        var statusText = response.statusText;
        var responseHeaders = headersToObject(response.headers);
        var contentType = response.headers.get('content-type') || '';
        var cloned = response.clone();
        safeReadBody(cloned).then(function(body) {
          var timing = getResourceTiming(url, startTime);
          send({
            type: 'network_request_done',
            requestId: requestId,
            status: status, statusText: statusText,
            responseHeaders: responseHeaders,
            body: body.text, bodyTruncated: body.truncated,
            contentType: contentType,
            resourceType: detectResourceType(contentType, url),
            size: body.byteLength,
            duration: Math.round(endTime - startTime),
            timing: timing,
          });
        }).catch(function() {});
        return response;
      }, function(error) {
        send({
          type: 'network_request_error',
          requestId: requestId,
          error: error.message,
          duration: Math.round(performance.now() - startTime),
        });
        throw error;
      });
    };
  }

  // ── XHR interception ─────────────────────────────────────────────────────

  if (typeof window.XMLHttpRequest !== 'undefined') {
    var OriginalXHR = window.XMLHttpRequest;
    window.XMLHttpRequest = function devmirrorXHR() {
      var xhr = new OriginalXHR();
      var requestId = generateRequestId();
      var xhrMethod = 'GET';
      var xhrUrl = '';
      var xhrStartTime = 0;
      var xhrRequestBody = null;
      var xhrRequestHeaders = {};

      var originalOpen = xhr.open;
      xhr.open = function(m, u) {
        xhrMethod = m.toUpperCase();
        xhrUrl = resolveUrl(u);
        return originalOpen.apply(xhr, arguments);
      };

      var originalSetRequestHeader = xhr.setRequestHeader;
      xhr.setRequestHeader = function(key, value) {
        xhrRequestHeaders[key] = value;
        return originalSetRequestHeader.apply(xhr, arguments);
      };

      var originalSend = xhr.send;
      xhr.send = function(body) {
        xhrStartTime = performance.now();
        xhrRequestBody = serializeBody(body !== undefined ? body : null);

        send({
          type: 'network_request_start',
          requestId: requestId, method: xhrMethod, url: xhrUrl,
          requestHeaders: xhrRequestHeaders,
          requestBody: xhrRequestBody,
          startTime: xhrStartTime, initiator: 'xhr',
        });

        xhr.addEventListener('loadend', function() {
          var duration = Math.round(performance.now() - xhrStartTime);
          var responseResult = safeGetXhrBody(xhr);
          var timing = getResourceTiming(xhrUrl, xhrStartTime);
          var ct = xhr.getResponseHeader('content-type') || '';
          send({
            type: 'network_request_done',
            requestId: requestId,
            status: xhr.status, statusText: xhr.statusText,
            responseHeaders: parseXhrResponseHeaders(xhr.getAllResponseHeaders()),
            body: responseResult.text, bodyTruncated: responseResult.truncated,
            contentType: ct,
            resourceType: detectResourceType(ct, xhrUrl),
            size: responseResult.byteLength,
            duration: duration, timing: timing,
          });
        });

        xhr.addEventListener('error', function() {
          send({
            type: 'network_request_error',
            requestId: requestId,
            error: 'Network error',
            duration: Math.round(performance.now() - xhrStartTime),
          });
        });

        return originalSend.apply(xhr, arguments);
      };

      return xhr;
    };
    window.XMLHttpRequest.prototype = OriginalXHR.prototype;
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
