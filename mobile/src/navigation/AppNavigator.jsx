import React from 'react'
import { NavigationContainer, DefaultTheme } from '@react-navigation/native'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { createStackNavigator } from '@react-navigation/stack'
import { Text, View } from 'react-native'
import HomeScreen from '../screens/HomeScreen'
import SessionScreen from '../screens/SessionScreen'
import SettingsScreen from '../screens/SettingsScreen'
import HistoryScreen from '../screens/HistoryScreen'
import { colors } from '../theme/colors'

const Tab = createBottomTabNavigator()
const Stack = createStackNavigator()

const darkTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.brand,
    background: colors.bg,
    card: colors.surface,
    text: colors.textPrimary,
    border: 'rgba(255,255,255,0.07)',
    notification: colors.brand,
  },
}

function TabIcon({ name, focused, color }) {
  const icons = { Home: '⊞', History: '⏱', Settings: '⚙' }
  return (
    <Text style={{ fontSize: 18, color, opacity: focused ? 1 : 0.5 }}>
      {icons[name] || '•'}
    </Text>
  )
}

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: 'rgba(255,255,255,0.07)',
          borderTopWidth: 1,
          height: 60,
          paddingBottom: 8,
        },
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarIcon: ({ focused, color }) => <TabIcon name={route.name} focused={focused} color={color} />,
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} options={{ title: 'Remote' }} />
      <Tab.Screen name="History" component={HistoryScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  )
}

export default function AppNavigator() {
  return (
    <NavigationContainer theme={darkTheme}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Main" component={MainTabs} />
        <Stack.Screen
          name="Session"
          component={SessionScreen}
          options={{ gestureEnabled: false, presentation: 'fullScreenModal' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  )
}
