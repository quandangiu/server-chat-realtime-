import { Server, Socket } from 'socket.io';

export const registerVideoHandlers = (io: Server, socket: Socket) => {
  socket.on('call_user', ({ targetUserId, roomId }) => {
    io.to(`user:${targetUserId}`).emit('incoming_call', {
      callerId: socket.userId,
      roomId,
    });
  });

  socket.on('accept_call', ({ callerId, roomId }) => {
    socket.join(`video:${roomId}`);
    io.to(`user:${callerId}`).emit('call_accepted', { userId: socket.userId, roomId });
  });

  socket.on('reject_call', ({ callerId }) => {
    io.to(`user:${callerId}`).emit('call_rejected', { userId: socket.userId });
  });

  socket.on('end_call', ({ roomId }) => {
    io.to(`video:${roomId}`).emit('call_ended', { userId: socket.userId });
    socket.leave(`video:${roomId}`);
  });

  socket.on('webrtc_offer', ({ targetUserId, offer }) => {
    io.to(`user:${targetUserId}`).emit('webrtc_offer', { fromUserId: socket.userId, offer });
  });

  socket.on('webrtc_answer', ({ targetUserId, answer }) => {
    io.to(`user:${targetUserId}`).emit('webrtc_answer', { fromUserId: socket.userId, answer });
  });

  socket.on('webrtc_ice_candidate', ({ targetUserId, candidate }) => {
    io.to(`user:${targetUserId}`).emit('webrtc_ice_candidate', { fromUserId: socket.userId, candidate });
  });
};
