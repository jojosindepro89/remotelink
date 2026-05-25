import { useState, useRef, useEffect } from 'react'
import VideoTile from '../components/VideoTile'
import { useVideoCall } from '../lib/useVideoCall'

const REACTIONS = ['👍', '❤️', '😂', '🎉', '👏', '🔥', '😮', '🙌']

export default function VideoCall() {
  const {
    localVideoRef, localStreamState, remoteStreams, callState,
    myVideo, myAudio, chatOpen, setChatOpen,
    messages, chatInput, setChatInput,
    reactions, myName, roomCode,
    toggleVideo, toggleAudio, sendReaction, sendChat, leaveCall, copyLink,
  } = useVideoCall()

  const chatEndRef = useRef(null)
  const [showReactionPicker, setShowReactionPicker] = useState(false)

  const remoteEntries    = Object.entries(remoteStreams)
  const participantCount = remoteEntries.length + 1

  // Auto-scroll chat
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  // Close reaction picker on outside click
  useEffect(() => {
    if (!showReactionPicker) return
    const handler = () => setShowReactionPicker(false)
    setTimeout(() => window.addEventListener('click', handler), 0)
    return () => window.removeEventListener('click', handler)
  }, [showReactionPicker])

  // Adaptive grid
  const gridCols = participantCount === 1 ? '1fr'
    : participantCount === 2 ? '1fr 1fr'
    : participantCount <= 4  ? '1fr 1fr'
    : '1fr 1fr 1fr'

  // ── Loading / error screens ─────────────────────────────────────

  if (callState === 'joining') {
    return (
      <div style={styles.fullscreen}>
        <div style={styles.center}>
          <div style={styles.pulse} />
          <p style={styles.joinText}>Joining call room <strong style={{ color: '#a5b4fc' }}>{roomCode}</strong>…</p>
          <p style={styles.subText}>Connecting camera and microphone</p>
        </div>
      </div>
    )
  }

  if (callState === 'error') {
    return (
      <div style={styles.fullscreen}>
        <div style={styles.center}>
          <p style={{ fontSize: 48, marginBottom: 16 }}>📵</p>
          <p style={{ color: 'white', fontWeight: 700, fontSize: 18, marginBottom: 8 }}>Could not join call</p>
          <p style={{ color: '#94a3b8', fontSize: 13, marginBottom: 24, textAlign: 'center', maxWidth: 300 }}>
            The room may be expired, or your camera is blocked. Check browser permissions and try again.
          </p>
          <a href="/" style={styles.btnPrimary}>← Back to Home</a>
        </div>
      </div>
    )
  }

  // ── Main call UI ────────────────────────────────────────────────

  return (
    <div style={{ ...styles.fullscreen, display: 'flex', flexDirection: 'column' }}>

      {/* ── Top bar ── */}
      <header style={styles.topBar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={styles.logoBox}>📹</div>
          <div>
            <p style={{ color: 'white', fontWeight: 700, fontSize: 14, margin: 0 }}>Video Call</p>
            <p style={{ color: '#64748b', fontSize: 12, margin: 0 }}>
              {participantCount} participant{participantCount !== 1 ? 's' : ''}
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Room code + copy */}
          <button id="btn-copy-call-link" onClick={copyLink} style={styles.codeChip}>
            <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#a5b4fc', letterSpacing: 3 }}>
              {roomCode}
            </span>
            <span style={{ color: '#475569', fontSize: 11 }}>🔗 Copy invite</span>
          </button>

          {/* Live badge */}
          <div style={styles.liveBadge}>
            <span style={styles.liveDot} />
            <span style={{ color: '#f87171', fontSize: 11, fontWeight: 700 }}>LIVE</span>
          </div>
        </div>
      </header>

      {/* ── Content ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Video grid */}
        <div style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: gridCols,
          gap: 12,
          padding: 16,
          alignContent: 'center',
        }}>
          {/* Local tile */}
          <VideoTile
            ref={localVideoRef}
            stream={localStreamState}
            displayName={myName}
            muted
            isLocal
            videoEnabled={myVideo}
            audioEnabled={myAudio}
            className="aspect-video"
            style={{ aspectRatio: '16/9', minHeight: 180 }}
          />

          {/* Remote tiles */}
          {remoteEntries.map(([socketId, info]) => (
            <RemoteTile
              key={socketId}
              socketId={socketId}
              stream={info.stream}
              displayName={info.displayName || 'Participant'}
              videoEnabled={info.video !== false}
              audioEnabled={info.audio !== false}
            />
          ))}
        </div>

        {/* Chat sidebar */}
        {chatOpen && (
          <div style={styles.chatPanel}>
            <div style={styles.chatHeader}>
              <span style={{ color: 'white', fontWeight: 600, fontSize: 13 }}>💬 Chat</span>
              <button onClick={() => setChatOpen(false)} style={styles.closeBtn}>✕</button>
            </div>
            <div style={styles.chatMessages}>
              {messages.length === 0 && (
                <p style={{ color: '#475569', fontSize: 12, textAlign: 'center', marginTop: 32 }}>
                  No messages yet
                </p>
              )}
              {messages.map((msg, i) => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: msg.senderId === 'me' ? 'flex-end' : 'flex-start', gap: 2 }}>
                  <span style={{ fontSize: 10, color: '#64748b' }}>{msg.sender}</span>
                  <div style={{
                    padding: '8px 12px', borderRadius: 16, fontSize: 13, maxWidth: '85%',
                    background: msg.senderId === 'me' ? '#6366f1' : 'rgba(255,255,255,0.08)',
                    color: 'white',
                  }}>
                    {msg.message}
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <div style={styles.chatInput}>
              <input
                style={styles.input}
                placeholder="Type a message…"
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendChat()}
              />
              <button onClick={sendChat} style={{ ...styles.btnPrimary, padding: '8px 14px', fontSize: 14 }}>→</button>
            </div>
          </div>
        )}
      </div>

      {/* ── Floating reactions ── */}
      {reactions.length > 0 && (
        <div style={styles.reactionsOverlay}>
          {reactions.map(r => (
            <div key={r.id} style={styles.reactionPill}>
              <span style={{ fontSize: 22 }}>{r.emoji}</span>
              <span style={{ fontSize: 11, color: '#94a3b8' }}>{r.displayName}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Control bar ── */}
      <div style={styles.controlBar}>

        <ControlBtn
          id="btn-toggle-audio"
          emoji={myAudio ? '🎙️' : '🔇'}
          label={myAudio ? 'Mute' : 'Unmuted'}
          active={!myAudio}
          danger={!myAudio}
          onClick={toggleAudio}
        />

        <ControlBtn
          id="btn-toggle-video"
          emoji={myVideo ? '📹' : '📷'}
          label={myVideo ? 'Camera' : 'Cam off'}
          active={!myVideo}
          danger={!myVideo}
          onClick={toggleVideo}
        />

        {/* Reaction picker */}
        <div style={{ position: 'relative' }}>
          <ControlBtn
            id="btn-reactions"
            emoji="😀"
            label="React"
            onClick={(e) => { e.stopPropagation(); setShowReactionPicker(p => !p) }}
          />
          {showReactionPicker && (
            <div style={styles.reactionPicker} onClick={e => e.stopPropagation()}>
              {REACTIONS.map(e => (
                <button key={e} style={styles.emojiBtn}
                  onClick={() => { sendReaction(e); setShowReactionPicker(false) }}>
                  {e}
                </button>
              ))}
            </div>
          )}
        </div>

        <ControlBtn
          id="btn-toggle-chat"
          emoji="💬"
          label="Chat"
          active={chatOpen}
          badge={!chatOpen && messages.length > 0 ? messages.length : 0}
          onClick={() => setChatOpen(p => !p)}
        />

        <ControlBtn
          id="btn-invite"
          emoji="🔗"
          label="Invite"
          onClick={copyLink}
        />

        {/* Leave */}
        <button
          id="btn-leave-call"
          onClick={leaveCall}
          style={styles.leaveBtn}
        >
          <span style={{ fontSize: 22 }}>📵</span>
          <span style={{ fontSize: 10, fontWeight: 600, color: '#f87171' }}>Leave</span>
        </button>
      </div>
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────

function RemoteTile({ stream, displayName, videoEnabled, audioEnabled }) {
  const videoRef = useRef(null)
  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    if (stream) { el.srcObject = stream; el.play().catch(() => {}) }
    else el.srcObject = null
  }, [stream])

  const hasVideo = videoEnabled && stream && stream.getVideoTracks().length > 0

  return (
    <div style={{ position: 'relative', background: '#0d0d18', borderRadius: 16, overflow: 'hidden',
      border: '1px solid rgba(255,255,255,0.07)', aspectRatio: '16/9', minHeight: 180 }}>
      <video ref={videoRef} autoPlay playsInline muted={false}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: hasVideo ? 'block' : 'none' }} />
      {!hasVideo && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'linear-gradient(135deg,rgba(99,102,241,0.3),rgba(168,85,247,0.3))', border:'1px solid rgba(99,102,241,0.3)', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <span style={{ fontWeight: 800, fontSize: 22, color: '#a5b4fc' }}>{displayName?.charAt(0)?.toUpperCase()}</span>
          </div>
          <span style={{ color: '#94a3b8', fontSize: 13, fontWeight: 500 }}>{displayName}</span>
          <span style={{ color: '#475569', fontSize: 11 }}>{stream ? 'Camera off' : 'Connecting…'}</span>
        </div>
      )}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '10px 12px', background: 'linear-gradient(to top,rgba(0,0,0,0.7),transparent)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <span style={{ color: 'white', fontSize: 11, fontWeight: 600 }}>{displayName}</span>
        {!audioEnabled && <span style={{ fontSize: 10, background:'rgba(239,68,68,0.8)', color:'white', padding:'2px 6px', borderRadius:6 }}>🔇</span>}
      </div>
    </div>
  )
}

function ControlBtn({ id, emoji, label, onClick, active = false, danger = false, badge = 0 }) {
  return (
    <div style={{ position: 'relative' }}>
      <button id={id} onClick={onClick} style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
        width: 64, height: 64, borderRadius: 18, border: '1px solid',
        cursor: 'pointer', transition: 'all 0.15s',
        borderColor: danger ? 'rgba(239,68,68,0.4)' : active ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.1)',
        background: danger ? 'rgba(239,68,68,0.15)' : active ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.06)',
        paddingTop: 12,
      }}>
        <span style={{ fontSize: 22 }}>{emoji}</span>
        <span style={{ fontSize: 10, fontWeight: 600, color: danger ? '#f87171' : active ? '#a5b4fc' : '#94a3b8' }}>{label}</span>
      </button>
      {badge > 0 && (
        <span style={{ position:'absolute', top:-4, right:-4, background:'#6366f1', color:'white', borderRadius:'50%', width:18, height:18, display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:700 }}>
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </div>
  )
}

// ── Inline styles ───────────────────────────────────────────────

const styles = {
  fullscreen: { position:'fixed', inset:0, background:'#08080f', fontFamily:'Inter,system-ui,sans-serif' },
  center:     { display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100%', gap:12 },
  pulse:      { width:48, height:48, borderRadius:'50%', background:'rgba(99,102,241,0.2)', border:'2px solid #6366f1', marginBottom:12,
    animation:'pulse 1.5s ease-in-out infinite' },
  joinText:   { color:'#e2e8f0', fontSize:16, margin:0 },
  subText:    { color:'#64748b', fontSize:13, margin:0 },

  topBar: {
    display:'flex', alignItems:'center', justifyContent:'space-between',
    padding:'12px 20px', borderBottom:'1px solid rgba(255,255,255,0.06)',
    background:'rgba(8,8,15,0.95)', flexShrink:0,
  },
  logoBox: { width:36, height:36, borderRadius:10, background:'linear-gradient(135deg,#6366f1,#7c3aed)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:18 },
  codeChip: { display:'flex', alignItems:'center', gap:10, background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:12, padding:'7px 14px', cursor:'pointer', transition:'border-color 0.2s' },
  liveBadge:{ display:'flex', alignItems:'center', gap:6, background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.25)', borderRadius:12, padding:'6px 12px' },
  liveDot:  { width:7, height:7, borderRadius:'50%', background:'#f87171', animation:'pulse 1s ease-in-out infinite' },

  chatPanel: { width:288, flexShrink:0, display:'flex', flexDirection:'column', borderLeft:'1px solid rgba(255,255,255,0.07)', background:'rgba(10,10,20,0.95)' },
  chatHeader:{ padding:'14px 16px', borderBottom:'1px solid rgba(255,255,255,0.05)', display:'flex', alignItems:'center', justifyContent:'space-between' },
  chatMessages:{ flex:1, overflowY:'auto', padding:16, display:'flex', flexDirection:'column', gap:12 },
  chatInput: { padding:12, borderTop:'1px solid rgba(255,255,255,0.05)', display:'flex', gap:8 },
  input:     { flex:1, background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:12, padding:'9px 13px', color:'white', fontSize:13, outline:'none' },
  closeBtn:  { background:'none', border:'none', color:'#64748b', cursor:'pointer', fontSize:16, padding:4 },

  reactionsOverlay: { position:'fixed', top:80, left:'50%', transform:'translateX(-50%)', display:'flex', flexDirection:'column', alignItems:'center', gap:8, pointerEvents:'none', zIndex:50 },
  reactionPill:     { display:'flex', alignItems:'center', gap:8, background:'rgba(15,15,30,0.85)', backdropFilter:'blur(12px)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:40, padding:'8px 16px', animation:'slideUp 0.3s ease-out' },

  controlBar: { flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', gap:12, padding:'16px 24px', borderTop:'1px solid rgba(255,255,255,0.06)', background:'rgba(8,8,15,0.97)' },
  leaveBtn:   { display:'flex', flexDirection:'column', alignItems:'center', gap:4, width:64, height:64, borderRadius:18, border:'1px solid rgba(239,68,68,0.4)', background:'rgba(239,68,68,0.15)', cursor:'pointer', paddingTop:12, transition:'all 0.15s' },

  reactionPicker: { position:'absolute', bottom:76, left:'50%', transform:'translateX(-50%)', background:'rgba(15,15,30,0.95)', backdropFilter:'blur(20px)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:20, padding:12, display:'flex', gap:8, boxShadow:'0 8px 40px rgba(0,0,0,0.6)', zIndex:100 },
  emojiBtn:   { fontSize:24, background:'none', border:'none', cursor:'pointer', padding:'4px 6px', borderRadius:10, transition:'transform 0.1s' },

  btnPrimary: { display:'inline-flex', alignItems:'center', justifyContent:'center', gap:6, background:'#6366f1', color:'white', border:'none', borderRadius:14, padding:'12px 24px', fontSize:14, fontWeight:700, cursor:'pointer', textDecoration:'none' },
}
