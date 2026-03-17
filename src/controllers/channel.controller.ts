import { Request, Response, NextFunction } from 'express';
import { Channel } from '../models/Channel';
import { Workspace } from '../models/Workspace';
import { Message } from '../models/Message';
import { sendSuccess, sendError } from '../utils/apiResponse';
import { generateChannelKey } from '../utils/encryption';
import { getIO } from '../socket/instance';

export const createChannel = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { workspaceId, name, type, description, encryptionEnabled } = req.body;

    // Validate type
    const validTypes = ['public', 'private', 'dm', 'voice'];
    if (type && !validTypes.includes(type)) {
      return sendError(res, 'VALIDATION_ERROR', 'Loại channel không hợp lệ', 400);
    }

    const ws = await Workspace.findById(workspaceId);
    if (!ws) return sendError(res, 'NOT_FOUND', 'Workspace không tồn tại', 404);

    const isMember = ws.members.some(m => m.user.toString() === req.userId);
    if (!isMember) return sendError(res, 'FORBIDDEN', 'Không phải member', 403);

    const channelData: any = {
      workspace: workspaceId,
      name,
      type: type || 'public',
      description,
      members: (type === 'public' || type === 'voice')
        ? ws.members.map(m => m.user)
        : [req.userId],
      createdBy: req.userId,
    };

    if (encryptionEnabled) {
      channelData.encryptionEnabled = true;
      channelData.encryptionKey = generateChannelKey();
    }

    const channel = await Channel.create(channelData);

    // Broadcast realtime cho tất cả user trong workspace
    try {
      const io = getIO();
      io.to(`workspace:${workspaceId}`).emit('channel_created', { channel });
    } catch {}

    sendSuccess(res, channel, 201);
  } catch (err) { next(err); }
};

export const getChannelsByWorkspace = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Auto-sync: đảm bảo user thuộc tất cả public + voice channels
    await Channel.updateMany(
      {
        workspace: req.params.workspaceId,
        type: { $in: ['public', 'voice'] },
        members: { $ne: req.userId },
      },
      { $addToSet: { members: req.userId } }
    );

    const channels = await Channel.find({
      workspace: req.params.workspaceId,
      members: req.userId,
    }).sort({ lastActivity: -1 });

    // Đếm unread (đơn giản: messages chưa có trong readBy)
    const result = await Promise.all(channels.map(async (ch) => {
      const unreadCount = await Message.countDocuments({
        channel: ch._id,
        sender: { $ne: req.userId },
        'readBy.user': { $ne: req.userId },
        isDeleted: false,
      });
      return { ...ch.toObject(), unreadCount };
    }));

    sendSuccess(res, result);
  } catch (err) { next(err); }
};

export const getChannelById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const channel = await Channel.findById(req.params.id);
    if (!channel) return sendError(res, 'NOT_FOUND', 'Channel không tồn tại', 404);

    const isMember = channel.members.some(m => m.toString() === req.userId);
    if (!isMember) return sendError(res, 'FORBIDDEN', 'Không phải member', 403);

    sendSuccess(res, channel);
  } catch (err) { next(err); }
};

export const getChannelMembers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const channel = await Channel.findById(req.params.id).populate('members', '_id username email avatar');
    if (!channel) return sendError(res, 'NOT_FOUND', 'Channel không tồn tại', 404);

    const isMember = channel.members.some((m: any) => (m._id || m).toString() === req.userId);
    if (!isMember) return sendError(res, 'FORBIDDEN', 'Không phải member', 403);

    const visibleMembers = (channel.members as any[]).filter((m: any) => {
      return m?.username !== 'AI-Assistant' && m?.email !== 'ai@chatapp.com';
    });

    sendSuccess(res, visibleMembers);
  } catch (err) { next(err); }
};

export const updateChannel = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const channel = await Channel.findById(req.params.id);
    if (!channel) return sendError(res, 'NOT_FOUND', 'Channel không tồn tại', 404);
    
    const ws = await Workspace.findById(channel.workspace);
    const member = ws?.members.find(m => {
      const uid = (m.user as any)?._id?.toString() || m.user.toString();
      return uid === req.userId;
    });
    
    // An admin, owner, or the exact creator can edit
    const isAdminOrOwner = member && ['admin', 'owner'].includes(member.role);
    const creatorId = (channel.createdBy as any)?._id?.toString() || channel.createdBy.toString();
    
    if (creatorId !== req.userId && !isAdminOrOwner) {
      return sendError(res, 'FORBIDDEN', 'Chỉ người tạo hoặc quản trị viên mới được sửa', 403);
    }

    Object.assign(channel, req.body);
    await channel.save();

    // Broadcast realtime
    try {
      const io = getIO();
      io.to(`workspace:${channel.workspace}`).emit('channel_updated', { channel });
    } catch {}

    sendSuccess(res, channel);
  } catch (err) { next(err); }
};

export const deleteChannel = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const channel = await Channel.findById(req.params.id);
    if (!channel) return sendError(res, 'NOT_FOUND', 'Channel không tồn tại', 404);
    
    const ws = await Workspace.findById(channel.workspace);
    const member = ws?.members.find(m => {
      const uid = (m.user as any)?._id?.toString() || m.user.toString();
      return uid === req.userId;
    });
    
    // An admin, owner, or the exact creator can delete
    const isAdminOrOwner = member && ['admin', 'owner'].includes(member.role);
    const creatorId = (channel.createdBy as any)?._id?.toString() || channel.createdBy.toString();
    
    if (creatorId !== req.userId && !isAdminOrOwner) {
      return sendError(res, 'FORBIDDEN', 'Chỉ người tạo hoặc quản trị viên mới được xóa', 403);
    }

    await Message.deleteMany({ channel: channel._id });
    const workspaceId = channel.workspace;
    await channel.deleteOne();

    // Broadcast realtime
    try {
      const io = getIO();
      io.to(`workspace:${workspaceId}`).emit('channel_deleted', { channelId: req.params.id });
    } catch {}

    sendSuccess(res, null);
  } catch (err) { next(err); }
};

export const createOrGetDM = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { workspaceId, targetUserId } = req.body;

    // Tìm DM channel đã tồn tại
    const existing = await Channel.findOne({
      workspace: workspaceId,
      type: 'dm',
      dmUsers: { $all: [req.userId, targetUserId], $size: 2 },
    });

    if (existing) return sendSuccess(res, existing);

    const channel = await Channel.create({
      workspace: workspaceId,
      name: `dm-${Date.now()}`,
      type: 'dm',
      members: [req.userId, targetUserId],
      dmUsers: [req.userId, targetUserId],
      createdBy: req.userId,
    });

    sendSuccess(res, channel, 201);
  } catch (err) { next(err); }
};

export const getChannelKey = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const channel = await Channel.findOne(
      { _id: req.params.id, members: req.userId },
      '+encryptionKey'
    );
    if (!channel?.encryptionKey)
      return sendError(res, 'NOT_FOUND', 'Channel không có encryption key', 404);

    sendSuccess(res, { key: channel.encryptionKey });
  } catch (err) { next(err); }
};
