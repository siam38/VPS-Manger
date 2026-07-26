import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;
let socketToken: string | null = null;

function currentToken(): string {
  return localStorage.getItem('vps_token') || '';
}

/**
 * Returns the shared socket, authenticated with the current token.
 *
 * If the stored token has changed since the socket was created (e.g. the user
 * logged out and logged back in), the stale connection is torn down and a new
 * one is opened. Otherwise the old socket would stay connected under the
 * previous session's credentials.
 */
export function getSocket(): Socket {
  const token = currentToken();

  if (socket && socketToken !== token) {
    socket.disconnect();
    socket = null;
    socketToken = null;
  }

  if (!socket) {
    socket = io('/', { auth: { token }, transports: ['websocket', 'polling'] });
    socketToken = token;
  }

  return socket;
}

export function disconnectSocket() {
  if (socket) { socket.disconnect(); socket = null; }
  socketToken = null;
}
