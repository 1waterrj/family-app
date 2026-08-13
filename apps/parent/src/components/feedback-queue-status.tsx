import { familyTokens } from '@family/design-tokens';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { useFeedbackRuntime } from '../features/feedback/feedback-runtime';

export function FeedbackQueueStatus() {
  const runtime = useFeedbackRuntime();
  const [retrying, setRetrying] = useState(false);
  const [selectedEntryId, setSelectedEntryId] = useState<string>();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();
  const selectedEntry = runtime.queuedEntries.find(
    ({ id }) => id === selectedEntryId,
  );

  async function retry() {
    setRetrying(true);
    try {
      await runtime.retry();
    } finally {
      setRetrying(false);
    }
  }

  async function deleteSelected() {
    if (!selectedEntry || deleting) return;
    setDeleting(true);
    setDeleteError(undefined);
    try {
      const result = await runtime.removeQueued(selectedEntry.id);
      if (result === 'failed') {
        setDeleteError('Saved feedback could not be deleted. Try again.');
        return;
      }
      setConfirmingDelete(false);
      setSelectedEntryId(undefined);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <View accessibilityLiveRegion="polite" style={styles.queueCard}>
      <Text style={styles.queueTitle}>Saved on this phone</Text>
      {runtime.syncMessage ? (
        <Text
          accessibilityLabel={runtime.syncMessage}
          accessibilityRole="alert"
          style={styles.errorStatus}
        >
          {runtime.syncMessage}
        </Text>
      ) : (
        <Text
          accessibilityLabel={queuedStatus(runtime.queuedCount)}
          style={styles.queueStatus}
        >
          {queuedStatus(runtime.queuedCount)}
        </Text>
      )}
      {runtime.queuedCount > 0 || runtime.syncMessage ? (
        <Pressable
          accessibilityLabel="Try sending now"
          accessibilityRole="button"
          accessibilityState={{ busy: retrying, disabled: retrying }}
          disabled={retrying}
          onPress={() => void retry()}
          style={({ pressed }) => [
            styles.retryButton,
            pressed && styles.pressed,
            retrying && styles.disabled,
          ]}
        >
          <Text style={styles.retryLabel}>
            {retrying ? 'Trying to send…' : 'Try sending now'}
          </Text>
        </Pressable>
      ) : null}
      {runtime.queuedEntries.map((entry) => (
        <Pressable
          key={entry.id}
          accessibilityLabel={`Review saved feedback: ${categoryLabel(entry.command.category)}`}
          accessibilityHint={`Saved ${formatDate(entry.createdAt)}. ${entry.command.diagnosticSnapshot.events.length > 0 ? 'Diagnostics attached.' : 'No diagnostics attached.'}`}
          accessibilityRole="button"
          onPress={() => {
            setConfirmingDelete(false);
            setDeleteError(undefined);
            setSelectedEntryId(entry.id);
          }}
          style={({ pressed }) => [styles.entryCard, pressed && styles.pressed]}
        >
          <Text style={styles.entryTitle}>
            {categoryLabel(entry.command.category)}
          </Text>
          <Text style={styles.entryMeta}>
            Saved {formatDate(entry.createdAt)}
          </Text>
          <Text numberOfLines={2} style={styles.entryPreview}>
            {descriptionPreview(entry.command.description)}
          </Text>
          <Text style={styles.entryMeta}>
            {entry.command.diagnosticSnapshot.events.length > 0
              ? 'Diagnostics attached'
              : 'No diagnostics attached'}
          </Text>
          {entry.deliveryState === 'DELIVERY_ATTEMPTED' ? (
            <Text style={styles.deliveryWarning}>Delivery was attempted.</Text>
          ) : null}
        </Pressable>
      ))}
      <Modal
        animationType="fade"
        onRequestClose={() => {
          if (!deleting) {
            setConfirmingDelete(false);
            setDeleteError(undefined);
            setSelectedEntryId(undefined);
          }
        }}
        transparent
        visible={selectedEntry !== undefined}
      >
        {selectedEntry ? (
          <View style={styles.modalBackdrop}>
            <View
              accessibilityLabel="Saved feedback details"
              accessibilityRole="summary"
              accessibilityViewIsModal
              style={styles.modalCard}
            >
              <Text style={styles.modalTitle}>Saved feedback details</Text>
              <Text style={styles.entryTitle}>
                {categoryLabel(selectedEntry.command.category)}
              </Text>
              <Text style={styles.entryMeta}>
                Saved {formatDate(selectedEntry.createdAt)}
              </Text>
              <Text style={styles.fullDescription}>
                {selectedEntry.command.description ||
                  'No description provided.'}
              </Text>
              <Text style={styles.entryMeta}>
                {diagnosticCountLabel(
                  selectedEntry.command.diagnosticSnapshot.events.length,
                )}
              </Text>
              {selectedEntry.deliveryState === 'DELIVERY_ATTEMPTED' ? (
                <Text style={styles.deliveryWarning}>
                  Delivery was attempted.
                </Text>
              ) : null}
              {confirmingDelete ? (
                <View
                  accessibilityLiveRegion="polite"
                  style={styles.confirmCard}
                >
                  <Text style={styles.confirmTitle}>
                    Delete saved feedback?
                  </Text>
                  <Text style={styles.confirmCopy}>
                    {selectedEntry.deliveryState === 'DELIVERY_ATTEMPTED'
                      ? 'This removes the local copy. The family server may already have accepted it.'
                      : 'This removes the only local copy if it has not already sent.'}
                  </Text>
                  {deleteError ? (
                    <Text
                      accessibilityLabel={deleteError}
                      accessibilityRole="alert"
                      style={styles.deleteError}
                    >
                      {deleteError}
                    </Text>
                  ) : null}
                  <View style={styles.modalActions}>
                    <Pressable
                      accessibilityRole="button"
                      disabled={deleting}
                      onPress={() => {
                        setConfirmingDelete(false);
                        setDeleteError(undefined);
                      }}
                      style={styles.secondaryButton}
                    >
                      <Text style={styles.secondaryLabel}>Keep draft</Text>
                    </Pressable>
                    <Pressable
                      accessibilityLabel="Confirm delete saved feedback"
                      accessibilityRole="button"
                      accessibilityState={{
                        busy: deleting,
                        disabled: deleting,
                      }}
                      disabled={deleting}
                      onPress={() => void deleteSelected()}
                      style={styles.dangerButton}
                    >
                      <Text style={styles.dangerLabel}>
                        {deleting ? 'Deleting…' : 'Delete'}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <View style={styles.modalActions}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setSelectedEntryId(undefined)}
                    style={styles.secondaryButton}
                  >
                    <Text style={styles.secondaryLabel}>Close</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setConfirmingDelete(true)}
                    style={styles.dangerButton}
                  >
                    <Text style={styles.dangerLabel}>Delete this draft</Text>
                  </Pressable>
                </View>
              )}
            </View>
          </View>
        ) : null}
      </Modal>
    </View>
  );
}

function categoryLabel(category: 'BROKEN' | 'CONFUSING' | 'IDEA'): string {
  return {
    BROKEN: 'Something broke',
    CONFUSING: 'This is confusing',
    IDEA: 'I have an idea',
  }[category];
}

function descriptionPreview(description: string): string {
  const normalized = description.replace(/\s+/g, ' ').trim();
  if (!normalized) return 'No description provided.';
  return normalized.length <= 80 ? normalized : `${normalized.slice(0, 77)}…`;
}

function formatDate(timestamp: string): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

function diagnosticCountLabel(count: number): string {
  return `${count} diagnostic ${count === 1 ? 'event' : 'events'}`;
}

function queuedStatus(count: number): string {
  if (count === 0) return 'No feedback is waiting to send.';
  if (count === 1) {
    return '1 feedback report is waiting for your family server.';
  }
  return `${count} feedback reports are waiting for your family server.`;
}

const styles = StyleSheet.create({
  queueCard: {
    gap: familyTokens.space.sm,
    padding: familyTokens.space.lg,
    borderRadius: familyTokens.radius.large,
    backgroundColor: '#F1EEE8',
  },
  queueTitle: {
    color: familyTokens.color.ink,
    fontSize: 16,
    fontWeight: '800',
  },
  queueStatus: {
    color: familyTokens.color.mutedInk,
    fontSize: 15,
    lineHeight: 21,
  },
  errorStatus: {
    color: familyTokens.color.danger,
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 21,
  },
  retryButton: {
    minHeight: familyTokens.touch.phoneMinimum,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: familyTokens.space.sm,
    borderWidth: 2,
    borderColor: familyTokens.color.focus,
    borderRadius: familyTokens.radius.pill,
    backgroundColor: familyTokens.color.surface,
  },
  retryLabel: {
    color: familyTokens.color.focus,
    fontSize: 15,
    fontWeight: '700',
  },
  entryCard: {
    gap: familyTokens.space.xs,
    padding: familyTokens.space.md,
    borderRadius: familyTokens.radius.medium,
    backgroundColor: familyTokens.color.surface,
  },
  entryTitle: {
    color: familyTokens.color.ink,
    fontSize: 16,
    fontWeight: '800',
  },
  entryMeta: { color: familyTokens.color.mutedInk, fontSize: 13 },
  entryPreview: { color: familyTokens.color.ink, fontSize: 14, lineHeight: 20 },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: familyTokens.space.lg,
    backgroundColor: 'rgba(25, 30, 33, 0.48)',
  },
  modalCard: {
    gap: familyTokens.space.md,
    padding: familyTokens.space.lg,
    borderRadius: familyTokens.radius.large,
    backgroundColor: familyTokens.color.surface,
  },
  modalTitle: {
    color: familyTokens.color.ink,
    fontSize: 24,
    fontWeight: '800',
  },
  fullDescription: {
    color: familyTokens.color.ink,
    fontSize: 16,
    lineHeight: 23,
  },
  confirmCard: {
    gap: familyTokens.space.sm,
    padding: familyTokens.space.md,
    borderRadius: familyTokens.radius.small,
    backgroundColor: '#FFF0EC',
  },
  confirmTitle: {
    color: familyTokens.color.danger,
    fontSize: 17,
    fontWeight: '800',
  },
  confirmCopy: { color: familyTokens.color.ink, fontSize: 14, lineHeight: 20 },
  deleteError: { color: familyTokens.color.danger, fontWeight: '700' },
  deliveryWarning: { color: familyTokens.color.warning, fontWeight: '700' },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: familyTokens.space.sm,
  },
  secondaryButton: {
    minHeight: familyTokens.touch.phoneMinimum,
    justifyContent: 'center',
    paddingHorizontal: familyTokens.space.md,
    borderRadius: familyTokens.radius.pill,
    borderWidth: 2,
    borderColor: familyTokens.color.focus,
  },
  secondaryLabel: { color: familyTokens.color.focus, fontWeight: '800' },
  dangerButton: {
    minHeight: familyTokens.touch.phoneMinimum,
    justifyContent: 'center',
    paddingHorizontal: familyTokens.space.md,
    borderRadius: familyTokens.radius.pill,
    backgroundColor: familyTokens.color.danger,
  },
  dangerLabel: { color: familyTokens.color.surface, fontWeight: '800' },
  pressed: { opacity: 0.78 },
  disabled: { opacity: 0.5 },
});
