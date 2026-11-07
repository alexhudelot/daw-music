// The player: a queue of samples from the worker, played a block at a time. If it runs dry it fades out in a few
// milliseconds rather than clicking, and counts it.
class StreamPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.q = [];
    this.pos = 0;
    this.have = 0;
    this.played = 0;
    this.underruns = 0;
    this.starting = true;
    this.g = 0;
    this.lastA = 0;
    this.lastB = 0;
    this.prefill = 0.5 * sampleRate;
    this.tick = 0;
    this.port.onmessage = (e) => {
      this.q.push(e.data);
      this.have += e.data.length / 2;
    };
  }
  process(_, outputs) {
    const out = outputs[0];
    const l = out[0];
    const r = out[1] || out[0];
    if (this.starting && this.have >= this.prefill) this.starting = false;
    const step = 1 / (0.003 * sampleRate);
    for (let i = 0; i < l.length; i++) {
      let a = 0;
      let b = 0;
      if (!this.starting && this.have > 0) {
        const c = this.q[0];
        a = c[this.pos];
        b = c[this.pos + 1];
        this.pos += 2;
        this.have--;
        this.played++;
        if (this.pos >= c.length) {
          this.q.shift();
          this.pos = 0;
        }
        this.g = Math.min(1, this.g + step);
        this.lastA = a;
        this.lastB = b;
      } else {
        if (!this.starting) {
          this.starting = true;
          this.prefill = 0.1 * sampleRate;
          this.underruns++;
        }
        this.g = Math.max(0, this.g - step);
        a = this.lastA;
        b = this.lastB;
      }
      l[i] = a * this.g;
      r[i] = b * this.g;
    }
    if ((this.tick++ & 15) === 0) {
      this.port.postMessage({ played: this.played, have: this.have, underruns: this.underruns });
    }
    return true;
  }
}
registerProcessor("stream-player", StreamPlayer);
