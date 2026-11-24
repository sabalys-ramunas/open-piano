/**
 * Keeps test browsers silent, so a test run never plays through the speakers
 * of whoever is running it. Chromium is also launched with --mute-audio; this
 * script covers WebKit, which has no such flag.
 *
 * - Web Audio: anything connected to a context's destination goes through a
 *   gain of zero instead.
 * - Media elements: always really muted, while `muted` still reads back
 *   whatever the app set, so tests of the app's own mute switch keep working.
 */
export const SILENCE_SCRIPT = `(() => {
  const connect = AudioNode.prototype.connect;
  const sinks = new WeakMap();
  AudioNode.prototype.connect = function (target, ...rest) {
    const offline = typeof OfflineAudioContext !== 'undefined' && target && target.context instanceof OfflineAudioContext;
    // Offline contexts render to memory (the import uses one), so they stay untouched.
    if (!offline && typeof AudioDestinationNode !== 'undefined' && target instanceof AudioDestinationNode) {
      let sink = sinks.get(target.context);
      if (!sink) {
        sink = target.context.createGain();
        sink.gain.value = 0;
        connect.call(sink, target);
        sinks.set(target.context, sink);
      }
      connect.call(this, sink, ...rest);
      return target;
    }
    return connect.call(this, target, ...rest);
  };
  const proto = HTMLMediaElement.prototype;
  const real = Object.getOwnPropertyDescriptor(proto, 'muted');
  if (real && real.set) {
    const said = new WeakMap();
    Object.defineProperty(proto, 'muted', {
      configurable: true,
      get() { return said.get(this) ?? false; },
      set(value) { said.set(this, Boolean(value)); real.set.call(this, true); },
    });
    const play = proto.play;
    proto.play = function () { real.set.call(this, true); return play.apply(this, arguments); };
  }
})();`;
