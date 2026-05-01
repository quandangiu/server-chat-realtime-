import mongoose, { Schema, Document } from 'mongoose';

export interface ITask extends Document {
  workspace: mongoose.Types.ObjectId;
  channel: mongoose.Types.ObjectId;
  sourceMessage?: mongoose.Types.ObjectId | null;
  taskType: 'work' | 'event' | 'poll';
  title: string;
  description?: string;
  status: 'todo' | 'in_progress' | 'review' | 'done' | 'blocked';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  assignee?: mongoose.Types.ObjectId | null;
  createdBy: mongoose.Types.ObjectId;
  dueDate?: Date | null;
  completedAt?: Date | null;
  eventAt?: Date | null;
  location?: string;
  eventRsvps?: Array<{
    user: mongoose.Types.ObjectId;
    response: 'going' | 'maybe' | 'declined';
  }>;
  pollQuestion?: string;
  pollOptions?: Array<{
    option: string;
    votes: mongoose.Types.ObjectId[];
  }>;
  pollExpiresAt?: Date | null;
  pollAnonymous?: boolean;
  pollMultiChoice?: boolean;
  comments?: Array<{
    _id: mongoose.Types.ObjectId;
    user: mongoose.Types.ObjectId;
    content: string;
    createdAt: Date;
  }>;
}

const taskSchema = new Schema(
  {
    workspace: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    channel: { type: Schema.Types.ObjectId, ref: 'Channel', required: true },
    sourceMessage: { type: Schema.Types.ObjectId, ref: 'Message', default: null },
    taskType: {
      type: String,
      enum: ['work', 'event', 'poll'],
      default: 'work',
    },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, default: '' },
    status: {
      type: String,
      enum: ['todo', 'in_progress', 'review', 'done', 'blocked'],
      default: 'todo',
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'urgent'],
      default: 'medium',
    },
    assignee: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    dueDate: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    eventAt: { type: Date, default: null },
    location: { type: String, default: '' },
    eventRsvps: [
      {
        user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        response: {
          type: String,
          enum: ['going', 'maybe', 'declined'],
          required: true,
        },
      },
    ],
    pollQuestion: { type: String, default: '' },
    pollOptions: [
      {
        option: { type: String },
        votes: [{ type: Schema.Types.ObjectId, ref: 'User' }],
      },
    ],
    pollExpiresAt: { type: Date, default: null },
    pollAnonymous: { type: Boolean, default: false },
    pollMultiChoice: { type: Boolean, default: false },
    comments: [
      {
        user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        content: { type: String, required: true },
        createdAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

taskSchema.index({ workspace: 1, channel: 1, taskType: 1, status: 1, dueDate: 1 });
taskSchema.index({ assignee: 1, status: 1, dueDate: 1 });

export const Task = mongoose.model<ITask>('Task', taskSchema);
