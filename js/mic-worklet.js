// Copyright (C) 2026 Aron Sommer. See LICENSE file for full license details.

// Posts the microphone signal as 16-bit PCM chunks.
class Mic extends AudioWorkletProcessor {
  chunk = new Int16Array(2048);
  length = 0;

  process([[channel]]) {
    if (!channel) return true;
    for (const sample of channel) {
      this.chunk[this.length++] = Math.max(-1, Math.min(1, sample)) * 0x7fff;
      if (this.length === this.chunk.length) {
        this.port.postMessage(this.chunk.slice());
        this.length = 0;
      }
    }
    return true;
  }
}

registerProcessor("mic", Mic);
