// Runs the wasm session off the page's thread: renders block here, and the audio already handed over keeps playing.
// If the wasm traps, a new instance carries on from what this browser has learned, after what's still queued.
let wasm = null;
let module = null;
let played = 0;
let offset = 0; // frames handed over by instances before this one
let made = 0;
let learner = "";
let restarts = 0;
const inbox = [];
const BARS = 4;

const imports = { env: { now_ms: () => performance.now() } };
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function write(text) {
  const bytes = encoder.encode(text);
  if (!bytes.length) return [0, 0];
  const p = wasm.alloc(bytes.length);
  new Uint8Array(wasm.memory.buffer, p, bytes.length).set(bytes);
  return [p, bytes.length];
}

async function start() {
  const instance = await WebAssembly.instantiate(module, imports);
  wasm = instance.exports;
  const [p, n] = write(learner);
  const seed = crypto.getRandomValues(new Uint32Array(1))[0];
  wasm.init(seed, BARS, p, n);
  if (n) wasm.free(p, n);
  offset = made;
}

function flush() {
  const n = wasm.events();
  if (!n) return;
  const list = JSON.parse(decoder.decode(new Uint8Array(wasm.memory.buffer, wasm.events_ptr(), n)));
  for (const e of list) {
    if (e.type === "learner") learner = e.json;
    if (e.type === "phrase") {
      e.memory_mb = wasm.memory.buffer.byteLength / 1e6;
      restarts = 0; // a phrase made it, so only errors in a row end the stream
    }
    for (const key of ["start", "landing"]) if (key in e) e[key] += offset;
    postMessage({ event: e });
  }
}

function turn() {
  try {
    while (inbox.length) {
      const [p, n] = write(JSON.stringify(inbox.shift()));
      wasm.message(p, n);
      wasm.free(p, n);
    }
    const frames = wasm.step(Math.max(0, played - offset));
    if (frames) {
      const audio = new Float32Array(wasm.memory.buffer, wasm.audio_ptr(), frames * 2).slice();
      made += frames;
      postMessage({ audio }, [audio.buffer]);
    }
    flush();
    setTimeout(turn, 40);
  } catch (err) {
    restarts++;
    postMessage({ event: { type: "trap", error: String(err), restarts } });
    if (restarts > 5) return;
    start()
      .then(() => setTimeout(turn, 500))
      .catch((e) => postMessage({ event: { type: "trap", error: String(e), restarts: 6 } }));
  }
}

onmessage = async (m) => {
  const d = m.data;
  if ("played" in d) played = d.played;
  else if (d.start) {
    learner = d.learner || "";
    let bytes;
    try {
      const response = await fetch("daw_stream_web.wasm");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      bytes = await response.arrayBuffer();
    } catch (err) {
      postMessage({ event: { type: "network", error: String(err) } });
      return;
    }
    try {
      module = await WebAssembly.compile(bytes);
    } catch (err) {
      postMessage({ event: { type: "unsupported", error: String(err) } });
      return;
    }
    try {
      await start();
      postMessage({ event: { type: "loaded" } });
      turn();
    } catch (err) {
      postMessage({ event: { type: "trap", error: String(err), restarts: 6 } });
    }
  } else {
    inbox.push(d);
  }
};
