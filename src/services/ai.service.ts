import OpenAI from 'openai';
import { Types } from 'mongoose';
import { User } from '../models/User';
import { Message } from '../models/Message';
import { Channel } from '../models/Channel';
import { Task } from '../models/Task';
import { Workspace } from '../models/Workspace';
import { hashPassword } from '../utils/bcrypt';

const AI_USERNAME = 'AI-Assistant';
const AI_EMAIL = 'ai@chatapp.com';

let openaiClient: OpenAI | null = null;

type AIIntent =
  | 'help'
  | 'stats'
  | 'summarize'
  | 'recap'
  | 'recap_done'
  | 'recap_event'
  | 'remind'
  | 'assign'
  | 'poll'
  | 'done'
  | 'unknown';

const TASK_AGENT_SYSTEM_PROMPT = `SYSTEM PROMPT — Task AI Agent

Bạn là AI Helper trong ứng dụng nhắn tin nhóm. Bạn giúp người dùng tạo và quản lý task thông minh thông qua hội thoại tự nhiên.

=== CÁC LOẠI TASK ===

1. EVENT TASK — Dùng khi nhóm hẹn đi đâu, làm gì cùng nhau
  Trường bắt buộc: title, datetime, location (tùy chọn)
  Tính năng: RSVP (tham gia/không tham gia/maybe), nhắc trước 24h, đếm ngược
  Ví dụ trigger: "hẹn", "đi chơi", "gặp nhau", "sinh nhật", "party", "họp mặt"

2. WORK TASK — Dùng khi giao việc, theo dõi tiến độ
  Trường bắt buộc: title, assignee (người nhận việc), deadline
  Trường tùy chọn: priority (low/medium/high/urgent), description, subtasks
  Status flow: Todo → In Progress → Review → Done
  Ví dụ trigger: "làm", "giao", "cần", "deadline", "hoàn thành", "kiểm tra"

3. POLL TASK — Dùng khi cần bỏ phiếu chọn thứ gì đó trong nhóm
  Trường bắt buộc: question, options[] (2-6 lựa chọn), expires_at
  Tính năng: vote realtime, anonymous hoặc public, multi-choice hoặc single
  Ví dụ trigger: "chọn", "vote", "mọi người thích", "nên đi đâu", "ai muốn"

=== FORMAT TRẢ LỜI ===

Khi tạo task thành công, luôn trả về:
✅ Task đã tạo: [Tên task]
  Loại: [Event / Work / Poll]
  [Thông tin chi tiết tương ứng loại]
  ID: #[task_id]

Ngôn ngữ: Trả lời bằng cùng ngôn ngữ người dùng đang dùng (tiếng Việt hoặc tiếng Anh).
Tone: Thân thiện, ngắn gọn. Không dài dòng.`;

const getOpenAIClient = () => {
  if (openaiClient) return openaiClient;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  openaiClient = new OpenAI({ apiKey });
  return openaiClient;
};

export const ensureAIUser = async () => {
  const existing = await User.findOne({ username: AI_USERNAME });
  if (existing) return existing;

  const randomPassword = `ai-bot-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const passwordHash = await hashPassword(randomPassword);

  return User.create({
    username: AI_USERNAME,
    email: AI_EMAIL,
    passwordHash,
    displayName: 'AI Helper',
    avatar: 'https://api.dicebear.com/7.x/bottts-neutral/svg?seed=AI',
    status: 'online',
    bio: 'Workspace AI assistant',
  });
};

export const parseAICommand = (content: string) => {
  const raw = (content || '').trim();
  if (!raw) return null;
  if (!raw.toLowerCase().startsWith('@ai')) return null;

  const withoutMention = raw.slice(3).trim();
  const [command, ...rest] = withoutMention.split(/\s+/);
  return {
    command: (command || 'help').toLowerCase(),
    args: rest.join(' ').trim(),
  };
};

const resolveIntent = (command: string): AIIntent => {
  if (command === 'help') return 'help';
  if (command === 'stats') return 'stats';
  if (command === 'summarize' || command === 'summary' || command === 'tomtat') return 'summarize';
  if (command === 'recap-done' || command === 'recap_done' || command === 'recapdone') return 'recap_done';
  if (command === 'recap-event' || command === 'recap_event' || command === 'recapevent') return 'recap_event';
  if (command === 'recap') return 'recap';
  if (command === 'remind') return 'remind';
  if (command === 'assign') return 'assign';
  if (command === 'poll') return 'poll';
  if (command === 'done') return 'done';
  return 'unknown';
};

const getHelpText = () => {
  return [
    'Lệnh AI:',
    '- @AI help: Xem danh sách lệnh',
    '- @AI stats: Xem thống kê hoạt động kênh',
    '- @AI summarize: Tóm tắt tin nhắn gần đây',
    '- @AI recap: Member xem task cần làm + task trễ của mình',
    '- @AI recap-done: (Admin/Owner) liệt kê member đã done/undone task',
    '- @AI recap-event: (Admin/Owner) liệt kê event đang có + người tham gia',
    '- @AI remind: Nhắc task sắp tới hạn (24h)',
    '- @AI assign @nguoi [noi dung]: Tạo task và giao người xử lý',
    '- @AI poll [cau hoi] / [lua chon 1] / [lua chon 2] ...: Tạo Poll Task',
    '- @AI done [ten task hoac ID]: Đánh dấu task hoàn thành',
  ].join('\n');
};

const getWorkspaceRole = async (workspaceId: string, userId: string) => {
  const ws = await Workspace.findById(workspaceId).select('members');
  if (!ws) return null;
  const member = ws.members.find((m: any) => {
    const uid = (m.user as any)?._id?.toString() || m.user?.toString();
    return uid === userId;
  });
  return member?.role || null;
};

const canUseManagerRecap = (role: string | null) => role === 'owner' || role === 'admin';

const groupTasksByAssignee = (tasks: any[]) => {
  const map = new Map<string, string[]>();
  for (const task of tasks) {
    const assignee = task.assignee;
    const key = assignee?._id?.toString?.() || String(task.assignee || 'unassigned');
    const label = assignee?.displayName || assignee?.username || 'Chưa assign';
    const fullKey = `${key}::${label}`;
    if (!map.has(fullKey)) map.set(fullKey, []);
    map.get(fullKey)!.push(task.title);
  }
  return map;
};

const buildRecapDoneForManager = async (channelId: string) => {
  const tasks = await Task.find({ channel: channelId, taskType: 'work' })
    .populate('assignee', 'username displayName')
    .select('title status dueDate assignee');

  const doneTasks = tasks.filter((t: any) => t.status === 'done' && t.assignee);
  const undoneTasks = tasks.filter((t: any) => t.status !== 'done' && t.assignee);
  const overdueTasks = tasks.filter((t: any) => t.status !== 'done' && t.assignee && t.dueDate && new Date(t.dueDate) < new Date());

  const doneGroup = groupTasksByAssignee(doneTasks as any[]);
  const undoneGroup = groupTasksByAssignee(undoneTasks as any[]);
  const overdueGroup = groupTasksByAssignee(overdueTasks as any[]);

  const doneLines = Array.from(doneGroup.entries()).map(([key, titles]) => {
    const label = key.split('::')[1];
    return `- ${label}: ${titles.join(', ')}`;
  });

  const undoneLines = Array.from(undoneGroup.entries()).map(([key, titles]) => {
    const label = key.split('::')[1];
    return `- ${label}: ${titles.join(', ')}`;
  });

  const overdueLines = Array.from(overdueGroup.entries()).map(([key, titles]) => {
    const label = key.split('::')[1];
    return `[RED]- ${label}: ${titles.join(', ')}`;
  });

  return [
    'Recap Done/Undone (Work):',
    'Đã done:',
    ...(doneLines.length ? doneLines : ['- Chưa có member hoàn thành task.']),
    'Chưa done:',
    ...(undoneLines.length ? undoneLines : ['- Không có task undone.']),
    'Task trễ deadline:',
    ...(overdueLines.length ? overdueLines : ['- Không có task trễ.']),
  ].join('\n');
};

const buildRecapEventForManager = async (channelId: string) => {
  const events = await Task.find({ channel: channelId, taskType: 'event', status: { $ne: 'done' } })
    .sort({ eventAt: 1 })
    .select('title eventAt location eventRsvps');

  if (events.length === 0) {
    return 'Recap Event: chưa có event đang hoạt động.';
  }

  const userIds = Array.from(new Set(
    events.flatMap((e: any) => (e.eventRsvps || []).map((r: any) => String(r.user)))
  ));

  const users = await User.find({ _id: { $in: userIds } }).select('username displayName');
  const userMap = new Map(users.map((u: any) => [String(u._id), u.displayName || u.username]));

  const lines: string[] = ['Recap Event:'];
  for (const ev of events as any[]) {
    const when = ev.eventAt ? new Date(ev.eventAt).toLocaleString('vi-VN') : 'Chưa có thời gian';
    const goingUsers = (ev.eventRsvps || [])
      .filter((r: any) => r.response === 'going')
      .map((r: any) => userMap.get(String(r.user)) || 'Unknown');

    lines.push(`- ${ev.title} (${when}${ev.location ? ` · ${ev.location}` : ''})`);
    lines.push(`  Người tham gia: ${goingUsers.length ? goingUsers.join(', ') : 'Chưa có ai xác nhận tham gia'}`);
  }

  return lines.join('\n');
};

const buildRecapForMember = async (channelId: string, senderId: string) => {
  const tasks = await Task.find({
    channel: channelId,
    taskType: 'work',
    assignee: senderId,
    status: { $ne: 'done' },
  }).select('title status dueDate');

  if (tasks.length === 0) {
    return 'Bạn chưa có task cần làm trong kênh này.';
  }

  const now = new Date();
  const todoLines = tasks.map((t: any) => {
    const due = t.dueDate ? ` · deadline ${new Date(t.dueDate).toLocaleString('vi-VN')}` : '';
    return `- ${t.title}${due}`;
  });

  const overdueLines = tasks
    .filter((t: any) => t.dueDate && new Date(t.dueDate) < now)
    .map((t: any) => `[RED]- ${t.title} · trễ hẹn từ ${new Date(t.dueDate).toLocaleString('vi-VN')}`);

  return [
    'Recap Task của bạn:',
    'Cần làm:',
    ...todoLines,
    'Task trễ hẹn:',
    ...(overdueLines.length ? overdueLines : ['- Không có task trễ hẹn.']),
  ].join('\n');
};

const getStatsText = async (channelId: string) => {
  const messageCount = await Message.countDocuments({ channel: channelId, isDeleted: false });

  const uniqueSenders = await Message.distinct('sender', {
    channel: channelId,
    isDeleted: false,
    sender: { $exists: true },
  });

  const latest = await Message.findOne({ channel: channelId, isDeleted: false })
    .sort({ createdAt: -1 })
    .select('createdAt')
    .lean<{ createdAt?: Date }>();

  return [
    `Thống kê kênh:`,
    `- Tổng tin nhắn: ${messageCount}`,
    `- Người gửi đang hoạt động: ${uniqueSenders.length}`,
    `- Hoạt động gần nhất: ${latest?.createdAt ? new Date(latest.createdAt).toISOString() : 'N/A'}`,
  ].join('\n');
};

const summarizeRecentMessages = async (channelId: string) => {
  const channel = await Channel.findById(channelId).select('name');
  const recent = await Message.find({ channel: channelId, isDeleted: false })
    .sort({ createdAt: -1 })
    .limit(30)
    .populate('sender', 'username displayName')
    .select('content sender createdAt type');

  if (recent.length === 0) {
    return 'Chưa có tin nhắn gần đây để tóm tắt.';
  }

  const conversationText = recent
    .reverse()
    .map((msg: any) => {
      const sender = msg.sender?.displayName || msg.sender?.username || 'Unknown';
      const content = (msg.content || '').trim();
      return `[${new Date(msg.createdAt).toISOString()}] ${sender}: ${content || '(tin nhắn không phải văn bản)'}`;
    })
    .join('\n');

  const ruleBasedSummary = buildRuleBasedSummary(recent as any[]);

  const client = getOpenAIClient();
  if (!client) {
    return [
      'Chế độ tóm tắt local (không cần API key):',
      ruleBasedSummary,
      '',
      'Gợi ý: thêm OPENAI_API_KEY để có tóm tắt sâu hơn.',
    ].join('\n');
  }

  const response = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature: 0.3,
    messages: [
      {
        role: 'system',
        content: `${TASK_AGENT_SYSTEM_PROMPT}\n\nHãy trả lời ngắn gọn và tập trung vào thông tin hành động được.`,
      },
      {
        role: 'user',
        content: `Hãy tóm tắt các tin nhắn gần đây trong kênh #${channel?.name || 'channel'}:\n\n${conversationText}`,
      },
    ],
  });

  return response.choices[0]?.message?.content?.trim() || 'Hiện tại mình chưa thể tạo tóm tắt, bạn thử lại sau nhé.';
};

const buildRuleBasedSummary = (messages: Array<{ content?: string; sender?: any; createdAt?: string | Date }>) => {
  const textMessages = messages
    .map((m) => ({
      sender: m.sender?.displayName || m.sender?.username || 'Unknown',
      content: (m.content || '').trim(),
    }))
    .filter((m) => m.content.length > 0);

  if (textMessages.length === 0) {
    return '- Chưa đủ dữ liệu văn bản để tóm tắt.';
  }

  const bySender = new Map<string, number>();
  for (const msg of textMessages) {
    bySender.set(msg.sender, (bySender.get(msg.sender) || 0) + 1);
  }

  const topSenders = Array.from(bySender.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, count]) => `${name} (${count})`)
    .join(', ');

  const decisions = textMessages
    .filter((m) => /\b(chốt|đồng ý|quyết định|ok|duyệt)\b/i.test(m.content))
    .slice(-3)
    .map((m) => `- ${m.content.slice(0, 140)}`);

  const blockers = textMessages
    .filter((m) => /\b(lỗi|bug|vướng|không chạy|blocked|trễ|chậm)\b/i.test(m.content))
    .slice(-3)
    .map((m) => `- ${m.content.slice(0, 140)}`);

  const actionItems = extractActionItems(textMessages.map((m) => m.content));

  return [
    `- Tổng tin nhắn văn bản: ${textMessages.length}`,
    `- Thành viên hoạt động nhiều: ${topSenders || 'N/A'}`,
    '- Quyết định gần đây:',
    ...(decisions.length > 0 ? decisions : ['- Chưa phát hiện quyết định rõ ràng.']),
    '- Blocker/Vướng mắc:',
    ...(blockers.length > 0 ? blockers : ['- Chưa phát hiện blocker nổi bật.']),
    '- Việc cần làm:',
    ...(actionItems.length > 0 ? actionItems.map((i) => `- ${i}`) : ['- Chưa trích xuất được action item rõ ràng.']),
  ].join('\n');
};

const extractActionItems = (contents: string[]) => {
  const tasks: string[] = [];
  const patterns = [
    /(?:cần|phải|hãy|todo|việc cần làm)\s+(.{4,120})/i,
    /(?:@\w+\s+)?(?:làm|fix|sửa|triển khai|update)\s+(.{3,120})/i,
  ];

  for (const line of contents) {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match?.[1]) {
        const task = match[1].trim().replace(/[.!?]$/, '');
        if (task.length >= 4) tasks.push(task);
      }
    }
  }

  return Array.from(new Set(tasks)).slice(0, 8);
};

const inferDeadline = (text: string): Date | null => {
  const lower = text.toLowerCase();
  const now = new Date();

  if (lower.includes('hôm nay') || lower.includes('today')) {
    const d = new Date(now);
    d.setHours(23, 59, 0, 0);
    return d;
  }

  if (lower.includes('ngày mai') || lower.includes('tomorrow')) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(23, 59, 0, 0);
    return d;
  }

  if (lower.includes('cuối tuần') || lower.includes('end of week')) {
    const d = new Date(now);
    const day = d.getDay();
    const add = (7 - day) % 7;
    d.setDate(d.getDate() + add);
    d.setHours(23, 59, 0, 0);
    return d;
  }

  return null;
};

const formatTaskCreated = (task: any, kindLabel: 'Event' | 'Work' | 'Poll', extraLines: string[] = []) => {
  const shortId = String(task._id).slice(-6);
  return [
    `✅ Task đã tạo: ${task.title}`,
    `   Loại: ${kindLabel}`,
    ...extraLines.map((line) => `   ${line}`),
    `   ID: #${shortId}`,
  ].join('\n');
};

const buildTodoCreateText = async (channelId: string, workspaceId: string, senderId: string) => {
  const recent = await Message.find({ channel: channelId, isDeleted: false })
    .sort({ createdAt: -1 })
    .limit(50)
    .select('content');

  const extracted = extractActionItems(recent.map((m: any) => m.content || ''));
  if (extracted.length === 0) {
    return 'Không tìm thấy việc cần làm rõ ràng từ tin nhắn gần đây.';
  }

  const existing = await Task.find({ channel: channelId, status: { $ne: 'done' } }).select('title');
  const existingTitles = new Set(existing.map((t: any) => String(t.title).toLowerCase()));
  const toCreate = extracted.filter((e) => !existingTitles.has(e.toLowerCase()));

  if (toCreate.length === 0) {
    return 'Các việc cần làm đã có task tương ứng, không tạo trùng.';
  }

  const created: any[] = [];
  for (const title of toCreate.slice(0, 6)) {
    const task = await Task.create({
      taskType: 'work',
      workspace: workspaceId,
      channel: channelId,
      title,
      status: 'todo',
      priority: 'medium',
      assignee: null,
      createdBy: senderId,
      dueDate: inferDeadline(title),
    });
    created.push(task);
  }

  return [
    `Đã tạo ${created.length} Work Task:`,
    ...created.map((t) => `- ${t.title} (#${String(t._id).slice(-6)})`),
  ].join('\n');
};

const buildRemindText = async (channelId: string) => {
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const tasks = await Task.find({
    channel: channelId,
    status: { $ne: 'done' },
    $or: [
      { dueDate: { $gte: now, $lte: in24h } },
      { taskType: 'event', eventAt: { $gte: now, $lte: in24h } },
    ],
  }).populate('assignee', 'username displayName');

  if (tasks.length === 0) {
    return 'Không có task sắp đến hạn trong 24h tới.';
  }

  return tasks
    .slice(0, 10)
    .map((t: any) => {
      const targetDate = t.taskType === 'event' && t.eventAt ? new Date(t.eventAt) : t.dueDate ? new Date(t.dueDate) : null;
      const hoursLeft = targetDate ? Math.max(1, Math.round((targetDate.getTime() - now.getTime()) / (1000 * 60 * 60))) : '?';
      const who = t.assignee?.displayName || t.assignee?.username || (t.taskType === 'event' ? 'participants' : 'unassigned');
      return `⏰ ${t.title} — còn ${hoursLeft} giờ · ${who}`;
    })
    .join('\n');
};

const buildAssignText = async (channelId: string, workspaceId: string, senderId: string, args: string) => {
  const mention = args.match(/@(\S+)/);
  if (!mention) {
    return 'Cú pháp: @AI assign @nguoi [nội dung]';
  }

  const target = mention[1].trim().toLowerCase();
  const taskContent = args.replace(/@\S+/, '').trim();
  if (!taskContent) return 'Bạn cần nhập nội dung task sau @người.';

  const channel = await Channel.findById(channelId).populate('members', 'username displayName');
  if (!channel) return 'Channel không tồn tại.';

  const member = (channel.members as any[]).find((m: any) => {
    const u = String(m.username || '').toLowerCase();
    const d = String(m.displayName || '').toLowerCase();
    return u === target || d === target;
  });

  if (!member) {
    return `Không tìm thấy thành viên @${target} trong channel hiện tại.`;
  }

  const dueDate = inferDeadline(taskContent);
  const task = await Task.create({
    taskType: 'work',
    workspace: workspaceId,
    channel: channelId,
    title: taskContent,
    description: '',
    status: 'todo',
    priority: 'medium',
    assignee: member._id,
    createdBy: senderId,
    dueDate,
  });

  return formatTaskCreated(task, 'Work', [
    `Assignee: ${member.displayName || member.username}`,
    `Deadline: ${dueDate ? dueDate.toISOString() : 'Chưa đặt'}`,
  ]);
};

const buildPollText = async (channelId: string, workspaceId: string, senderId: string, args: string) => {
  const parts = args.split('/').map((s) => s.trim()).filter(Boolean);
  if (parts.length < 3) {
    return 'Cú pháp: @AI poll [câu hỏi] / [lựa chọn 1] / [lựa chọn 2] ...';
  }

  const question = parts[0];
  const options = parts.slice(1, 7);
  if (options.length < 2) return 'Poll cần tối thiểu 2 lựa chọn.';

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const task = await Task.create({
    taskType: 'poll',
    workspace: workspaceId,
    channel: channelId,
    title: `Poll: ${question}`,
    pollQuestion: question,
    pollOptions: options.map((option) => ({ option, votes: [] })),
    pollExpiresAt: expiresAt,
    pollAnonymous: false,
    pollMultiChoice: false,
    status: 'todo',
    priority: 'low',
    createdBy: senderId,
  });

  return formatTaskCreated(task, 'Poll', [
    `Question: ${question}`,
    `Options: ${options.join(' | ')}`,
    `Expires: ${expiresAt.toISOString()}`,
  ]);
};

const buildDoneText = async (channelId: string, args: string) => {
  const needle = args.trim();
  if (!needle) return 'Cú pháp: @AI done [tên task hoặc ID]';

  const queryById = needle.replace('#', '');
  let task = await Task.findOne({ channel: channelId, _id: queryById }).catch(() => null);
  if (!task) {
    task = await Task.findOne({
      channel: channelId,
      title: { $regex: needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' },
      status: { $ne: 'done' },
    }).sort({ createdAt: -1 });
  }

  if (!task) return 'Không tìm thấy task phù hợp để đánh dấu hoàn thành.';

  task.status = 'done';
  task.completedAt = new Date();
  await task.save();

  return `✅ Đã hoàn thành task: ${task.title} (ID: #${String(task._id).slice(-6)})`;
};

const buildTaskRecap = async (channelId: string) => {
  const tasks = await Task.find({ channel: channelId }).populate('assignee', 'username displayName');
  const done = tasks.filter((t: any) => t.status === 'done').length;
  const inProgress = tasks.filter((t: any) => t.status === 'in_progress').length;
  const overdue = tasks.filter((t: any) => t.status !== 'done' && t.dueDate && new Date(t.dueDate) < new Date()).length;

  const inProgressDetails = tasks
    .filter((t: any) => t.status === 'in_progress')
    .slice(0, 5)
    .map((t: any) => `- ${t.title} (${t.assignee?.displayName || t.assignee?.username || 'chưa assign'})`);

  const upcomingEvents = tasks
    .filter((t: any) => t.taskType === 'event' && t.status !== 'done' && t.eventAt)
    .sort((a: any, b: any) => new Date(a.eventAt).getTime() - new Date(b.eventAt).getTime())
    .slice(0, 5)
    .map((t: any) => `- ${t.title} (${new Date(t.eventAt).toISOString()})`);

  return [
    `- Đã xong: ${done} task`,
    `- Đang làm: ${inProgress} task${inProgressDetails.length ? '\n' + inProgressDetails.join('\n') : ''}`,
    `- Trễ deadline: ${overdue} task`,
    '- Event sắp tới:',
    ...(upcomingEvents.length ? upcomingEvents : ['- Chưa có event task sắp tới']),
  ].join('\n');
};

const buildRecapText = async (channelId: string, workspaceId: string, senderId: string) => {
  const role = await getWorkspaceRole(workspaceId, senderId);
  if (canUseManagerRecap(role)) {
    const taskRecap = await buildTaskRecap(channelId);
    return [
      'Task recap (Admin/Owner):',
      taskRecap,
      '',
      'Gợi ý: dùng @AI recap-done hoặc @AI recap-event để xem chi tiết hơn.',
    ].join('\n');
  }
  return buildRecapForMember(channelId, senderId);
};

const buildTodoText = async (channelId: string, workspaceId: string, senderId: string) => {
  return buildTodoCreateText(channelId, workspaceId, senderId);
};

export const detectTaskSuggestion = (content: string) => {
  const text = (content || '').trim();
  if (!text) return null;

  if (/\b(tôi sẽ làm|mình sẽ làm|i will|deadline|hoàn thành trước)\b/i.test(text)) {
    return 'Mình phát hiện có ý định giao việc. Bạn có muốn mình tạo Work Task cho nội dung này không?';
  }

  if (/\b(hẹn|đi chơi|gặp nhau|sinh nhật|party|họp mặt)\b/i.test(text)) {
    return 'Mình thấy đây giống kế hoạch sự kiện. Bạn có muốn mình tạo Event Task không?';
  }

  if (/\b(chọn|vote|mọi người thích|nên đi đâu|ai muốn)\b/i.test(text)) {
    return 'Bạn có muốn mình tạo Poll Task để cả nhóm vote không?';
  }

  return null;
};

export const buildAIResponse = async (params: {
  channelId: string;
  workspaceId: string;
  senderId: string;
  command: string;
  args?: string;
}) => {
  const { channelId, workspaceId, senderId, command, args = '' } = params;
  const intent = resolveIntent(command);

  if (intent === 'help') return getHelpText();
  if (intent === 'stats') return getStatsText(channelId);
  if (intent === 'summarize') return summarizeRecentMessages(channelId);
  if (intent === 'recap') return buildRecapText(channelId, workspaceId, senderId);
  if (intent === 'recap_done') {
    const role = await getWorkspaceRole(workspaceId, senderId);
    if (!canUseManagerRecap(role)) return 'Bạn không có quyền dùng lệnh này. Chỉ admin/owner.';
    return buildRecapDoneForManager(channelId);
  }
  if (intent === 'recap_event') {
    const role = await getWorkspaceRole(workspaceId, senderId);
    if (!canUseManagerRecap(role)) return 'Bạn không có quyền dùng lệnh này. Chỉ admin/owner.';
    return buildRecapEventForManager(channelId);
  }
  if (intent === 'remind') return buildRemindText(channelId);
  if (intent === 'assign') return buildAssignText(channelId, workspaceId, senderId, args);
  if (intent === 'poll') return buildPollText(channelId, workspaceId, senderId, args);
  if (intent === 'done') return buildDoneText(channelId, args);

  return 'Lệnh chưa hỗ trợ. Thử: @AI help';
};

export const getAIUserObjectId = async (): Promise<Types.ObjectId> => {
  const aiUser = await ensureAIUser();
  return aiUser._id as Types.ObjectId;
};
