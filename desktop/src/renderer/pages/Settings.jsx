import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Save, Server, Monitor, Bell, Palette, Shield } from 'lucide-react'
import useAppStore from '../store/appStore'
import toast from 'react-hot-toast'

function Section({ icon: Icon, title, children }) {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: 'rgba(99,102,241,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={15} style={{ color: '#818cf8' }} />
        </div>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{title}</span>
      </div>
      {children}
    </div>
  )
}

function SettingRow({ label, description, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{label}</div>
        {description && <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>{description}</div>}
      </div>
      {children}
    </div>
  )
}

function Toggle({ value, onChange }) {
  return (
    <button
      onClick={() => onChange(!value)}
      style={{
        width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer',
        background: value ? '#6366f1' : 'rgba(255,255,255,0.1)',
        position: 'relative', transition: 'background 0.2s', flexShrink: 0,
      }}
    >
      <span style={{
        position: 'absolute', top: 3, left: value ? 21 : 3,
        width: 16, height: 16, borderRadius: '50%', background: 'white',
        transition: 'left 0.2s', display: 'block',
        boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
      }} />
    </button>
  )
}

export default function Settings() {
  const navigate = useNavigate()
  const { settings, updateSettings } = useAppStore()
  const [serverUrl, setServerUrl] = useState(settings.serverUrl)

  const handleSave = () => {
    updateSettings({ serverUrl })
    toast.success('Settings saved')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0d0d14' }}>
      <div style={{ height: 32, background: 'rgba(0,0,0,0.3)', borderBottom: '1px solid rgba(255,255,255,0.05)',
        WebkitAppRegion: 'drag', display: 'flex', alignItems: 'center', padding: '0 12px', flexShrink: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>RemoteLink Settings</span>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Minimal sidebar for settings page */}
        <div style={{ width: 200, background: 'rgba(0,0,0,0.2)', borderRight: '1px solid rgba(255,255,255,0.05)', padding: 12 }}>
          <div className="nav-item" onClick={() => navigate('/')} style={{ cursor: 'pointer' }}>
            <ChevronLeft size={14} />
            <span style={{ fontSize: 13 }}>Back</span>
          </div>
        </div>

        <div className="content animate-fade-in">
          <div style={{ maxWidth: 560 }}>
            <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 24 }}>Settings</h1>

            <Section icon={Server} title="Connection">
              <SettingRow label="Server URL" description="RemoteLink backend server address">
                <input
                  className="input"
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  placeholder="http://localhost:3001"
                  style={{ width: 240, fontSize: 12 }}
                />
              </SettingRow>
            </Section>

            <Section icon={Monitor} title="Display & Performance">
              <SettingRow label="Default Stream Quality" description="Quality preset when session starts">
                <select
                  value={settings.quality}
                  onChange={(e) => updateSettings({ quality: e.target.value })}
                  style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 8, color: 'white', fontSize: 12, padding: '6px 10px', outline: 'none' }}
                >
                  <option value="auto">Auto</option>
                  <option value="high">High (4 Mbps)</option>
                  <option value="medium">Medium (1.5 Mbps)</option>
                  <option value="low">Low (500 Kbps)</option>
                </select>
              </SettingRow>
            </Section>

            <Section icon={Bell} title="Notifications">
              <SettingRow label="Enable Notifications" description="Show system notifications for incoming sessions">
                <Toggle value={settings.notifications} onChange={(v) => updateSettings({ notifications: v })} />
              </SettingRow>
              <SettingRow label="Sound Alerts" description="Play a sound when viewer joins">
                <Toggle value={settings.soundEnabled} onChange={(v) => updateSettings({ soundEnabled: v })} />
              </SettingRow>
              <SettingRow label="Start Minimized" description="Launch RemoteLink to system tray">
                <Toggle value={settings.startMinimized} onChange={(v) => updateSettings({ startMinimized: v })} />
              </SettingRow>
            </Section>

            <Section icon={Shield} title="Privacy & Security">
              <SettingRow label="Clipboard Sync" description="Allow clipboard sharing between devices">
                <Toggle value={settings.clipboardSync} onChange={(v) => updateSettings({ clipboardSync: v })} />
              </SettingRow>
            </Section>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
              <button className="btn btn-ghost" style={{ padding: '9px 18px' }} onClick={() => navigate('/')}>Cancel</button>
              <button className="btn btn-primary" style={{ padding: '9px 18px' }} onClick={handleSave}>
                <Save size={14} /> Save Settings
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
