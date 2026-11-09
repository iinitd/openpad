/**
 * Server-sent events over XMLHttpRequest.
 *
 * React Native's fetch does not expose a readable response body, but its XHR
 * implementation reports progressive `responseText` through `onprogress`.
 * Browsers support the same surface, so one implementation covers both.
 */
export interface SseHandlers {
  onOpen(): void;
  onEvent(data: string): void;
  onError(message: string, status?: number): void;
}

export interface SseHandle {
  close(): void;
}

export function openServerSentEvents(
  url: string,
  headers: Record<string, string>,
  handlers: SseHandlers,
): SseHandle {
  const xhr = new XMLHttpRequest();
  let opened = false;
  let closed = false;
  let consumed = 0;
  let buffer = "";
  let failure: string | null = null;

  const parse = () => {
    let text: string;
    try {
      text = xhr.responseText ?? "";
    } catch {
      return;
    }
    if (text.length <= consumed) return;
    buffer += text.slice(consumed);
    consumed = text.length;
    // Records are separated by a blank line. Tolerate CRLF servers.
    for (;;) {
      const match = /\r?\n\r?\n/.exec(buffer);
      if (!match || match.index === undefined) break;
      const record = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);
      const dataLines: string[] = [];
      for (const line of record.split(/\r?\n/)) {
        if (!line || line.startsWith(":")) continue;
        if (!line.startsWith("data:")) continue;
        dataLines.push(line.slice(5).replace(/^ /, ""));
      }
      if (dataLines.length > 0) {
        try {
          handlers.onEvent(dataLines.join("\n"));
        } catch {
          // A malformed event must not tear down the stream.
        }
      }
    }
  };

  const finish = () => {
    if (closed) return;
    closed = true;
    if (opened) handlers.onError(failure ?? "The OpenCode event stream closed.", xhr.status || undefined);
    else handlers.onError(failure ?? connectionFailure(xhr.status), xhr.status || undefined);
  };

  xhr.onreadystatechange = () => {
    if (closed) return;
    if (xhr.readyState === 2 || xhr.readyState === 3) {
      if (!opened && xhr.status === 200) {
        opened = true;
        handlers.onOpen();
      }
      if (opened) parse();
    }
    if (xhr.readyState === 4) {
      parse();
      finish();
    }
  };
  xhr.onprogress = () => {
    if (closed) return;
    if (!opened && xhr.status === 200) {
      opened = true;
      handlers.onOpen();
    }
    parse();
  };
  xhr.onerror = () => {
    failure = connectionFailure(xhr.status);
  };

  try {
    xhr.open("GET", url, true);
    xhr.setRequestHeader("Accept", "text/event-stream");
    for (const [name, value] of Object.entries(headers)) {
      xhr.setRequestHeader(name, value);
    }
    xhr.send();
  } catch (error) {
    failure = error instanceof Error ? error.message : "Could not open the OpenCode event stream.";
  }

  return {
    close() {
      if (closed) return;
      closed = true;
      try {
        xhr.abort();
      } catch {
        // Ignore abort failures.
      }
    },
  };
}

function connectionFailure(status: number): string {
  if (status === 401) return "OpenCode rejected these credentials. Check the server password and username.";
  if (status === 404) return "This OpenCode server does not expose /api/event. Puff requires the OpenCode v2 server.";
  if (status > 0) return `OpenCode event stream failed (HTTP ${status}).`;
  return "Could not reach the OpenCode event stream. Check the server URL, network, and CORS settings.";
}
