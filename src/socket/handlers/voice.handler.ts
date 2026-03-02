import { Server, Socket } from 'socket.io';
import { redis } from '../../config/redis';
import { User } from '../../models/User';
import { Channel } from '../../models/Channel';
import { Workspace } from '../../models/Workspace';

interface VoiceMember {
  userId: string;
  username: string;
  displayName?: string;
  avatar: string | null;
  joinedAt: string;
  isMuted: boolean;
  isDeafened: boolean;
}

// Tìm socket theo userId — ưu tiên socket đang ở voice channel
function findSocketByUserId(io: Server, userId: string): Socket | null {
  let fallback: Socket | null = null;
  for (const [, s] of io.sockets.sockets) {
    if (s.userId === userId) {
      // Ưu tiên socket đang trong voice channel (multi-tab case)
      if ((s as any).currentVoiceChannel) return s;
      if (!fallback) fallback = s;
    }
  }
  return fallback;
}

async function removeFromVoice(io: Server, channelId: string, userId: string) {
  console.log(`[Voice] removeFromVoice: user=${userId}, channel=${channelId}`);
  const key = `voice:${channelId}`;
  const raw = await redis.get(key);
  if (!raw) return;

  const list = JSON.parse(raw) as VoiceMember[];
  const updated = list.filter((m) => m.userId !== userId);

  if (updated.length === 0) {
    await redis.del(key);
  } else {
    await redis.set(key, JSON.stringify(updated));
  }

  const channel = await Channel.findById(channelId).select('workspace');
  if (channel) {
    // Tell all clients to destroy the peer connection for this user
    io.to(`workspace:${channel.workspace}`).emit('voice_user_left', {
      userId,
      channelId,
    });
    // Then update the visible member list
    io.to(`workspace:${channel.workspace}`).emit('voice_channel_updated', {
      channelId,
      members: updated,
    });
  }
}

export const registerVoiceHandlers = (io: Server, socket: Socket) => {
  const { userId } = socket;

  socket.on('join_voice_channel', async ({ channelId }, callback) => {
    try {
      console.log(`[Voice] join_voice_channel: user=${userId}, channel=${channelId}`);
      const user = await User.findById(userId).select(
        'username displayName avatar'
      );
      if (!user) return callback?.({ error: 'User not found' });

      const member: VoiceMember = {
        userId: userId!,
        username: user.username,
        displayName: user.displayName || user.username,
        avatar: user.avatar || null,
        joinedAt: new Date().toISOString(),
        isMuted: false,
        isDeafened: false,
      };

      const key = `voice:${channelId}`;
      const raw = await redis.get(key);
      const list = raw ? (JSON.parse(raw) as VoiceMember[]) : [];

      // Tránh duplicate
      const filtered = list.filter((m) => m.userId !== userId);
      filtered.push(member);
      await redis.set(key, JSON.stringify(filtered));

      // Track để auto-remove khi disconnect
      (socket as any).currentVoiceChannel = channelId;

      const channel = await Channel.findById(channelId).select('workspace');
      if (channel) {
        // Đảm bảo socket đã join workspace room (F5 auto-rejoin có thể xảy ra
        // trước khi client gọi join_workspace → socket chưa ở workspace room
        // → sẽ không nhận được broadcast)
        socket.join(`workspace:${channel.workspace}`);

        // 1. Thông báo cho existing members tạo peer non-initiator
        socket.to(`workspace:${channel.workspace}`).emit('voice_user_joined', {
          userId: userId!,
          channelId,
        });

        // 2. Broadcast danh sách mới (bao gồm cả user vừa join, kèm existing members)
        console.log(`[Voice] Broadcasting voice_channel_updated to workspace:${channel.workspace}, members:`, filtered.map(m => m.username));
        io.to(`workspace:${channel.workspace}`).emit('voice_channel_updated', {
          channelId,
          members: filtered,
        });
      }

      callback?.({ success: true });
    } catch (err: any) {
      callback?.({ error: err.message });
    }
  });

  socket.on('leave_voice_channel', async ({ channelId }, callback) => {
    try {
      await removeFromVoice(io, channelId, userId!);
      (socket as any).currentVoiceChannel = null;
      callback?.({ success: true });
    } catch (err: any) {
      callback?.({ error: err.message });
    }
  });

  socket.on('toggle_mute', async ({ channelId, isMuted }, callback) => {
    try {
      const key = `voice:${channelId}`;
      const raw = await redis.get(key);
      if (!raw) return callback?.({ error: 'No voice members' });

      const list = JSON.parse(raw) as VoiceMember[];
      const member = list.find((m) => m.userId === userId);
      if (!member) return callback?.({ error: 'Not in voice channel' });

      member.isMuted = isMuted;
      await redis.set(key, JSON.stringify(list));

      const channel = await Channel.findById(channelId).select('workspace');
      if (channel) {
        io.to(`workspace:${channel.workspace}`).emit('voice_member_updated', {
          channelId,
          userId,
          isMuted,
        });
      }

      callback?.({ success: true });
    } catch (err: any) {
      callback?.({ error: err.message });
    }
  });

  socket.on('toggle_deafen', async ({ channelId, isDeafened }, callback) => {
    try {
      const key = `voice:${channelId}`;
      const raw = await redis.get(key);
      if (!raw) return callback?.({ error: 'No voice members' });

      const list = JSON.parse(raw) as VoiceMember[];
      const member = list.find((m) => m.userId === userId);
      if (!member) return callback?.({ error: 'Not in voice channel' });

      member.isDeafened = isDeafened;
      await redis.set(key, JSON.stringify(list));

      const channel = await Channel.findById(channelId).select('workspace');
      if (channel) {
        io.to(`workspace:${channel.workspace}`).emit('voice_member_updated', {
          channelId,
          userId,
          isDeafened,
        });
      }

      callback?.({ success: true });
    } catch (err: any) {
      callback?.({ error: err.message });
    }
  });

  // Relay WebRTC signaling giữa 2 peers
  socket.on('voice_signal', ({ to, signal }, callback) => {
    try {
      const targetSocket = findSocketByUserId(io, to);
      console.log(`[Voice] voice_signal: from=${userId} to=${to}, targetFound=${!!targetSocket}, signalType=${signal?.type || 'candidate'}`);
      if (!targetSocket) {
        return callback?.({ error: 'Target user not connected' });
      }

      targetSocket.emit('voice_signal', {
        from: userId!,
        signal,
      });

      callback?.({ success: true });
    } catch (err: any) {
      callback?.({ error: err.message });
    }
  });

  // Relay speaking indicator to all other users in the workspace
  socket.on('voice_speaking', async ({ channelId, isSpeaking }) => {
    try {
      const channel = await Channel.findById(channelId).select('workspace');
      if (channel) {
        socket.to(`workspace:${channel.workspace}`).emit('voice_speaking', {
          userId: userId!,
          channelId,
          isSpeaking,
        });
      }
    } catch (err: any) {
      console.warn('[Voice] voice_speaking error:', err.message);
    }
  });

  // Cập nhật mute status và broadcast
  socket.on('voice_mute', async ({ channelId, isMuted }, callback) => {
    try {
      const key = `voice:${channelId}`;
      const raw = await redis.get(key);
      if (!raw) return callback?.({ error: 'No voice members' });

      const list = JSON.parse(raw) as VoiceMember[];
      const updated = list.map((m) =>
        m.userId === userId! ? { ...m, isMuted } : m
      );
      await redis.set(key, JSON.stringify(updated));

      const channel = await Channel.findById(channelId).select('workspace');
      if (channel) {
        io.to(`workspace:${channel.workspace}`).emit('voice_channel_updated', {
          channelId,
          members: updated,
        });
      }

      callback?.({ success: true });
    } catch (err: any) {
      callback?.({ error: err.message });
    }
  });

  // ─── Admin: Force mute a user in voice ───
  socket.on('voice_force_mute', async ({ channelId, targetUserId, isMuted }, callback) => {
    try {
      // Verify caller is admin/owner
      const channel = await Channel.findById(channelId).select('workspace');
      if (!channel) return callback?.({ error: 'Channel not found' });

      const ws = await Workspace.findById(channel.workspace);
      if (!ws) return callback?.({ error: 'Workspace not found' });

      const callerMember = ws.members.find(m => m.user.toString() === userId);
      if (!callerMember || !['owner', 'admin'].includes(callerMember.role)) {
        return callback?.({ error: 'Không đủ quyền' });
      }

      // Update Redis
      const key = `voice:${channelId}`;
      const raw = await redis.get(key);
      if (!raw) return callback?.({ error: 'No voice members' });

      const list = JSON.parse(raw) as VoiceMember[];
      const updated = list.map((m) =>
        m.userId === targetUserId ? { ...m, isMuted } : m
      );
      await redis.set(key, JSON.stringify(updated));

      // Broadcast updated members
      io.to(`workspace:${channel.workspace}`).emit('voice_channel_updated', {
        channelId,
        members: updated,
      });

      // Notify target user privately
      const targetSocket = findSocketByUserId(io, targetUserId);
      if (targetSocket) {
        targetSocket.emit('voice_force_muted', { channelId, isMuted });
      }

      callback?.({ success: true });
    } catch (err: any) {
      callback?.({ error: err.message });
    }
  });

  // ─── Admin: Kick user from voice channel ───
  socket.on('voice_kick_user', async ({ channelId, targetUserId }, callback) => {
    try {
      // Verify caller is admin/owner
      const channel = await Channel.findById(channelId).select('workspace');
      if (!channel) return callback?.({ error: 'Channel not found' });

      const ws = await Workspace.findById(channel.workspace);
      if (!ws) return callback?.({ error: 'Workspace not found' });

      const callerMember = ws.members.find(m => m.user.toString() === userId);
      if (!callerMember || !['owner', 'admin'].includes(callerMember.role)) {
        return callback?.({ error: 'Không đủ quyền' });
      }

      // Remove from voice
      await removeFromVoice(io, channelId, targetUserId);

      // Clear target socket's currentVoiceChannel
      const targetSocket = findSocketByUserId(io, targetUserId);
      if (targetSocket) {
        (targetSocket as any).currentVoiceChannel = null;
        targetSocket.emit('voice_kicked', { channelId });
      }

      callback?.({ success: true });
    } catch (err: any) {
      callback?.({ error: err.message });
    }
  });
};

export { removeFromVoice };
