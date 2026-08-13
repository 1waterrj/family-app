import {
  FeedbackPublicPreviewSchema,
  type FeedbackPublicPreview,
} from '@family/contracts';

export type GithubIssueHandoff =
  | { kind: 'URL'; url: string }
  | {
      kind: 'CLIPBOARD';
      issueComposerUrl: string;
      markdown: string;
    };

export function buildGithubIssueHandoff(
  preview: FeedbackPublicPreview,
  maxUrlLength = 7_000,
): GithubIssueHandoff {
  const validated = FeedbackPublicPreviewSchema.parse(preview);
  const repository = new URL(validated.repositoryUrl);
  const issueComposerUrl = `${repository.origin}${repository.pathname.replace(/\/$/, '')}/issues/new`;
  const markdown = `${validated.title}\n\n${validated.body}`;
  const params = new URLSearchParams({
    title: validated.title,
    body: validated.body,
    labels: validated.labels.join(','),
  });
  const url = `${issueComposerUrl}?${params.toString()}`;

  if (url.length <= maxUrlLength) return { kind: 'URL', url };
  return { kind: 'CLIPBOARD', issueComposerUrl, markdown };
}
