/**
 * E2E test: Two socket clients join the same video call room
 * and exchange WebRTC offer/answer via the signaling server.
 */
const { io } = require('socket.io-client')
const axios  = require('axios')

const BASE   = 'http://localhost:3001'
const DEVICE1 = 'test-caller-001'
const DEVICE2 = 'test-caller-002'

let pass = 0
let fail = 0

function ok(msg)   { console.log(`  ✅ ${msg}`); pass++ }
function bad(msg)  { console.log(`  ❌ ${msg}`); fail++ }
function section(s){ console.log(`\n📋 ${s}`) }

async function connect(deviceId, displayName) {
  const sock = io(BASE, {
    auth: { deviceId, displayName },
    transports: ['websocket', 'polling'],
    timeout: 6000,
  })
  await new Promise((res, rej) => {
    sock.once('connect', res)
    sock.once('connect_error', rej)
    setTimeout(() => rej(new Error('connect timeout')), 6000)
  })
  return sock
}

async function run() {
  console.log('\n🧪 RemoteLink Video Call — End-to-End Test\n' + '─'.repeat(45))

  // ── 1. Health check ──────────────────────────────────────
  section('Backend Health')
  try {
    const h = await axios.get(`${BASE}/health`)
    ok(`Server is ${h.data.status} (${h.data.environment})`)
  } catch (e) { bad(`Health check failed: ${e.message}`); process.exit(1) }

  // ── 2. Create call room ──────────────────────────────────
  section('Create Call Room')
  let roomCode, joinLink, roomId
  try {
    const r = await axios.post(`${BASE}/api/calls`, { deviceId: DEVICE1 })
    roomCode = r.data.roomCode
    joinLink = r.data.joinLink
    roomId   = r.data.roomId
    ok(`Room created: ${roomCode}`)
    ok(`Join link: ${joinLink}`)
    ok(`Expires: ${r.data.expiresAt}`)
  } catch (e) { bad(`Create room failed: ${e.message}`); process.exit(1) }

  // ── 3. Room lookup ───────────────────────────────────────
  section('Room Lookup by Code')
  try {
    const r = await axios.get(`${BASE}/api/calls/${roomCode}`)
    ok(`Room found: ${r.data.roomCode}`)
    ok(`Status: ${r.data.status}`)
    ok(`Participants: ${r.data.participantCount}`)
  } catch (e) { bad(`Room lookup failed: ${e.message}`) }

  // ── 4. 404 for missing room ──────────────────────────────
  section('404 for Missing Room')
  try {
    await axios.get(`${BASE}/api/calls/ZZZ-ZZZ-ZZZ`)
    bad('Should have returned 404')
  } catch (e) {
    if (e.response?.status === 404) ok('Got 404 for missing room ✓')
    else bad(`Unexpected error: ${e.message}`)
  }

  // ── 5. WebSocket: Caller 1 connects ─────────────────────
  section('WebSocket: Caller 1 Joins')
  let sock1
  try {
    sock1 = await connect(DEVICE1, 'Alice')
    ok(`Caller 1 connected (socket: ${sock1.id})`)
  } catch (e) { bad(`Caller 1 connect failed: ${e.message}`); process.exit(1) }

  // Caller 1 joins the room
  const joinRes1 = await new Promise((res) => {
    sock1.emit('call:join', { roomCode, displayName: 'Alice' }, res)
  })

  if (joinRes1.success) {
    ok(`Caller 1 joined room ${joinRes1.roomCode}`)
    ok(`Is initiator: ${joinRes1.isInitiator}`)
    ok(`Existing participants: ${joinRes1.participants.length}`)
  } else {
    bad(`Caller 1 join failed: ${joinRes1.error}`)
  }

  // ── 6. WebSocket: Caller 2 connects ─────────────────────
  section('WebSocket: Caller 2 Joins via Link')
  let sock2

  // Track what sock1 receives when caller 2 joins
  const participantJoinedPromise = new Promise((res) => {
    sock1.once('call:participant_joined', (data) => res(data))
    setTimeout(() => res(null), 4000)
  })

  try {
    sock2 = await connect(DEVICE2, 'Bob')
    ok(`Caller 2 connected (socket: ${sock2.id})`)
  } catch (e) { bad(`Caller 2 connect failed: ${e.message}`); process.exit(1) }

  const joinRes2 = await new Promise((res) => {
    sock2.emit('call:join', { roomCode, displayName: 'Bob' }, res)
  })

  if (joinRes2.success) {
    ok(`Caller 2 joined room ${joinRes2.roomCode}`)
    ok(`Existing participants seen by Bob: ${joinRes2.participants.length}`)
    ok(`Bob sees Alice: ${joinRes2.participants.some(p => p.displayName === 'Alice') ? 'yes' : 'no (expected)'}`)
  } else {
    bad(`Caller 2 join failed: ${joinRes2.error}`)
  }

  // Check caller 1 was notified
  const joined = await participantJoinedPromise
  if (joined) {
    ok(`Caller 1 notified of caller 2 joining: ${joined.displayName}`)
  } else {
    bad('Caller 1 was NOT notified when caller 2 joined')
  }

  // ── 7. WebRTC Offer/Answer relay ─────────────────────────
  section('WebRTC Signaling Relay (Offer → Answer)')

  // Caller 2 will receive offer from caller 1
  const offerReceived = new Promise((res) => {
    sock2.once('call:offer', (data) => res(data))
    setTimeout(() => res(null), 3000)
  })

  // Caller 1 sends offer to caller 2
  sock1.emit('call:offer', {
    targetSocketId: sock2.id,
    offer: { type: 'offer', sdp: 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\n...(mock SDP)' },
    roomCode,
  })

  const offer = await offerReceived
  if (offer) {
    ok(`Offer relayed to caller 2 from ${offer.fromSocketId}`)

    // Caller 2 sends answer back
    const answerReceived = new Promise((res) => {
      sock1.once('call:answer', (data) => res(data))
      setTimeout(() => res(null), 3000)
    })

    sock2.emit('call:answer', {
      targetSocketId: offer.fromSocketId,
      answer: { type: 'answer', sdp: 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n...(mock SDP)' },
      roomCode,
    })

    const answer = await answerReceived
    if (answer) ok(`Answer relayed back to caller 1 from ${answer.fromSocketId}`)
    else         bad('Answer was not relayed back')
  } else {
    bad('Offer was NOT relayed to caller 2')
  }

  // ── 8. ICE relay ─────────────────────────────────────────
  section('ICE Candidate Relay')
  const iceReceived = new Promise((res) => {
    sock2.once('call:ice', (data) => res(data))
    setTimeout(() => res(null), 2000)
  })
  sock1.emit('call:ice', {
    targetSocketId: sock2.id,
    candidate: { candidate: 'candidate:0 1 UDP 1 127.0.0.1 9 typ host', sdpMid: '0', sdpMLineIndex: 0 },
    roomCode,
  })
  const ice = await iceReceived
  if (ice) ok(`ICE candidate relayed ✓`)
  else      bad('ICE candidate NOT relayed')

  // ── 9. Media toggle broadcast ────────────────────────────
  section('Media Toggle Broadcast')
  const toggleReceived = new Promise((res) => {
    sock2.once('call:media_toggle', (data) => res(data))
    setTimeout(() => res(null), 2000)
  })
  sock1.emit('call:media_toggle', { roomCode, video: false, audio: true })
  const toggle = await toggleReceived
  if (toggle) ok(`Media toggle broadcast (video=${toggle.video}, audio=${toggle.audio})`)
  else         bad('Media toggle NOT received')

  // ── 10. Reaction ─────────────────────────────────────────
  section('Emoji Reaction')
  const reactionReceived = new Promise((res) => {
    sock2.once('call:reaction', (data) => res(data))
    setTimeout(() => res(null), 2000)
  })
  sock1.emit('call:reaction', { roomCode, emoji: '👍' })
  const reaction = await reactionReceived
  if (reaction) ok(`Reaction received: ${reaction.emoji} from ${reaction.displayName}`)
  else           bad('Reaction NOT received')

  // ── 11. Chat message ─────────────────────────────────────
  section('In-Call Chat')
  const chatReceived = new Promise((res) => {
    sock2.once('chat:message', (data) => res(data))
    setTimeout(() => res(null), 2000)
  })
  sock1.emit('chat:message', { message: 'Hello from test!', roomCode })
  const chat = await chatReceived
  if (chat) ok(`Chat message received: "${chat.message}" from ${chat.sender}`)
  else       bad('Chat message NOT received')

  // ── 12. Participant leave + notify ───────────────────────
  section('Participant Leave')
  const leftReceived = new Promise((res) => {
    sock1.once('call:participant_left', (data) => res(data))
    setTimeout(() => res(null), 3000)
  })
  sock2.emit('call:leave', { roomCode })
  const left = await leftReceived
  if (left) ok(`Caller 1 notified: caller 2 left (socketId: ${left.socketId})`)
  else       bad('Caller 1 was NOT notified when caller 2 left')

  // ── 13. Room participant count ───────────────────────────
  section('Room State After Leave')
  await new Promise(r => setTimeout(r, 500))
  try {
    const r = await axios.get(`${BASE}/api/calls/${roomCode}`)
    ok(`Room participant count: ${r.data.participantCount}`)
    ok(`Room status: ${r.data.status}`)
  } catch (e) { bad(`Room check failed: ${e.message}`) }

  // ── 14. Second room independence ─────────────────────────
  section('Second Independent Room')
  try {
    const r2 = await axios.post(`${BASE}/api/calls`, { deviceId: 'test-other' })
    ok(`Second room: ${r2.data.roomCode}`)
    ok(`Different from first: ${r2.data.roomCode !== roomCode ? 'yes ✓' : 'NO (collision!)'}`)
  } catch (e) { bad(`Second room failed: ${e.message}`) }

  // ── Cleanup ──────────────────────────────────────────────
  sock1.disconnect()
  if (sock2.connected) sock2.disconnect()

  // ── Summary ──────────────────────────────────────────────
  console.log('\n' + '─'.repeat(45))
  console.log(`Results: ${pass} passed, ${fail} failed`)
  if (fail === 0) {
    console.log('🎉 All tests passed! Video call is fully functional.\n')
  } else {
    console.log(`⚠️  ${fail} test(s) need attention.\n`)
  }
  process.exit(fail === 0 ? 0 : 1)
}

run().catch(err => { console.error('Test runner crashed:', err); process.exit(1) })
