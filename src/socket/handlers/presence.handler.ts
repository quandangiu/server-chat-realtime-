import { Server, Socket } from 'socket.io';
import { redis } from '../../config/redis';
import { Workspace } from '../../models/Workspace';
import { Channel } from '../../models/Channel';
import { setOnline, setOffline, getOnlineUsers, refreshPresence } from '../../services/presence.service';

export const registerPresenceHandlers = (io: Server, socket: Socket) => {
  const { userId } = socket;

  // Connect → set online
  (async () => {
    try {
      await setOnline(userId);
      const workspaces = await Workspace.find({ 'members.user': userId }, '_id');
      for (const ws of workspaces) {
        io.to(`workspace:${ws._id}`).emit('user_status_changed', { userId, status: 'online' });
      }
    } catch (err) {
      console.error('❌ Error in initial presence setup:', err);
    }
  })();

  // Join workspace room
  socket.on('join_workspace', async ({ workspaceId }) => {
    try {
      const isMember = await Workspace.exists({ _id: workspaceId, 'members.user': userId });
      if (!isMember) return;

      socket.join(`workspace:${workspaceId}`);

      const ws = await Workspace.findById(workspaceId, 'members');
      if (ws) {
        const memberIds = ws.members.map(m => m.user.toString());
        const onlineIds = await getOnlineUsers(memberIds);
        socket.emit('workspace_online_users', { workspaceId, onlineIds });
      }

      // Gửi snapshot voice members cho tất cả voice channels
      const voiceChannels = await Channel.find({
        workspace: workspaceId,
        type: 'voice',
      }).select('_id');

      for (const ch of voiceChannels) {
        const key = `voice:${ch._id}`;
        const raw = await redis.get(key);
        if (raw) {
          const members = JSON.parse(raw);
          if (members.length > 0) {
            socket.emit('voice_channel_updated', {
              channelId: ch._id.toString(),
              members,
            });
          }
        }
      }
    } catch (err) {
      console.error('❌ Error in join_workspace:', err);
    }
  });

  // Join/leave channel
  socket.on('join_channel', async ({ channelId }) => {
    try {
      const ok = await Channel.exists({ _id: channelId, members: userId });
      if (ok) socket.join(`channel:${channelId}`);
    } catch (err) {
      console.error('❌ Error in join_channel:', err);
    }
  });

  socket.on('leave_channel', ({ channelId }) => {
    try {
      socket.leave(`channel:${channelId}`);
    } catch (err) {
      console.error('❌ Error in leave_channel:', err);
    }
  });

  // Heartbeat
  socket.on('heartbeat', () => {
    try {
      refreshPresence(userId).catch(err => console.error('❌ Error in heartbeat:', err));
    } catch (err) {
      console.error('❌ Error in heartbeat:', err);
    }
  });

  // Disconnect
  socket.on('disconnect', async () => {
    try {
      console.log(`[Socket] User disconnected: ${userId}`);
      const sockets = await io.in(`user:${userId}`).fetchSockets();
      if (sockets.length === 0) {
        await setOffline(userId);
        const workspaces = await Workspace.find({ 'members.user': userId }, '_id');
        for (const ws of workspaces) {
          io.to(`workspace:${ws._id}`).emit('user_status_changed', {
            userId, status: 'offline', lastSeen: new Date(),
          });
        }
      }
    } catch (err) {
      console.error('❌ Error in disconnect:', err);
    }
  });
};
