import { Request, Response, NextFunction } from 'express';
import { User } from '../models/User';
import { redis } from '../config/redis';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../utils/jwt';
import { hashPassword, comparePassword } from '../utils/bcrypt';
import { sendSuccess, sendError } from '../utils/apiResponse';

const REFRESH_TTL = 7 * 24 * 60 * 60; // 7 days

export const register = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { username, email, password } = req.body;

    const exists = await User.findOne({ $or: [{ email }, { username }] });
    if (exists) return sendError(res, 'CONFLICT', 'Email hoặc username đã tồn tại', 409);

    const passwordHash = await hashPassword(password);
    const user = await User.create({ username, email, passwordHash });

    const accessToken = generateAccessToken(user._id.toString());
    const refreshToken = generateRefreshToken(user._id.toString());

    await redis.set(`refresh:${user._id}:${refreshToken}`, '1', { EX: REFRESH_TTL });

    // Cookie cho cross-origin network access
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      maxAge: REFRESH_TTL * 1000,
    });

    sendSuccess(res, {
      user: { _id: user._id, username, email, avatar: null },
      accessToken,
    }, 201);
  } catch (err) { next(err); }
};

export const login = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email }).select('+passwordHash');
    if (!user || !(await comparePassword(password, user.passwordHash)))
      return sendError(res, 'UNAUTHORIZED', 'Sai email hoặc mật khẩu', 401);

    const accessToken = generateAccessToken(user._id.toString());
    const refreshToken = generateRefreshToken(user._id.toString());

    await redis.set(`refresh:${user._id}:${refreshToken}`, '1', { EX: REFRESH_TTL });
    await User.findByIdAndUpdate(user._id, { status: 'online' });

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      maxAge: REFRESH_TTL * 1000,
    });

    sendSuccess(res, {
      user: { _id: user._id, username: user.username, email: user.email, avatar: user.avatar, displayName: user.displayName },
      accessToken,
    });
  } catch (err) { next(err); }
};

export const refreshTokenHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.cookies.refreshToken;
    if (!token) return sendError(res, 'UNAUTHORIZED', 'Không có refresh token', 401);

    const decoded = verifyRefreshToken(token);
    const exists = await redis.get(`refresh:${decoded.userId}:${token}`);
    if (!exists) return sendError(res, 'UNAUTHORIZED', 'Refresh token đã bị thu hồi', 401);

    const newAccessToken = generateAccessToken(decoded.userId);
    sendSuccess(res, { accessToken: newAccessToken });
  } catch (err) { next(err); }
};

export const logout = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.cookies.refreshToken;
    if (token) {
      try {
        const decoded = verifyRefreshToken(token);
        await redis.del(`refresh:${decoded.userId}:${token}`);
      } catch { /* ignore invalid token */ }
    }
    if (req.userId) {
      await User.findByIdAndUpdate(req.userId, { status: 'offline', lastSeen: new Date() });
    }
    res.clearCookie('refreshToken');
    sendSuccess(res, null);
  } catch (err) { next(err); }
};

export const getMe = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return sendError(res, 'NOT_FOUND', 'User không tồn tại', 404);
    sendSuccess(res, user);
  } catch (err) { next(err); }
};
