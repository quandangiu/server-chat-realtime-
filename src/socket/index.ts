import { Server } from 'socket.io';
import http from 'http';
import { verifyToken } from '../utils/jwt';
import { registerPresenceHandlers } from './handlers/presence.handler';
import { registerMessageHandlers } from './handlers/message.handler';
import { registerVideoHandlers } from './handlers/video.handler';
import { registerVoiceHandlers, removeFromVoice } from './handlers/voice.handler';
import { setIO } from './instance';

declare module 'socket.io' {
  interface Socket {
    userId: string;
  }
}

export const initSocket = (httpServer: http.Server) => {
  const allowedOrigins = (process.env.CLIENT_URLS || 'http://localhost:5173')
    .split(',')
    .map(s => s.trim());

  const io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        // Cho phép LAN
        if (/^http:\/\/(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(origin)) {
          return callback(null, true);
        }
        callback(null, true); // dev mode: cho tất cả
      },
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  // Lưu io instance để dùng trong REST controllers
  setIO(io);

  // Auth middleware
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) throw new Error('No token');
      const decoded = verifyToken(token);
      socket.userId = decoded.userId;
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`[Socket] User connected: ${socket.userId} (${socket.id})`);
    socket.join(`user:${socket.userId}`);

    registerPresenceHandlers(io, socket);
    registerMessageHandlers(io, socket);
    registerVideoHandlers(io, socket);
    registerVoiceHandlers(io, socket);

    // Auto-remove từ voice khi disconnect
    socket.on('disconnect', async () => {
      const currentVoiceChannel = (socket as any).currentVoiceChannel;
      if (currentVoiceChannel) {
        await removeFromVoice(io, currentVoiceChannel, socket.userId);
      }
    });
  });

  return io;
};
