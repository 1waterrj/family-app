import type AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';

export const MAINTAINER_TOOLS_STORAGE_KEY = 'family-parent-maintainer-tools:v1';

export type MaintainerSettingsStorage = Pick<
  typeof AsyncStorage,
  'getItem' | 'setItem'
>;

export async function loadMaintainerToolsEnabled(
  storage: MaintainerSettingsStorage,
): Promise<boolean> {
  return (await storage.getItem(MAINTAINER_TOOLS_STORAGE_KEY)) === 'true';
}

export async function setMaintainerToolsEnabled(
  storage: MaintainerSettingsStorage,
  enabled: boolean,
): Promise<void> {
  await storage.setItem(MAINTAINER_TOOLS_STORAGE_KEY, String(enabled));
}

export function useMaintainerToolsSetting(storage: MaintainerSettingsStorage) {
  const [enabled, setEnabledState] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    setLoading(true);
    setError(undefined);
    void loadMaintainerToolsEnabled(storage)
      .then((value) => {
        if (active) setEnabledState(value);
      })
      .catch(() => {
        if (active) {
          setEnabledState(false);
          setError('Maintainer settings could not be loaded.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      mounted.current = false;
    };
  }, [storage]);

  const setEnabled = useCallback(
    async (nextEnabled: boolean) => {
      setSaving(true);
      setError(undefined);
      try {
        await setMaintainerToolsEnabled(storage, nextEnabled);
        if (mounted.current) setEnabledState(nextEnabled);
        return true;
      } catch {
        if (mounted.current) {
          setError('Maintainer settings could not be saved.');
        }
        return false;
      } finally {
        if (mounted.current) setSaving(false);
      }
    },
    [storage],
  );

  return { enabled, loading, saving, error, setEnabled };
}
