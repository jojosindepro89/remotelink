import { useState, useRef, useEffect } from 'react'
import { Send, Smile } from 'lucide-react'

export default function Chat({ messages = [], onSend }) {
  const [input, setInput] = useState('')
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!input.trim()) return
    onSend(input.trim())
    setInput('')
  }

  const formatTime = (ts) => {
    try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) } catch { return '' }
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-center text-slate-500 text-xs py-8">
            No messages yet. Say hello!
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`chat-message ${msg.isSelf ? 'own' : ''}`}>
            {!msg.isSelf && (
              <p className="text-xs text-slate-500 mb-1 ml-1">{msg.sender}</p>
            )}
            <div className={`bubble ${msg.isSelf ? '!bg-brand-600 text-white' : ''}`}>
              {msg.message}
            </div>
            <p className="text-[10px] text-slate-600 mt-0.5 mx-1">{formatTime(msg.timestamp)}</p>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-3 border-t border-white/6">
        <div className="flex gap-2">
          <input
            id="chat-input"
            type="text"
            className="input text-sm py-2"
            placeholder="Type a message..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button type="submit" id="chat-send" className="btn-primary p-2 shrink-0">
            <Send size={15} />
          </button>
        </div>
      </form>
    </div>
  )
}
