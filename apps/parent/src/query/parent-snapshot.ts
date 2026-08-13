import {
  createFamilyApiClient,
  familyQueryKeys,
  type ClientSession,
} from '@family/api-client';
import { queryOptions } from '@tanstack/react-query';

export function parentSnapshotQueryOptions(
  session: ClientSession,
  fetchImpl: typeof globalThis.fetch,
) {
  const client = createFamilyApiClient({
    apiOrigin: session.apiOrigin,
    accessToken: session.accessToken,
    fetch: fetchImpl,
  });

  return queryOptions({
    queryKey: familyQueryKeys.parentSnapshot(session),
    queryFn: () => client.getParentSnapshot(),
  });
}
