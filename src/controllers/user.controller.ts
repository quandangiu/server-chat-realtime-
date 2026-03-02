import { Request, Response, NextFunction } from 'express';
import { User } from '../models/User';
import { sendSuccess, sendError } from '../utils/apiResponse';

export const searchUsers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { q, limit = 10 } = req.query;
    if (!q) return sendSuccess(res, []);

    const users = await User.find({
      $or: [
        { username: { $regex: q, $options: 'i' } },
        { displayName: { $regex: q, $options: 'i' } },
        { email: { $regex: q, $options: 'i' } },
      ],
      _id: { $ne: req.userId },
    })
      .select('username avatar displayName status')
      .limit(Number(limit));

    sendSuccess(res, users);
  } catch (err) { next(err); }
};

export const getUserById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return sendError(res, 'NOT_FOUND', 'User không tồn tại', 404);
    sendSuccess(res, user);
  } catch (err) { next(err); }
};

export const updateProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.params.id !== req.userId)
      return sendError(res, 'FORBIDDEN', 'Không có quyền', 403);

    const updates: any = {};
    if (req.body.displayName !== undefined) updates.displayName = req.body.displayName;
    if (req.body.bio !== undefined) updates.bio = req.body.bio;
    if ((req as any).file) updates.avatar = (req as any).file.path;

    const user = await User.findByIdAndUpdate(req.userId, updates, { new: true });
    sendSuccess(res, user);
  } catch (err) { next(err); }
};
