import { ParentAppProvider } from '../src/app/app-provider';
import { familyTokens } from '@family/design-tokens';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  return (
    <ParentAppProvider>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: familyTokens.color.canvas },
          headerTintColor: familyTokens.color.ink,
          contentStyle: { backgroundColor: familyTokens.color.canvas },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="setup" options={{ title: 'Connect family' }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="approval/[submissionAttemptId]"
          options={{ title: 'Review chore' }}
        />
        <Stack.Screen
          name="feedback/new"
          options={{ title: 'Send feedback' }}
        />
        <Stack.Screen
          name="feedback/[feedbackId]"
          options={{ title: 'Review feedback' }}
        />
        <Stack.Screen
          name="feedback/export/[feedbackId]"
          options={{ title: 'Public issue preview' }}
        />
      </Stack>
    </ParentAppProvider>
  );
}
