import jwt from 'jsonwebtoken';

export const generateAccessToken = (userId: string) =>
  jwt.sign({ userId }, process.env.JWT_ACCESS_SECRET!, { expiresIn: '15m' });

export const generateRefreshToken = (userId: string) =>
  jwt.sign({ userId }, process.env.JWT_REFRESH_SECRET!, { expiresIn: '7d' });

export const verifyToken = (token: string) =>
  jwt.verify(token, process.env.JWT_ACCESS_SECRET!) as { userId: string };

export const verifyRefreshToken = (token: string) =>
  jwt.verify(token, process.env.JWT_REFRESH_SECRET!) as { userId: string };
