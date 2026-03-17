import { Server } from 'socket.io';
import { Message } from '../../models/Message';
import { Workspace } from '../../models/Workspace';
import { buildAIResponse, ensureAIUser, parseAICommand, detectTaskSuggestion } from '../../services/ai.service';
import { redis } from '../../config/redis';

type HandleAIMessageInput = {
  io: Server;
  channelId: string;
  workspaceId: string;
  senderId: string;
  content: string;
  sourceMessageId?: string;
};

export const handleAIMessage = async ({ io, channelId, workspaceId, senderId, content, sourceMessageId }: HandleAIMessageInput) => {
  const command = parseAICommand(content);
  const workspace = await Workspace.findById(workspaceId).select('aiEnabled');
  if (!workspace || workspace.aiEnabled === false) return;

  if (sourceMessageId) {
    const source = await Message.findById(sourceMessageId).select('isDeleted content channel');
    if (!source || source.isDeleted || String(source.channel) !== channelId) return;
    if (!String(source.content || '').trim().toLowerCase().startsWith('@ai')) return;
  }

  if (!command) {
    await maybeSuggestTaskFromNaturalMessage(io, channelId, workspaceId, senderId, content);
    return;
  }

  const limiter = await checkAIRateLimit(workspaceId, senderId);
  if (!limiter.allowed) {
    await emitAIText(io, channelId, `Bạn đang dùng AI quá nhanh. Vui lòng thử lại sau ${limiter.retryAfterSec}s.`);
    return;
  }

  const aiUser = await ensureAIUser();
  if (String(aiUser._id) === senderId) return;

  const replyText = await buildAIResponse({
    channelId,
    workspaceId,
    senderId,
    command: command.command,
    args: command.args,
  });
  await emitAIText(io, channelId, replyText, aiUser._id as any, sourceMessageId);
};

const emitAIText = async (io: Server, channelId: string, content: string, aiUserId?: string, aiCommandOf?: string) => {
  if (aiCommandOf) {
    const source = await Message.findById(aiCommandOf).select('isDeleted channel');
    if (!source || source.isDeleted || String(source.channel) !== channelId) {
      return;
    }
  }

  const aiUser = aiUserId ? { _id: aiUserId } : await ensureAIUser();
  const aiMessage = await Message.create({
    channel: channelId,
    sender: aiUser._id,
    content: `[AI Support]\n${content}`,
    type: 'system',
    aiCommandOf: aiCommandOf || null,
  });

  await aiMessage.populate('sender', 'username avatar displayName');
  io.to(`channel:${channelId}`).emit('new_message', { message: aiMessage });
};

const checkAIRateLimit = async (workspaceId: string, userId: string) => {
  // 6 AI commands / minute per user per workspace
  const limit = Number(process.env.AI_RATE_LIMIT_COUNT || 6);
  const windowSec = Number(process.env.AI_RATE_LIMIT_WINDOW_SEC || 60);
  const key = `ai:rl:${workspaceId}:${userId}`;

  try {
    if (!redis.isOpen) {
      return { allowed: true, retryAfterSec: 0 };
    }

    const current = await redis.incr(key);
    if (current === 1) {
      await redis.expire(key, windowSec);
    }

    if (current > limit) {
      const ttl = await redis.ttl(key);
      return { allowed: false, retryAfterSec: Math.max(ttl, 1) };
    }

    return { allowed: true, retryAfterSec: 0 };
  } catch {
    // Fail-open nếu Redis có vấn đề để không làm gián đoạn chat
    return { allowed: true, retryAfterSec: 0 };
  }
};

const maybeSuggestTaskFromNaturalMessage = async (
  io: Server,
  channelId: string,
  workspaceId: string,
  senderId: string,
  content: string
) => {
  const suggestion = detectTaskSuggestion(content);
  if (!suggestion) return;

  const key = `ai:suggest:${workspaceId}:${channelId}:${senderId}`;
  try {
    if (redis.isOpen) {
      const exists = await redis.get(key);
      if (exists) return;
      await redis.set(key, '1', { EX: 120 });
    }
  } catch {}

  await emitAIText(io, channelId, suggestion);
};
