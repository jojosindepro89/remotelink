import { forwardRef, useEffect } from 'react'

/**
 * Binds a MediaStream to a <video> element.
 * Uses forwardRef so the parent can pass a ref directly to the <video> element.
 * Also accepts `stream` prop for reactive updates.
 */
const VideoTile = forwardRef(function VideoTile(
  { stream, displayName, muted = false, isLocal = false, videoEnabled = true, audioEnabled = true, className = '' },
  ref
) {
  // When stream changes, bind it to the video element
  useEffect(() => {
    const el = ref?.current
    if (!el) return
    if (stream) {
      el.srcObject = stream
      el.play().catch(() => {}) // Autoplay policy
    } else {
      el.srcObject = null
    }
  }, [stream, ref])

  const hasVideo = videoEnabled && stream && stream.getVideoTracks().length > 0

  return (
    <div
      className={`relative rounded-2xl overflow-hidden flex items-center justify-center ${className}`}
      style={{ background: '#0d0d18', border: '1px solid rgba(255,255,255,0.07)' }}
    >
      {/* Video element — always mounted, hidden when camera is off */}
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={muted || isLocal}
        className="w-full h-full object-cover"
        style={{
          transform: isLocal ? 'scaleX(-1)' : 'none',
          display: hasVideo ? 'block' : 'none',
        }}
      />

      {/* Avatar placeholder when camera is off or no stream yet */}
      {!hasVideo && (
        <div className="flex flex-col items-center gap-3 z-10">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, rgba(99,102,241,0.3), rgba(168,85,247,0.3))', border: '1px solid rgba(99,102,241,0.3)' }}
          >
            <span className="text-2xl font-bold" style={{ color: '#a5b4fc' }}>
              {displayName?.charAt(0)?.toUpperCase() || '?'}
            </span>
          </div>
          <span className="text-sm font-medium" style={{ color: '#94a3b8' }}>{displayName}</span>
          <span className="text-xs" style={{ color: '#475569' }}>
            {!stream ? 'Connecting…' : 'Camera off'}
          </span>
        </div>
      )}

      {/* Name + mute indicators overlay */}
      <div
        className="absolute bottom-0 inset-x-0 p-3 flex items-center justify-between"
        style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 100%)' }}
      >
        <span className="text-xs font-semibold text-white drop-shadow">
          {displayName}{isLocal ? ' (You)' : ''}
        </span>
        <div className="flex items-center gap-1">
          {!audioEnabled && (
            <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ background: 'rgba(239,68,68,0.8)', color: 'white' }}>🔇</span>
          )}
          {!videoEnabled && stream && (
            <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ background: 'rgba(71,85,105,0.8)', color: 'white' }}>Cam off</span>
          )}
        </div>
      </div>
    </div>
  )
})

export default VideoTile
