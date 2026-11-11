# Connecting Puff to OpenClaw

Choose **OpenClaw** on the Puff connection page. Enter the Gateway WebSocket URL, such as `ws://localhost:18789` for a Gateway on the same machine or the reachable `wss://` URL of a remote Gateway. `localhost` refers to the device running Puff. Use the Gateway root endpoint or the exact proxy path; a Paseo `/ws` address and pairing offer are not OpenClaw connection settings.

Enter the Gateway token if shared-token authentication is configured. Puff persists its Ed25519 device identity and endpoint-bound device credential. If the Gateway asks for pairing, follow the approval command shown in the connection error on the Gateway host and reconnect. Browser connections also need their actual origin allowed by the Gateway. The adapter follows ordinary operator authorization and does not approve its own device.

The Projects sidebar shows known agent roots and session directories. Opening a project restores a conversation directly in the writer; if the directory has no available conversation, Puff loads the configured Agent profile for that directory and creates one automatically. Scoped provider/model choices use that profile and their full provider/model references. Puff does not create or rewrite the configured Agent. The current session determines session-owned file access when several conversations share the same path.

New conversations share the chosen directory. To use an isolated checkout, select an existing worktree directory exposed by the Gateway. Puff does not automatically allocate a new worktree for every chat.

When the Gateway does not advertise `sessions.create`, Puff creates a persistent conversation using `sessions.patch`. This compatibility path supports the configured agent workspace only: `sessions.patch` cannot bind a different directory. Selecting another directory reports the configured root to select. Each conversation still receives its own session key and transcript. Execution inherits the Gateway's agent/default cwd configuration; Puff does not override that configuration through a patch. If the agent roster omits its workspace, Puff can resolve it through `agents.files.list`.

Puff retains endpoint-specific recent sessions, workspace mappings, document positions, and queued input. Switching backend does not send a previous server's session IDs or queued messages to the new server. Hiding a replaced OpenClaw conversation is a local preference; it does not delete the Gateway transcript or worktree.

Multiple backends can remain connected together. Use **Settings → Add connection**, then switch or open a workspace/session from its source connection. Disconnect closes only the selected connection. See [Multiple backend connections](multiple-backends.md).

## Gateway requirements and limits

The adapter negotiates Gateway protocol 3 or 4 and uses `agents.list`, `sessions.list`, `models.list`, `sessions.patch`, `chat.history`, `chat.send`, and `chat.abort`, plus `sessions.create` when advertised. Session-message subscriptions and file methods are used when supported. Missing methods or denied scopes report the affected operation. Protocol negotiation alone does not guarantee that an older Gateway has every required method.

Compatibility checks for v2026.9.2 use key-only `sessions.describe`, agent-scoped `models.list` without `sessionKey`, and creation parameters without the newer `titleSource` field. Method availability comes from the connected Gateway's advertised feature list.

Session file access uses `sessions.files.list/get`; configured workspace browsing uses `agents.workspace.list/get` when there is no matching session. The adapter does not fall back from a session to a different configured directory. Current Gateway session directory lists can truncate at 250 entries without a pagination method; Puff reports that it cannot show a complete listing.

Text and images can arrive inline through WebSocket. Larger or other binary files use `sessions.files.download` and the Gateway's HTTP download grant. A browser needs same-origin hosting or CORS support on that download route. The grant is bound to the live issuing WebSocket; the adapter does not forward the Gateway token or device credential to download URLs. Preview file reads are limited to 24 MiB.

The implementation has local protocol verification and a Web export. Real Gateway authentication, account availability, native device behavior, and deployed reverse-proxy settings still need validation against the selected installation.
