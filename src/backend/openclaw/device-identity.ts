import AsyncStorage from "@react-native-async-storage/async-storage";
import nacl from "tweetnacl";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import { asRecord, asString, asStringArray, isRecord } from "./wire";

export interface OpenClawStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export const defaultOpenClawStorage: OpenClawStorage = AsyncStorage;
const IDENTITY_KEY = "puff:openclaw:device-identity:v1";
const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** No Buffer, btoa or Node crypto: these codecs also run in Hermes. */
export function encodeBase64Url(bytes: Uint8Array): string {
  let result = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]; const b = bytes[i + 1]; const c = bytes[i + 2];
    result += BASE64URL[a >>> 2];
    result += BASE64URL[((a & 3) << 4) | ((b ?? 0) >>> 4)];
    if (i + 1 < bytes.length) result += BASE64URL[((b & 15) << 2) | ((c ?? 0) >>> 6)];
    if (i + 2 < bytes.length) result += BASE64URL[c & 63];
  }
  return result;
}

export function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(value) || value.length % 4 === 1) {
    throw new Error("Invalid OpenClaw device key encoding.");
  }
  const bytes = new Uint8Array(Math.floor(value.length * 6 / 8));
  let bits = 0; let accumulator = 0; let index = 0;
  for (const char of value) {
    accumulator = (accumulator << 6) | BASE64URL.indexOf(char); bits += 6;
    if (bits >= 8) { bits -= 8; bytes[index++] = (accumulator >>> bits) & 255; }
  }
  if (encodeBase64Url(bytes) !== value) throw new Error("Invalid OpenClaw device key encoding.");
  return bytes;
}

export type OpenClawDeviceIdentity = {
  readonly deviceId: string;
  /** Raw 32-byte Ed25519 public key, encoded as unpadded base64url. */
  readonly publicKey: string;
  sign(payload: string): string;
};

function identityFromSeed(seed: Uint8Array): OpenClawDeviceIdentity {
  if (seed.length !== 32) throw new Error("OpenClaw device seed must contain 32 bytes.");
  const keyPair = nacl.sign.keyPair.fromSeed(seed);
  return {
    deviceId: bytesToHex(sha256(keyPair.publicKey)),
    publicKey: encodeBase64Url(keyPair.publicKey),
    sign: (payload) => encodeBase64Url(nacl.sign.detached(utf8ToBytes(payload), keyPair.secretKey)),
  };
}

// Concurrent connections must share the same persisted identity, including its creation.
const identityLoads = new WeakMap<OpenClawStorage, Promise<OpenClawDeviceIdentity>>();

export function loadOpenClawDeviceIdentity(storage: OpenClawStorage = defaultOpenClawStorage): Promise<OpenClawDeviceIdentity> {
  const existing = identityLoads.get(storage);
  if (existing) return existing;
  const loading = (async () => {
    const stored = await storage.getItem(IDENTITY_KEY);
    if (stored !== null) {
      try {
        const record: unknown = JSON.parse(stored);
        if (!isRecord(record) || record.version !== 1 || typeof record.seed !== "string") throw new Error();
        const identity = identityFromSeed(decodeBase64Url(record.seed));
        if (identity.deviceId !== record.deviceId || identity.publicKey !== record.publicKey) throw new Error();
        return identity;
      } catch {
        // Silently replacing a damaged key would abandon the user's approved device.
        throw new Error("Stored OpenClaw device identity is damaged. Restore or clear this app's OpenClaw device storage and pair again.");
      }
    }
    const seed = new Uint8Array(32);
    if (typeof globalThis.crypto?.getRandomValues !== "function") {
      throw new Error("Secure random generation is unavailable for OpenClaw device pairing.");
    }
    globalThis.crypto.getRandomValues(seed);
    const identity = identityFromSeed(seed);
    await storage.setItem(IDENTITY_KEY, JSON.stringify({
      version: 1, seed: encodeBase64Url(seed), deviceId: identity.deviceId, publicKey: identity.publicKey,
    }));
    seed.fill(0);
    return identity;
  })();
  identityLoads.set(storage, loading);
  void loading.catch(() => { if (identityLoads.get(storage) === loading) identityLoads.delete(storage); });
  return loading;
}

export type DeviceAuthPayloadV3Params = {
  deviceId: string; clientId: string; clientMode: string; role: string; scopes: readonly string[];
  signedAtMs: number; token?: string | null; nonce: string; platform?: string | null; deviceFamily?: string | null;
};

/** Matches packages/gateway-client/src/device-auth.ts byte for byte. */
export function buildDeviceAuthPayloadV3(params: DeviceAuthPayloadV3Params): string {
  const normalize = (value?: string | null) => (value ?? "").trim().replace(/[A-Z]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 32));
  return ["v3", params.deviceId, params.clientId, params.clientMode, params.role,
    params.scopes.join(","), String(params.signedAtMs), params.token ?? "", params.nonce,
    normalize(params.platform), normalize(params.deviceFamily)].join("|");
}

/** Keep endpoint credentials out of WebSocket URLs; a root URL stays at root. */
export function normalizeOpenClawUrl(input: string): string {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new Error("Enter a valid OpenClaw ws:// or wss:// gateway URL."); }
  if (url.protocol === "http:") url.protocol = "ws:";
  if (url.protocol === "https:") url.protocol = "wss:";
  if (url.protocol !== "ws:" && url.protocol !== "wss:") throw new Error("OpenClaw gateway URL must use ws:// or wss://.");
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Enter OpenClaw credentials in the token/password fields. Gateway URLs cannot contain credentials, queries, or fragments.");
  }
  return url.toString();
}

export function openClawGatewayScope(input: string): string {
  const url = new URL(normalizeOpenClawUrl(input));
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
  return `${url.protocol}//${url.host}${path}`;
}

export type OpenClawDeviceToken = { token: string; scopes: string[] };

function tokenKey(endpoint: string, deviceId: string, role: string): string {
  const scope = openClawGatewayScope(endpoint);
  return `puff:openclaw:device-token:v1:${bytesToHex(sha256(utf8ToBytes(JSON.stringify([scope, deviceId, role]))))}`;
}

export async function loadOpenClawDeviceToken(storage: OpenClawStorage, endpoint: string, deviceId: string, role: string): Promise<OpenClawDeviceToken | null> {
  const raw = await storage.getItem(tokenKey(endpoint, deviceId, role));
  if (!raw) return null;
  try {
    const record: unknown = JSON.parse(raw);
    const value = asRecord(record);
    const token = asString(value.token)?.trim();
    if (value.version !== 1 || value.endpoint !== openClawGatewayScope(endpoint) ||
        value.deviceId !== deviceId || value.role !== role || !token ||
        !Array.isArray(value.scopes) || value.scopes.some((scope: unknown) => typeof scope !== "string")) return null;
    return { token, scopes: asStringArray(value.scopes) };
  } catch { return null; }
}

export async function storeOpenClawDeviceToken(storage: OpenClawStorage, endpoint: string, deviceId: string, role: string, entry: OpenClawDeviceToken): Promise<void> {
  await storage.setItem(tokenKey(endpoint, deviceId, role), JSON.stringify({
    version: 1, endpoint: openClawGatewayScope(endpoint), deviceId, role,
    token: entry.token, scopes: entry.scopes, updatedAtMs: Date.now(),
  }));
}

export async function clearOpenClawDeviceToken(storage: OpenClawStorage, endpoint: string, deviceId: string, role: string, expectedToken?: string): Promise<void> {
  // A stale connection must not erase a newer token issued to a concurrent one.
  if (expectedToken && (await loadOpenClawDeviceToken(storage, endpoint, deviceId, role))?.token !== expectedToken) return;
  await storage.removeItem(tokenKey(endpoint, deviceId, role));
}
