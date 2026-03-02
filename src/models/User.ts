import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
  username: string;
  email: string;
  passwordHash: string;
  avatar: string | null;
  displayName: string;
  status: 'online' | 'offline' | 'away';
  lastSeen: Date;
  bio: string;
}

const userSchema = new Schema({
  username:     { type: String, required: true, unique: true, trim: true, minlength: 3 },
  email:        { type: String, required: true, unique: true, lowercase: true },
  passwordHash: { type: String, required: true, select: false },
  avatar:       { type: String, default: null },
  displayName:  { type: String, maxlength: 50 },
  status:       { type: String, enum: ['online', 'offline', 'away'], default: 'offline' },
  lastSeen:     { type: Date, default: Date.now },
  bio:          { type: String, maxlength: 200 },
}, { timestamps: true });

export const User = mongoose.model<IUser>('User', userSchema);
