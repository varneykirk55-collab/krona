// Both Twilio Media Streams and OpenAI's audio/pcmu use mono G.711 μ-law at 8 kHz.
// Pass raw frames directly: no WAV headers, gratuitous resampling or lossy transcoding.
export class TwilioPlayback {
  private itemId: string | null = null;
  private startAt: number | null = null;
  private sentMs = 0;
  private playedMs = 0;
  private sequence = 0;
  private epoch = 0;
  private marks = new Map<string, number>();
  latestTimestamp = 0;
  constructor(
    public streamSid: string,
    private send: (event: unknown) => void,
  ) {}
  timestamp(ms: number) {
    if (Number.isFinite(ms) && ms >= this.latestTimestamp) this.latestTimestamp = ms;
  }
  audio(base64: string, itemId: string) {
    const bytes = Buffer.from(base64, 'base64');
    if (!bytes.length || bytes.length > 128000) throw new Error('Invalid audio frame');
    if (this.itemId !== itemId) {
      this.itemId = itemId;
      this.sentMs = 0;
      this.playedMs = 0;
      this.startAt = this.latestTimestamp;
      this.marks.clear();
    }
    this.sentMs += bytes.length / 8;
    if (this.marks.size > 1000) throw new Error('Audio acknowledgement backpressure exceeded');
    // Chunk output to 200 ms or less. Twilio buffers it and acknowledges the mark after playback.
    for (let i = 0; i < bytes.length; i += 1600)
      this.send({
        event: 'media',
        streamSid: this.streamSid,
        media: { payload: bytes.subarray(i, i + 1600).toString('base64') },
      });
    const name = `p_${this.epoch}_${++this.sequence}`;
    this.marks.set(name, this.sentMs);
    this.send({ event: 'mark', streamSid: this.streamSid, mark: { name } });
  }
  acknowledge(name: string) {
    const played = this.marks.get(name);
    if (played !== undefined) {
      this.playedMs = Math.max(this.playedMs, played);
      this.marks.delete(name);
    }
  }
  interrupt() {
    const elapsed = this.startAt === null ? 0 : Math.max(0, this.latestTimestamp - this.startAt);
    const audioEndMs = Math.min(this.sentMs, Math.max(this.playedMs, elapsed));
    const itemId = this.itemId;
    this.send({ event: 'clear', streamSid: this.streamSid });
    // clear causes Twilio to acknowledge discarded marks too. Ignore them by dropping this epoch.
    this.epoch++;
    this.marks.clear();
    this.itemId = null;
    this.startAt = null;
    this.sentMs = 0;
    this.playedMs = 0;
    return { itemId, audioEndMs };
  }
}
