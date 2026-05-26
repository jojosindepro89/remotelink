const logger = require('../utils/logger');

/**
 * In-memory session state manager for active connections.
 * MongoDB holds persistent history; this manages live session state.
 */
class SessionManager {
  constructor() {
    this.activeSessions = new Map(); // sessionId -> SessionState
    this.socketToSession = new Map(); // socketId -> sessionId
    this.deviceToSocket = new Map(); // deviceId -> socketId
    this.timeouts = new Map(); // sessionId -> timeoutHandle
  }

  createSession(sessionId, hostInfo) {
    const state = {
      sessionId,
      sessionCode: hostInfo.sessionCode,
      hostSocketId: hostInfo.socketId,
      hostDeviceId: hostInfo.deviceId,
      viewers: new Map(), // socketId -> viewerInfo
      status: 'waiting',
      createdAt: Date.now(),
      startedAt: null,
      iceCandidatesQueue: new Map(), // targetSocketId -> candidates[]
    };
    this.activeSessions.set(sessionId, state);
    this.socketToSession.set(hostInfo.socketId, sessionId);
    this.deviceToSocket.set(hostInfo.deviceId, hostInfo.socketId);

    // Session timeout: auto-expire after 1hr of waiting
    this._startWaitingTimeout(sessionId);
    logger.info(`Session created: ${sessionId} by device ${hostInfo.deviceId}`);
    return state;
  }

  addViewer(sessionId, viewerInfo) {
    const session = this.activeSessions.get(sessionId);
    if (!session) return null;

    session.viewers.set(viewerInfo.socketId, {
      socketId: viewerInfo.socketId,
      deviceId: viewerInfo.deviceId,
      displayName: viewerInfo.displayName,
      joinedAt: Date.now(),
      permissions: viewerInfo.permissions || {
        canControl: false,
        canChat: true,
        canTransferFiles: false,
        canViewScreen: true,
        canUseAudio: false,
      },
    });

    this.socketToSession.set(viewerInfo.socketId, sessionId);
    this.deviceToSocket.set(viewerInfo.deviceId, viewerInfo.socketId);

    if (session.status === 'waiting') {
      session.status = 'active';
      session.startedAt = Date.now();
      this._clearTimeout(sessionId);
      this._startSessionTimeout(sessionId);
    }

    logger.info(`Viewer joined session ${sessionId}: ${viewerInfo.deviceId}`);
    return session;
  }

  removeSocket(socketId) {
    const sessionId = this.socketToSession.get(socketId);
    if (!sessionId) return null;

    const session = this.activeSessions.get(sessionId);
    if (!session) return null;

    let role = null;

    if (session.hostSocketId === socketId) {
      role = 'host';
      // Don't end immediately — give 60s grace period for host to reconnect.
      // Browser tab switches, brief network blips, and Vercel cold-renders
      // can drop the WS for several seconds without the host actually leaving.
      session.hostDisconnectedAt = Date.now();
      session.status = 'host_disconnected';
      this._clearTimeout(sessionId);
      this.timeouts.set(sessionId, setTimeout(() => {
        const s = this.activeSessions.get(sessionId);
        if (s && s.status === 'host_disconnected') {
          logger.info(`Host did not reconnect to session ${sessionId} within grace period — ending`);
          s.status = 'ended';
          setTimeout(() => this.activeSessions.delete(sessionId), 30000);
        }
      }, 60000));
      logger.info(`Host disconnected from session ${sessionId} (60s grace period started)`);
    } else if (session.viewers.has(socketId)) {
      role = 'viewer';
      session.viewers.delete(socketId);
      logger.info(`Viewer disconnected from session ${sessionId}`);
    }

    this.socketToSession.delete(socketId);
    return { session, role };
  }

  getSession(sessionId) {
    return this.activeSessions.get(sessionId);
  }

  getSessionByCode(code) {
    const upperCode = (code || '').toUpperCase();
    for (const [, session] of this.activeSessions) {
      const sessionCodeUpper = (session.sessionCode || '').toUpperCase();
      if (sessionCodeUpper === upperCode && session.status !== 'ended') {
        return session;
      }
    }
    return null;
  }

  /**
   * Reclaim a session for a host that has reconnected with a new socket.
   * Looks up by deviceId — if the host's previous session is in grace
   * period, swap in the new socket and resume.
   */
  reclaimHostSession(deviceId, newSocketId) {
    for (const [sessionId, session] of this.activeSessions) {
      if (session.hostDeviceId === deviceId && session.status === 'host_disconnected') {
        // Remove old socket binding, attach new one
        this.socketToSession.delete(session.hostSocketId);
        session.hostSocketId = newSocketId;
        session.status = session.viewers.size > 0 ? 'active' : 'waiting';
        session.hostDisconnectedAt = null;
        this.socketToSession.set(newSocketId, sessionId);
        this.deviceToSocket.set(deviceId, newSocketId);
        this._clearTimeout(sessionId);
        logger.info(`Host reclaimed session ${sessionId} via deviceId ${deviceId}`);
        return session;
      }
    }
    return null;
  }

  getSessionBySocket(socketId) {
    const sessionId = this.socketToSession.get(socketId);
    return sessionId ? this.activeSessions.get(sessionId) : null;
  }

  endSession(sessionId) {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      session.status = 'ended';
      this._clearTimeout(sessionId);
      // Keep in memory briefly for reconnect grace period
      setTimeout(() => {
        this.activeSessions.delete(sessionId);
        logger.info(`Session ${sessionId} purged from memory`);
      }, 30000);
    }
  }

  updateViewerPermissions(sessionId, viewerSocketId, permissions) {
    const session = this.activeSessions.get(sessionId);
    if (!session) return false;
    const viewer = session.viewers.get(viewerSocketId);
    if (!viewer) return false;
    Object.assign(viewer.permissions, permissions);
    return true;
  }

  getActiveSessionsStats() {
    const stats = { total: 0, active: 0, waiting: 0, viewers: 0 };
    for (const [, session] of this.activeSessions) {
      stats.total++;
      if (session.status === 'active') stats.active++;
      if (session.status === 'waiting') stats.waiting++;
      stats.viewers += session.viewers.size;
    }
    return stats;
  }

  _startWaitingTimeout(sessionId) {
    const handle = setTimeout(() => {
      const session = this.activeSessions.get(sessionId);
      if (session && session.status === 'waiting') {
        session.status = 'timeout';
        logger.info(`Session ${sessionId} timed out waiting for viewer`);
      }
    }, 10 * 60 * 1000); // 10 min wait timeout
    this.timeouts.set(sessionId, handle);
  }

  _startSessionTimeout(sessionId) {
    const maxDuration = parseInt(process.env.SESSION_MAX_DURATION_MS) || 28800000;
    const handle = setTimeout(() => {
      logger.info(`Session ${sessionId} reached max duration`);
      this.endSession(sessionId);
    }, maxDuration);
    this.timeouts.set(sessionId, handle);
  }

  _clearTimeout(sessionId) {
    const handle = this.timeouts.get(sessionId);
    if (handle) {
      clearTimeout(handle);
      this.timeouts.delete(sessionId);
    }
  }
}

module.exports = new SessionManager();
