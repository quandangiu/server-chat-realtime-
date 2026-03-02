import mongoose, { Schema, Document } from 'mongoose';

const notificationSchema = new Schema({
  recipient: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  type:      { type: String, enum: ['mention', 'dm', 'reaction', 'invite'], required: true },
  actor:     { type: Schema.Types.ObjectId, ref: 'User' },
  payload: {
    messageId:   { type: Schema.Types.ObjectId, ref: 'Message' },
    channelId:   { type: Schema.Types.ObjectId, ref: 'Channel' },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace' },
    preview:     String,
  },
  isRead: { type: Boolean, default: false },
  readAt: Date,
}, { timestamps: true });

notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });

export const Notification = mongoose.model('Notification', notificationSchema);
