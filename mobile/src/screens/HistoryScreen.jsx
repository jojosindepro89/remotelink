import React from 'react'
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import useMobileStore from '../hooks/useSession'
import { colors, spacing, radius } from '../theme/colors'

export default function HistoryScreen() {
  const { sessionHistory } = useMobileStore()

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.header}>
        <Text style={styles.title}>⏱ Session History</Text>
        <Text style={styles.subtitle}>{sessionHistory.length} sessions</Text>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: spacing.md }}>
        {sessionHistory.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>📋</Text>
            <Text style={styles.emptyText}>No sessions yet</Text>
            <Text style={styles.emptySubtext}>Sessions will appear here after you start or join one</Text>
          </View>
        ) : (
          sessionHistory.map((s) => (
            <View key={s.sessionId} style={styles.item}>
              <View style={[styles.icon, {
                backgroundColor: s.role === 'host' ? 'rgba(99,102,241,0.12)' : 'rgba(16,185,129,0.1)'
              }]}>
                <Text style={{ fontSize: 18 }}>{s.role === 'host' ? '🖥' : '👁'}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={styles.code}>{s.sessionCode}</Text>
                  <View style={[styles.badge, {
                    backgroundColor: s.role === 'host' ? 'rgba(99,102,241,0.1)' : 'rgba(16,185,129,0.1)'
                  }]}>
                    <Text style={[styles.badgeText, { color: s.role === 'host' ? '#818cf8' : '#34d399' }]}>
                      {s.role === 'host' ? 'Host' : 'Viewer'}
                    </Text>
                  </View>
                </View>
                <Text style={styles.meta}>{new Date(s.startedAt).toLocaleString()}</Text>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  header: { padding: spacing.md, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)' },
  title: { fontSize: 20, fontWeight: '800', color: colors.textPrimary },
  subtitle: { fontSize: 13, color: colors.textMuted, marginTop: 3 },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyIcon: { fontSize: 44, marginBottom: 14 },
  emptyText: { fontSize: 16, fontWeight: '600', color: colors.textSecondary, marginBottom: 6 },
  emptySubtext: { fontSize: 13, color: colors.textMuted, textAlign: 'center', lineHeight: 19 },
  item: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder,
    borderRadius: radius.lg, padding: 14, marginBottom: 8,
  },
  icon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  code: { fontFamily: 'Courier', fontSize: 15, fontWeight: '700', color: colors.textPrimary, letterSpacing: 2 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.full },
  badgeText: { fontSize: 11, fontWeight: '600' },
  meta: { fontSize: 12, color: colors.textMuted, marginTop: 3 },
})
