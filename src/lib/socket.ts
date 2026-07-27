import { io, Socket } from 'socket.io-client';
import { getToken } from './auth';

let socket: Socket | null = null;

/**
 * Returns the shared, authenticated socket.
 *
 * Note what this deliberately does NOT do any more: rebuild the connection
 * when the token string changes. Access tokens now rotate roughly every
 * twelve minutes, and the old "token differs, reconnect" rule would have
 * torn down every live terminal and log stream four times an hour — turning
 * the session fix into a worse bug than the one it replaced.
 *
 * The server authenticates the socket once at handshake, so an established
 * connection stays valid. What matters is that *re*connects present a current
 * token, which is why `auth` is a callback: socket.io re-evaluates it on every
 * reconnection attempt, picking up whatever the latest token is at that moment.
 *
 * Ending a session is the one case that must drop the connection, and that
 * goes through disconnectSocket() explicitly.
 */
export function getSocket(): Socket {
  if (!socket) {
    socket = io('/', {
      // Callback form: re-read on every (re)connect attempt.
      auth: (cb: (data: Record<string, unknown>) => void) => cb({ token: getToken() ?? '' }),
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
    });
  }
  return socket;
}

export function disconnectSocket() {
  if (socket) { socket.disconnect(); socket = null; }
}
