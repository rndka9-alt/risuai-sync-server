/**
 * AsyncIterable<Uint8Array> 에서 정확한 바이트 수를 읽어오는 유틸.
 * 청크 경계를 자동으로 처리하며, 개별 블록 단위로 데이터를 소비하여
 * 전체 스트림을 메모리에 올리지 않는다.
 */
export class BufferedAsyncReader {
  private chunks: Buffer[] = [];
  private available = 0;
  private iterator: AsyncIterator<Uint8Array>;
  private done = false;

  constructor(iterable: AsyncIterable<Uint8Array>) {
    this.iterator = iterable[Symbol.asyncIterator]();
  }

  /**
   * 정확히 n바이트를 읽는다.
   * 스트림 끝에 도달하여 n바이트를 채울 수 없으면 null을 반환한다.
   */
  async readExact(n: number): Promise<Buffer | null> {
    while (this.available < n && !this.done) {
      const result = await this.iterator.next();
      if (result.done) {
        this.done = true;
        break;
      }
      const buf = Buffer.isBuffer(result.value) ? result.value : Buffer.from(result.value);
      this.chunks.push(buf);
      this.available += buf.length;
    }

    if (this.available < n) return null;
    return this.consume(n);
  }

  private consume(n: number): Buffer {
    if (n === 0) return Buffer.alloc(0);

    // 첫 청크에 충분한 데이터가 있으면 복사 후 반환
    if (this.chunks[0].length >= n) {
      const chunk = this.chunks[0];
      const result = Buffer.from(chunk.subarray(0, n));
      if (chunk.length === n) {
        this.chunks.shift();
      } else {
        this.chunks[0] = chunk.subarray(n);
      }
      this.available -= n;
      return result;
    }

    // 여러 청크에 걸친 경우: 순차 복사
    const result = Buffer.alloc(n);
    let offset = 0;
    while (offset < n) {
      const chunk = this.chunks[0];
      const needed = n - offset;
      if (chunk.length <= needed) {
        chunk.copy(result, offset);
        offset += chunk.length;
        this.available -= chunk.length;
        this.chunks.shift();
      } else {
        chunk.copy(result, offset, 0, needed);
        this.chunks[0] = chunk.subarray(needed);
        this.available -= needed;
        offset = n;
      }
    }
    return result;
  }
}
