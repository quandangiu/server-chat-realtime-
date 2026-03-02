import mongoose, { Schema, Document } from 'mongoose';

export interface IMessage extends Document {
  channel: mongoose.Types.ObjectId;
  sender: mongoose.Types.ObjectId;
  content: string;
  type: 'text' | 'image' | 'file' | 'system';
  attachment: {
    url: string;
    name: string;
    size: number;
    mimeType: string;
    publicId: string;
  };
  replyTo: mongoose.Types.ObjectId;
  reactions: Map<string, mongoose.Types.ObjectId[]>;
  readBy: Array<{ user: mongoose.Types.ObjectId; readAt: Date }>;
  isEdited: boolean;
  editedAt: Date;
  isDeleted: boolean;
}

const messageSchema = new Schema({
  channel:  { type: Schema.Types.ObjectId, ref: 'Channel', required: true },
  sender:   { type: Schema.Types.ObjectId, ref: 'User', required: true },
  content:  { type: String, default: '' },
  type:     { type: String, enum: ['text', 'image', 'file', 'system'], default: 'text' },
  attachment: {
    url:      String,
    name:     String,
    size:     Number,
    mimeType: String,
    publicId: String,
  },
  replyTo:   { type: Schema.Types.ObjectId, ref: 'Message', default: null },
  reactions: { type: Map, of: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: {} },
  readBy: [{
    user:   { type: Schema.Types.ObjectId, ref: 'User' },
    readAt: { type: Date, default: Date.now },
  }],
  isEdited:  { type: Boolean, default: false },
  editedAt:  Date,
  isDeleted: { type: Boolean, default: false },
}, { timestamps: true });

messageSchema.index({ channel: 1, _id: -1 });
messageSchema.index({ channel: 1, createdAt: -1 });
messageSchema.index({ content: 'text' });

export const Message = mongoose.model<IMessage>('Message', messageSchema);
