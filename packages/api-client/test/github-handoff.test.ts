import { describe, expect, it } from 'vitest';

import { buildGithubIssueHandoff } from '../src/github-handoff.js';

const preview = {
  repositoryUrl: 'https://github.com/family-tests/family-app',
  title: 'Feedback preview',
  body: 'Safe public text.',
  labels: ['feedback', 'type:bug'],
  redactions: [],
} as const;

describe('GitHub issue handoff', () => {
  it('builds a browser issue-composer URL from a validated preview', () => {
    const result = buildGithubIssueHandoff(preview);
    expect(result).toMatchObject({ kind: 'URL' });
    if (result.kind !== 'URL') throw new Error('Expected a URL handoff');

    const url = new URL(result.url);
    expect(url.origin).toBe('https://github.com');
    expect(url.pathname).toBe('/family-tests/family-app/issues/new');
    expect(url.searchParams.get('title')).toBe(preview.title);
    expect(url.searchParams.get('body')).toBe(preview.body);
    expect(url.searchParams.get('labels')).toBe('feedback,type:bug');
  });

  it('falls back to a copyable markdown handoff above the URL limit', () => {
    const longPreview = { ...preview, body: 'a'.repeat(300) };

    expect(buildGithubIssueHandoff(longPreview, 200)).toEqual({
      kind: 'CLIPBOARD',
      issueComposerUrl: 'https://github.com/family-tests/family-app/issues/new',
      markdown: `${longPreview.title}\n\n${longPreview.body}`,
    });
  });
});
