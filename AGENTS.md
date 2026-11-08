# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing any code.

# Local Working Rules

- Ask before any action that spends money, quota, or other people's time: EAS cloud builds (`eas build`), submissions (`eas submit`), GitHub Actions runs, tagging a release, or force-pushing. Diagnose and prepare, then state the reason and wait for approval. Local commands that only read or run on this machine do not need approval.
- Do not run `expo export`, bundler checks, or any verification pass after routine changes. The user verifies on the device; only run one when they explicitly ask or when a change touches native/bundling configuration that could break the build.
- Routine code changes in this project usually do not need new test files.
- Routine code changes in this project usually do not need test runs.
- If a bug is unclear, keeps regressing, or needs confirmation, it is acceptable to build a minimal local repro or run targeted verification.
- By default, modify the code directly and let the user verify changes manually.

# Iteration Focus

- The current center of gravity is the **OpenCode backend on iOS**. Implement new work against OpenCode and verify it in the iOS development client first; treat the web build as the quick-iteration surface and the other backends as secondary.

# Backend Priorities

- **OpenCode is the primary backend for feature work.** Implement and verify new capabilities against the OpenCode adapter first.
- **Do not change the Paseo or OpenClaw adapters as part of feature work.** They are maintained as-is; leave their behavior, mapping, and transports untouched unless the user explicitly asks for a change there.
- Add new backend capabilities as optional methods or capability-detected features. Do not widen the shared `WriterBackend` contract with required methods that would force edits to Paseo or OpenClaw.
- Shared UI, store, and contract changes are allowed when they are backend-neutral, but they must preserve existing Paseo and OpenClaw behavior. If a feature cannot ship without modifying those adapters, stop and ask the user first.
- Do not chase feature parity across backends. If Paseo or OpenClaw lacks a new capability, document or degrade the UI instead of emulating the missing behavior in their adapters.
- Paseo and OpenClaw bug fixes are out of scope for ordinary feature iterations. Treat them as separate, explicitly requested work.

# Ongoing Discussions

- Internal product discussions, design notes, and research records live in a separate private `research-openpad` project, not in this repository. Read the current discussion state there before continuing a research topic, and record substantive new questions, insights, corrections, and decisions there in the same turn.
- The Agent Communication exploration is research only. Recording or discussing it does not authorize feature work; follow any later explicit user instruction about implementation.
- Cross-backend file exchange notes stay in the same private research project; link substantive developments to the Agent Communication record when they affect context or artifact handoffs.
