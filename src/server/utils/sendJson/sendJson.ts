import http from 'http';

export function sendJson(res: http.ServerResponse, statusCode: number, data: object): void {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}
