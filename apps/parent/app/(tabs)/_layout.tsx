import { familyTokens } from '@family/design-tokens';
import { Tabs } from 'expo-router';
import { Text } from 'react-native';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: familyTokens.color.focus,
        tabBarInactiveTintColor: familyTokens.color.mutedInk,
        tabBarStyle: { backgroundColor: familyTokens.color.surface },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => (
            <Text accessibilityElementsHidden style={{ color, fontSize: 22 }}>
              ⌂
            </Text>
          ),
        }}
      />
      <Tabs.Screen
        name="approvals"
        options={{
          title: 'Approvals',
          tabBarIcon: ({ color }) => (
            <Text accessibilityElementsHidden style={{ color, fontSize: 22 }}>
              ✓
            </Text>
          ),
        }}
      />
      <Tabs.Screen
        name="chores"
        options={{
          title: 'Chores',
          tabBarIcon: ({ color }) => (
            <Text accessibilityElementsHidden style={{ color, fontSize: 22 }}>
              □
            </Text>
          ),
        }}
      />
      <Tabs.Screen
        name="rewards"
        options={{
          title: 'Rewards',
          tabBarIcon: ({ color }) => (
            <Text accessibilityElementsHidden style={{ color, fontSize: 22 }}>
              $
            </Text>
          ),
        }}
      />
      <Tabs.Screen
        name="feedback"
        options={{
          title: 'Feedback',
          tabBarIcon: ({ color }) => (
            <Text accessibilityElementsHidden style={{ color, fontSize: 21 }}>
              💬
            </Text>
          ),
        }}
      />
    </Tabs>
  );
}
