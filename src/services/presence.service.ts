import { redis } from '../config/redis';
import { User } from '../models/User';

const ONLINE_TTL = 300; // 5 phút

export const setOnline = async (userId: string) => {
  await redis.set(`presence:${userId}`, 'online', { EX: ONLINE_TTL });
  await User.findByIdAndUpdate(userId, { status: 'online' });
};

export const setOffline = async (userId: string) => {
  await redis.del(`presence:${userId}`);
  await User.findByIdAndUpdate(userId, { status: 'offline', lastSeen: new Date() });
};

export const isOnline = async (userId: string): Promise<boolean> => {
  return !!(await redis.get(`presence:${userId}`));
};

export const getOnlineUsers = async (userIds: string[]): Promise<string[]> => {
  if (!userIds.length) return [];
  const results = await redis.mGet(userIds.map(id => `presence:${id}`));
  return userIds.filter((_, i) => results[i] !== null);
};

export const refreshPresence = async (userId: string) => {
  await redis.expire(`presence:${userId}`, ONLINE_TTL);
};
