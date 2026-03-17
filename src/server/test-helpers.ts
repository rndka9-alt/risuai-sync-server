import zlib from 'zlib';

export function buildBlock(
  type: number,
  name: string,
  data: string | Buffer,
  compress = false,
): Buffer {
  const nameBytes = Buffer.from(name, 'utf-8');
  let dataBytes = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;
  const compression = compress ? 1 : 0;

  if (compress) {
    dataBytes = zlib.gzipSync(dataBytes);
  }

  const header = Buffer.alloc(3 + nameBytes.length + 4);
  header[0] = type;
  header[1] = compression;
  header[2] = nameBytes.length;
  nameBytes.copy(header, 3);
  header.writeUInt32LE(dataBytes.length, 3 + nameBytes.length);

  return Buffer.concat([header, dataBytes]);
}

export function buildRisuSave(...blocks: Buffer[]): Buffer {
  return Buffer.concat([
    Buffer.from('RISUSAVE\0', 'utf-8'),
    ...blocks,
  ]);
}

export function hexEncode(str: string): string {
  let hex = '';
  for (let i = 0; i < str.length; i++) {
    hex += str.charCodeAt(i).toString(16).padStart(2, '0');
  }
  return hex;
}

interface MockWs {
  readyState: number;
  send: (...args: unknown[]) => void;
  _sent: string[];
}

export function createMockWs(): MockWs {
  const sent: string[] = [];
  return {
    readyState: 1,
    send(data: unknown) { sent.push(String(data)); },
    _sent: sent,
  };
}

export function sentMessages(ws: MockWs): unknown[] {
  return ws._sent.map((s) => JSON.parse(s));
}

export function lastSentMessage(ws: MockWs): unknown {
  const msgs = sentMessages(ws);
  return msgs[msgs.length - 1];
}

export function clearSent(ws: MockWs): void {
  ws._sent.length = 0;
}
