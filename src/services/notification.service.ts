import { Notification } from '../models/Notification';

export const createNotification = async (data: {
  recipient: string;
  type: 'mention' | 'dm' | 'reaction' | 'invite';
  actor: string;
  payload?: {
    messageId?: string;
    channelId?: string;
    workspaceId?: string;
    preview?: string;
  };
}) => {
  return Notification.create(data);
};

export const getNotifications = async (userId: string, limit = 20) => {
  return Notification.find({ recipient: userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('actor', 'username avatar displayName');
};

export const markAsRead = async (notificationId: string, userId: string) => {
  return Notification.findOneAndUpdate(
    { _id: notificationId, recipient: userId },
    { isRead: true, readAt: new Date() },
    { new: true }
  );
};

export const markAllAsRead = async (userId: string) => {
  return Notification.updateMany(
    { recipient: userId, isRead: false },
    { isRead: true, readAt: new Date() }
  );
};
