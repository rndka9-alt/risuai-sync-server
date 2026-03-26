interface BatchFileEntry {
  filePath: string;
  size: number;
}

export interface BatchHeader {
  files: BatchFileEntry[];
}

export function parseBatchBody(buf: Buffer): { header: BatchHeader; bodies: Buffer[] } | null {
  if (buf.length < 4) return null;

  const headerLen = buf.readUInt32BE(0);
  if (buf.length < 4 + headerLen) return null;

  let header: BatchHeader;
  try {
    header = JSON.parse(buf.subarray(4, 4 + headerLen).toString('utf-8'));
  } catch {
    return null;
  }

  if (!header.files || !Array.isArray(header.files)) return null;

  const bodies: Buffer[] = [];
  let offset = 4 + headerLen;
  for (const file of header.files) {
    if (typeof file.filePath !== 'string' || typeof file.size !== 'number') return null;
    if (offset + file.size > buf.length) return null;
    bodies.push(buf.subarray(offset, offset + file.size));
    offset += file.size;
  }

  return { header, bodies };
}
