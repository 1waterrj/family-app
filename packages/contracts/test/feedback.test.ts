import { describe, expect, it } from 'vitest';
import {
  ClientDiagnosticSnapshotSchema,
  CreateFeedbackCommandSchema,
  FeedbackDiagnosticEventSchema,
  FeedbackPublicPreviewSchema,
  FeedbackReportSchema,
  UpdateFeedbackCommandSchema,
  DIAGNOSTIC_WINDOW_MS,
  MAX_DIAGNOSTIC_BYTES,
  MAX_DIAGNOSTIC_EVENTS,
} from '../src/index.js';

const event = {
  kind: 'API_RESULT',
  at: '2026-08-10T12:00:00.000Z',
  operation: 'GET_PARENT_SNAPSHOT',
  outcome: 'ERROR',
  status: 503,
  errorCode: 'INTERNAL_ERROR',
  durationBucket: 'UNDER_1_SECOND',
  requestId: '10000000-0000-4000-8000-000000000001',
} as const;

const snapshot = {
  source: 'PARENT_IOS',
  appVersion: '1.2.3',
  currentScreen: 'PARENT_HOME',
  events: [event],
} as const;

describe('feedback contracts', () => {
  it('parses a valid diagnostic event, snapshot, and private report', () => {
    expect(FeedbackDiagnosticEventSchema.parse(event)).toEqual(event);
    expect(ClientDiagnosticSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(
      FeedbackReportSchema.parse({
        id: '20000000-0000-4000-8000-000000000001',
        category: 'BROKEN',
        source: snapshot.source,
        appVersion: snapshot.appVersion,
        screen: snapshot.currentScreen,
        status: 'NEW',
        title: 'Sync problem',
        description: 'The page did not refresh.',
        diagnosticSnapshot: snapshot,
        privacyFindings: [
          { field: 'DESCRIPTION', kind: 'HOSTNAME', start: 0, end: 4 },
        ],
        publicIssueUrl: null,
        createdAt: '2026-08-10T12:00:00.000Z',
        updatedAt: '2026-08-10T12:00:00.000Z',
        reviewedAt: null,
        exportedAt: null,
        closedAt: null,
      }),
    ).toMatchObject({ id: '20000000-0000-4000-8000-000000000001' });
  });

  it('rejects unallowlisted diagnostic metadata and values', () => {
    expect(() =>
      FeedbackDiagnosticEventSchema.parse({
        ...event,
        authorization: 'Bearer must-never-parse',
      }),
    ).toThrow();
    expect(() =>
      FeedbackDiagnosticEventSchema.parse({
        ...event,
        operation: 'GET_/private',
      }),
    ).toThrow();
    expect(() =>
      ClientDiagnosticSnapshotSchema.parse({
        ...snapshot,
        currentScreen: 'CALENDAR',
      }),
    ).toThrow();
    expect(() =>
      FeedbackDiagnosticEventSchema.parse({ ...event, requestBody: 'secret' }),
    ).toThrow();
  });

  it('enforces diagnostic count and byte limits', () => {
    expect(() =>
      ClientDiagnosticSnapshotSchema.parse({
        ...snapshot,
        events: Array.from({ length: MAX_DIAGNOSTIC_EVENTS + 1 }, () => event),
      }),
    ).toThrow();
    const largeEvent = {
      ...event,
      operation: 'CREATE_FEEDBACK_PUBLIC_PREVIEW' as const,
      errorCode: 'UNSUPPORTED_MEDIA_TYPE' as const,
      durationBucket: 'FIVE_SECONDS_OR_MORE' as const,
    };
    const events = Array.from(
      { length: MAX_DIAGNOSTIC_EVENTS },
      () => largeEvent,
    );
    expect(
      new TextEncoder().encode(JSON.stringify(events)).byteLength,
    ).toBeGreaterThan(MAX_DIAGNOSTIC_BYTES);
    expect(() =>
      CreateFeedbackCommandSchema.parse({
        idempotencyKey: '30000000-0000-4000-8000-000000000001',
        category: 'BROKEN',
        description: '',
        diagnosticSnapshot: { ...snapshot, events },
      }),
    ).toThrow();
  });

  it('limits every diagnostic snapshot to one fifteen-minute incident window', () => {
    // Break caught: individually valid events can expose an unbounded slice of household activity.
    const firstAt = '2026-08-10T12:00:00.000Z';
    const boundaryAt = new Date(
      Date.parse(firstAt) + DIAGNOSTIC_WINDOW_MS,
    ).toISOString();
    const outsideAt = new Date(
      Date.parse(firstAt) + DIAGNOSTIC_WINDOW_MS + 1,
    ).toISOString();
    const fractionalOutsideAt = '2026-08-10T12:15:00.000000001Z';

    expect(
      ClientDiagnosticSnapshotSchema.safeParse({
        ...snapshot,
        events: [
          { kind: 'NETWORK', at: boundaryAt, state: 'ONLINE' },
          { kind: 'NETWORK', at: firstAt, state: 'OFFLINE' },
        ],
      }).success,
    ).toBe(true);
    expect(
      ClientDiagnosticSnapshotSchema.safeParse({
        ...snapshot,
        events: [
          { kind: 'NETWORK', at: outsideAt, state: 'ONLINE' },
          { kind: 'NETWORK', at: firstAt, state: 'OFFLINE' },
        ],
      }).success,
    ).toBe(false);
    expect(
      ClientDiagnosticSnapshotSchema.safeParse({
        ...snapshot,
        events: [
          { kind: 'NETWORK', at: firstAt, state: 'OFFLINE' },
          { kind: 'NETWORK', at: fractionalOutsideAt, state: 'ONLINE' },
        ],
      }).success,
    ).toBe(false);
  });

  it.each([
    ['development', true],
    ['1.2.3', true],
    ['1.2.3-beta.1', true],
    ['1.2.3-01alpha', true],
    ['1.2.3+20260811.42', true],
    ['1.2.3-beta.1+build.42', true],
    ['1.2.3+AKIAIOSFODNN7EXAMPLE', true],
    ['1.2.3+Avery', true],
    ['1.2.3+eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYW1pbHkifQ.c2lnbmF0dXJl', true],
    ['1.2.3-01', false],
    ['1.2.3+build](https://example.test)', false],
    ['1.2.3+build\u0007secret', false],
    [' 1.2.3', false],
    ['1.2.3\n', false],
    ['https://family.example/app/1.2.3', false],
    ['Bearer private-token', false],
    ['github_' + 'pat_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456', false],
    ['the version from the test phone', false],
    ['v'.repeat(160), false],
    ['1.2.3+'.concat('b'.repeat(155)), false],
  ] as const)(
    'admits only safe app-version metadata: %s',
    (appVersion, valid) => {
      // Break caught: free-form version metadata can carry secrets or Markdown into a public preview.
      expect(
        ClientDiagnosticSnapshotSchema.safeParse({ ...snapshot, appVersion })
          .success,
      ).toBe(valid);
    },
  );

  it('requires the exact loaded revision for every feedback update', () => {
    // Break caught: a parent update can overwrite a newer scrub without declaring its base revision.
    const command = {
      idempotencyKey: '30000000-0000-4000-8000-000000000001',
      expectedUpdatedAt: '2026-08-10T12:00:00.000Z',
      title: 'Reviewed title',
    };
    expect(UpdateFeedbackCommandSchema.parse(command)).toEqual(command);
    expect(
      UpdateFeedbackCommandSchema.safeParse({
        idempotencyKey: command.idempotencyKey,
        title: command.title,
      }).success,
    ).toBe(false);
    expect(
      UpdateFeedbackCommandSchema.safeParse({
        ...command,
        expectedUpdatedAt: '2026-08-10T12:00:00.000000001Z',
      }).success,
    ).toBe(false);
    expect(
      UpdateFeedbackCommandSchema.safeParse({
        ...command,
        expectedUpdatedAt: '2026-08-10T08:00:00.000-04:00',
      }).success,
    ).toBe(false);
  });

  it('trims descriptions, accepts empty descriptions, and requires UUID keys', () => {
    const parsed = CreateFeedbackCommandSchema.parse({
      idempotencyKey: '30000000-0000-4000-8000-000000000001',
      category: 'IDEA',
      description: '  Optional context  ',
      diagnosticSnapshot: { ...snapshot, events: [] },
    });
    expect(parsed.description).toBe('Optional context');
    expect(() =>
      CreateFeedbackCommandSchema.parse({
        idempotencyKey: 'not-a-uuid',
        category: 'IDEA',
        description: '',
        diagnosticSnapshot: { ...snapshot, events: [] },
      }),
    ).toThrow();
  });

  it('allows only a public GitHub repository URL and unique redactions', () => {
    const preview = {
      repositoryUrl: 'https://github.com/family-tests/family-app',
      title: 'Feedback preview',
      body: 'Safe public text.',
      labels: ['feedback', 'type:bug'],
      redactions: ['EMAIL', 'LINK'],
    } as const;
    expect(FeedbackPublicPreviewSchema.parse(preview)).toEqual(preview);
    expect(() =>
      FeedbackPublicPreviewSchema.parse({
        ...preview,
        repositoryUrl: 'https://token@github.com/family-tests/family-app?x=1',
      }),
    ).toThrow();
    expect(() =>
      FeedbackPublicPreviewSchema.parse({
        ...preview,
        redactions: ['EMAIL', 'EMAIL'],
      }),
    ).toThrow();
  });
});
