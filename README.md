# RemoteLink 🖥️

> A modern, secure, cross-platform remote desktop and screen sharing platform — similar to TeamViewer — built with WebRTC, Socket.io, React, and Node.js.

[![Deploy Frontend](https://img.shields.io/badge/Frontend-Vercel-black?logo=vercel)](https://remotelink.vercel.app)
[![Deploy Backend](https://img.shields.io/badge/Backend-Railway-purple?logo=railway)](https://remotelink-backend.up.railway.app)

## ✨ Features

| Feature | Status |
|---------|--------|
| 🖥️ Remote desktop (screen share) | ✅ |
| 🎮 Mouse & keyboard remote control | ✅ |
| 📹 Video calls with shareable link | ✅ |
| 💬 In-session chat | ✅ |
| 📁 File transfer | ✅ |
| 📋 Clipboard sync | ✅ |
| 🎙️ Voice chat | ✅ |
| 🔒 End-to-end WebRTC encryption | ✅ |
| 👤 Guest access (no account needed) | ✅ |
| 🌓 Dark mode UI | ✅ |
| 📱 Mobile responsive | ✅ |
| 🖥️ Electron desktop app | ✅ |
| 🔄 Auto-reconnect | ✅ |
| 🔐 Session code + password | ✅ |

## 🏗️ Architecture

```
remotelink/
├── web/           # React + Vite frontend (Vercel)
├── backend/       # Node.js + Express + Socket.io (Railway)
├── desktop/       # Electron desktop app (Windows/Mac)
├── mobile/        # React Native mobile app
└── vercel.json    # Frontend deployment config
```

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- MongoDB (local or Atlas)

### Backend
```bash
cd backend
cp .env.example .env   # Edit secrets
npm install
npm run dev            # Starts on :3001
```

### Web Frontend
```bash
cd web
cp .env.example .env.local   # Set API URL
npm install
npm run dev            # Starts on :5173
```

### Desktop App
```bash
cd desktop
npm install
npm run dev            # Electron window opens
```

## 🌐 Production Deployment

### Frontend → Vercel
```bash
# Install Vercel CLI
npm i -g vercel

# From repo root
vercel --prod
```

### Backend → Railway
1. Connect this repo to Railway
2. Select `/backend` as root directory
3. Add env vars from `backend/.env.example`
4. Add MongoDB plugin (or provide MONGODB_URI)

## 🔧 Environment Variables

### Backend (`backend/.env`)
| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default: 3001) |
| `MONGODB_URI` | MongoDB connection string |
| `JWT_SECRET` | Long random string for JWT signing |
| `ALLOWED_ORIGINS` | Comma-separated allowed origins |
| `TURN_URL` | TURN server URL (optional, for cross-NAT) |

### Frontend (`web/.env`)
| Variable | Description |
|----------|-------------|
| `VITE_API_URL` | Backend API URL |
| `VITE_WS_URL` | Backend WebSocket URL |

## 📡 WebSocket Events

### Remote Desktop Session
| Event | Direction | Description |
|-------|-----------|-------------|
| `session:create` | Client→Server | Create a new session |
| `session:join` | Client→Server | Join with code+password |
| `viewer:joined` | Server→Host | Viewer has connected |
| `webrtc:offer` | P2P relay | WebRTC offer |
| `webrtc:answer` | P2P relay | WebRTC answer |
| `webrtc:ice` | P2P relay | ICE candidate |
| `control:event` | Viewer→Host | Mouse/keyboard event |

### Video Calls
| Event | Direction | Description |
|-------|-----------|-------------|
| `call:join` | Client→Server | Join call room |
| `call:offer` | P2P relay | WebRTC offer |
| `call:answer` | P2P relay | WebRTC answer |
| `call:ice` | P2P relay | ICE candidate |
| `call:reaction` | Broadcast | Emoji reaction |
| `chat:message` | Broadcast | Chat message |

## 🔐 Security

- All WebRTC streams are end-to-end encrypted (DTLS-SRTP)
- Session codes expire after 24h
- Passwords are bcrypt-hashed
- Rate limiting on all API routes
- Helmet.js security headers
- JWT authentication with refresh tokens

## 🛠️ Tech Stack

- **Frontend**: React 18, Vite, Tailwind CSS, Socket.io-client, React Router
- **Backend**: Node.js, Express, Socket.io, MongoDB/Mongoose, JWT
- **Desktop**: Electron, @nut-tree-fork/nut-js (OS control)
- **WebRTC**: Native browser WebRTC API, STUN/TURN
- **Deploy**: Vercel (frontend) + Railway (backend)

## 📄 License

MIT — free for personal and commercial use.
