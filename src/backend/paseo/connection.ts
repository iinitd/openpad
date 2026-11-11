import { Platform } from "react-native";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { WriterBackend } from "../types";
import { PaseoBackend } from "./adapter";
import {
  parseConnectionOfferFromUrl,
  type ConnectionOffer,
} from "@getpaseo/protocol/connection-offer";
import {
  buildRelayWebSocketUrl,
  shouldUseTlsForDefaultHostedRelay,
} from "@getpaseo/protocol/daemon-endpoints";

const CONNECT_TIMEOUT_MS = 10_000;

// The daemon gates which providers a client may see behind a minimum app
// version: older/unknown clients only get the legacy {claude, codex, opencode}
// set, while newer clients get every installed provider (trae, cursor, etc.).
// We announce a version at/above that threshold so the full, availability-aware
// provider list is returned.
const PUFF_APP_VERSION = "0.1.999";

function directConnectionError(error: unknown, url: string, password?: string): Error {
  const message = error instanceof Error ? error.message : String(error || "Connection failed");
  if (Platform.OS !== "web" || typeof window === "undefined") {
    return error instanceof Error ? error : new Error(message);
  }

  let endpoint: URL | null = null;
  try {
    endpoint = new URL(url);
  } catch {
    // Keep the client's original URL validation error below.
  }
  const loopbackHosts = ["localhost", "127.0.0.1", "::1"];
  const remotePage = !loopbackHosts.includes(window.location.hostname);
  const loopbackEndpoint = endpoint ? loopbackHosts.includes(endpoint.hostname) : false;
  if (remotePage && loopbackEndpoint) {
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const hostname = window.location.hostname.includes(":")
      ? `[${window.location.hostname}]`
      : window.location.hostname;
    return new Error(
      `This page cannot use ${url}: localhost refers to the browser's machine. ` +
        `Use ${protocol}://${hostname}:6767/ws instead.`,
    );
  }

  if (/code 1006|transport closed|failed to fetch|network/i.test(message)) {
    const passwordHint = password?.trim() ? "Check the password" : "Enter the daemon password";
    return new Error(
      `Could not connect to ${url}. ${passwordHint}, make sure the daemon allows ` +
        `${window.location.origin}, and verify that the endpoint is reachable. (${message})`,
    );
  }
  return error instanceof Error ? error : new Error(message);
}

export function createPuffClient(url: string, password?: string): WriterBackend {
  const clientType = Platform.OS === "web" ? ("browser" as const) : ("mobile" as const);

  return new PaseoBackend(new DaemonClient({
    url,
    clientId: `puff-${crypto.randomUUID()}`,
    clientType,
    appVersion: PUFF_APP_VERSION,
    password: password && password.length > 0 ? password : undefined,
    reconnect: { enabled: false },
    suppressSendErrors: true,
  }));
}

function createRelayClient(offer: ConnectionOffer): WriterBackend {
  const clientType = Platform.OS === "web" ? ("browser" as const) : ("mobile" as const);
  const useTls = offer.relay.useTls ?? shouldUseTlsForDefaultHostedRelay(offer.relay.endpoint);

  const url = buildRelayWebSocketUrl({
    endpoint: offer.relay.endpoint,
    useTls,
    serverId: offer.serverId,
    role: "client",
  });

  return new PaseoBackend(new DaemonClient({
    url,
    clientId: `puff-${crypto.randomUUID()}`,
    clientType,
    appVersion: PUFF_APP_VERSION,
    reconnect: { enabled: false },
    suppressSendErrors: true,
    e2ee: { enabled: true, daemonPublicKeyB64: offer.daemonPublicKeyB64 },
  }));
}

/**
 * Connect to a daemon with a timeout. Creates a client with reconnect
 * disabled so that connection failures reject rather than silently retry
 * forever.
 */
export async function connectWithTimeout(
  url: string,
  password?: string,
  timeoutMs: number = CONNECT_TIMEOUT_MS,
): Promise<WriterBackend> {
  const client = createPuffClient(url, password);

  return new Promise<WriterBackend>((resolve, reject) => {
    const timer = setTimeout(() => {
      void client.close().catch(() => {});
      reject(new Error(`Connection timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    client
      .connect()
      .then(() => {
        clearTimeout(timer);
        client.setReconnectEnabled(true);
        resolve(client);
      })
      .catch((error) => {
        clearTimeout(timer);
        void client.close().catch(() => {});
        reject(directConnectionError(error, url, password));
      });
  });
}

/**
 * Connect via relay using a pairing link URL (contains #offer= fragment).
 * Relay connections use E2E encryption and go through a public relay server,
 * which avoids Origin/CORS issues in browser environments.
 */
export async function connectViaRelay(
  offerUrl: string,
  timeoutMs: number = CONNECT_TIMEOUT_MS,
): Promise<WriterBackend> {
  const offer = parseConnectionOfferFromUrl(offerUrl);
  if (!offer) {
    throw new Error("Invalid pairing link: missing or malformed #offer= fragment");
  }

  const client = createRelayClient(offer);

  return new Promise<WriterBackend>((resolve, reject) => {
    const timer = setTimeout(() => {
      void client.close().catch(() => {});
      reject(new Error(`Relay connection timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    client
      .connect()
      .then(() => {
        clearTimeout(timer);
        client.setReconnectEnabled(true);
        resolve(client);
      })
      .catch((error) => {
        clearTimeout(timer);
        void client.close().catch(() => {});
        reject(error);
      });
  });
}
