/**
 * Ensures write processing happens in the order requests arrived,
 * even when upstream responses come back out of order.
 *
 * Usage:
 *   const seq = queue.reserve();     // when request arrives
 *   queue.enqueue(seq, () => { … }); // when upstream responds (success)
 *   queue.skip(seq);                 // when upstream fails
 */
export class WriteOrderQueue {
  private nextSeq = 0;
  private lastProcessed = 0;
  private pending = new Map<number, (() => void) | null>();

  /** Call when a new write request arrives. Returns the sequence number. */
  reserve(): number {
    return ++this.nextSeq;
  }

  /** Call when the write succeeded and is ready to process. */
  enqueue(seq: number, fn: () => void): void {
    this.pending.set(seq, fn);
    this.drain();
  }

  /** Call when the write failed — unblock subsequent writes without processing. */
  skip(seq: number): void {
    this.pending.set(seq, null);
    this.drain();
  }

  /** Number of entries waiting to be drained. */
  get pendingCount(): number {
    return this.pending.size;
  }

  private drain(): void {
    while (this.pending.has(this.lastProcessed + 1)) {
      const next = this.lastProcessed + 1;
      const fn = this.pending.get(next);
      this.pending.delete(next);
      this.lastProcessed = next;
      if (fn) fn();
    }
  }
}
