import React, { useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, Switch,
  TouchableOpacity, TextInput, Alert, Platform
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import useMobileStore from '../hooks/useSession'
import { colors, spacing, radius } from '../theme/colors'

function SettingItem({ label, description, right }) {
  return (
    <View style={styles.settingItem}>
      <View style={{ flex: 1 }}>
        <Text style={styles.settingLabel}>{label}</Text>
        {description && <Text style={styles.settingDesc}>{description}</Text>}
      </View>
      {right}
    </View>
  )
}

function Section({ title, children }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionCard}>{children}</View>
    </View>
  )
}

export default function SettingsScreen() {
  const { settings, updateSettings, clearAuth, user, sessionHistory } = useMobileStore()
  const [serverUrl, setServerUrl] = useState(settings.serverUrl)

  const handleSave = () => {
    updateSettings({ serverUrl })
    Alert.alert('Saved', 'Settings have been updated')
  }

  const handleClearHistory = () => {
    Alert.alert(
      'Clear History',
      'Are you sure you want to clear all session history?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear', style: 'destructive', onPress: () => updateSettings({}) },
      ]
    )
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.header}>
        <Text style={styles.title}>⚙ Settings</Text>
        <Text style={styles.subtitle}>RemoteLink v1.0</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: 40 }}>

        {/* Device Info */}
        {user && (
          <View style={styles.userCard}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{(user.displayName || 'U').charAt(0).toUpperCase()}</Text>
            </View>
            <View>
              <Text style={styles.userName}>{user.displayName || 'Unknown'}</Text>
              <Text style={styles.userMeta}>{user.isGuest ? 'Guest Device' : 'Registered'} · {sessionHistory.length} sessions</Text>
            </View>
          </View>
        )}

        <Section title="🌐 Connection">
          <SettingItem
            label="Server URL"
            description="RemoteLink backend address"
            right={null}
          />
          <TextInput
            style={styles.input}
            value={serverUrl}
            onChangeText={setServerUrl}
            placeholder="http://192.168.1.x:3001"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            keyboardType="url"
          />
          <TouchableOpacity style={styles.btnSave} onPress={handleSave} activeOpacity={0.8}>
            <Text style={styles.btnSaveText}>Save Server URL</Text>
          </TouchableOpacity>
        </Section>

        <Section title="🎥 Performance">
          <SettingItem
            label="Stream Quality"
            description="Video quality preset"
            right={null}
          />
          <View style={styles.qualityBtns}>
            {['auto', 'high', 'medium', 'low'].map(q => (
              <TouchableOpacity
                key={q}
                style={[styles.qualityBtn, settings.quality === q && styles.qualityBtnActive]}
                onPress={() => updateSettings({ quality: q })}
              >
                <Text style={[styles.qualityBtnText, settings.quality === q && { color: 'white' }]}>
                  {q.charAt(0).toUpperCase() + q.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <SettingItem
            label="Keep Screen On"
            description="Prevent screen from sleeping during sessions"
            right={
              <Switch
                value={settings.keepScreenOn}
                onValueChange={(v) => updateSettings({ keepScreenOn: v })}
                trackColor={{ true: colors.brand, false: 'rgba(255,255,255,0.15)' }}
                thumbColor="white"
              />
            }
          />
        </Section>

        <Section title="🔔 Notifications">
          <SettingItem
            label="Push Notifications"
            description="Get notified about incoming sessions"
            right={
              <Switch
                value={settings.notifications}
                onValueChange={(v) => updateSettings({ notifications: v })}
                trackColor={{ true: colors.brand, false: 'rgba(255,255,255,0.15)' }}
                thumbColor="white"
              />
            }
          />
          <SettingItem
            label="Vibration"
            description="Vibrate on incoming connection"
            right={
              <Switch
                value={settings.vibration}
                onValueChange={(v) => updateSettings({ vibration: v })}
                trackColor={{ true: colors.brand, false: 'rgba(255,255,255,0.15)' }}
                thumbColor="white"
              />
            }
          />
        </Section>

        <Section title="🔒 Privacy">
          <SettingItem
            label="Clipboard Sync"
            description="Allow clipboard sharing during sessions"
            right={
              <Switch
                value={settings.clipboardSync}
                onValueChange={(v) => updateSettings({ clipboardSync: v })}
                trackColor={{ true: colors.brand, false: 'rgba(255,255,255,0.15)' }}
                thumbColor="white"
              />
            }
          />
        </Section>

        <TouchableOpacity style={styles.btnDanger} onPress={handleClearHistory} activeOpacity={0.8}>
          <Text style={styles.btnDangerText}>🗑 Clear Session History</Text>
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  header: { padding: spacing.md, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)' },
  title: { fontSize: 20, fontWeight: '800', color: colors.textPrimary },
  subtitle: { fontSize: 13, color: colors.textMuted, marginTop: 3 },

  userCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder,
    borderRadius: radius.xl, padding: 14, marginBottom: 20,
  },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: 'white', fontSize: 18, fontWeight: '800' },
  userName: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  userMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },

  section: { marginBottom: 20 },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  sectionCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder, borderRadius: radius.xl, overflow: 'hidden' },

  settingItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 14, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)',
  },
  settingLabel: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  settingDesc: { fontSize: 11, color: colors.textMuted, marginTop: 2 },

  input: {
    backgroundColor: 'rgba(255,255,255,0.05)', borderTopWidth: 1, borderBottomWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)', padding: 13,
    color: colors.textPrimary, fontSize: 13,
  },

  btnSave: { backgroundColor: colors.brand, margin: 12, borderRadius: radius.lg, padding: 12, alignItems: 'center' },
  btnSaveText: { color: 'white', fontWeight: '700', fontSize: 14 },

  qualityBtns: { flexDirection: 'row', gap: 8, padding: 12 },
  qualityBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  qualityBtnActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  qualityBtnText: { fontSize: 12, fontWeight: '600', color: colors.textMuted },

  btnDanger: {
    backgroundColor: 'rgba(239,68,68,0.1)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.2)',
    borderRadius: radius.xl, padding: 14, alignItems: 'center', marginTop: 8,
  },
  btnDangerText: { color: '#f87171', fontWeight: '700', fontSize: 14 },
})
