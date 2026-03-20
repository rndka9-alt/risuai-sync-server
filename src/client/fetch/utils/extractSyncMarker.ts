import { SYNC_MARKER_KEY } from '../../../shared/syncMarker';

interface SyncMarkerValue {
  interceptorType: string;
  streaming: boolean;
}

interface ExtractResult {
  cleanBody: string;
  marker: SyncMarkerValue;
}

/**
 * fetch body에서 sync 마커를 추출하고 제거한다.
 * 마커가 없으면 null 반환.
 */
export function extractSyncMarker(body: BodyInit | null | undefined): ExtractResult | null {
  if (body == null) return null;

  let bodyStr: string;
  if (typeof body === 'string') {
    bodyStr = body;
  } else if (body instanceof Uint8Array) {
    bodyStr = new TextDecoder().decode(body);
  } else if (body instanceof ArrayBuffer) {
    bodyStr = new TextDecoder().decode(new Uint8Array(body));
  } else {
    return null;
  }

  if (!bodyStr.includes(SYNC_MARKER_KEY)) return null;

  try {
    const parsed: Record<string, unknown> = JSON.parse(bodyStr);
    const marker = parsed[SYNC_MARKER_KEY];
    if (!marker || typeof marker !== 'object') return null;

    const markerValue = marker as SyncMarkerValue;
    delete parsed[SYNC_MARKER_KEY];

    return {
      cleanBody: JSON.stringify(parsed),
      marker: markerValue,
    };
  } catch {
    return null;
  }
}
