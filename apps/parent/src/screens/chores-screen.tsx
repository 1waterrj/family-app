import {
  FamilyApiError,
  createFamilyApiClient,
  createSecureUuid,
  familyQueryKeys,
  parseUnsignedDollars,
  type ClientSession,
} from '@family/api-client';
import {
  CreateChoreTemplateSchema,
  PublishChoreInstanceSchema,
  type ParentSnapshot,
} from '@family/contracts';
import { familyTokens } from '@family/design-tokens';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';

import {
  PublishForm,
  type PublishDraft,
} from '../features/chores/publish-form';
import {
  TemplateForm,
  type TemplateDraft,
} from '../features/chores/template-form';
import { parentSnapshotQueryOptions } from '../query/parent-snapshot';
import { ScreenState, ScreenStateAction } from '../components/screen-state';
import type { OpenFeedbackDraft } from '../features/feedback/contextual-feedback';

type OperationState<T> = {
  draft: T;
  idempotencyKey: string;
};

const emptyTemplateDraft: TemplateDraft = {
  name: '',
  imageKey: 'tidy-toys',
  instructions: '',
  valueInput: '',
  durationMinutesInput: '',
};

const emptyPublishDraft: PublishDraft = {
  instructionsInput: '',
  valueInput: '',
  durationMinutesInput: '',
};

export function ChoresScreen({
  session,
  fetch: fetchImpl,
  onReportProblem,
}: {
  session: ClientSession;
  fetch: typeof globalThis.fetch;
  onReportProblem?: OpenFeedbackDraft;
}) {
  const queryClient = useQueryClient();
  const snapshotQuery = useQuery(
    parentSnapshotQueryOptions(session, fetchImpl),
  );
  const client = useMemo(
    () =>
      createFamilyApiClient({
        apiOrigin: session.apiOrigin,
        accessToken: session.accessToken,
        fetch: fetchImpl,
      }),
    [fetchImpl, session.accessToken, session.apiOrigin],
  );
  const [templateState, setTemplateState] = useState<
    OperationState<TemplateDraft>
  >(() => ({ draft: emptyTemplateDraft, idempotencyKey: createSecureUuid() }));
  const [publishState, setPublishState] = useState<
    OperationState<PublishDraft>
  >(() => ({ draft: emptyPublishDraft, idempotencyKey: createSecureUuid() }));
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>();
  const [templateError, setTemplateError] = useState<string>();
  const [publishError, setPublishError] = useState<string>();
  const [templateErrorReportable, setTemplateErrorReportable] = useState(false);
  const [publishErrorReportable, setPublishErrorReportable] = useState(false);
  const [publishSuccess, setPublishSuccess] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [templateFrozen, setTemplateFrozen] = useState(false);
  const [publishFrozen, setPublishFrozen] = useState(false);
  const generation = useRef(0);

  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );

  if (!snapshotQuery.data && snapshotQuery.isPending) {
    return <ScreenState message="Loading chore library…" />;
  }
  if (!snapshotQuery.data) {
    return (
      <ScreenState
        message="The chore library could not be loaded."
        primaryActionLabel="Try again"
        onPrimaryAction={() => void snapshotQuery.refetch()}
        actionLabel={onReportProblem ? 'Report this problem' : undefined}
        onAction={
          onReportProblem
            ? () =>
                onReportProblem({
                  category: 'BROKEN',
                  screen: 'PARENT_CHORES',
                })
            : undefined
        }
      />
    );
  }

  const snapshot = snapshotQuery.data;
  const changeTemplate = (change: Partial<TemplateDraft>) => {
    if (templateFrozen) return;
    setTemplateState((current) => ({
      ...current,
      draft: { ...current.draft, ...change },
    }));
    setTemplateError(undefined);
    setTemplateErrorReportable(false);
  };
  const changePublish = (change: Partial<PublishDraft>) => {
    if (publishFrozen) return;
    setPublishState((current) => ({
      ...current,
      draft: { ...current.draft, ...change },
    }));
    setPublishError(undefined);
    setPublishErrorReportable(false);
    setPublishSuccess(undefined);
  };

  const createTemplate = async () => {
    if (creating) return;
    let input: ReturnType<typeof CreateChoreTemplateSchema.parse>;
    try {
      const duration = parseDuration(templateState.draft.durationMinutesInput);
      input = CreateChoreTemplateSchema.parse({
        householdId: snapshot.household.id,
        name: requiredText(templateState.draft.name, 'Enter a chore name.'),
        imageKey: templateState.draft.imageKey,
        instructions: requiredText(
          templateState.draft.instructions,
          'Enter chore instructions.',
        ),
        defaultValueCents: parseUnsignedDollars(templateState.draft.valueInput),
        defaultDurationMinutes: duration,
        idempotencyKey: templateState.idempotencyKey,
      });
    } catch (error) {
      setTemplateError(templateValidationMessage(error));
      setTemplateErrorReportable(false);
      return;
    }
    setCreating(true);
    setTemplateFrozen(true);
    setTemplateError(undefined);
    setTemplateErrorReportable(false);
    const operationGeneration = generation.current;
    try {
      const created = await client.createTemplate(input);
      if (generation.current !== operationGeneration) return;
      setSelectedTemplateId(created.id);
      setTemplateState({
        draft: emptyTemplateDraft,
        idempotencyKey: createSecureUuid(),
      });
      setTemplateFrozen(false);
      queryClient.setQueryData<ParentSnapshot>(
        familyQueryKeys.parentSnapshot(session),
        (current) =>
          current
            ? {
                ...current,
                templates: [
                  ...current.templates.filter(
                    (template) => template.id !== created.id,
                  ),
                  created,
                ],
              }
            : current,
      );
      void queryClient
        .invalidateQueries({
          queryKey: familyQueryKeys.parentSnapshot(session),
        })
        .catch(() => undefined);
    } catch (error) {
      if (generation.current === operationGeneration) {
        if (isConfirmedValidationError(error)) setTemplateFrozen(false);
        setTemplateError(operationErrorMessage(error));
        setTemplateErrorReportable(!isConfirmedValidationError(error));
      }
    } finally {
      if (generation.current === operationGeneration) setCreating(false);
    }
  };

  const publishChore = async () => {
    if (publishing) return;
    const selected = snapshot.templates.find(
      (template) => template.id === selectedTemplateId,
    );
    if (!selected) {
      setPublishError('Select a chore template.');
      setPublishErrorReportable(false);
      return;
    }
    let input: ReturnType<typeof PublishChoreInstanceSchema.parse>;
    try {
      input = PublishChoreInstanceSchema.parse({
        householdId: snapshot.household.id,
        choreTemplateId: selected.id,
        instructions: optionalText(publishState.draft.instructionsInput),
        valueCents: optionalMoney(publishState.draft.valueInput),
        durationMinutes: optionalDuration(
          publishState.draft.durationMinutesInput,
        ),
        idempotencyKey: publishState.idempotencyKey,
      });
    } catch (error) {
      setPublishError(publishValidationMessage(error));
      setPublishErrorReportable(false);
      return;
    }
    setPublishing(true);
    setPublishFrozen(true);
    setPublishError(undefined);
    setPublishErrorReportable(false);
    setPublishSuccess(undefined);
    const operationGeneration = generation.current;
    try {
      const published = await client.publishChore(input);
      if (generation.current !== operationGeneration) return;
      setPublishSuccess(`Added ${published.name} to the shared pool.`);
      setPublishState({
        draft: emptyPublishDraft,
        idempotencyKey: createSecureUuid(),
      });
      setPublishFrozen(false);
      queryClient.setQueryData<ParentSnapshot>(
        familyQueryKeys.parentSnapshot(session),
        (current) =>
          current
            ? {
                ...current,
                chores: [
                  ...current.chores.filter(
                    (chore) => chore.id !== published.id,
                  ),
                  published,
                ],
              }
            : current,
      );
      void queryClient
        .invalidateQueries({
          queryKey: familyQueryKeys.parentSnapshot(session),
        })
        .catch(() => undefined);
    } catch (error) {
      if (generation.current === operationGeneration) {
        if (isConfirmedValidationError(error)) setPublishFrozen(false);
        setPublishError(operationErrorMessage(error));
        setPublishErrorReportable(!isConfirmedValidationError(error));
      }
    } finally {
      if (generation.current === operationGeneration) setPublishing(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>PARENT TOOLS</Text>
      <Text style={styles.title}>Chore library</Text>
      <TemplateForm
        draft={templateState.draft}
        disabled={creating || publishing}
        draftFrozen={templateFrozen}
        error={templateError}
        onChange={changeTemplate}
        onStartNewOperation={() => {
          setTemplateState((current) => ({
            ...current,
            idempotencyKey: createSecureUuid(),
          }));
          setTemplateFrozen(false);
          setTemplateError(undefined);
          setTemplateErrorReportable(false);
        }}
        onSubmit={() => void createTemplate()}
      />
      {templateError && templateErrorReportable && onReportProblem ? (
        <ScreenStateAction
          label="Report this problem"
          onPress={() =>
            onReportProblem({ category: 'BROKEN', screen: 'PARENT_CHORES' })
          }
        />
      ) : null}
      <PublishForm
        templates={snapshot.templates.filter((template) => template.isActive)}
        selectedTemplateId={selectedTemplateId}
        draft={publishState.draft}
        disabled={creating || publishing}
        draftFrozen={publishFrozen}
        error={publishError}
        success={publishSuccess}
        onSelect={(templateId) => {
          if (publishFrozen) return;
          setSelectedTemplateId(templateId);
          setPublishError(undefined);
          setPublishErrorReportable(false);
          setPublishSuccess(undefined);
        }}
        onChange={changePublish}
        onStartNewOperation={() => {
          setPublishState((current) => ({
            ...current,
            idempotencyKey: createSecureUuid(),
          }));
          setPublishFrozen(false);
          setPublishError(undefined);
          setPublishErrorReportable(false);
          setPublishSuccess(undefined);
        }}
        onSubmit={() => void publishChore()}
      />
      {publishError && publishErrorReportable && onReportProblem ? (
        <ScreenStateAction
          label="Report this problem"
          onPress={() =>
            onReportProblem({ category: 'BROKEN', screen: 'PARENT_CHORES' })
          }
        />
      ) : null}
    </ScrollView>
  );
}

function requiredText(value: string, message: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new RangeError(message);
  return trimmed;
}

function optionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseDuration(value: string): number {
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new RangeError('Duration must be a whole number from 1 to 1440.');
  }
  const duration = Number(value);
  if (duration > 1440) {
    throw new RangeError('Duration must be a whole number from 1 to 1440.');
  }
  return duration;
}

function optionalDuration(value: string): number | undefined {
  return value.trim() === '' ? undefined : parseDuration(value.trim());
}

function optionalMoney(value: string): number | undefined {
  return value.trim() === '' ? undefined : parseUnsignedDollars(value.trim());
}

function templateValidationMessage(error: unknown): string {
  if (error instanceof RangeError) {
    return error.message.startsWith('Expected dollars')
      ? 'Enter dollars with no more than two decimals.'
      : error.message;
  }
  if (error instanceof Error) return error.message;
  return 'The template could not be created.';
}

function publishValidationMessage(error: unknown): string {
  if (error instanceof RangeError) {
    return error.message.startsWith('Duration')
      ? error.message
      : 'Enter dollars with no more than two decimals.';
  }
  if (error instanceof Error) return error.message;
  return 'The chore could not be published.';
}

function operationErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'The request could not be saved.';
}

function isConfirmedValidationError(error: unknown): boolean {
  return error instanceof FamilyApiError && error.kind === 'VALIDATION';
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: familyTokens.color.canvas },
  content: {
    gap: familyTokens.space.lg,
    padding: familyTokens.space.lg,
  },
  eyebrow: {
    color: familyTokens.color.child.secondary,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  title: { color: familyTokens.color.ink, fontSize: 30, fontWeight: '800' },
});
