import mongoose, { Schema, Document } from 'mongoose';

export interface IChannel extends Document {
  workspace: mongoose.Types.ObjectId;
  name: string;
  type: 'public' | 'private' | 'dm' | 'voice';
  description: string;
  members: mongoose.Types.ObjectId[];
  createdBy: mongoose.Types.ObjectId;
  lastMessage: mongoose.Types.ObjectId;
  lastActivity: Date;
  dmUsers: mongoose.Types.ObjectId[];
  encryptionEnabled: boolean;
  encryptionKey: string;
}

const channelSchema = new Schema({
  workspace:    { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
  name:         { type: String, required: true, maxlength: 80 },
  type:         { type: String, enum: ['public', 'private', 'dm', 'voice'], default: 'public' },
  description:  { type: String },
  members:      [{ type: Schema.Types.ObjectId, ref: 'User' }],
  createdBy:    { type: Schema.Types.ObjectId, ref: 'User' },
  lastMessage:  { type: Schema.Types.ObjectId, ref: 'Message' },
  lastActivity: { type: Date, default: Date.now },
  dmUsers:      [{ type: Schema.Types.ObjectId, ref: 'User' }],
  encryptionEnabled: { type: Boolean, default: false },
  encryptionKey:     { type: String, select: false },
}, { timestamps: true });

channelSchema.index({ workspace: 1 });
channelSchema.index({ members: 1 });
channelSchema.index({ lastActivity: -1 });

export const Channel = mongoose.model<IChannel>('Channel', channelSchema);
