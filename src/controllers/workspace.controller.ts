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

export const updateWorkspace = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ws = await Workspace.findById(req.params.id);
    if (!ws) return sendError(res, 'NOT_FOUND', 'Workspace không tồn tại', 404);

    const member = ws.members.find(m => m.user.toString() === req.userId);
    if (!member || !['owner', 'admin'].includes(member.role))
      return sendError(res, 'FORBIDDEN', 'Không đủ quyền', 403);

    Object.assign(ws, req.body);
    await ws.save();
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

export const addMember = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ws = await Workspace.findById(req.params.id);
    if (!ws) return sendError(res, 'NOT_FOUND', 'Workspace không tồn tại', 404);

    const adminMember = ws.members.find(m => m.user.toString() === req.userId);
    if (!adminMember || !['owner', 'admin'].includes(adminMember.role))
      return sendError(res, 'FORBIDDEN', 'Không đủ quyền', 403);

    const { userId } = req.body;
    const alreadyMember = ws.members.some(m => m.user.toString() === userId);
    if (alreadyMember) return sendError(res, 'CONFLICT', 'Đã là member', 409);

    ws.members.push({ user: userId, role: 'member', joinedAt: new Date() });
    await ws.save();

    // Thêm vào tất cả public channels
    await Channel.updateMany(
      { workspace: ws._id, type: 'public' },
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

    const adminMember = ws.members.find(m => m.user.toString() === req.userId);
    if (!adminMember || !['owner', 'admin'].includes(adminMember.role))
      return sendError(res, 'FORBIDDEN', 'Không đủ quyền', 403);

    ws.members = ws.members.filter(m => m.user.toString() !== req.params.userId) as any;
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

    const alreadyMember = ws.members.some(m => m.user.toString() === req.userId);
    if (!alreadyMember) {
      ws.members.push({ user: req.userId as any, role: 'member', joinedAt: new Date() });
      await ws.save();

      await Channel.updateMany(
        { workspace: ws._id, type: 'public' },
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
