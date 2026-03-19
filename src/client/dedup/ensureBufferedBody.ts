/** ReadableStream body → Uint8Array 변환. 다른 타입은 그대로 유지. */
export async function ensureBufferedBody(init: RequestInit): Promise<RequestInit> {
  if (!(init.body instanceof ReadableStream)) return init;
  const reader = init.body.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buf.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ...init, body: buf };
}
