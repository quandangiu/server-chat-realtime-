import { Request, Response, NextFunction } from 'express';
import { Message } from '../models/Message';
import { Channel } from '../models/Channel';
import { Workspace } from '../models/Workspace';
import { User } from '../models/User';
import { sendSuccess, sendError } from '../utils/apiResponse';
import { encryptMessage, decryptMessage } from '../utils/encryption';
import { getIO } from '../socket/instance';

export const getMessages = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { channelId } = req.params;
    const { cursor, limit = 50 } = req.query;

    const isMember = await Channel.exists({ _id: channelId, members: req.userId });
    if (!isMember) return sendError(res, 'FORBIDDEN', 'Không phải member', 403);

    const query: any = { channel: channelId, isDeleted: false };
    if (cursor) query._id = { $lt: cursor };

    const messages = await Message
      .find(query)
      .sort({ _id: -1 })
      .limit(Number(limit) + 1)
      .populate('sender', 'username avatar displayName')
      .populate({
        path: 'replyTo',
        select: 'content sender',
        populate: { path: 'sender', select: 'username' }
      });

    const hasMore = messages.length > Number(limit);
    if (hasMore) messages.pop();

    const nextCursor = hasMore ? messages[messages.length - 1]._id : null;

    // Lọc bỏ messages có sender bị null (user đã bị xóa)
    const validMessages = messages.filter(msg => msg.sender != null);

    // Helper: convert reactions Map to plain object
    const convertReactions = (reactions: Map<string, any> | undefined): Record<string, string[]> => {
      if (!reactions || !(reactions instanceof Map)) return {};
      const obj: Record<string, string[]> = {};
      reactions.forEach((userIds, emoji) => {
        obj[emoji] = userIds.map((id: any) => id.toString());
      });
      return obj;
    };

    // Decrypt nếu channel có encryption
    const channel = await Channel.findById(channelId).select('+encryptionKey');
    let result = validMessages.reverse();
    if (channel?.encryptionEnabled && channel.encryptionKey) {
      result = result.map(msg => {
        const obj = msg.toObject();
        try {
          obj.content = decryptMessage(obj.content, channel.encryptionKey);
        } catch { /* giữ nguyên nếu decrypt fail */ }
        // Nếu replyTo đã bị xóa, set null thay vì để object rỗng
        if (obj.replyTo && !(obj.replyTo as any).content) (obj as any).replyTo = null;
        // Convert reactions Map to Object
        (obj as any).reactions = convertReactions(msg.reactions);
        return obj;
      }) as any;
    } else {
      result = result.map(msg => {
        const obj = msg.toObject();
        if (obj.replyTo && !(obj.replyTo as any).content) (obj as any).replyTo = null;
        // Convert reactions Map to Object
        (obj as any).reactions = convertReactions(msg.reactions);
        return obj;
      }) as any;
    }

    sendSuccess(res, { messages: result, nextCursor, hasMore });
  } catch (err) { next(err); }
};

export const sendMessage = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { channelId } = req.params;
    const { content, type, replyTo, attachment } = req.body;

    const channel = await Channel.findOne({ _id: channelId, members: req.userId }).select('+encryptionKey');
    if (!channel) return sendError(res, 'FORBIDDEN', 'Không phải member', 403);

    let finalContent = content;
    if (channel.encryptionEnabled && channel.encryptionKey && content) {
      finalContent = encryptMessage(content, channel.encryptionKey);
    }

    const message = await Message.create({
      channel: channelId,
      sender: req.userId,
      content: finalContent,
      type: type || 'text',
      replyTo: replyTo || null,
      attachment,
    });

    await message.populate('sender', 'username avatar displayName');
    if (message.replyTo) await message.populate('replyTo', 'content sender');

    await Channel.findByIdAndUpdate(channelId, {
      lastMessage: message._id,
      lastActivity: new Date(),
    });

    // Trả về content đã decrypt cho người gửi
    const result = message.toObject();
    result.content = content; // original plaintext

    sendSuccess(res, result, 201);
  } catch (err) { next(err); }
};

export const updateMessage = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const message = await Message.findById(req.params.id);
    if (!message) return sendError(res, 'NOT_FOUND', 'Message không tồn tại', 404);
    if (message.sender.toString() !== req.userId)
      return sendError(res, 'FORBIDDEN', 'Chỉ người gửi mới được sửa', 403);

    message.content = req.body.content;
    message.isEdited = true;
    message.editedAt = new Date();
    await message.save();

    // Broadcast realtime
    try {
      const io = getIO();
      io.to(`channel:${message.channel}`).emit('message_updated', {
        messageId: message._id,
        content: message.content,
        isEdited: true,
        editedAt: message.editedAt,
      });
    } catch {}

    sendSuccess(res, message);
  } catch (err) { next(err); }
};

export const deleteMessage = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const message = await Message.findById(req.params.id);
    if (!message) return sendError(res, 'NOT_FOUND', 'Message không tồn tại', 404);

    const channel = await Channel.findById(message.channel).select('workspace members');
    if (!channel) return sendError(res, 'NOT_FOUND', 'Channel không tồn tại', 404);

    const isMember = channel.members.some((m: any) => String(m) === req.userId);
    if (!isMember) return sendError(res, 'FORBIDDEN', 'Không phải member của channel', 403);

    const workspace = await Workspace.findById(channel.workspace).select('members');
    const memberRole = workspace?.members.find((m: any) => {
      const uid = (m.user as any)?._id?.toString() || m.user?.toString();
      return uid === req.userId;
    })?.role;

    const isOwnerOrAdmin = memberRole === 'owner' || memberRole === 'admin';
    const isOwnMessage = message.sender.toString() === req.userId;

    if (!isOwnerOrAdmin && !isOwnMessage) {
      return sendError(res, 'FORBIDDEN', 'Member chỉ được xóa tin nhắn của mình', 403);
    }

    const originalContent = String(message.content || '').trim().toLowerCase();

    message.isDeleted = true;
    message.content = '';
    await message.save();

    const deletedMessageIds = [String(message._id)];

    const isAICommandMessage = originalContent.startsWith('@ai');

    if (isAICommandMessage) {
      const linked = await Message.findOne({
        aiCommandOf: message._id,
        isDeleted: false,
      });

      let aiReply = linked;
      if (!aiReply) {
        const aiUser = await User.findOne({ username: 'AI-Assistant' }).select('_id');
        if (aiUser) {
          const msgCreatedAt = new Date((message as any).createdAt || Date.now());
          const upperWindow = new Date(msgCreatedAt.getTime() + 10 * 60 * 1000);
          aiReply = await Message.findOne({
            channel: message.channel,
            sender: aiUser._id,
            type: 'system',
            isDeleted: false,
            createdAt: { $gte: msgCreatedAt, $lte: upperWindow },
            content: { $regex: /^\[AI Support\]/i },
          }).sort({ createdAt: 1 });
        }
      }

      if (aiReply) {
        aiReply.isDeleted = true;
        aiReply.content = '';
        await aiReply.save();
        deletedMessageIds.push(String(aiReply._id));
      }
    }

    // Broadcast realtime
    try {
      const io = getIO();
      for (const messageId of deletedMessageIds) {
        io.to(`channel:${message.channel}`).emit('message_deleted', {
          messageId,
          channelId: String(message.channel),
        });
      }
    } catch {}

    sendSuccess(res, null);
  } catch (err) { next(err); }
};

export const toggleReaction = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { emoji, action } = req.body;
    const message = await Message.findById(req.params.id);
    if (!message) return sendError(res, 'NOT_FOUND', 'Message không tồn tại', 404);

    const reactions = message.reactions || new Map();
    const users = reactions.get(emoji) || [];

    if (action === 'add') {
      if (!users.some((u: any) => u.toString() === req.userId)) {
        users.push(req.userId as any);
      }
    } else {
      const idx = users.findIndex((u: any) => u.toString() === req.userId);
      if (idx > -1) users.splice(idx, 1);
    }

    if (users.length === 0) {
      reactions.delete(emoji);
    } else {
      reactions.set(emoji, users);
    }

    message.reactions = reactions;
    await message.save();

    // Convert Map to plain object for response
    const reactionsObj: Record<string, string[]> = {};
    reactions.forEach((val: any, key: string) => {
      reactionsObj[key] = val.map((v: any) => v.toString());
    });

    // Broadcast realtime
    try {
      const io = getIO();
      io.to(`channel:${message.channel}`).emit('reaction_updated', {
        messageId: message._id,
        channelId: message.channel,
        reactions: reactionsObj,
      });
    } catch {}

    sendSuccess(res, { reactions: reactionsObj });
  } catch (err) { next(err); }
};

export const searchMessages = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { q, channelId } = req.query;
    if (!q) return sendSuccess(res, []);

    const query: any = { $text: { $search: q as string }, isDeleted: false };
    if (channelId) query.channel = channelId;

    const messages = await Message.find(query)
      .sort({ score: { $meta: 'textScore' } })
      .limit(20)
      .populate('sender', 'username avatar displayName');

    sendSuccess(res, messages);
  } catch (err) { next(err); }
};
