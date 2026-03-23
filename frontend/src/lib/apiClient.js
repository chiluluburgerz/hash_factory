const HF_API_KEY_STORAGE_KEY = "hf_user_api_key";
const HF_API_PREFIX = "/hf";

export function getStoredApiKey() {
  try {
    return window.localStorage.getItem(HF_API_KEY_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

export function setStoredApiKey(apiKey) {
  try {
    const normalized = String(apiKey || "").trim().replace(/^bearer\s+/i, "");
    window.localStorage.setItem(HF_API_KEY_STORAGE_KEY, normalized);
  } catch {
    // ignore
  }
}

export function clearStoredApiKey() {
  try {
    window.localStorage.removeItem(HF_API_KEY_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function hfPath(path) {
  const raw = String(path || "").trim();
  if (!raw) return HF_API_PREFIX;
  return raw.startsWith("/") ? `${HF_API_PREFIX}${raw}` : `${HF_API_PREFIX}/${raw}`;
}

function buildHttpError(message, meta = {}) {
  const err = new Error(message);
  err.name = "HttpError";
  err.status = meta.status ?? null;
  err.url = meta.url ?? null;
  err.payload = meta.payload ?? null;
  err.responseText = meta.responseText ?? "";
  err.contentType = meta.contentType ?? "";
  err.contentLength = meta.contentLength ?? null;
  err.method = meta.method ?? "GET";
  err.requestId =
    meta.payload?.request_id ||
    meta.payload?.requestId ||
    meta.payload?.detail?.request_id ||
    meta.payload?.detail?.requestId ||
    null;
  return err;
}

function isPlainObject(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function shouldSerializeJsonBody(method, body) {
  if (body == null) return false;
  if (method === "GET" || method === "HEAD") return false;
  if (typeof body === "string") return false;
  if (body instanceof FormData) return false;
  if (body instanceof URLSearchParams) return false;
  if (body instanceof Blob) return false;
  if (body instanceof ArrayBuffer) return false;
  return isPlainObject(body) || Array.isArray(body);
}

export async function fetchJsonOrThrow(path, opts = {}) {
  const apiKey = getStoredApiKey();
  const url = hfPath(path);
  const method = String(opts.method || "GET").toUpperCase();

  const headers = new Headers(opts.headers || {});
  headers.set("Accept", "application/json");
  headers.set("Cache-Control", "no-store");
  headers.set("Pragma", "no-cache");

  if (apiKey) {
    headers.set("Authorization", `Bearer ${apiKey}`);
  }

  let requestBody = opts.body;

  if (shouldSerializeJsonBody(method, requestBody)) {
    headers.set("Content-Type", "application/json");
    requestBody = JSON.stringify(requestBody);
  }

  const res = await fetch(url, {
    ...opts,
    method,
    headers,
    body: requestBody,
    cache: "no-store",
  });

  const contentType = String(res.headers.get("content-type") || "").toLowerCase();
  const contentLength = res.headers.get("content-length");
  const finalUrl = res.url || url;
  const text = await res.text().catch(() => "");

  let payload = null;
  if (text && contentType.includes("application/json")) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!res.ok) {
    throw buildHttpError(
      payload?.message ||
        payload?.detail?.message ||
        payload?.upstream_detail?.message ||
        payload?.error ||
        `Request failed: ${finalUrl} (${res.status})`,
      {
        status: res.status,
        url: finalUrl,
        payload,
        responseText: text,
        contentType,
        contentLength,
        method,
      }
    );
  }

  if (!text) {
    return null;
  }

  if (!contentType.includes("application/json")) {
    throw buildHttpError(
      `Expected JSON but received ${contentType || "unknown content type"} from ${finalUrl}`,
      {
        status: 502,
        url: finalUrl,
        payload: null,
        responseText: text,
        contentType,
        contentLength,
        method,
      }
    );
  }

  if (payload == null) {
    throw buildHttpError(`Invalid JSON received from ${finalUrl}`, {
      status: 502,
      url: finalUrl,
      payload: null,
      responseText: text,
      contentType,
      contentLength,
      method,
    });
  }

  return payload;
}