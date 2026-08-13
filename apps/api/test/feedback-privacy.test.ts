import { describe, expect, it } from 'vitest';

import {
  buildPublicFeedbackPreview,
  findPrivacyFindings,
} from '../src/feedback/privacy.js';

const repository = 'https://github.com/family-tests/family-app';

describe('feedback privacy boundary', () => {
  it('returns deterministic non-overlapping UTF-16 spans without matched values', () => {
    // Break caught: scanner offsets count code points, duplicate matches, or leak matched text.
    const findings = findPrivacyFindings(
      '😀 Avery at avery@example.com used 192.168.1.10, 2001:db8::1, raspberrypi.local and 123e4567-e89b-12d3-a456-426614174000.',
      ['Avery', 'Avery'],
    );

    expect(findings).toEqual([
      { kind: 'KNOWN_PRIVATE_TERM', start: 3, end: 8 },
      { kind: 'EMAIL', start: 12, end: 29 },
      { kind: 'IP_ADDRESS', start: 35, end: 47 },
      { kind: 'IP_ADDRESS', start: 49, end: 60 },
      { kind: 'HOSTNAME', start: 62, end: 79 },
      { kind: 'UUID', start: 84, end: 120 },
    ]);
    expect(JSON.stringify(findings)).not.toMatch(/Avery|avery@example/i);
  });

  it('treats every UUID-shaped hex identifier as private', () => {
    // Break caught: nil or non-RFC-version UUID-shaped correlation IDs remain public.
    expect(
      findPrivacyFindings(
        'IDs 00000000-0000-0000-0000-000000000000 and ffffffff-ffff-ffff-ffff-ffffffffffff',
        [],
      ),
    ).toEqual([
      { kind: 'UUID', start: 4, end: 40 },
      { kind: 'UUID', start: 45, end: 81 },
    ]);
  });

  it('maps deceptive normalized matches back to useful original UTF-16 spans', () => {
    // Break caught: invisible controls, comments, entities, and compatibility glyphs split private terms or corrupt UI highlighting.
    const text =
      '😀 Av\u200Be<!--hide-->ry and av&#101;ry&#64;example.com Ａｖｅｒｙ Av\u202Eery';

    expect(findPrivacyFindings(text, ['Avery'])).toEqual([
      { kind: 'KNOWN_PRIVATE_TERM', start: 3, end: 20 },
      { kind: 'EMAIL', start: 25, end: 51 },
      { kind: 'KNOWN_PRIVATE_TERM', start: 52, end: 57 },
      { kind: 'KNOWN_PRIVATE_TERM', start: 58, end: 64 },
    ]);
    for (const finding of findPrivacyFindings(text, ['Avery'])) {
      expect(text.slice(finding.start, finding.end)).not.toBe('');
    }
  });

  it.each([
    [
      'combining sequence',
      '😀 Ave\u0301ry',
      ['Avéry'],
      [{ kind: 'KNOWN_PRIVATE_TERM', start: 3, end: 9 }],
    ],
    [
      'Hangul Jamo sequence',
      'x 가 z',
      ['가'],
      [{ kind: 'KNOWN_PRIVATE_TERM', start: 2, end: 4 }],
    ],
    [
      'compatibility ligature expansion',
      '😀 ﬀamily',
      ['ffamily'],
      [{ kind: 'KNOWN_PRIVATE_TERM', start: 3, end: 9 }],
    ],
  ] as const)(
    'normalizes a whole %s and maps it to the original UTF-16 span',
    (_case, text, knownTerms, expected) => {
      // Break caught: normalizing one code point at a time misses composition across adjacent Unicode code points.
      expect(findPrivacyFindings(text, knownTerms)).toEqual(expected);
    },
  );

  it('redacts sequence-equivalent terms without over-redacting emoji or non-Latin text', () => {
    // Break caught: public reconstruction leaks canonically equivalent family terms or destroys unrelated Unicode text.
    const preview = buildPublicFeedbackPreview({
      report: {
        category: 'BROKEN',
        source: 'DASHBOARD',
        appVersion: '1.2.3',
        diagnosticSnapshot: { events: [] },
      },
      input: {
        publicTitle: 'Ave\u0301ry 가 ﬀamily',
        publicDescription: 'Keep 👨‍👩‍👧 東京 and Café unchanged.',
        includeDiagnostics: false,
      },
      knownTerms: ['Avéry', '가', 'ffamily'],
      repository,
    });

    expect(preview.title).toBe(
      '<family-member> <family-member> <family-member>',
    );
    expect(preview.body).toContain('👨‍👩‍👧 東京 and Café');
    expect(preview.redactions).toEqual(['KNOWN_PRIVATE_TERM']);
  });

  it.each([
    ['named joiner', 'Av&zwj;ery', 10],
    ['named negative thin space', 'Av&NegativeThinSpace;ery', 24],
    ['numeric joiner', 'Av&#x200D;ery', 13],
  ] as const)(
    'decodes a %s entity before matching and preserves its source span',
    (_case, text, end) => {
      // Break caught: a browser collapses a valid invisible entity after the server scanner has declared the text safe.
      expect(findPrivacyFindings(text, ['Avery'])).toEqual([
        { kind: 'KNOWN_PRIVATE_TERM', start: 0, end },
      ]);
    },
  );

  it('leaves no visually equivalent private term after entity interpretation', () => {
    // Break caught: the public Markdown contains named entities that render as an unredacted family term.
    const preview = buildPublicFeedbackPreview({
      report: {
        category: 'BROKEN',
        source: 'DASHBOARD',
        appVersion: '1.2.3',
        diagnosticSnapshot: { events: [] },
      },
      input: {
        publicTitle: 'Entity safety',
        publicDescription:
          'Av&zwj;ery Av&NegativeThinSpace;ery Av&#x200D;ery 👨‍👩‍👧 東京',
        includeDiagnostics: false,
      },
      knownTerms: ['Avery'],
      repository,
    });

    expect(preview.body.match(/<family-member>/gu)).toHaveLength(3);
    expect(interpretInvisibleHtmlEntities(preview.body)).not.toContain('Avery');
    expect(preview.body).toContain('👨‍👩‍👧 東京');
    expect(preview.redactions).toEqual(['KNOWN_PRIVATE_TERM']);
  });

  it('removes complete raw HTML elements conservatively, including malformed and nested blocks', () => {
    // Break caught: stripping only tags publishes content hidden by CSS, collapsed details, or malformed raw HTML.
    const preview = buildPublicFeedbackPreview({
      report: {
        category: 'BROKEN',
        source: 'DASHBOARD',
        appVersion: '1.2.3',
        diagnosticSnapshot: { events: [] },
      },
      input: {
        publicTitle: 'Raw HTML safety',
        publicDescription:
          'Keep **ordinary** 👨‍👩‍👧 東京. <DiV style="display:/**/none"><span>nested arbitrary one</span></dIv> middle <section style="opacity:0">arbitrary two</section> <details><summary>summary label</summary>arbitrary three</details> <ARTICLE aria-hidden="true"><div>arbitrary four</div></ARTICLE> keep-tail <footer data-note="unterminated">arbitrary five',
        includeDiagnostics: false,
      },
      knownTerms: [],
      repository,
    });

    expect(preview.body).toContain('Keep \\*\\*ordinary\\*\\* 👨‍👩‍👧 東京.');
    expect(preview.body).toContain('middle');
    expect(preview.body).toContain('keep-tail');
    expect(preview.body).not.toMatch(
      /arbitrary|summary label|<\/?(?:div|span|section|details|summary|article|footer)/iu,
    );
  });

  it('removes hidden HTML and neutralizes deceptive Markdown before public output', () => {
    // Break caught: a public preview visually hides private text or reconstructs links and credentials after scanning.
    const preview = buildPublicFeedbackPreview({
      report: {
        category: 'BROKEN',
        source: 'DASHBOARD',
        appVersion: '1.2.3',
        diagnosticSnapshot: { events: [] },
      },
      input: {
        publicTitle:
          'Av\u200Bery <!--Avery secret--> <span hidden>arbitrary hidden family detail</span>',
        publicDescription:
          '👨‍👩‍👧 Café 家族 <!--Bearer hidden-secret--> <div style="display:none">arbitrary private surprise</div> host family&#45;hub.local [go](h&#x74;tps://family-hub.local/private) Bearer sec\u200Bret-token https://family\u202E-hub.local/private `<script>unclassified private script</script>`',
        includeDiagnostics: false,
      },
      knownTerms: ['Avery'],
      repository,
    });

    expect(preview.title).toBe('<family-member>');
    expect(preview.body).toContain('👨‍👩‍👧 Café 家族');
    expect(preview.body).not.toMatch(
      /Avery|hidden-secret|arbitrary hidden|arbitrary private|unclassified private|family-hub|secret-token|https?:|<!--|-->|<\/?(?:span|div|script)|\u200B|\u202E/iu,
    );
    expect(preview.body).not.toContain('[go](');
    expect(findPrivacyFindings(preview.title, ['Avery'])).toEqual([]);
    expect(findPrivacyFindings(preview.body, ['Avery'])).toEqual([]);
    expect(preview.redactions).toEqual([
      'KNOWN_PRIVATE_TERM',
      'HOSTNAME',
      'CREDENTIAL',
      'LINK',
    ]);
  });

  it('scrubs the full union of overlapping authorization and API-key credentials', () => {
    // Break caught: the earlier Authorization match wins and leaves the Bearer secret suffix public.
    const publicDescription =
      '😀 Authorization: Bearer secret-token; api_key=abcd1234; password=my-secret';

    expect(findPrivacyFindings(publicDescription, [])).toEqual([
      { kind: 'CREDENTIAL', start: 3, end: 37 },
      { kind: 'CREDENTIAL', start: 39, end: 55 },
      { kind: 'CREDENTIAL', start: 57, end: 75 },
    ]);
    const preview = buildPublicFeedbackPreview({
      report: {
        category: 'BROKEN',
        source: 'PARENT_IOS',
        appVersion: '1.2.3-beta.1+build.42',
        diagnosticSnapshot: { events: [] },
      },
      input: {
        publicTitle: 'Credential overlap',
        publicDescription,
        includeDiagnostics: false,
      },
      knownTerms: [],
      repository,
    });

    expect(preview.body).toBe(
      '## Description\n\n😀 <credential>; <credential>; <credential>\n\n## App metadata\n\n- App version: 1.2.3-beta.1+build.42',
    );
    expect(preview.body).not.toMatch(
      /Authorization|Bearer|secret-token|api_key|abcd1234|password|my-secret/i,
    );
  });

  it('detects single-label LAN hosts and the complete Basic authorization value', () => {
    // Break caught: public scanning leaves local device names or the Base64 credential payload after matching only the Basic scheme.
    const text =
      'Connect to family-server or raspberrypi with Authorization: Basic dXNlcjpwYXNz.';

    const findings = findPrivacyFindings(text, []);

    expect(
      findings.map(({ kind, start, end }) => [kind, text.slice(start, end)]),
    ).toEqual([
      ['HOSTNAME', 'family-server'],
      ['HOSTNAME', 'raspberrypi'],
      ['CREDENTIAL', 'Authorization: Basic dXNlcjpwYXNz'],
    ]);
  });

  it('leaves no single-label LAN host or Basic credential payload in the final preview', () => {
    // Break caught: initial findings are reconstructed into public Markdown with private LAN routing or reusable credentials intact.
    const preview = buildPublicFeedbackPreview({
      report: {
        category: 'BROKEN',
        source: 'DASHBOARD',
        appVersion: '1.2.3',
        diagnosticSnapshot: { events: [] },
      },
      input: {
        publicTitle: 'family-server failed',
        publicDescription:
          'raspberrypi returned Authorization: Basic dXNlcjpwYXNz while the server and family-friendly labels stayed readable.',
        includeDiagnostics: false,
      },
      knownTerms: [],
      repository,
    });

    expect(`${preview.title}\n${preview.body}`).not.toMatch(
      /family-server|raspberrypi|dXNlcjpwYXNz/iu,
    );
    expect(preview.body).toContain('the server');
    expect(preview.body).toContain('family-friendly');
    expect(preview.redactions).toEqual(['HOSTNAME', 'CREDENTIAL']);
  });

  it('detects generic single-label hosts in local connection contexts', () => {
    // Break caught: common home hostnames evade the scanner unless they contain a device-role suffix.
    const text =
      'Connect to ubuntu via router; ssh ubuntu; host=familybox; then try printer:631; nas:/family.';

    expect(
      findPrivacyFindings(text, []).map(({ kind, start, end }) => [
        kind,
        text.slice(start, end),
      ]),
    ).toEqual([
      ['HOSTNAME', 'ubuntu'],
      ['HOSTNAME', 'router'],
      ['HOSTNAME', 'ubuntu'],
      ['HOSTNAME', 'familybox'],
      ['HOSTNAME', 'printer'],
      ['HOSTNAME', 'nas'],
    ]);
  });

  it('does not classify generic device words in ordinary prose as hostnames', () => {
    // Break caught: fail-closed LAN detection turns every mention of an operating system or household device into a false positive.
    expect(
      findPrivacyFindings(
        'Ubuntu documentation explains how a printer, router, and NAS work. Familybox is a product name.',
        [],
      ),
    ).toEqual([]);
  });

  it.each([
    'I cannot connect to my account.',
    'Connecting to the family calendar fails.',
    'Please ping me tomorrow.',
    'We need to dig deeper into this.',
    'The timer showed kitchen:300...',
  ])(
    'preserves benign prose without treating it as a LAN hostname: %s',
    (text) => {
      // Break caught: broad command-shaped regexes publish false hostname findings for ordinary grammar and timer values.
      expect(findPrivacyFindings(text, [])).toEqual([]);
    },
  );

  it('preserves benign connection prose in the final public preview', () => {
    // Break caught: scanner false positives silently replace ordinary user-visible words in the public issue.
    const publicTitle = 'I cannot connect to my account.';
    const publicDescription = [
      'Connecting to the family calendar fails.',
      'Please ping me tomorrow.',
      'We need to dig deeper into this.',
      'The timer showed kitchen:300...',
    ].join(' ');
    const preview = buildPublicFeedbackPreview({
      report: {
        category: 'BROKEN',
        source: 'DASHBOARD',
        appVersion: '1.2.3',
        diagnosticSnapshot: { events: [] },
      },
      input: {
        publicTitle,
        publicDescription,
        includeDiagnostics: false,
      },
      knownTerms: [],
      repository,
    });

    expect(preview.title).toBe(publicTitle);
    expect(preview.body).toContain(publicDescription);
    expect(preview.redactions).toEqual([]);
  });

  it('removes contextual single-label hosts from the final public preview', () => {
    // Break caught: preview reconstruction publishes device identifiers that were supplied without a dotted LAN suffix.
    const preview = buildPublicFeedbackPreview({
      report: {
        category: 'BROKEN',
        source: 'DASHBOARD',
        appVersion: '1.2.3',
        diagnosticSnapshot: { events: [] },
      },
      input: {
        publicTitle: 'ssh ubuntu failed',
        publicDescription:
          'Connect to familybox via router, then try printer:631 or nas:/family.',
        includeDiagnostics: false,
      },
      knownTerms: [],
      repository,
    });

    expect(`${preview.title}\n${preview.body}`).not.toMatch(
      /ubuntu|familybox|router|printer|nas/iu,
    );
    expect(preview.redactions).toEqual(['HOSTNAME']);
  });

  it('uses one outer redaction for nested link findings and keeps adjacent spans separate', () => {
    // Break caught: nested email/hostname/credential spans leak part of a Markdown link, or adjacent findings collapse.
    const nested = buildPublicFeedbackPreview({
      report: {
        category: 'BROKEN',
        source: 'PARENT_ANDROID',
        appVersion: 'development',
        diagnosticSnapshot: { events: [] },
      },
      input: {
        publicTitle: 'Nested overlap',
        publicDescription:
          '[avery@example.com](https://family-hub.local/private?api_key=abcd1234)',
        includeDiagnostics: false,
      },
      knownTerms: ['Avery'],
      repository,
    });

    expect(nested.body).toBe(
      '## Description\n\n<link>\n\n## App metadata\n\n- App version: development',
    );
    expect(nested.body).not.toMatch(
      /avery|example|family-hub|private|api_key|abcd1234/i,
    );
    expect(findPrivacyFindings('Avery!Riley', ['Avery!', 'Riley'])).toEqual([
      { kind: 'KNOWN_PRIVATE_TERM', start: 0, end: 6 },
      { kind: 'KNOWN_PRIVATE_TERM', start: 6, end: 11 },
    ]);
  });

  it('reconstructs a hostile preview from allowlisted fields and deterministic replacements', () => {
    // Break caught: public output reuses private report text or fails to scrub a supported secret class.
    const preview = buildPublicFeedbackPreview({
      report: {
        category: 'BROKEN',
        source: 'PARENT_IOS',
        appVersion: '1.2.3',
        title: 'LOCAL PRIVATE REPORT TITLE',
        description: 'LOCAL PRIVATE REPORT DESCRIPTION',
        householdId: '90000000-0000-4000-8000-000000000001',
        submittedByParentId: '90000000-0000-4000-8000-000000000002',
        diagnosticSnapshot: {
          events: [
            {
              kind: 'API_RESULT',
              at: '2026-08-10T12:00:00.000Z',
              operation: 'GET_PARENT_SNAPSHOT',
              outcome: 'ERROR',
              status: 503,
              errorCode: 'INTERNAL_ERROR',
              durationBucket: 'UNDER_1_SECOND',
              requestId: '10000000-0000-4000-8000-000000000001',
            },
          ],
        },
      },
      input: {
        publicTitle: 'Avery cannot sync',
        publicDescription: `Riley at avery@example.com called 192.168.1.9 and 2001:db8::1 on family-hub.local. Bearer secret-token ${[
          'github',
          '_pat_',
        ].join(
          '',
        )}ABCDEFGHIJKLMNOPQRSTUVWXYZ123456 via [calendar title](http://family-hub.local/private). ID 123e4567-e89b-12d3-a456-426614174000.`,
        includeDiagnostics: true,
      },
      knownTerms: ['Avery', 'Riley', 'Fixture household'],
      repository,
    });

    expect(preview).toMatchObject({
      repositoryUrl: repository,
      title: '<family-member> cannot sync',
      labels: ['feedback', 'app:parent', 'platform:ios', 'type:bug'],
    });
    expect(preview.body).toContain('<family-member>');
    expect(preview.body).toContain('<email>');
    expect(preview.body).toContain('<local-server>');
    expect(preview.body).toContain('<credential>');
    expect(preview.body).toContain('<link>');
    expect(preview.body).toContain('<identifier>');
    expect(preview.body).toContain('<request-1>');
    expect(preview.body).toContain('## App metadata\n\n- App version: 1.2.3');
    expect(preview.body).not.toMatch(
      /Avery|Riley|avery@example|192\.168|2001:db8|family-hub|Bearer|secret-token|github_pat|calendar title|123e4567|10000000|LOCAL PRIVATE|90000000/i,
    );
    expect(preview.redactions).toEqual([
      'KNOWN_PRIVATE_TERM',
      'EMAIL',
      'IP_ADDRESS',
      'HOSTNAME',
      'UUID',
      'CREDENTIAL',
      'LINK',
    ]);
  });

  it('omits the whole diagnostic timeline when any event fails its strict schema', () => {
    // Break caught: a malformed event is partially serialized into a public issue.
    const preview = buildPublicFeedbackPreview({
      report: {
        category: 'IDEA',
        source: 'DASHBOARD',
        appVersion: '2.0.0+42',
        diagnosticSnapshot: {
          events: [
            {
              kind: 'SCREEN',
              at: '2026-08-10T12:00:00.000Z',
              screen: 'DASHBOARD_HOME',
              calendarTitle: 'Private school appointment',
            },
          ],
        },
      },
      input: {
        publicTitle: 'Safer title',
        publicDescription: 'Safer description',
        includeDiagnostics: true,
      },
      knownTerms: [],
      repository,
    });

    expect(preview.title).toBe('Safer title');
    expect(preview.body).toContain('Safer description');
    expect(preview.body).not.toMatch(/diagnostic|calendar|appointment/i);
  });

  it.each([
    [
      'AWS access key',
      '1.2.3+AKIAIOSFODNN7EXAMPLE',
      '1.2.3+<credential>',
      ['CREDENTIAL'],
    ],
    [
      'known family term',
      '1.2.3+Avery',
      '1.2.3+<family-member>',
      ['KNOWN_PRIVATE_TERM'],
    ],
    [
      'JWT-shaped build',
      '1.2.3+eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYW1pbHkifQ.c2lnbmF0dXJl',
      '1.2.3+<credential>',
      ['CREDENTIAL'],
    ],
  ] as const)(
    'sanitizes %s app-version metadata and reports its redaction',
    (_case, appVersion, publicVersion, redactions) => {
      // Break caught: safe-looking SemVer build metadata bypasses the public privacy scanner.
      const preview = buildPublicFeedbackPreview({
        report: {
          category: 'BROKEN',
          source: 'PARENT_IOS',
          appVersion,
          diagnosticSnapshot: { events: [] },
        },
        input: {
          publicTitle: 'Safe title',
          publicDescription: 'Safe description',
          includeDiagnostics: false,
        },
        knownTerms: ['Avery'],
        repository,
      });

      expect(preview.body).toContain(`- App version: ${publicVersion}`);
      expect(preview.body).not.toContain(appVersion);
      expect(preview.redactions).toEqual(redactions);
    },
  );

  it.each([
    '1.2.3\n\n[steal](https://example.test/?token=private-secret)',
    '1.2.3+build](https://example.test)',
    '1.2.3+build\u0007secret',
  ])(
    'rejects Markdown or control-bearing app-version metadata: %j',
    (appVersion) => {
      // Break caught: structurally hostile metadata reaches Markdown before the privacy scanner can make it inert.
      expect(() =>
        buildPublicFeedbackPreview({
          report: {
            category: 'BROKEN',
            source: 'PARENT_IOS',
            appVersion,
            diagnosticSnapshot: { events: [] },
          },
          input: {
            publicTitle: 'Safe title',
            publicDescription: 'Safe description',
            includeDiagnostics: false,
          },
          knownTerms: [],
          repository,
        }),
      ).toThrow();
    },
  );

  it('rejects hostile app-version text instead of interpolating it into Markdown', () => {
    // Break caught: unvalidated stored metadata can create a public Markdown link or credential-like section.
    expect(() =>
      buildPublicFeedbackPreview({
        report: {
          category: 'BROKEN',
          source: 'PARENT_IOS',
          appVersion:
            '1.2.3\n\n[steal](https://example.test/?token=private-secret)',
          diagnosticSnapshot: { events: [] },
        },
        input: {
          publicTitle: 'Safe title',
          publicDescription: 'Safe description',
          includeDiagnostics: false,
        },
        knownTerms: [],
        repository,
      }),
    ).toThrow();
  });
});

function interpretInvisibleHtmlEntities(text: string): string {
  return text
    .replaceAll('&zwj;', '\u200D')
    .replaceAll('&NegativeThinSpace;', '\u200B')
    .replaceAll('&#x200D;', '\u200D')
    .replace(/\p{Default_Ignorable_Code_Point}/gu, '');
}
