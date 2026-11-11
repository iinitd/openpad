# Connecting Puff to an OpenCode server

Choose **OpenCode** on the Puff connection page and enter the URL of an OpenCode **v2** server, usually `http://localhost:4096`. `localhost` refers to the device running Puff; use the reachable LAN address when the server runs elsewhere.

OpenCode is the primary backend for feature development in this project. New capabilities are implemented and verified here first; the Paseo and OpenClaw adapters are maintained as-is and are not changed as part of ordinary feature work.

Run the server with:

```bash
opencode serve --port 4096
```

OpenCode prints a generated server password at startup. Paste it into **Server password**. If the server was started with `OPENCODE_SERVER_PASSWORD`, use that value instead. The basic-auth username defaults to `opencode`; set it explicitly only if `OPENCODE_SERVER_USERNAME` was changed.

For the Puff web app, allow the page's origin explicitly:

```bash
opencode serve --port 4096 --cors http://localhost:8081
```

The browser sends an `Authorization` header for protected servers, which requires CORS support for that origin. Native iOS/Android connections do not need `--cors`.

## Pair links

Puff also accepts a one-time OpenCode **pair link**, either in the dedicated **Pair link** field or pasted into **Server URL**. Generate one on the server host with:

```bash
opencode pair
```

Puff redeems the link once through `/auth/connect/<code>` (asking for JSON), receives the session token, and stores that token as the server password. The link itself is not saved. Pair links are single-use and expire in five minutes; the resulting session token is long-lived (about 30 days). When it expires, generate another pair link.

Pair links work over both HTTP and HTTPS on the local network: the iOS app allows plain HTTP to local hosts and IP addresses, because user-hosted OpenCode servers often run without a TLS certificate. A public hostname still needs HTTPS. Prefer HTTPS anyway — the link carries the one-time code, and a session token travels in the `Authorization` header afterwards. The OpenCode server must also allow the Puff page's origin for the redemption request, same as the normal CORS requirement.

Treat the session token like the server password: it grants API access.

## What maps to what

| Puff | OpenCode v2 |
| --- | --- |
| Connection | One `opencode serve` HTTP endpoint |
| Project / workspace | OpenCode project location (`directory`) |
| Writing conversation | OpenCode session (`ses_…`) |
| Provider in the model picker | OpenCode agent profile (`build`, `plan`, …) |
| Model | `providerID/modelID`, such as `opencode/deepseek-v4.1-flash-free` |
| Transcript | Session messages: user, assistant text/reasoning/tool parts |

Puff lists existing OpenCode sessions and can create new ones in any discovered project directory. The selected OpenCode agent becomes the session's provider; switching models updates the session in place. The OpenCode TUI may auto-title a session after its first turn; Puff refreshes session titles when the server announces a rename.

## Supported operations

- Project discovery, session listing and paging, session creation and archiving.
- Asynchronous prompts (`/prompt`) with live SSE updates, and interruption.
- History hydration, provider/model switching, session status from the active-session map.
- One-shot permission replies. Puff auto-allows a pending request once, matching the other backends' inactive-connection behavior; persistent "always" grants are not used.
- Workspace directory listing and file reads (24 MiB preview limit).

Files are read through the server's location-scoped `/api/fs` routes. They are not bound to one session, so two conversations in the same directory share the same file view.

## Requirements and limits

- **OpenCode v2 is required.** Puff uses the `/api/...` HTTP surface and `/api/event` SSE stream. An OpenCode v1 server (the older `/session`, `/event` API) is rejected at connect time.
- The event stream must be reachable. A server that accepts HTTP but blocks `/api/event` cannot drive the writer in real time.
- Server passwords are stored in Puff's saved connection profile, as with Paseo passwords and OpenClaw tokens.
- Puff archives rather than deletes sessions. Archiving uses `PATCH /api/session/:id` with `archived: true`, so the session disappears from normal lists but is not destroyed.
- Directory listings do not include file sizes or modification times in this API; sizes show as zero in the file tree.
- No file upload or attachment sending is implemented yet.
- Only primary OpenCode agents are offered as providers; subagents are hidden.

## Verification status

The adapter was smoke-tested against OpenCode **v2.2.3** on macOS using the same transports as the app: connect, version discovery, project list, session list, provider/model snapshot, create session, prompt, live text event, history hydration, model switch, archive, directory list and file read. The XMLHttpRequest SSE reader and the connection UI still need verification in the deployed web and native clients, including CORS and credential handling against the user's actual server.
