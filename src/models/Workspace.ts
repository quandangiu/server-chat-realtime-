import mongoose, { Schema, Document } from 'mongoose';
import slugify from 'slugify';

export interface IWorkspace extends Document {
  name: string;
  slug: string;
  icon: string;
  owner: mongoose.Types.ObjectId;
  members: Array<{
    user: mongoose.Types.ObjectId;
    role: 'owner' | 'admin' | 'member';
    joinedAt: Date;
  }>;
  inviteCode: string;
}

const workspaceSchema = new Schema({
  name:   { type: String, required: true, maxlength: 80 },
  slug:   { type: String, unique: true, lowercase: true },
  icon:   { type: String, default: '💬' },
  owner:  { type: Schema.Types.ObjectId, ref: 'User', required: true },
  members: [{
    user:     { type: Schema.Types.ObjectId, ref: 'User' },
    role:     { type: String, enum: ['owner', 'admin', 'member'], default: 'member' },
    joinedAt: { type: Date, default: Date.now },
  }],
  inviteCode: { type: String, unique: true, sparse: true },
}, { timestamps: true });

workspaceSchema.index({ 'members.user': 1 });

// Auto tạo slug từ name
workspaceSchema.pre('save', function(next) {
  if (this.isModified('name')) {
    this.slug = slugify(this.name, { lower: true, strict: true }) + '-' + Date.now().toString(36);
  }
  if (!this.inviteCode) {
    this.inviteCode = Math.random().toString(36).slice(2, 10);
  }
  next();
});

export const Workspace = mongoose.model<IWorkspace>('Workspace', workspaceSchema);
