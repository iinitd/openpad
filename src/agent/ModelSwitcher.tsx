import { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { useSessionStore } from "../stores/session-store";
import { useProvidersStore } from "../stores/providers-store";
import { usePreferencesStore } from "../stores/preferences-store";
import { THEME } from "../styles/theme";
import { useShallow } from "zustand/react/shallow";

export interface ProviderModelSelection {
  provider: string;
  model: string | null;
}

interface ProviderModelPickerModalProps {
  visible: boolean;
  initialProvider: string | null;
  initialModel: string | null;
  allowProviderChange: boolean;
  title: string;
  confirmLabel: string;
  cwd?: string | null;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: (selection: ProviderModelSelection) => void | Promise<void>;
}

// Shared picker with draft state: tapping a provider/model never mutates a
// session by itself. Existing sessions lock the provider; new sessions opt in
// to provider selection and are only created after the explicit confirmation.
export function ProviderModelPickerModal({
  visible,
  initialProvider,
  initialModel,
  allowProviderChange,
  title,
  confirmLabel,
  cwd,
  busy = false,
  error,
  onCancel,
  onConfirm,
}: ProviderModelPickerModalProps) {
  const {
    entries: allEntries,
    loading,
    error: providersError,
    loadProviders,
    getModels,
  } = useProvidersStore(
    useShallow((state) => ({
      entries: state.entries,
      loading: state.loading,
      error: state.error,
      loadProviders: state.loadProviders,
      getModels: state.getModels,
    })),
  );
  const [draftProvider, setDraftProvider] = useState(initialProvider ?? "");
  const [draftModel, setDraftModel] = useState<string | null>(initialModel);

  const readyEntries = useMemo(
    () => allEntries.filter((entry) => entry.available),
    [allEntries],
  );
  const displayedEntries = readyEntries.length > 0 ? readyEntries : allEntries;
  const draftModels = draftProvider ? getModels(draftProvider) : [];
  const draftEntry = allEntries.find((entry) => entry.provider === draftProvider);
  const lockedProviderLabel =
    draftEntry?.label ?? initialProvider ?? draftProvider ?? "Unknown provider";

  useEffect(() => {
    if (!visible) return;
    setDraftProvider(initialProvider ?? "");
    setDraftModel(initialModel);
    void loadProviders({ cwd: cwd ?? undefined });
  }, [cwd, initialModel, initialProvider, loadProviders, visible]);

  // A new-session picker may open before the provider snapshot arrives. Once
  // it does, keep a valid ready provider selected and seed its default model.
  useEffect(() => {
    if (!visible || !allowProviderChange || readyEntries.length === 0) return;
    if (readyEntries.some((entry) => entry.provider === draftProvider)) return;
    const first = readyEntries[0]!;
    setDraftProvider(first.provider);
    setDraftModel(first.models.find((candidate) => candidate.isDefault)?.id ?? null);
  }, [allowProviderChange, draftProvider, readyEntries, visible]);

  function selectProvider(nextProvider: string) {
    if (!allowProviderChange || busy) return;
    const entry = allEntries.find((candidate) => candidate.provider === nextProvider);
    if (!entry?.available) return;
    setDraftProvider(nextProvider);
    setDraftModel(entry.models.find((candidate) => candidate.isDefault)?.id ?? null);
  }

  const canConfirm =
    Boolean(draftProvider) &&
    !loading &&
    !providersError &&
    !busy &&
    (!allowProviderChange || Boolean(draftEntry?.available));

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => !busy && onCancel()}
    >
      <TouchableOpacity
        style={styles.backdrop}
        activeOpacity={1}
        onPress={() => !busy && onCancel()}
      >
        <TouchableOpacity activeOpacity={1} style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.dialogTitle}>{title}</Text>
            <TouchableOpacity
              onPress={onCancel}
              disabled={busy}
              hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
            >
              <Text style={styles.closeButton}>×</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.sectionLabel}>Provider</Text>
          {allowProviderChange ? (
            loading && allEntries.length === 0 ? (
              <ActivityIndicator color={THEME.colors.primary} />
            ) : (
              <View style={styles.chipRow}>
                {displayedEntries.map((entry) => {
                  const active = draftProvider === entry.provider;
                  return (
                    <TouchableOpacity
                      key={entry.provider}
                      style={[
                        styles.chip,
                        active && styles.chipActive,
                        !entry.available && styles.chipUnavailable,
                      ]}
                      disabled={busy || !entry.available}
                      onPress={() => selectProvider(entry.provider)}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>
                        {entry.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )
          ) : (
            <View style={styles.lockedProvider}>
              <Text style={styles.lockedProviderText}>{lockedProviderLabel}</Text>
              <Text style={styles.lockedHint}>Fixed for this session</Text>
            </View>
          )}

          <Text style={styles.sectionLabel}>Model</Text>
          <ScrollView style={styles.modelScroll} keyboardShouldPersistTaps="handled">
            <TouchableOpacity
              style={[styles.modelRow, draftModel === null && styles.modelRowActive]}
              disabled={busy || !draftProvider}
              onPress={() => setDraftModel(null)}
            >
              <Text style={styles.modelLabel}>Provider default</Text>
            </TouchableOpacity>
            {draftModels.map((candidate) => {
              const active = draftModel === candidate.id;
              return (
                <TouchableOpacity
                  key={candidate.id}
                  style={[styles.modelRow, active && styles.modelRowActive]}
                  disabled={busy}
                  onPress={() => setDraftModel(candidate.id)}
                >
                  <Text style={styles.modelLabel}>{candidate.label || candidate.id}</Text>
                  {candidate.description ? (
                    <Text style={styles.modelDesc} numberOfLines={2}>
                      {candidate.description}
                    </Text>
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {error || providersError ? (
            <Text style={styles.error}>{error ?? providersError}</Text>
          ) : null}
          <View style={styles.dialogActions}>
            <TouchableOpacity
              style={styles.cancelButton}
              disabled={busy}
              onPress={onCancel}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.confirmButton, !canConfirm && styles.confirmButtonDisabled]}
              disabled={!canConfirm}
              onPress={() =>
                void onConfirm({ provider: draftProvider, model: draftModel })
              }
            >
              {busy ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.confirmButtonText}>{confirmLabel}</Text>
              )}
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

// Existing sessions may change model in place, but their provider is immutable.
export function ModelSwitcher() {
  const provider = useSessionStore((state) => state.provider);
  const model = useSessionStore((state) => state.model);
  const cwd = useSessionStore((state) => state.cwd);
  const setModel = useSessionStore((state) => state.setModel);
  const entries = useProvidersStore((state) => state.entries);
  const setLastProvider = usePreferencesStore((state) => state.setLastProvider);
  const setLastModel = usePreferencesStore((state) => state.setLastModel);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentEntry = entries.find((entry) => entry.provider === provider);
  const currentModelLabel =
    currentEntry?.models.find((candidate) => candidate.id === model)?.label ??
    model ??
    "default";

  async function applySelection(selection: ProviderModelSelection) {
    setError(null);
    setBusy(true);
    try {
      await setModel(selection.model);
      setLastProvider(provider);
      setLastModel(selection.model);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to switch model");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <TouchableOpacity
        style={styles.trigger}
        onPress={() => {
          setError(null);
          setOpen(true);
        }}
        disabled={!provider}
      >
        <Text style={styles.triggerText} numberOfLines={1}>
          {provider ?? "provider"} · {currentModelLabel}
        </Text>
        <Text style={styles.triggerChevron}>▾</Text>
      </TouchableOpacity>

      <ProviderModelPickerModal
        visible={open}
        initialProvider={provider}
        initialModel={model}
        allowProviderChange={false}
        title="Change model"
        confirmLabel="Apply"
        cwd={cwd}
        busy={busy}
        error={error}
        onCancel={() => !busy && setOpen(false)}
        onConfirm={applySelection}
      />
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: THEME.spacing.xs,
    paddingHorizontal: THEME.spacing.sm,
    paddingVertical: 4,
    borderRadius: THEME.radii.full,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    backgroundColor: THEME.colors.backgroundSecondary,
    maxWidth: 220,
  },
  triggerText: {
    fontSize: 14,
    color: THEME.colors.textSecondary,
    flexShrink: 1,
  },
  triggerChevron: {
    fontSize: 12,
    color: THEME.colors.textMuted,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "center",
    alignItems: "center",
    padding: THEME.spacing.lg,
  },
  sheet: {
    width: "100%",
    maxWidth: 420,
    maxHeight: "80%",
    backgroundColor: THEME.colors.background,
    borderRadius: THEME.radii.lg,
    padding: THEME.spacing.lg,
    gap: THEME.spacing.sm,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: THEME.spacing.xs,
  },
  dialogTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: THEME.colors.text,
  },
  closeButton: {
    fontSize: 26,
    lineHeight: 24,
    color: THEME.colors.textMuted,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: THEME.colors.textSecondary,
    marginTop: THEME.spacing.sm,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: THEME.spacing.sm,
  },
  chip: {
    paddingHorizontal: THEME.spacing.md,
    paddingVertical: THEME.spacing.xs,
    borderRadius: THEME.radii.full,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    backgroundColor: THEME.colors.backgroundSecondary,
  },
  chipActive: {
    backgroundColor: THEME.colors.primary,
    borderColor: THEME.colors.primary,
  },
  chipUnavailable: {
    opacity: 0.45,
  },
  chipText: {
    fontSize: 15,
    color: THEME.colors.text,
  },
  chipTextActive: {
    color: "#fff",
    fontWeight: "600",
  },
  lockedProvider: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 36,
    paddingHorizontal: THEME.spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: THEME.colors.border,
    borderRadius: THEME.radii.md,
    backgroundColor: THEME.colors.backgroundSecondary,
    gap: THEME.spacing.md,
  },
  lockedProviderText: {
    fontSize: 15,
    fontWeight: "500",
    color: THEME.colors.text,
  },
  lockedHint: {
    fontSize: 13,
    color: THEME.colors.textMuted,
  },
  modelScroll: {
    maxHeight: 260,
  },
  modelRow: {
    paddingHorizontal: THEME.spacing.md,
    paddingVertical: THEME.spacing.sm,
    borderRadius: THEME.radii.md,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    marginBottom: THEME.spacing.sm,
  },
  modelRowActive: {
    borderColor: THEME.colors.primary,
    backgroundColor: THEME.colors.backgroundSecondary,
  },
  modelLabel: {
    fontSize: 16,
    fontWeight: "500",
    color: THEME.colors.text,
  },
  modelDesc: {
    fontSize: 14,
    color: THEME.colors.textMuted,
    marginTop: 2,
  },
  dialogActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: THEME.spacing.sm,
    marginTop: THEME.spacing.sm,
  },
  cancelButton: {
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: THEME.spacing.md,
  },
  cancelButtonText: {
    fontSize: 15,
    color: THEME.colors.textSecondary,
  },
  confirmButton: {
    minWidth: 82,
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: THEME.spacing.lg,
    borderRadius: THEME.radii.full,
    backgroundColor: THEME.colors.primary,
  },
  confirmButtonDisabled: {
    opacity: 0.45,
  },
  confirmButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#fff",
  },
  error: {
    fontSize: 15,
    color: THEME.colors.error,
  },
});
