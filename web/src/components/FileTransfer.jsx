import { useState, useRef, useCallback } from 'react'
import { Upload, File, Check, X, Download, AlertCircle } from 'lucide-react'
import { fileApi } from '../lib/api'
import toast from 'react-hot-toast'

const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

export default function FileTransfer({ sessionId }) {
  const [transfers, setTransfers] = useState([])
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef(null)

  const handleFile = useCallback(async (file) => {
    const id = Date.now()
    setTransfers(prev => [...prev, {
      id, name: file.name, size: file.size,
      status: 'uploading', progress: 0,
    }])

    try {
      const res = await fileApi.upload(sessionId, file, (progress) => {
        setTransfers(prev => prev.map(t => t.id === id ? { ...t, progress } : t))
      })
      setTransfers(prev => prev.map(t =>
        t.id === id ? { ...t, status: 'done', progress: 100, downloadUrl: res.transfer?.downloadUrl } : t
      ))
      toast.success(`${file.name} transferred`)
    } catch (err) {
      setTransfers(prev => prev.map(t =>
        t.id === id ? { ...t, status: 'error' } : t
      ))
      toast.error(`Failed to transfer ${file.name}`)
    }
  }, [sessionId])

  const handleDrop = (e) => {
    e.preventDefault()
    setIsDragging(false)
    const files = Array.from(e.dataTransfer.files)
    files.forEach(handleFile)
  }

  const handleInputChange = (e) => {
    Array.from(e.target.files).forEach(handleFile)
    e.target.value = ''
  }

  const statusIcon = (status) => {
    if (status === 'done') return <Check size={14} className="text-emerald-400" />
    if (status === 'error') return <AlertCircle size={14} className="text-red-400" />
    return null
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden p-4 space-y-4">
      {/* Drop Zone */}
      <div
        id="file-drop-zone"
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all duration-200 ${
          isDragging
            ? 'border-brand-400 bg-brand-500/10'
            : 'border-white/10 hover:border-brand-500/50 hover:bg-white/3'
        }`}
      >
        <Upload size={28} className="text-slate-500 mx-auto mb-3" />
        <p className="text-sm text-slate-400 font-medium">Drop files or click to browse</p>
        <p className="text-xs text-slate-600 mt-1">Up to 500MB per file</p>
        <input
          id="file-input"
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleInputChange}
        />
      </div>

      {/* Transfer List */}
      <div className="flex-1 overflow-y-auto space-y-2">
        {transfers.map((t) => (
          <div key={t.id} className="card p-3">
            <div className="flex items-center gap-3">
              <File size={18} className="text-brand-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{t.name}</p>
                <p className="text-xs text-slate-500">{formatBytes(t.size)}</p>
              </div>
              {statusIcon(t.status)}
              {t.status === 'done' && t.downloadUrl && (
                <a href={t.downloadUrl} download className="btn-ghost p-1">
                  <Download size={13} />
                </a>
              )}
            </div>
            {t.status === 'uploading' && (
              <div className="progress-bar mt-2">
                <div className="progress-fill" style={{ width: `${t.progress}%` }} />
              </div>
            )}
          </div>
        ))}
        {transfers.length === 0 && (
          <div className="text-center text-slate-500 text-xs py-6">No files transferred yet</div>
        )}
      </div>
    </div>
  )
}
