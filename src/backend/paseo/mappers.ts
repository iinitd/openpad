import type {
  ConnectionState as PaseoConnectionState,
  DaemonEvent,
  FetchAgentTimelinePayload,
  FetchAgentsEntry,
  FetchWorkspacesEntry,
  FileExplorerDirectoryPayload,
  FileReadResult,
} from "@getpaseo/client/internal/daemon-client";
import type {
  AgentModelDefinition as PaseoAgentModelDefinition,
  AgentPermissionRequest,
  AgentTimelineItem,
} from "@getpaseo/protocol/agent-types";
import type {
  AgentSnapshotPayload,
  AgentStreamEventPayload,
  GetProvidersSnapshotResponseMessage,
} from "@getpaseo/protocol/messages";
import type {
  AgentModelDefinition,
  BackendAgent,
  BackendAgentEntry,
  BackendAgentStreamMessage,
  BackendAgentTimeline,
  BackendAgentUpdateMessage,
  BackendDirectory,
  BackendFile,
  BackendPermissionRequest,
  BackendPermissionRequestMessage,
  BackendProvidersSnapshot,
  BackendStreamEvent,
  BackendTimelineItem,
  BackendWorkspaceEntry,
  ConnectionState,
} from "../types";

export function mapConnectionState(state: PaseoConnectionState): ConnectionState {
  switch (state.status) {
    case "connecting":
      return { status: state.status, attempt: state.attempt };
    case "disconnected":
      return { status: state.status, reason: state.reason };
    default:
      return { status: state.status };
  }
}

export function mapAgent(agent: AgentSnapshotPayload): BackendAgent {
  return {
    id: agent.id,
    provider: agent.provider,
    cwd: agent.cwd,
    workspaceId: agent.workspaceId,
    model: agent.model,
    status: agent.status,
    title: agent.title,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
    archivedAt: agent.archivedAt,
  };
}

export function mapAgentEntry(entry: FetchAgentsEntry): BackendAgentEntry {
  return { agent: mapAgent(entry.agent) };
}

export function mapWorkspace(entry: FetchWorkspacesEntry): BackendWorkspaceEntry {
  return {
    id: entry.id,
    title: entry.title ?? null,
    name: entry.name,
    workspaceDirectory: entry.workspaceDirectory ?? entry.projectRootPath,
    projectRootPath: entry.projectRootPath,
    projectCustomName: entry.projectCustomName,
    projectDisplayName: entry.projectDisplayName,
  };
}

export function mapPermissionRequest(request: AgentPermissionRequest): BackendPermissionRequest {
  return {
    id: request.id,
    actions: request.actions?.map((action) => ({
      id: action.id,
      behavior: action.behavior,
    })),
  };
}

export function mapTimelineItem(item: AgentTimelineItem): BackendTimelineItem {
  switch (item.type) {
    case "user_message":
    case "assistant_message":
      return { type: item.type, text: item.text, messageId: item.messageId };
    case "reasoning":
      return { type: item.type, text: item.text };
    case "tool_call": {
      const tool = item as AgentTimelineItem & { detail?: unknown; input?: unknown; command?: unknown };
      const detail =
        typeof tool.detail === "string"
          ? tool.detail
          : typeof tool.command === "string"
            ? tool.command
            : undefined;
      return {
        type: item.type,
        callId: item.callId,
        name: item.name,
        status: item.status,
        ...(detail ? { detail } : {}),
        ...(tool.input !== undefined ? { input: tool.input } : {}),
      };
    }
    case "error":
      return { type: item.type, message: item.message };
    default:
      return { type: "other" };
  }
}

export function mapStreamEvent(event: AgentStreamEventPayload): BackendStreamEvent {
  switch (event.type) {
    case "timeline":
      return { type: event.type, item: mapTimelineItem(event.item) };
    case "permission_requested":
      return { type: event.type, request: mapPermissionRequest(event.request) };
    case "thread_started":
    case "turn_started":
    case "turn_completed":
    case "turn_failed":
    case "turn_canceled":
    case "permission_resolved":
    case "attention_required":
      return { type: event.type };
    default:
      return { type: "other" };
  }
}

export function mapAgentStream(
  message: Extract<DaemonEvent, { type: "agent_stream" }>,
): BackendAgentStreamMessage {
  return {
    agentId: message.agentId,
    event: mapStreamEvent(message.event),
    ...(typeof message.seq === "number" ? { seq: message.seq } : {}),
    ...(typeof message.epoch === "string" ? { epoch: message.epoch } : {}),
  };
}

export function mapAgentUpdate(
  message: Extract<DaemonEvent, { type: "agent_update" }>,
): BackendAgentUpdateMessage | null {
  if (message.payload.kind !== "upsert") return null;
  return { agentId: message.agentId, agent: mapAgent(message.payload.agent) };
}

export function mapPermissionMessage(
  message: Extract<DaemonEvent, { type: "agent_permission_request" }>,
): BackendPermissionRequestMessage {
  return { agentId: message.agentId, request: mapPermissionRequest(message.request) };
}

export function mapAgentTimeline(timeline: FetchAgentTimelinePayload): BackendAgentTimeline {
  return {
    agentId: timeline.agentId,
    agent: timeline.agent ? mapAgent(timeline.agent) : null,
    epoch: timeline.epoch,
    window: {
      minSeq: timeline.window.minSeq,
      maxSeq: timeline.window.maxSeq,
      nextSeq: timeline.window.nextSeq,
    },
    // Keep every entry and its sequence ranges, including unsupported items.
    // Hydration replays live events strictly after window.maxSeq.
    entries: timeline.entries.map((entry) => ({
      item: mapTimelineItem(entry.item),
      timestamp: entry.timestamp,
      seqStart: entry.seqStart,
      seqEnd: entry.seqEnd,
      sourceSeqRanges: entry.sourceSeqRanges.map((range) => ({
        startSeq: range.startSeq,
        endSeq: range.endSeq,
      })),
    })),
  };
}

export function mapDirectory(directory: FileExplorerDirectoryPayload): BackendDirectory {
  return {
    path: directory.path,
    entries: directory.entries.map((entry) => ({
      name: entry.name,
      path: entry.path,
      kind: entry.kind,
      size: entry.size,
      modifiedAt: entry.modifiedAt,
    })),
  };
}

export function mapFile(file: FileReadResult): BackendFile {
  return {
    bytes: file.bytes,
    mime: file.mime,
    size: file.size,
    path: file.path,
    kind: file.kind,
    modifiedAt: file.modifiedAt,
  };
}

function mapModel(model: PaseoAgentModelDefinition): AgentModelDefinition {
  return {
    id: model.id,
    label: model.label,
    provider: model.provider,
    description: model.description,
    isDefault: model.isDefault,
  };
}

export function mapProvidersSnapshot(
  snapshot: GetProvidersSnapshotResponseMessage["payload"],
): BackendProvidersSnapshot {
  return {
    entries: snapshot.entries.map((entry) => ({
      provider: entry.provider,
      label: entry.label,
      status: entry.status,
      enabled: entry.enabled,
      error: entry.error,
      models: (entry.models ?? []).map(mapModel),
      defaultModeId: entry.defaultModeId,
    })),
  };
}
