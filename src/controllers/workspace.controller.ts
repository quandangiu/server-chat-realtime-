import { Request, Response, NextFunction } from 'express';
import { Workspace } from '../models/Workspace';
import { Channel } from '../models/Channel';
import { sendSuccess, sendError } from '../utils/apiResponse';
import { getIO } from '../socket/instance';

export const createWorkspace = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, description } = req.body;

    const ws = await Workspace.create({
      name,
      description,
      owner: req.userId,
      members: [{ user: req.userId, role: 'owner' }],
    });

    // Tạo channel #general mặc định
    await Channel.create({
      workspace: ws._id,
      name: 'general',
      type: 'public',
      description: 'Channel chung',
      members: [req.userId],
      createdBy: req.userId,
    });

    sendSuccess(res, ws, 201);
  } catch (err) { next(err); }
};

export const getMyWorkspaces = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workspaces = await Workspace.find({ 'members.user': req.userId })
      .populate('members.user', 'username avatar displayName status');
    sendSuccess(res, workspaces);
  } catch (err) { next(err); }
};

export const getWorkspaceById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ws = await Workspace.findById(req.params.id)
      .populate('members.user', 'username avatar displayName status');
    if (!ws) return sendError(res, 'NOT_FOUND', 'Workspace không tồn tại', 404);

    const isMember = ws.members.some(m => m.user && (m.user as any)._id?.toString() === req.userId);
    if (!isMember) return sendError(res, 'FORBIDDEN', 'Không phải member', 403);

    sendSuccess(res, ws);
  } catch (err) { next(err); }
};

export const uploadAvatar = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ws = await Workspace.findById(req.params.id);
    if (!ws) {
      console.error('[AvatarUpload] Workspace not found:', req.params.id);
      return sendError(res, 'NOT_FOUND', 'Workspace không tồn tại', 404);
    }

    const member = ws.members.find(m => {
      const uid = (m.user as any)?._id?.toString() || m.user.toString();
      return uid === req.userId;
    });
    if (!member || !['owner', 'admin'].includes(member.role)) {
      console.error('[AvatarUpload] Permission denied for user:', req.userId);
      return sendError(res, 'FORBIDDEN', 'Không đủ quyền', 403);
    }

    if (!req.file) {
      console.error('[AvatarUpload] No file received in req.file');
      return sendError(res, 'BAD_REQUEST', 'Vui lòng chọn ảnh', 400);
    }

    const avatarUrl = (req.file as any).path;
    console.log('[AvatarUpload] Successfully uploaded to Cloudinary, URL:', avatarUrl);
    ws.avatar = avatarUrl;
    await ws.save();

    try {
      const io = getIO();
      io.to(`workspace:${ws._id}`).emit('workspace_updated', ws);
    } catch {}

    sendSuccess(res, ws);
  } catch (err: any) { 
    console.error('[AvatarUpload] Fatal Error:', err.message, err.stack);
    next(err); 
  }
};

export const updateWorkspace = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ws = await Workspace.findById(req.params.id);
    if (!ws) return sendError(res, 'NOT_FOUND', 'Workspace không tồn tại', 404);

    const member = ws.members.find(m => {
      const uid = (m.user as any)?._id?.toString() || m.user.toString();
      return uid === req.userId;
    });
    if (!member || !['owner', 'admin'].includes(member.role))
      return sendError(res, 'FORBIDDEN', 'Không đủ quyền', 403);

    Object.assign(ws, req.body);
    await ws.save();

    try {
      const io = getIO();
      io.to(`workspace:${ws._id}`).emit('workspace_updated', ws);
    } catch {}

    sendSuccess(res, ws);
  } catch (err) { next(err); }
};

export const deleteWorkspace = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ws = await Workspace.findById(req.params.id);
    if (!ws) return sendError(res, 'NOT_FOUND', 'Workspace không tồn tại', 404);
    if (ws.owner.toString() !== req.userId)
      return sendError(res, 'FORBIDDEN', 'Chỉ owner mới được xóa', 403);

    await Channel.deleteMany({ workspace: ws._id });
    await ws.deleteOne();
    sendSuccess(res, null);
  } catch (err) { next(err); }
};

export const updateMemberRole = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ws = await Workspace.findById(req.params.id);
    if (!ws) return sendError(res, 'NOT_FOUND', 'Workspace không tồn tại', 404);

    const adminMember = ws.members.find(m => {
      const uid = (m.user as any)?._id?.toString() || m.user.toString();
      return uid === req.userId;
    });
    if (!adminMember || !['owner', 'admin'].includes(adminMember.role))
      return sendError(res, 'FORBIDDEN', 'Không đủ quyền', 403);

    const { role } = req.body;
    if (!['owner', 'admin', 'member'].includes(role))
      return sendError(res, 'BAD_REQUEST', 'Role không hợp lệ', 400);

    const targetUserId = req.params.userId;
    const targetMember = ws.members.find(m => {
      const uid = (m.user as any)?._id?.toString() || m.user.toString();
      return uid === targetUserId;
    });

    if (!targetMember)
      return sendError(res, 'NOT_FOUND', 'Thành viên không nằm trong workspace', 404);

    // Only owner can assign owner roles
    if (role === 'owner' && adminMember.role !== 'owner') {
      return sendError(res, 'FORBIDDEN', 'Chỉ owner mới có thể cấp quyền owner', 403);
    }
    
    // Only owner can demote/promote another admin or owner
    if (targetMember.role !== 'member' && adminMember.role !== 'owner' && targetUserId !== req.userId) {
       return sendError(res, 'FORBIDDEN', 'Chỉ owner mới có thể thay đổi quyền của owner/admin khác', 403);
    }

    targetMember.role = role;
    await ws.save();

    try {
      const io = getIO();
      io.to(`workspace:${ws._id}`).emit('member_role_updated', {
        workspaceId: ws._id,
        userId: targetUserId,
        role
      });
      io.to(`workspace:${ws._id}`).emit('workspace_updated', ws);
    } catch {}

    sendSuccess(res, ws);
  } catch (err) { next(err); }
};

export const addMember = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ws = await Workspace.findById(req.params.id);
    if (!ws) return sendError(res, 'NOT_FOUND', 'Workspace không tồn tại', 404);

    const adminMember = ws.members.find(m => {
      const uid = (m.user as any)?._id?.toString() || m.user.toString();
      return uid === req.userId;
    });
    if (!adminMember || !['owner', 'admin'].includes(adminMember.role))
      return sendError(res, 'FORBIDDEN', 'Không đủ quyền', 403);

    const { userId } = req.body;
    const alreadyMember = ws.members.some(m => {
      const uid = (m.user as any)?._id?.toString() || m.user.toString();
      return uid === userId;
    });
    if (alreadyMember) return sendError(res, 'CONFLICT', 'Đã là member', 409);

    ws.members.push({ user: userId, role: 'member', joinedAt: new Date() });
    await ws.save();

    // Thêm vào tất cả public + voice channels
    await Channel.updateMany(
      { workspace: ws._id, type: { $in: ['public', 'voice'] } },
      { $addToSet: { members: userId } }
    );

    // Broadcast realtime
    try {
      const io = getIO();
      io.to(`workspace:${ws._id}`).emit('workspace_member_added', {
        workspaceId: ws._id,
        userId,
      });
    } catch {}

    sendSuccess(res, ws);
  } catch (err) { next(err); }
};

export const removeMember = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ws = await Workspace.findById(req.params.id);
    if (!ws) return sendError(res, 'NOT_FOUND', 'Workspace không tồn tại', 404);

    const adminMember = ws.members.find(m => {
      const uid = (m.user as any)?._id?.toString() || m.user.toString();
      return uid === req.userId;
    });
    if (!adminMember || !['owner', 'admin'].includes(adminMember.role))
      return sendError(res, 'FORBIDDEN', 'Không đủ quyền', 403);

    ws.members = ws.members.filter(m => {
      const uid = (m.user as any)?._id?.toString() || m.user.toString();
      return uid !== req.params.userId;
    }) as any;
    await ws.save();

    await Channel.updateMany(
      { workspace: ws._id },
      { $pull: { members: req.params.userId } }
    );

    // Broadcast realtime
    try {
      const io = getIO();
      io.to(`workspace:${ws._id}`).emit('workspace_member_removed', {
        workspaceId: ws._id,
        userId: req.params.userId,
      });
      // Kick user's socket khỏi workspace room
      io.to(`user:${req.params.userId}`).emit('workspace_kicked', {
        workspaceId: ws._id,
      });
    } catch {}

    sendSuccess(res, null);
  } catch (err) { next(err); }
};

export const joinByInvite = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ws = await Workspace.findOne({ inviteCode: req.params.inviteCode });
    if (!ws) return sendError(res, 'NOT_FOUND', 'Invite code không hợp lệ', 404);

    const alreadyMember = ws.members.some(m => {
      const uid = (m.user as any)?._id?.toString() || m.user.toString();
      return uid === req.userId;
    });
    if (!alreadyMember) {
      ws.members.push({ user: req.userId as any, role: 'member', joinedAt: new Date() });
      await ws.save();

      await Channel.updateMany(
        { workspace: ws._id, type: { $in: ['public', 'voice'] } },
        { $addToSet: { members: req.userId } }
      );

      // Broadcast realtime
      try {
        const io = getIO();
        io.to(`workspace:${ws._id}`).emit('workspace_member_added', {
          workspaceId: ws._id,
          userId: req.userId,
        });
      } catch {}
    }

    sendSuccess(res, ws);
  } catch (err) { next(err); }
};
