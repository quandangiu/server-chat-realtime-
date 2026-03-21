import { Request, Response, NextFunction } from 'express';
import { Task } from '../models/Task';
import { Channel } from '../models/Channel';
import { Workspace } from '../models/Workspace';
import { sendError, sendSuccess } from '../utils/apiResponse';
import { getIO } from '../socket/instance';

const canAccessChannel = async (channelId: string, userId: string) => {
  return Channel.exists({ _id: channelId, members: userId });
};

const canAccessWorkspace = async (workspaceId: string, userId: string) => {
  return Workspace.exists({ _id: workspaceId, 'members.user': userId });
};

const getWorkspaceRole = async (workspaceId: string, userId: string) => {
  const ws = await Workspace.findById(workspaceId).select('members');
  if (!ws) return null;

  const member = ws.members.find((m: any) => {
    const uid = (m.user as any)?._id?.toString() || m.user?.toString();
    return uid === userId;
  });
  return member?.role || null;
};

const isAdminOrOwner = async (workspaceId: string, userId: string) => {
  const role = await getWorkspaceRole(workspaceId, userId);
  return role === 'admin' || role === 'owner';
};

const emitTaskUpdated = (task: any) => {
  try {
    const io = getIO();
    io.to(`channel:${task.channel}`).emit('task_updated', { task });
    io.to(`workspace:${task.workspace}`).emit('task_updated', { task });
  } catch {}
};

export const createTask = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      workspaceId,
      channelId,
      taskType,
      title,
      description,
      priority,
      assignee,
      dueDate,
      sourceMessage,
      eventAt,
      location,
      pollQuestion,
      pollOptions,
      pollExpiresAt,
      pollAnonymous,
      pollMultiChoice,
    } = req.body;

    const normalizedType = taskType || 'work';
    const normalizedTitle = (title || pollQuestion || '').trim();
    if (!normalizedTitle) return sendError(res, 'VALIDATION_ERROR', 'Title là bắt buộc', 400);

    const hasChannelAccess = await canAccessChannel(channelId, String(req.userId));
    if (!hasChannelAccess) return sendError(res, 'FORBIDDEN', 'Không phải member của channel', 403);

    if (normalizedType === 'work') {
      const allowed = await isAdminOrOwner(String(workspaceId), String(req.userId));
      if (!allowed) {
        return sendError(res, 'FORBIDDEN', 'Chỉ admin/owner mới được tạo Work task', 403);
      }
    }

    const task = await Task.create({
      taskType: normalizedType,
      workspace: workspaceId,
      channel: channelId,
      sourceMessage: sourceMessage || null,
      title: normalizedTitle,
      description: (description || '').trim(),
      priority: priority || 'medium',
      assignee: assignee || null,
      createdBy: req.userId,
      dueDate: dueDate ? new Date(dueDate) : null,
      eventAt: eventAt ? new Date(eventAt) : null,
      location: (location || '').trim(),
      pollQuestion: (pollQuestion || '').trim(),
      pollOptions: Array.isArray(pollOptions)
        ? pollOptions
            .map((option: string) => ({ option: String(option || '').trim(), votes: [] }))
            .filter((item: any) => item.option.length > 0)
        : [],
      pollExpiresAt: pollExpiresAt ? new Date(pollExpiresAt) : null,
      pollAnonymous: !!pollAnonymous,
      pollMultiChoice: !!pollMultiChoice,
    });

    await task.populate('assignee', 'username avatar displayName');
    await task.populate('createdBy', 'username avatar displayName');

    try {
      const io = getIO();
      io.to(`channel:${channelId}`).emit('task_created', { task });
      io.to(`workspace:${workspaceId}`).emit('task_created', { task });
    } catch {}

    sendSuccess(res, task, 201);
  } catch (err) { next(err); }
};

export const getTasksByChannel = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { channelId } = req.params;
    const { status } = req.query;

    const hasAccess = await canAccessChannel(channelId, String(req.userId));
    if (!hasAccess) return sendError(res, 'FORBIDDEN', 'Không phải member của channel', 403);

    const query: any = { channel: channelId };
    if (status) query.status = status;

    const tasks = await Task.find(query)
      .sort({ createdAt: -1 })
      .populate('assignee', 'username avatar displayName')
      .populate('createdBy', 'username avatar displayName');

    sendSuccess(res, tasks);
  } catch (err) { next(err); }
};

export const getTasksByWorkspace = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { workspaceId } = req.params;
    const hasAccess = await canAccessWorkspace(workspaceId, String(req.userId));
    if (!hasAccess) return sendError(res, 'FORBIDDEN', 'Không phải member của workspace', 403);

    const tasks = await Task.find({ workspace: workspaceId })
      .sort({ createdAt: -1 })
      .limit(300)
      .populate('assignee', 'username avatar displayName')
      .populate('createdBy', 'username avatar displayName');

    sendSuccess(res, tasks);
  } catch (err) { next(err); }
};

export const updateTask = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return sendError(res, 'NOT_FOUND', 'Task không tồn tại', 404);

    const userId = String(req.userId);
    const hasAccess = await canAccessWorkspace(String(task.workspace), userId);
    if (!hasAccess) return sendError(res, 'FORBIDDEN', 'Không có quyền cập nhật task', 403);

    const canManageAllWorkTasks = await isAdminOrOwner(String(task.workspace), userId);
    const isOwnWorkTask = !!task.assignee && String(task.assignee) === userId;

    // Work task: member chỉ được sửa task của chính mình (assignee)
    if (task.taskType === 'work' && !canManageAllWorkTasks && !isOwnWorkTask) {
      return sendError(res, 'FORBIDDEN', 'Member chỉ được sửa Work task của chính mình', 403);
    }

    const patch = req.body || {};
    if (typeof patch.title === 'string') task.title = patch.title.trim();
    if (typeof patch.description === 'string') task.description = patch.description.trim();
    if (typeof patch.status === 'string') {
      task.status = patch.status;
      task.completedAt = patch.status === 'done' ? new Date() : null;
    }
    if (typeof patch.priority === 'string') task.priority = patch.priority;
    if ('assignee' in patch) {
      if (task.taskType === 'work') {
        if (!canManageAllWorkTasks) {
          return sendError(res, 'FORBIDDEN', 'Chỉ admin/owner mới được assign Work task', 403);
        }
      }
      task.assignee = patch.assignee || null;
    }
    if ('dueDate' in patch) task.dueDate = patch.dueDate ? new Date(patch.dueDate) : null;

    await task.save();
    await task.populate('assignee', 'username avatar displayName');
    await task.populate('createdBy', 'username avatar displayName');

    emitTaskUpdated(task);

    sendSuccess(res, task);
  } catch (err) { next(err); }
};

export const deleteTask = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return sendError(res, 'NOT_FOUND', 'Task không tồn tại', 404);

    const userId = String(req.userId);
    const hasAccess = await canAccessWorkspace(String(task.workspace), userId);
    if (!hasAccess) return sendError(res, 'FORBIDDEN', 'Không có quyền xóa task', 403);

    const role = await getWorkspaceRole(String(task.workspace), userId);
    const canManageWork = role === 'admin' || role === 'owner';

    if (task.taskType === 'work' && !canManageWork) {
      return sendError(res, 'FORBIDDEN', 'Work task chỉ admin/owner mới có thể xóa', 403);
    }

    await task.deleteOne();

    try {
      const io = getIO();
      io.to(`channel:${task.channel}`).emit('task_deleted', {
        taskId: req.params.id,
        channelId: String(task.channel),
        workspaceId: String(task.workspace),
      });
      io.to(`workspace:${task.workspace}`).emit('task_deleted', {
        taskId: req.params.id,
        channelId: String(task.channel),
        workspaceId: String(task.workspace),
      });
    } catch {}

    sendSuccess(res, null);
  } catch (err) { next(err); }
};

export const claimTask = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return sendError(res, 'NOT_FOUND', 'Task không tồn tại', 404);
    if (task.taskType !== 'work') return sendError(res, 'VALIDATION_ERROR', 'Chỉ Work task mới có thể nhận', 400);

    const userId = String(req.userId);
    const hasAccess = await canAccessWorkspace(String(task.workspace), userId);
    if (!hasAccess) return sendError(res, 'FORBIDDEN', 'Không có quyền nhận task', 403);

    if (task.assignee && String(task.assignee) !== userId) {
      return sendError(res, 'CONFLICT', 'Task đã có người nhận', 409);
    }

    task.assignee = req.userId as any;
    if (task.status === 'todo') task.status = 'in_progress';
    await task.save();
    await task.populate('assignee', 'username avatar displayName');
    await task.populate('createdBy', 'username avatar displayName');

    emitTaskUpdated(task);
    sendSuccess(res, task);
  } catch (err) { next(err); }
};

export const voteTask = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { optionIndex } = req.body;
    const first = await Task.findById(req.params.id);
    if (!first) return sendError(res, 'NOT_FOUND', 'Task không tồn tại', 404);
    if (first.taskType !== 'poll') return sendError(res, 'VALIDATION_ERROR', 'Chỉ Poll task mới có thể vote', 400);

    const userId = String(req.userId);
    const hasAccess = await canAccessWorkspace(String(first.workspace), userId);
    if (!hasAccess) return sendError(res, 'FORBIDDEN', 'Không có quyền vote', 403);

    const idx = Number(optionIndex);
    const maxAttempts = 3;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const task = attempt === 0 ? first : await Task.findById(req.params.id);
      if (!task) return sendError(res, 'NOT_FOUND', 'Task không tồn tại', 404);

      if (task.pollExpiresAt && task.pollExpiresAt.getTime() < Date.now()) {
        return sendError(res, 'CONFLICT', 'Poll đã hết hạn', 409);
      }

      if (!Number.isInteger(idx) || idx < 0 || idx >= (task.pollOptions?.length || 0)) {
        return sendError(res, 'VALIDATION_ERROR', 'Lựa chọn không hợp lệ', 400);
      }

      const oid = String(req.userId);
      task.pollOptions = (task.pollOptions || []).map((opt, i) => {
        let votes = (opt.votes || []).map((v) => String(v));
        if (!task.pollMultiChoice || i === idx) {
          votes = votes.filter((v) => v !== oid);
        }
        return {
          option: opt.option,
          votes: votes as any,
        };
      }) as any;

      const pollOptions = task.pollOptions || [];
      const selected = pollOptions[idx];
      const selectedVotes = (selected.votes || []).map((v: any) => String(v));
      const alreadyVoted = selectedVotes.includes(oid);
      if (!alreadyVoted) {
        selected.votes = [...(selected.votes || []), req.userId as any] as any;
      }

      try {
        await task.save();
        await task.populate('assignee', 'username avatar displayName');
        await task.populate('createdBy', 'username avatar displayName');
        emitTaskUpdated(task);
        return sendSuccess(res, task);
      } catch (error: any) {
        if (error?.name === 'VersionError' && attempt < maxAttempts - 1) {
          continue;
        }
        if (error?.name === 'VersionError') {
          return sendError(res, 'CONFLICT', 'Poll đang được cập nhật, vui lòng thử lại', 409);
        }
        throw error;
      }
    }
  } catch (err) { next(err); }
};

export const rsvpTask = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { response } = req.body;
    if (!['going', 'maybe', 'declined'].includes(response)) {
      return sendError(res, 'VALIDATION_ERROR', 'RSVP không hợp lệ', 400);
    }

    const task = await Task.findById(req.params.id);
    if (!task) return sendError(res, 'NOT_FOUND', 'Task không tồn tại', 404);
    if (task.taskType !== 'event') return sendError(res, 'VALIDATION_ERROR', 'Chỉ Event task mới có RSVP', 400);

    const userId = String(req.userId);
    const hasAccess = await canAccessWorkspace(String(task.workspace), userId);
    if (!hasAccess) return sendError(res, 'FORBIDDEN', 'Không có quyền RSVP', 403);

    const list = Array.isArray(task.eventRsvps) ? task.eventRsvps : [];
    const existing = list.find((item: any) => String(item.user) === userId);
    if (existing) {
      existing.response = response;
    } else {
      list.push({ user: req.userId as any, response } as any);
    }
    (task as any).eventRsvps = list;

    await task.save();
    await task.populate('assignee', 'username avatar displayName');
    await task.populate('createdBy', 'username avatar displayName');

    emitTaskUpdated(task);
    sendSuccess(res, task);
  } catch (err) { next(err); }
};

export const getMyTaskSummary = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = String(req.userId);
    const workspaceId = req.query.workspaceId ? String(req.query.workspaceId) : '';
    const channelId = req.query.channelId ? String(req.query.channelId) : '';

    if (workspaceId) {
      const hasAccess = await canAccessWorkspace(workspaceId, userId);
      if (!hasAccess) return sendError(res, 'FORBIDDEN', 'Không có quyền truy cập workspace', 403);
    }

    if (channelId) {
      const hasChannelAccess = await canAccessChannel(channelId, userId);
      if (!hasChannelAccess) return sendError(res, 'FORBIDDEN', 'Không có quyền truy cập channel', 403);
    }

    const query: any = {
      taskType: 'work',
      assignee: req.userId,
      status: { $ne: 'done' },
    };
    if (workspaceId) query.workspace = workspaceId;
    if (channelId) query.channel = channelId;

    const now = new Date();
    const [pendingCount, overdueCount] = await Promise.all([
      Task.countDocuments(query),
      Task.countDocuments({
        ...query,
        dueDate: { $ne: null, $lt: now },
      }),
    ]);

    sendSuccess(res, { pendingCount, overdueCount });
  } catch (err) { next(err); }
};
