// Gives the web app navigator.requestMIDIAccess inside the iPad and iPhone
// shell, where the system web view has no Web MIDI. The native side
// (MIDIBridge.swift) talks to CoreMIDI and calls window.__nativeMidi.
(function () {
  if (typeof navigator.requestMIDIAccess === 'function') return;
  var native = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.midi;
  if (!native) return;

  function now() {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  function Emitter() {
    this._listeners = {};
  }
  Emitter.prototype.addEventListener = function (type, fn) {
    (this._listeners[type] = this._listeners[type] || []).push(fn);
  };
  Emitter.prototype.removeEventListener = function (type, fn) {
    var list = this._listeners[type] || [];
    var i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  };
  Emitter.prototype._emit = function (type, event) {
    var handler = this['on' + type];
    try {
      if (typeof handler === 'function') handler.call(this, event);
    } catch (error) {
      console.error(error);
    }
    (this._listeners[type] || []).slice().forEach(function (fn) {
      try {
        fn.call(this, event);
      } catch (error) {
        console.error(error);
      }
    }, this);
  };

  function Port(info, type) {
    Emitter.call(this);
    this.id = info.id;
    this.name = info.name;
    this.manufacturer = info.manufacturer || '';
    this.version = '';
    this.type = type;
    this.state = 'connected';
    this.connection = 'open';
    this.onmidimessage = null;
    this.onstatechange = null;
  }
  Port.prototype = Object.create(Emitter.prototype);
  Port.prototype.open = function () {
    return Promise.resolve(this);
  };
  Port.prototype.close = function () {
    return Promise.resolve(this);
  };
  // Like Web MIDI, a timestamp (performance.now() time) holds the message
  // until that moment. The native message has no timestamp field, so the
  // wait happens here. Bytes are forced into 0..255 because the native side
  // converts them to UInt8.
  Port.prototype.send = function (data, timestamp) {
    if (this.state !== 'connected') return;
    var id = this.id;
    var bytes = [];
    for (var i = 0; i < data.length; i++) bytes.push(Number(data[i]) & 255);
    var delay = typeof timestamp === 'number' && isFinite(timestamp) ? timestamp - now() : 0;
    if (delay <= 0) {
      native.postMessage({ type: 'send', id: id, data: bytes });
      return;
    }
    setTimeout(function () {
      native.postMessage({ type: 'send', id: id, data: bytes });
    }, delay);
  };
  Port.prototype.clear = function () {};

  var access = new Emitter();
  access.inputs = new Map();
  access.outputs = new Map();
  access.sysexEnabled = false;
  access.onstatechange = null;

  var waiting = [];
  var gotPorts = false;

  // Ports that go away stay in the map with state 'disconnected', as in Web
  // MIDI, so the app can still list them. Plugging the same device back in
  // reuses its port object.
  function sync(map, list, type) {
    var changed = [];
    var seen = Object.create(null);
    list.forEach(function (info) {
      seen[info.id] = true;
      var port = map.get(info.id);
      if (!port) {
        port = new Port(info, type);
        map.set(info.id, port);
        changed.push(port);
      } else if (port.state !== 'connected') {
        port.state = 'connected';
        port.connection = 'open';
        port.name = info.name;
        changed.push(port);
      }
    });
    map.forEach(function (port, id) {
      if (seen[id] || port.state === 'disconnected') return;
      port.state = 'disconnected';
      port.connection = 'closed';
      changed.push(port);
    });
    return changed;
  }

  window.__nativeMidi = {
    ports: function (inputs, outputs) {
      var changed = sync(access.inputs, inputs || [], 'input').concat(sync(access.outputs, outputs || [], 'output'));
      if (!gotPorts) {
        gotPorts = true;
        waiting.splice(0).forEach(function (resolve) {
          resolve(access);
        });
      }
      changed.forEach(function (port) {
        var event = { type: 'statechange', port: port, target: access };
        port._emit('statechange', event);
        access._emit('statechange', event);
      });
    },
    receive: function (id, bytes) {
      var port = access.inputs.get(id);
      if (!port || port.state !== 'connected') return;
      port._emit('midimessage', { type: 'midimessage', data: new Uint8Array(bytes), timeStamp: now(), target: port });
    },
  };

  navigator.requestMIDIAccess = function () {
    return new Promise(function (resolve) {
      if (gotPorts) {
        resolve(access);
        return;
      }
      // Only the first request asks native for the port list; the others wait for the same answer.
      var first = waiting.length === 0;
      waiting.push(resolve);
      if (first) native.postMessage({ type: 'start' });
    });
  };
})();
