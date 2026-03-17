import { Server, Socket } from 'socket.io';
import { Message } from '../../models/Message';
import { Channel } from '../../models/Channel';
import { handleAIMessage } from './ai.handler';

export const registerMessageHandlers = (io: Server, socket: Socket) => {
  const { userId } = socket;

  socket.on('send_message', async (data, callback) => {
    try {
      const { channelId, content, type, replyTo, attachment } = data;

      const channel = await Channel.findOne({ _id: channelId, members: userId });
      if (!channel) return callback?.({ error: 'Not a member' });

      const message = await Message.create({
        channel: channelId,
        sender: userId,
        content, type,
        replyTo: replyTo || null,
        attachment,
      });

      await message.populate('sender', 'username avatar displayName');
      if (message.replyTo) {
        await message.populate({
          path: 'replyTo',
          select: 'content sender',
          populate: { path: 'sender', select: 'username' }
        });
      }

      await Channel.findByIdAndUpdate(channelId, {
        lastMessage: message._id,
        lastActivity: new Date(),
      });

      io.to(`channel:${channelId}`).emit('new_message', { message });

      void handleAIMessage({
        io,
        channelId,
        workspaceId: String(channel.workspace),
        senderId: userId,
        content: content || '',
        sourceMessageId: String(message._id),
      }).catch((error) => {
        console.error('AI handler error:', error);
      });

      callback?.({ success: true, message });
    } catch (err: any) {
      callback?.({ error: err.message });
    }
  });

  socket.on('typing_start', ({ channelId }) => {
    try {
      socket.to(`channel:${channelId}`).emit('user_typing', {
        userId, username: '', channelId,
      });
    } catch (err) {
      console.error('❌ Error in typing_start:', err);
    }
  });

  socket.on('typing_stop', ({ channelId }) => {
    try {
      socket.to(`channel:${channelId}`).emit('user_stop_typing', { userId, channelId });
    } catch (err) {
      console.error('❌ Error in typing_stop:', err);
    }
  });

  socket.on('mark_read', async ({ channelId, messageId }) => {
    try {
      await Message.updateMany(
        { channel: channelId, _id: { $lte: messageId }, 'readBy.user': { $ne: userId } },
        { $push: { readBy: { user: userId } } }
      );
      io.to(`channel:${channelId}`).emit('messages_read', {
        userId, channelId, lastReadMessageId: messageId,
      });
    } catch (err) {
      console.error('❌ Error in mark_read:', err);
    }
  });
};
