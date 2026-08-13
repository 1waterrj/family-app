import { z } from 'zod';

export const DEFAULT_HOUSEHOLD_PAYOUT_CEILING_CENTS = 100_00;

const GithubRepositorySlugSchema = z
  .string()
  .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)
  .refine((value) => !value.endsWith('.git'));
const canonicalGithubRepositoryUrlPattern =
  /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/;

const EnvironmentSchema = z.object({
  DATABASE_URL: z.url(),
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  API_HOST: z.string().trim().min(1).default('127.0.0.1'),
  API_PORT: z.coerce.number().int().positive().max(65_535).default(3_000),
  DEVELOPMENT_AUTH_SECRET: z.string().min(32).optional(),
  FAMILY_FEEDBACK_GITHUB_REPOSITORY: GithubRepositorySlugSchema.optional(),
  HOUSEHOLD_PAYOUT_CEILING_CENTS: z.coerce
    .number()
    .int()
    .safe()
    .nonnegative()
    .max(DEFAULT_HOUSEHOLD_PAYOUT_CEILING_CENTS)
    .default(DEFAULT_HOUSEHOLD_PAYOUT_CEILING_CENTS),
});

export type Config = {
  databaseUrl: string;
  nodeEnv: 'development' | 'test' | 'production';
  apiHost: string;
  apiPort: number;
  developmentAuthSecret?: string;
  feedbackGithubRepository?: string;
  householdPayoutCeilingCents: number;
};

export function readConfig(
  environment: Record<string, string | undefined>,
): Config {
  const values = EnvironmentSchema.parse(environment);

  return {
    databaseUrl: values.DATABASE_URL,
    nodeEnv: values.NODE_ENV,
    apiHost: values.API_HOST,
    apiPort: values.API_PORT,
    developmentAuthSecret: values.DEVELOPMENT_AUTH_SECRET,
    feedbackGithubRepository: values.FAMILY_FEEDBACK_GITHUB_REPOSITORY
      ? githubRepositoryUrl(values.FAMILY_FEEDBACK_GITHUB_REPOSITORY)
      : undefined,
    householdPayoutCeilingCents: values.HOUSEHOLD_PAYOUT_CEILING_CENTS,
  };
}

function githubRepositoryUrl(slug: string): string {
  const repository = new URL(`/${slug}`, 'https://github.com');
  const pathSegments = repository.pathname.split('/').filter(Boolean);
  if (
    repository.origin !== 'https://github.com' ||
    repository.username !== '' ||
    repository.password !== '' ||
    repository.port !== '' ||
    repository.search !== '' ||
    repository.hash !== '' ||
    pathSegments.length !== 2 ||
    pathSegments.some((segment) => segment.length === 0)
  ) {
    throw new Error(
      'FAMILY_FEEDBACK_GITHUB_REPOSITORY must be an exact owner/repository slug.',
    );
  }
  return parseFeedbackGithubRepositoryUrl(repository.toString());
}

export function parseFeedbackGithubRepositoryUrl(value: string): string {
  const match = canonicalGithubRepositoryUrlPattern.exec(value);
  if (!match || match[2]!.endsWith('.git')) {
    throw new Error(
      'feedbackGithubRepository must be the exact canonical HTTPS github.com owner/repository URL.',
    );
  }
  const canonical = new URL(`/${match[1]}/${match[2]}`, 'https://github.com');
  if (canonical.toString() !== value) {
    throw new Error(
      'feedbackGithubRepository must be the exact canonical HTTPS github.com owner/repository URL.',
    );
  }
  return value;
}
