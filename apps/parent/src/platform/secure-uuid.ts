import * as Crypto from 'expo-crypto';

export function createParentUuid(): string {
  return Crypto.randomUUID();
}
