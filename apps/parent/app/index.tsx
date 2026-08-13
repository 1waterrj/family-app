import { Redirect } from 'expo-router';

import { useSession } from '../src/auth/use-session';
import { ScreenState } from '../src/components/screen-state';

export default function IndexRoute() {
  const { session, loading } = useSession();
  if (loading) return <ScreenState message="Opening your family…" />;
  return session ? (
    <Redirect href="/(tabs)/home" />
  ) : (
    <Redirect href="/setup" />
  );
}
