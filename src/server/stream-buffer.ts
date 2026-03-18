import http from 'http';
import * as logger from './logger';

interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

interface BufferedStream {
  id: string;
  senderClientId: string;
  targetCharId: string | null;
  upstreamReq: http.ClientRequest | null;
  accumulatedText: string;
  lineBuffer: string;
  status: 'streaming' | 'completed' | 'failed';
  subscribers: Set<http.ServerResponse>;
  createdAt: number;
  completedAt: number | null;
  error?: string;
  /** Non-SSE 응답 전체 (설정 시 subscribe가 raw HTTP로 응답) */
  rawResponse: RawResponse | null;
}

const streams = new Map<string, BufferedStream>();

/** Completed stream 보존 기간 (5분) */
const STREAM_TTL_MS = 5 * 60 * 1000;
/** Zombie streaming 엔트리 강제 정리 (30분) */
const STREAM_ZOMBIE_TTL_MS = 30 * 60 * 1000;

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [id, stream] of streams) {
    // Completed/failed stream 만료 정리
    if (stream.completedAt && now - stream.completedAt > STREAM_TTL_MS) {
      streams.delete(id);
      logger.debug('Stream buffer expired', { streamId: id });
      continue;
    }

    // Zombie streaming 엔트리 강제 정리: upstream 무응답 시
    if (stream.status === 'streaming' && now - stream.createdAt > STREAM_ZOMBIE_TTL_MS) {
      logger.warn('Zombie stream buffer cleaned up', { streamId: id, ageSeconds: String(Math.round((now - stream.createdAt) / 1000)) });

      if (stream.upstreamReq && !stream.upstreamReq.destroyed) {
        stream.upstreamReq.destroy();
      }

      stream.status = 'failed';
      stream.completedAt = now;
      stream.error = 'stream timeout';
      stream.upstreamReq = null;

      for (const sub of stream.subscribers) {
        if (!sub.writableEnded) {
          sub.write(`data: ${JSON.stringify({ type: 'error', error: 'stream timeout' })}\n\n`);
          sub.end();
        }
      }
      stream.subscribers.clear();
    }
  }
}, 60_000);
cleanupTimer.unref();

export function create(
  id: string,
  senderClientId: string,
  targetCharId: string | null,
  upstreamReq: http.ClientRequest,
): void {
  streams.set(id, {
    id,
    senderClientId,
    targetCharId,
    upstreamReq,
    accumulatedText: '',
    lineBuffer: '',
    status: 'streaming',
    subscribers: new Set(),
    createdAt: Date.now(),
    completedAt: null,
    rawResponse: null,
  });
}

export function addChunk(id: string, chunk: Buffer): void {
  const stream = streams.get(id);
  if (!stream || stream.status !== 'streaming') return;

  stream.lineBuffer += chunk.toString('utf-8');
  const lastNewline = stream.lineBuffer.lastIndexOf('\n');
  if (lastNewline === -1) return;

  const completePart = stream.lineBuffer.slice(0, lastNewline + 1);
  stream.lineBuffer = stream.lineBuffer.slice(lastNewline + 1);

  const deltas = parseSSEDeltas(completePart);
  if (deltas.length === 0) return;

  for (const delta of deltas) {
    stream.accumulatedText += delta;
  }

  for (const sub of stream.subscribers) {
    if (!sub.writableEnded) {
      sub.write(`data: ${JSON.stringify({ text: stream.accumulatedText })}\n\n`);
    }
  }
}

export function complete(id: string): void {
  const stream = streams.get(id);
  if (!stream || stream.status !== 'streaming') return;

  if (stream.lineBuffer.trim()) {
    const deltas = parseSSEDeltas(stream.lineBuffer);
    for (const delta of deltas) {
      stream.accumulatedText += delta;
    }
    stream.lineBuffer = '';
  }

  stream.status = 'completed';
  stream.completedAt = Date.now();
  stream.upstreamReq = null;

  for (const sub of stream.subscribers) {
    if (!sub.writableEnded) {
      sub.write(`data: ${JSON.stringify({ type: 'done', text: stream.accumulatedText })}\n\n`);
      sub.end();
    }
  }
  stream.subscribers.clear();
}

export function fail(id: string, error: string): void {
  const stream = streams.get(id);
  if (!stream || stream.status !== 'streaming') return;

  stream.status = 'failed';
  stream.completedAt = Date.now();
  stream.error = error;
  stream.upstreamReq = null;

  for (const sub of stream.subscribers) {
    if (!sub.writableEnded) {
      sub.write(`data: ${JSON.stringify({ type: 'error', error, text: stream.accumulatedText })}\n\n`);
      sub.end();
    }
  }
  stream.subscribers.clear();
}

/**
 * 유저가 명시적으로 생성 중단.
 * Upstream 연결을 끊고 현재까지의 텍스트를 보존한다.
 */
export function abort(id: string): boolean {
  const stream = streams.get(id);
  if (!stream || stream.status !== 'streaming') return false;

  if (stream.upstreamReq && !stream.upstreamReq.destroyed) {
    stream.upstreamReq.destroy();
  }
  stream.upstreamReq = null;

  if (stream.lineBuffer.trim()) {
    const deltas = parseSSEDeltas(stream.lineBuffer);
    for (const delta of deltas) {
      stream.accumulatedText += delta;
    }
    stream.lineBuffer = '';
  }

  stream.status = 'completed';
  stream.completedAt = Date.now();

  for (const sub of stream.subscribers) {
    if (!sub.writableEnded) {
      sub.write(`data: ${JSON.stringify({ type: 'done', text: stream.accumulatedText, aborted: true })}\n\n`);
      sub.end();
    }
  }
  stream.subscribers.clear();
  return true;
}

/**
 * Non-SSE 응답 전체를 버퍼링하여 즉시 완료 상태로 저장.
 * 클라이언트가 끊겨도 재연결 시 동일 응답을 받을 수 있다.
 */
export function storeResponse(
  id: string,
  senderClientId: string,
  targetCharId: string | null,
  status: number,
  headers: http.IncomingHttpHeaders,
  body: Buffer,
): string {
  const contentType = typeof headers['content-type'] === 'string'
    ? headers['content-type']
    : undefined;
  const extractedText = parseNonSSEResponseText(status, contentType, body);

  streams.set(id, {
    id,
    senderClientId,
    targetCharId,
    upstreamReq: null,
    accumulatedText: extractedText,
    lineBuffer: '',
    status: 'completed',
    subscribers: new Set(),
    createdAt: Date.now(),
    completedAt: Date.now(),
    rawResponse: { status, headers, body },
  });

  return extractedText;
}

/**
 * 재연결.
 * - Non-SSE: 버퍼된 응답을 원본 그대로 전송.
 * - SSE: 현재 누적 텍스트 즉시 전송 + 라이브 구독.
 */
export function subscribe(id: string, res: http.ServerResponse): boolean {
  const stream = streams.get(id);
  if (!stream) return false;

  // Non-SSE: 원본 응답 그대로 재전송
  if (stream.rawResponse) {
    const raw = stream.rawResponse;
    const headers = { ...raw.headers };
    headers['content-length'] = String(raw.body.length);
    delete headers['transfer-encoding'];
    res.writeHead(raw.status, headers);
    res.end(raw.body);
    return true;
  }

  // SSE: 누적 텍스트 + 라이브 구독
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    'connection': 'keep-alive',
  });

  res.write(`data: ${JSON.stringify({ text: stream.accumulatedText })}\n\n`);

  if (stream.status !== 'streaming') {
    const event = stream.status === 'failed'
      ? { type: 'error', error: stream.error, text: stream.accumulatedText }
      : { type: 'done', text: stream.accumulatedText };
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    res.end();
    return true;
  }

  stream.subscribers.add(res);
  res.on('close', () => {
    stream.subscribers.delete(res);
  });
  return true;
}

export interface StreamInfo {
  id: string;
  senderClientId: string;
  targetCharId: string | null;
  status: string;
  textLength: number;
  createdAt: number;
}

/** 활성 스트림 목록 (헤더 수신 전 끊긴 클라이언트가 자기 스트림을 찾을 때 사용) */
export function getActiveStreams(): StreamInfo[] {
  const result: StreamInfo[] = [];
  for (const stream of streams.values()) {
    if (stream.status === 'streaming') {
      result.push({
        id: stream.id,
        senderClientId: stream.senderClientId,
        targetCharId: stream.targetCharId,
        status: stream.status,
        textLength: stream.accumulatedText.length,
        createdAt: stream.createdAt,
      });
    }
  }
  return result;
}

/** 보관소: ACK 수신 시 버퍼 삭제 */
export function acknowledge(id: string): boolean {
  return streams.delete(id);
}

/** 보관소: 미수신 완료 SSE 스트림 목록 (catchUp 응답에 첨부) */
export function getCompletedPending(): Array<{
  id: string;
  targetCharId: string | null;
  accumulatedText: string;
}> {
  const result: Array<{ id: string; targetCharId: string | null; accumulatedText: string }> = [];
  for (const stream of streams.values()) {
    if (stream.status === 'completed' && stream.accumulatedText) {
      result.push({
        id: stream.id,
        targetCharId: stream.targetCharId,
        accumulatedText: stream.accumulatedText,
      });
    }
  }
  return result;
}

/** For testing */
export function _clear(): void {
  streams.clear();
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Non-SSE 응답 body에서 생성 텍스트 추출 (OpenAI / Anthropic) */
export function parseNonSSEResponseText(
  status: number,
  contentType: string | undefined,
  body: Buffer,
): string {
  if (status !== 200) return '';
  if (!contentType || !contentType.includes('application/json')) return '';

  try {
    const json: Record<string, unknown> = JSON.parse(body.toString('utf-8'));

    // OpenAI: { choices: [{ message: { content: "text" } }] }
    if (Array.isArray(json.choices)) {
      for (const choice of json.choices) {
        if (!isRecord(choice)) continue;
        const message = choice.message;
        if (!isRecord(message)) continue;
        if (typeof message.content === 'string') return message.content;
      }
    }

    // Anthropic: { content: [{ type: "text", text: "text" }] }
    if (Array.isArray(json.content)) {
      const parts: string[] = [];
      for (const block of json.content) {
        if (!isRecord(block)) continue;
        if (block.type === 'text' && typeof block.text === 'string') {
          parts.push(block.text);
        }
      }
      if (parts.length > 0) return parts.join('');
    }

    return '';
  } catch {
    return '';
  }
}

function parseSSEDeltas(raw: string): string[] {
  const deltas: string[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data: ')) continue;
    const payload = trimmed.slice(6).trim();
    if (payload === '[DONE]' || payload === '') continue;
    try {
      const json = JSON.parse(payload);
      if (json.choices && Array.isArray(json.choices)) {
        for (const choice of json.choices) {
          const content = choice?.delta?.content;
          if (typeof content === 'string') deltas.push(content);
        }
        continue;
      }
      if (json.type === 'content_block_delta') {
        const text = json.delta?.text;
        if (typeof text === 'string') deltas.push(text);
        continue;
      }
    } catch { /* skip */ }
  }
  return deltas;
}
