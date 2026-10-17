'use strict';

function abortError(signal) {
  return signal?.reason instanceof Error ? signal.reason : new DOMException('The operation was aborted.', 'AbortError');
}

function blockedManualRedirect(error, options) {
  // Chromium reports a deliberately unfollowed HTTP redirect differently
  // across Electron versions. Expose its Location with net.request instead;
  // the caller still validates every destination before making another request.
  return options.redirect === 'manual' && [error?.message, error?.cause?.message].some(message =>
    message === 'Redirect was cancelled' || /ERR_BLOCKED_BY_CLIENT/.test(String(message || '')));
}

function responseHeaders(values, raw) {
  const headers = new Headers();
  if (Array.isArray(raw) && raw.length) {
    for (let index = 0; index + 1 < raw.length; index += 2) headers.append(raw[index], raw[index + 1]);
  } else {
    for (const [name, value] of Object.entries(values || {})) {
      for (const item of Array.isArray(value) ? value : [value]) headers.append(name, String(item));
    }
  }
  return headers;
}

function withUrl(response, url) {
  Object.defineProperty(response, 'url', { value: String(url), enumerable: true });
  return response;
}

function requestBody(body) {
  if (body == null) return undefined;
  if (typeof body === 'string' || Buffer.isBuffer(body)) return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  // A stream may have been consumed by the first fetch and cannot safely replay.
  throw new TypeError('The Electron redirect fallback requires a replayable request body.');
}

function manualRequest(electron, session, url, options) {
  return new Promise((resolve, reject) => {
    const signal = options.signal;
    if (signal?.aborted) { reject(abortError(signal)); return; }
    let request;
    let incoming;
    let controller;
    let settled = false;
    let streamDone = false;
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    const fail = error => {
      if (streamDone) return;
      streamDone = true;
      cleanup();
      if (!settled) { settled = true; reject(error); }
      else if (controller) { try { controller.error(error); } catch {} }
    };
    const stop = () => { try { request?.abort(); } catch {} };
    const onAbort = () => { fail(abortError(signal)); stop(); };
    try {
      const headers = new Headers(options.headers || {});
      if (options.referrer && !headers.has('referer')) headers.set('referer', options.referrer);
      const body = requestBody(options.body);
      if (options.body instanceof URLSearchParams && !headers.has('content-type')) headers.set('content-type', 'application/x-www-form-urlencoded;charset=UTF-8');
      request = electron.net.request({
        url: String(url), method: options.method || 'GET', session,
        redirect: 'manual', credentials: options.credentials || 'include',
        headers: Object.fromEntries(headers.entries()),
        ...(options.referrerPolicy ? { referrerPolicy: options.referrerPolicy } : {}),
        ...(options.cache ? { cache: options.cache } : {}),
      });
      signal?.addEventListener('abort', onAbort, { once: true });
      // Never follow here: providers must validate every redirect destination.
      request.on('redirect', (status, _method, target, rawHeaders) => {
        if (settled || streamDone) return;
        try {
          const headers = responseHeaders(rawHeaders);
          headers.set('location', target);
          const response = withUrl(new Response(null, { status, headers }), url);
          settled = true; streamDone = true; cleanup();
          resolve(response);
          stop();
        } catch (error) { fail(error); stop(); }
      });
      request.on('error', error => fail(error));
      request.on('abort', () => {
        if (!streamDone) fail(signal?.aborted ? abortError(signal) : new DOMException('Electron request aborted.', 'AbortError'));
      });
      request.on('response', message => {
        if (settled || streamDone) { stop(); return; }
        incoming = message;
        try {
          const status = message.statusCode;
          const headers = responseHeaders(message.headers, message.rawHeaders);
          const noBody = String(options.method || 'GET').toUpperCase() === 'HEAD' || [204, 205, 304].includes(status);
          let stream = null;
          if (!noBody) {
            stream = new ReadableStream({
              start(value) { controller = value; },
              pull() { incoming?.resume?.(); },
              cancel() { streamDone = true; cleanup(); stop(); },
            }, { highWaterMark: 512 * 1024, size: chunk => chunk.byteLength });
          }
          // Electron requires the end listener to be installed before data.
          message.on('end', () => {
            if (streamDone) return;
            streamDone = true; cleanup();
            try { controller?.close(); } catch {}
          });
          message.on('error', error => fail(error));
          message.on('aborted', () => fail(new DOMException('Media response aborted.', 'AbortError')));
          message.on('data', chunk => {
            if (streamDone || !controller) return;
            try {
              controller.enqueue(new Uint8Array(chunk));
              if (controller.desiredSize <= 0) {
                if (typeof incoming.pause === 'function') incoming.pause();
                // Some Electron builds expose only events, without pause/resume.
                // Abort a stalled consumer rather than buffering a whole song.
                else if (controller.desiredSize < -(8 * 1024 * 1024)) {
                  fail(new Error('Media consumer stalled; upstream stream stopped at the memory limit.'));
                  stop();
                }
              }
            } catch (error) { fail(error); stop(); }
          });
          const response = withUrl(new Response(stream, { status, statusText: message.statusMessage || '', headers }), url);
          settled = true;
          resolve(response);
        } catch (error) { fail(error); stop(); }
      });
      if (signal?.aborted) { onAbort(); return; }
      request.end(body);
    } catch (error) { fail(error); stop(); }
  });
}

async function fetchWithSession(electron, session, url, options = {}) {
  if (options.signal?.aborted) throw abortError(options.signal);
  try { return await session.fetch(url, options); }
  catch (error) {
    if (options.signal?.aborted) throw abortError(options.signal);
    if (!blockedManualRedirect(error, options)) throw error;
    return manualRequest(electron, session, url, options);
  }
}

module.exports = { fetchWithSession };
