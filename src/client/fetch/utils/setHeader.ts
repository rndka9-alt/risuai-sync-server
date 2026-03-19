export function setHeader(headers: HeadersInit, name: string, value: string): void {
  if (headers instanceof Headers) {
    headers.set(name, value);
  } else if (Array.isArray(headers)) {
    headers.push([name, value]);
  } else {
    headers[name] = value;
  }
}
