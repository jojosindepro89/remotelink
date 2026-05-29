import React from 'react'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { View, Text, ScrollView } from 'react-native'
import AppNavigator from './src/navigation/AppNavigator'

class ErrorBoundary extends React.Component {
  state = { error: null, info: null }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error, info) {
    this.setState({ info })
    console.error('[RemoteLink] App crashed:', error, info)
  }
  render() {
    if (this.state.error) {
      return (
        <View style={{ flex: 1, backgroundColor: '#0d0d14', padding: 24, paddingTop: 60 }}>
          <Text style={{ color: '#f87171', fontSize: 22, fontWeight: '700', marginBottom: 12 }}>RemoteLink crashed</Text>
          <Text style={{ color: '#cbd5e1', fontSize: 13, marginBottom: 18 }}>Show this screen to the developer:</Text>
          <ScrollView style={{ backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: 12, maxHeight: 400 }}>
            <Text style={{ color: '#fef08a', fontFamily: 'monospace', fontSize: 11 }}>
              {String(this.state.error?.stack || this.state.error?.message || this.state.error)}
            </Text>
            <Text style={{ color: '#94a3b8', fontFamily: 'monospace', fontSize: 10, marginTop: 12 }}>
              {String(this.state.info?.componentStack || '')}
            </Text>
          </ScrollView>
        </View>
      )
    }
    return this.props.children
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <AppNavigator />
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  )
}
