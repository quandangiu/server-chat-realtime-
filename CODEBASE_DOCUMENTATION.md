# Chat Realtime Server - Comprehensive Codebase Documentation

**Project:** chat-realtime-server v1.0.0  
**Architecture:** Express.js + MongoDB + Redis + Socket.io + OpenAI  
**Language:** TypeScript  
**Environment:** Node.js (ES2020 target)  

---

## 📋 Table of Contents

1. [Project Overview](#project-overview)
2. [Technology Stack](#technology-stack)
3. [Core Infrastructure](#core-infrastructure)
4. [Database Models & Schema](#database-models--schema)
5. [API Endpoints & Routes](#api-endpoints--routes)
6. [Authentication & Authorization](#authentication--authorization)
7. [Real-Time Capabilities (Socket.io)](#real-time-capabilities-socketio)
8. [AI Service Integration](#ai-service-integration)
9. [File Upload & Storage](#file-upload--storage)
10. [Middleware & Error Handling](#middleware--error-handling)
11. [Services & Utilities](#services--utilities)

---

## 🎯 Project Overview

**Purpose:**  
A comprehensive team collaboration platform with real-time messaging, task management, AI assistance, and voice/video capabilities.

**Key Features:**
- Real-time messaging with encryption support
- Workspace & channel management with role-based access
- Task management (Work/Event/Poll types)
- User presence tracking
- Voice/Video calling infrastructure
- AI assistant integration (OpenAI)
- File upload via Cloudinary
- Message reactions & threading

---

## 🛠️ Technology Stack

### Core Dependencies
- **express** (^4.18.2) - Web framework
- **socket.io** (^4.6.1) - Real-time bidirectional communication
- **mongoose** (^8.0.0) - MongoDB ODM
- **redis** (^4.6.7) - Caching & real-time data
- **jsonwebtoken** (^9.0.0) - JWT authentication
- **bcrypt** (^5.1.1) - Password hashing
- **multer** + **multer-storage-cloudinary** - File upload middleware
- **cloudinary** (^1.41.0) - Cloud storage for files
- **openai** (^6.31.0) - AI assistant API
- **zod** (^3.22.4) - Schema validation
- **crypto-js** (^4.2.0) - Message encryption
- **slugify** (^1.6.6) - Slug generation

### Development
- **typescript** (^5.3.2) - Type safety
- **tsx** (^4.0.0) - TypeScript runner
- **@types/** packages - Type definitions

---

## 🔧 Core Infrastructure

### Server Entry Point (`src/server.ts`)

```typescript
// Main server initialization with:
- Express app setup
- CORS configuration (supports LAN access via 192.168.x.x, 10.x.x.x)
- Middleware stack (JSON parser, cookie parser)
- Database connections (MongoDB + Redis)
- Socket.io initialization
- Health check endpoint: GET /api/health
- Error handler (must be last middleware)
- Server listens on configurable PORT (default: 3000) & HOST (default: 0.0.0.0)
```

### Database Connections

#### MongoDB (`src/config/db.ts`)
- **Connection String:** `MONGO_URI` env var (default: `mongodb://localhost:27017/chatapp`)
- **Behavior:** Throws error on connection failure (critical service)
- **Status Logging:** Logs connection status on startup

#### Redis (`src/config/redis.ts`)
- **Connection String:** `REDIS_URL` env var (default: `redis://localhost:6379`)
- **Behavior:** Continues without Redis if connection fails (graceful degradation)
- **Use Cases:**
  - Presence tracking (online/offline status)
  - Voice channel member lists
  - AI rate limiting
  - Token blacklisting (refresh tokens)
  - Task suggestion deduplication

#### Cloudinary (`src/config/cloudinary.ts`)
- **Configuration:** Lazy-loaded on first use
- **Credentials:** `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`
- **Storage Paths:**
  - Images: `chat/images` folder
  - Files: `chat/files` folder

---

## 📊 Database Models & Schema

### 1. **User Model** (`src/models/User.ts`)

```typescript
interface IUser {
  _id: ObjectId
  username: string (unique, min 3 chars)
  email: string (unique, lowercase)
  passwordHash: string (selected: false in queries)
  avatar?: string | null
  displayName: string (max 50 chars)
  status: 'online' | 'offline' | 'away' (default: offline)
  lastSeen: Date (default: now)
  bio: string (max 200 chars)
  timestamps: true (createdAt, updatedAt)
}
```

**Key Features:**
- Password never returned in API responses (passwordHash select: false)
- Status tracking for presence system
- Display name separate from username

---

### 2. **Workspace Model** (`src/models/Workspace.ts`)

```typescript
interface IWorkspace {
  _id: ObjectId
  name: string (required, max 80 chars)
  slug: string (unique, auto-generated from name + timestamp)
  icon: string (default: '💬')
  avatar?: string | null
  aiEnabled: boolean (default: true)
  owner: ObjectId (ref: User)
  members: Array<{
    user: ObjectId (ref: User)
    role: 'owner' | 'admin' | 'member'
    joinedAt: Date
  }>
  inviteCode: string (unique, auto-generated 8-char code)
  timestamps: true
}
```

**Indexes:**
- `members.user`: 1 (for member lookup)

**Auto-Hooks:**
- On save: Generate slug from name + timestamp
- On save: Generate inviteCode if missing

**Role Hierarchy:**
- **Owner:** Can delete workspace, manage all members, change roles
- **Admin:** Can create channels, manage members, change member roles (except owner)
- **Member:** Can create public/DM channels, join existing channels

---

### 3. **Channel Model** (`src/models/Channel.ts`)

```typescript
interface IChannel {
  _id: ObjectId
  workspace: ObjectId (ref: Workspace, required)
  name: string (required, max 80 chars)
  type: 'public' | 'private' | 'dm' | 'voice' (default: public)
  description: string
  members: ObjectId[] (ref: User)
  createdBy: ObjectId (ref: User)
  lastMessage: ObjectId (ref: Message)
  lastActivity: Date (default: now)
  dmUsers: ObjectId[] (ref: User) - exactly 2 users for DM
  encryptionEnabled: boolean (default: false)
  encryptionKey: string (select: false - never returned by default)
  timestamps: true
}
```

**Indexes:**
- `workspace`: 1
- `members`: 1
- `lastActivity`: -1

**Channel Type Behaviors:**
- **Public:** All workspace members auto-join
- **Private:** Only invited members
- **DM:** Between 2 specific users, workspace-scoped
- **Voice:** All workspace members auto-join, no messages

**Encryption:**
- Uses AES encryption (CryptoJS) for message content
- Key stored in DB (select: false) but never sent to clients
- Messages encrypted before storage, decrypted on retrieval

---

### 4. **Message Model** (`src/models/Message.ts`)

```typescript
interface IMessage {
  _id: ObjectId
  channel: ObjectId (ref: Channel, required)
  sender: ObjectId (ref: User, required)
  content: string (default: '')
  type: 'text' | 'image' | 'file' | 'system' (default: text)
  attachment?: {
    url: string
    name: string
    size: number
    mimeType: string
    publicId: string (Cloudinary public_id)
  }
  replyTo?: ObjectId (ref: Message)
  aiCommandOf?: ObjectId (ref: Message) - links AI response to user command
  reactions: Map<emoji, ObjectId[]> (default: {})
  readBy: Array<{
    user: ObjectId (ref: User)
    readAt: Date (default: now)
  }>
  isEdited: boolean (default: false)
  editedAt?: Date
  isDeleted: boolean (default: false)
  timestamps: true
}
```

**Indexes:**
- `channel, _id`: -1 (load messages by channel in reverse order)
- `channel, createdAt`: -1 (fetch messages by date)
- `aiCommandOf, isDeleted`: 1 (find linked AI responses)
- `content`: text (full-text search)

**Message Types:**
- **Text:** Regular chat messages
- **Image:** Image attachments
- **File:** Document/file attachments
- **System:** AI responses, notifications

**Read Tracking:**
- Each message tracks who has read it
- Client marks messages as read via socket event
- Dashboard shows unread count per channel

**Soft Deletion:**
- `isDeleted: true` + empty `content`
- Message ID preserved for thread integrity
- Deleted AI command messages also delete linked AI responses

---

### 5. **Task Model** (`src/models/Task.ts`)

```typescript
interface ITask {
  _id: ObjectId
  workspace: ObjectId (ref: Workspace, required)
  channel: ObjectId (ref: Channel, required)
  sourceMessage?: ObjectId (ref: Message) - message that created task
  taskType: 'work' | 'event' | 'poll' (default: work)
  title: string (required, max 200 chars)
  description: string
  status: 'todo' | 'in_progress' | 'review' | 'done' | 'blocked' (default: todo)
  priority: 'low' | 'medium' | 'high' | 'urgent' (default: medium)
  assignee?: ObjectId (ref: User)
  createdBy: ObjectId (ref: User, required)
  dueDate?: Date | null
  completedAt?: Date | null

  // Event Task Fields
  eventAt?: Date | null
  location?: string
  eventRsvps: Array<{
    user: ObjectId (ref: User)
    response: 'going' | 'maybe' | 'declined'
  }>

  // Poll Task Fields
  pollQuestion: string
  pollOptions: Array<{
    option: string
    votes: ObjectId[] (ref: User)
  }>
  pollExpiresAt?: Date | null
  pollAnonymous: boolean (default: false)
  pollMultiChoice: boolean (default: false)

  timestamps: true
}
```

**Task Type Details:**

#### Work Task
- **Purpose:** Track work assignments
- **Flow:** todo → in_progress → review → done | blocked
- **Creation Rules:** Only admin/owner in workspace
- **Assignment:** Can assign to specific members
- **Deadline Tracking:** Tracks due dates & completion
- **AI Integration:** `@AI assign @username [description]` creates work tasks

#### Event Task
- **Purpose:** Schedule group events/meetings
- **Features:** RSVP tracking (going/maybe/declined)
- **Reminders:** 24-hour advance notifications
- **Countdown:** Client-side countdown display
- **Triggers:** Keywords like "hẹn", "đi chơi", "sinh nhật", "party"

#### Poll Task
- **Purpose:** Group voting/decision making
- **Options:** 2-6 choices per poll
- **Features:** Anonymous/public voting, multi-choice support
- **Expiration:** Automatic close after expiration time
- **Vote Tracking:** JSON array with user IDs

---

### 6. **Notification Model** (`src/models/Notification.ts`)

```typescript
{
  _id: ObjectId
  recipient: ObjectId (ref: User, required)
  type: 'mention' | 'dm' | 'reaction' | 'invite'
  actor: ObjectId (ref: User) - user who triggered notification
  payload: {
    messageId?: ObjectId (ref: Message)
    channelId?: ObjectId (ref: Channel)
    workspaceId?: ObjectId (ref: Workspace)
    preview?: string
  }
  isRead: boolean (default: false)
  readAt?: Date
  timestamps: true (createdAt, updatedAt)
}
```

**Index:** `recipient, isRead, createdAt`: -1

**Notification Types:**
- **mention:** User @mentioned in message
- **dm:** Direct message received in DM channel
- **reaction:** User added reaction to user's message
- **invite:** User invited to workspace/channel

---

## 🔐 Authentication & Authorization

### JWT Token Strategy

#### Access Token
- **Payload:** `{ userId: string }`
- **Secret:** `JWT_ACCESS_SECRET` env var
- **Expiration:** 15 minutes
- **Usage:** Bearer token in Authorization header
- **Format:** `Authorization: Bearer <token>`

#### Refresh Token
- **Payload:** `{ userId: string }`
- **Secret:** `JWT_REFRESH_SECRET` env var
- **Expiration:** 7 days
- **Storage:** HTTP-only cookie + Redis
- **Cookie Settings:** `httpOnly: true`, `secure: false`, `sameSite: lax`
- **Redis Key:** `refresh:{userId}:{token}` with 7-day expiration
- **Usage:** Automatic renewal endpoint

### Authentication Middleware (`src/middleware/auth.middleware.ts`)

```typescript
authenticate(req, res, next) {
  - Extract Bearer token from Authorization header
  - Verify token signature & expiration
  - Extract userId and attach to req.userId
  - Return 401 if token invalid/expired
  - Can be applied to individual routes or route groups
}
```

### Authorization Patterns

**Workspace-Level:**
- Owner: Full control (delete, change all roles)
- Admin: Manage members (add/remove), create channels, change member roles (except owner)
- Member: Create channels, join channels

**Channel-Level:**
- Creator or Admin/Owner: Can edit/delete channel
- Members: Can send messages, view history
- Private Channel: Only invited members can access
- Public/Voice: All workspace members auto-join

**Task-Level:**
- Work Task: Only assigned member OR admin/owner can update
- Event Task: Any member can RSVP
- Poll Task: Any member can vote

### Session Management

**Login Flow:**
1. User provides email + password
2. Password compared against bcrypt hash
3. Access token generated (15m)
4. Refresh token generated (7d) & stored in Redis + cookie
5. User status set to 'online'

**Token Refresh Flow:**
1. Client sends POST /api/auth/refresh-token with cookie
2. Refresh token extracted from cookie
3. Verified against Redis blacklist & signature
4. If valid: Generate new access token
5. If invalid: Return 401 (client must re-login)

**Logout Flow:**
1. Extract refresh token from cookie
2. Delete token from Redis (revoke)
3. Update user status to 'offline' + lastSeen
4. Clear cookie

---

## 📡 Real-Time Capabilities (Socket.io)

### Connection & Authentication

```typescript
// Client connection:
const socket = io(SERVER_URL, {
  auth: {
    token: accessToken  // JWT access token
  }
})

// Server validates token on every connection
io.use((socket, next) => {
  const token = socket.handshake.auth.token
  const decoded = verifyToken(token)  // Throws if invalid
  socket.userId = decoded.userId
  next()
})
```

**CORS:**
- Allowed origins from `CLIENT_URLS` env var (comma-separated)
- Supports LAN: 192.168.x.x, 10.x.x.x, 172.16-31.x.x
- Credentials: true (for cookies)
- Transports: WebSocket + polling fallback

### Socket.io Room Structure

```
user:{userId}              - Personal room for DMs & calls
workspace:{workspaceId}    - All workspace broadcasts
channel:{channelId}        - Channel-specific messages
video:{roomId}            - Video call room
```

### Message Events

#### send_message
```typescript
socket.emit('send_message', {
  channelId: string
  content: string
  type: 'text' | 'image' | 'file'
  replyTo?: ObjectId
  attachment?: { url, name, size, mimeType, publicId }
}, (response) => {
  // { success: true, message: IMessage } or { error: string }
})

// Broadcast:
io.to(`channel:${channelId}`).emit('new_message', { message })
```

**Features:**
- Saves to database immediately
- Encrypts if channel has encryption enabled
- Triggers AI handler if message starts with @AI
- Returns plaintext to sender
- Updates channel lastActivity

#### typing_start / typing_stop
```typescript
socket.emit('typing_start', { channelId })
socket.emit('typing_stop', { channelId })

// Broadcasts:
socket.to(`channel:${channelId}`).emit('user_typing', 
  { userId, username: '', channelId }
)
socket.to(`channel:${channelId}`).emit('user_stop_typing', 
  { userId, channelId }
)
```

#### mark_read
```typescript
socket.emit('mark_read', { channelId, messageId })

// Marks all messages in channel up to messageId as read by current user
// Broadcasts: io.to(`channel:${channelId}`).emit('messages_read', 
//   { userId, channelId, lastReadMessageId }
// )
```

### Presence Events

#### join_workspace
```typescript
socket.emit('join_workspace', { workspaceId })

// Server broadcasts online members:
socket.emit('workspace_online_users', 
  { workspaceId, onlineIds: string[] }
)

// Server broadcasts voice channel snapshots:
socket.emit('voice_channel_updated', 
  { channelId, members: VoiceMember[] }
)
```

#### join_channel / leave_channel
```typescript
socket.on('join_channel', ({ channelId })) => {
  // Join socket to room, validates membership first
})

socket.on('leave_channel', ({ channelId })) => {
  // Leave the room
})
```

#### heartbeat
```typescript
socket.emit('heartbeat')
// Refreshes presence TTL in Redis (extends 5-min window)
```

### Presence Event: user_status_changed
**Broadcast:** When user goes online/offline
```typescript
io.to(`workspace:${workspaceId}`).emit('user_status_changed', {
  userId: string
  status: 'online' | 'offline'
  lastSeen?: Date  // Only on offline
})
```

**Triggered:**
- On socket connection (goes online)
- On final disconnect (all sockets disconnected for user, goes offline)
- Redis TTL expiration (5-min heartbeat window)

### Video Call Events

#### call_user
```typescript
socket.emit('call_user', { targetUserId, roomId })
// Sends: io.to(`user:${targetUserId}`).emit('incoming_call', 
//   { callerId, roomId }
// )
```

#### accept_call
```typescript
socket.emit('accept_call', { callerId, roomId })
socket.join(`video:${roomId}`)
// Sends: io.to(`user:${callerId}`).emit('call_accepted', 
//   { userId: socket.userId, roomId }
// )
```

#### reject_call
```typescript
socket.emit('reject_call', { callerId })
// Sends: io.to(`user:${callerId}`).emit('call_rejected', 
//   { userId: socket.userId }
// )
```

#### end_call
```typescript
socket.emit('end_call', { roomId })
// Broadcasts: io.to(`video:${roomId}`).emit('call_ended', 
//   { userId: socket.userId }
// )
socket.leave(`video:${roomId}`)
```

#### WebRTC Signaling (offer/answer/ICE)
```typescript
socket.emit('webrtc_offer', { targetUserId, offer: RTCSessionDescription })
socket.emit('webrtc_answer', { targetUserId, answer: RTCSessionDescription })
socket.emit('webrtc_ice_candidate', { targetUserId, candidate: RTCIceCandidate })

// All forwarded to target user with fromUserId
```

### Voice Channel Events

#### join_voice_channel
```typescript
socket.emit('join_voice_channel', { channelId }, (response) => {
  // { success: true } or { error: string }
})

// Server:
// 1. Stores member in Redis: voice:{channelId}
// 2. Notifies existing members:
socket.to(`workspace:${workspaceId}`).emit('voice_user_joined', 
  { userId, channelId }
)
// 3. Broadcasts updated member list:
io.to(`workspace:${workspaceId}`).emit('voice_channel_updated', 
  { channelId, members: VoiceMember[] }
)
```

**VoiceMember Structure:**
```typescript
{
  userId: string
  username: string
  displayName: string
  avatar: string | null
  joinedAt: ISO8601 timestamp
  isMuted: boolean
  isDeafened: boolean
}
```

#### leave_voice_channel
```typescript
socket.emit('leave_voice_channel', { channelId }, (response) => {
  // { success: true } or { error: string }
})

// Server:
// 1. Removes from Redis list
// 2. Broadcasts departure:
io.to(`workspace:${workspaceId}`).emit('voice_user_left', 
  { userId, channelId }
)
// 3. Updates member list
```

#### toggle_mute / toggle_deafen
```typescript
socket.emit('toggle_mute', { channelId, isMuted }, callback)
socket.emit('toggle_deafen', { channelId, isDeafened }, callback)

// Broadcasts:
io.to(`workspace:${workspaceId}`).emit('voice_member_updated', 
  { channelId, userId, isMuted/isDeafened }
)
```

### Real-Time Broadcasting Events (from Controllers/Services)

These are emitted by server when REST API actions occur:

```typescript
// Workspace
io.to(`workspace:${workspaceId}`).emit('workspace_updated', workspace)
io.to(`workspace:${workspaceId}`).emit('workspace_member_added', 
  { workspaceId, userId }
)
io.to(`workspace:${workspaceId}`).emit('workspace_member_removed', 
  { workspaceId, userId }
)
io.to(`user:${userId}`).emit('workspace_kicked', { workspaceId })

// Channel
io.to(`workspace:${workspaceId}`).emit('channel_created', { channel })
io.to(`workspace:${workspaceId}`).emit('channel_updated', { channel })
io.to(`workspace:${workspaceId}`).emit('channel_deleted', { channelId })

// Message
io.to(`channel:${channelId}`).emit('message_updated', {
  messageId, content, isEdited, editedAt
})
io.to(`channel:${channelId}`).emit('message_deleted', { messageId, channelId })
io.to(`channel:${channelId}`).emit('reaction_updated', 
  { messageId, channelId, reactions }
)

// Task
io.to(`channel:${channelId}`).emit('task_created', { task })
io.to(`channel:${channelId}`).emit('task_updated', { task })
io.to(`channel:${channelId}`).emit('task_deleted', { taskId, channelId, workspaceId })
```

---

## 🤖 AI Service Integration

### Overview

**Service:** `src/services/ai.service.ts`  
**Handler:** `src/socket/handlers/ai.handler.ts`  
**Model:** OpenAI GPT (configurable via `OPENAI_API_KEY`)  

### AI User Setup

```typescript
ensureAIUser() {
  // Creates/retrieves bot user with:
  // - username: "AI-Assistant"
  // - email: "ai@chatapp.com"
  // - avatar: DiceBear SVG
  // - status: "online"
  // - bio: "Workspace AI assistant"
  
  // Auto-created on first AI command if not exists
}
```

### Command Parsing

**Trigger:** Messages starting with `@ai`

```typescript
parseAICommand(content: string) {
  // Input: "@ai summarize last 30 messages"
  // Output: { command: "summarize", args: "last 30 messages" }
  
  // Input: "just a regular message"
  // Output: null (no command)
}
```

### Commands

#### @AI help
- Lists all available commands
- No rate limiting

#### @AI stats
- Total messages in channel
- Unique senders
- Last activity timestamp

#### @AI summarize
- Summarizes 30 most recent messages
- Combines rule-based + LLM summaries
- Output: Natural language summary

#### @AI recap
- Per-member view of assigned work tasks
- Shows pending + overdue tasks
- Respects member view (only their assignments)

#### @AI recap-done (admin/owner only)
- Lists work tasks by assignee status
- Shows: done tasks, pending tasks, overdue tasks
- Admin/owner view only

#### @AI recap-event (admin/owner only)
- Lists all upcoming events
- Shows RSVP counts
- Admin/owner view only

#### @AI remind
- Lists tasks due within 24 hours
- Helps members prepare for deadlines

#### @AI assign @username [description]
- Creates work task and assigns to user
- Automatic title generation from description
- Sets default priority: medium
- Only admin/owner can create

#### @AI poll [question] / [option1] / [option2] ...
- Creates poll task
- 2-6 options required
- Expires after 24 hours default
- Triggers: Keywords like "chọn", "vote", "nên đi đâu"

#### @AI done [task name or ID]
- Marks user's own task as complete
- Updates status: in_progress → done
- Sets completedAt timestamp

### Natural Language Features

#### Task Detection
- Watches for natural language patterns
- Triggers: "hẹn", "đi chơi", "gặp nhau", "sinh nhật", "party"
- Suggests: "Would you like me to create an Event task?"
- Deduplicates: 2-minute window per user/channel

### Rate Limiting

```typescript
Config:
- DEFAULT: 6 AI commands per 60 seconds per user per workspace
- Configurable: AI_RATE_LIMIT_COUNT, AI_RATE_LIMIT_WINDOW_SEC
- Storage: Redis key `ai:rl:{workspaceId}:{userId}`
- Fail-open: If Redis unavailable, allows all requests
```

**Response on Rate Limit:**
```
"Bạn đang dùng AI quá nhanh. Vui lòng thử lại sau {X}s."
```

### System Prompt

```
SYSTEM_PROMPT focuses on:
- Task types: Event, Work, Poll
- Smart context from conversation
- Vietnamese + English support
- Friendly, concise tone
- Format structured responses
```

### AI Message Storage

```typescript
// When AI responds:
await Message.create({
  channel: channelId
  sender: aiUser._id
  content: `[AI Support]\n${response}`
  type: 'system'
  aiCommandOf: sourceMessageId  // Links to user's @AI command
})

// If source message deleted:
// Related AI message also deleted automatically
```

### Workspace Control

```typescript
// Each workspace has aiEnabled flag
workspace.aiEnabled: true | false

// If disabled:
// - No AI commands processed
// - No suggestions sent
```

---

## 📁 File Upload & Storage

### Multer Configuration (`src/middleware/upload.middleware.ts`)

**Allowed MIME Types:**
- Images: jpeg, png, gif, webp
- Documents: pdf, txt, zip, docx (MS Word)

**Max File Size:** 10 MB

**Storage Provider:** Cloudinary

```typescript
CloudinaryStorage Config:
- Images folder: chat/images
- Files folder: chat/files
- Resource type: auto-detect (image vs raw)
- Public ID: {timestamp}-{randomString}
```

### Upload Endpoints

#### POST /api/files/upload
```typescript
multipart/form-data {
  file: File (required)
}

Response: {
  success: true
  data: {
    url: string (secure_url from Cloudinary)
    name: string (original filename)
    size: number (bytes)
    mimeType: string
    publicId: string (for deletion)
  }
}
```

#### DELETE /api/files/{publicId}
```typescript
// Deletes file from Cloudinary
// publicId must be URL-encoded if contains special chars

Response: { success: true, data: null }
```

### Message Attachments

Messages can include attachments:

```typescript
attachment: {
  url: string (Cloudinary secure URL)
  name: string
  size: number (bytes)
  mimeType: string
  publicId: string (for deletion via API)
}
```

### Workspace Avatar Upload

```typescript
PUT /api/workspaces/{id}/avatar
multipart/form-data {
  avatar: File (required)
}

// Only owner/admin can upload
// Updates workspace.avatar field
// Broadcasts via socket: workspace_updated
```

---

## 🛡️ Middleware & Error Handling

### Middleware Stack (src/server.ts)

1. **CORS** - Cross-origin requests
2. **express.json({ limit: '10mb' })** - JSON body parsing
3. **cookie-parser** - Cookie parsing
4. **Authentication** - Per-route token validation
5. **Validation** - Request body schema validation
6. **Upload** - Multer file handling
7. **Routes** - API endpoints
8. **errorHandler** - Centralized error response

### Authentication Middleware

```typescript
authenticate(req, res, next) {
  - Extracts "Bearer {token}" from Authorization header
  - Verifies token with JWT_ACCESS_SECRET
  - Sets req.userId on success
  - Returns 401 on failure
  - Per-route application
}
```

### Validation Middleware

```typescript
validate(schema: ZodSchema)(req, res, next) {
  - Parses req.body against Zod schema
  - Returns 400 with validation errors if fails
  - Overwrites req.body with parsed data
  - Continues on success
}
```

**Example Usage:**
```typescript
router.post('/login', 
  validate(loginSchema),
  login
)
```

### Upload Middleware

```typescript
upload.single(fieldName) - Multer middleware for single file
upload.array(fieldName, maxCount?) - Multiple files

// Applied to routes that handle file uploads
POST /api/files/upload - File upload
PUT /api/users/{id} - Avatar update
PUT /api/workspaces/{id}/avatar - Workspace avatar
```

### Error Handler Middleware

```typescript
errorHandler(err, req, res, next) {
  - Extracts error message
  - Uses err.statusCode (defaults to 500)
  - Logs error with "❌ Error:" prefix
  - Returns JSON:
    {
      success: false
      error: {
        code: 'INTERNAL_ERROR'
        message: string
      }
    }
}
```

**Must be last middleware** (per Express docs)

### Standard Error Response Format

```typescript
{
  success: false
  error: {
    code: string (e.g., 'UNAUTHORIZED', 'NOT_FOUND', 'FORBIDDEN')
    message: string (localized to Vietnamese mostly)
  }
}
```

---

## 📡 API Endpoints & Routes

### Route Organization (`src/routes/index.ts`)

```typescript
/api/auth         → auth.routes.ts
/api/users        → user.routes.ts
/api/workspaces   → workspace.routes.ts
/api/channels     → channel.routes.ts
/api/messages     → message.routes.ts
/api/files        → file.routes.ts
/api/tasks        → task.routes.ts
```

### Health Check

```
GET /api/health
Response: { success: true, message: 'Server is running', timestamp: Date }
```

### Authentication Endpoints (`src/routes/auth.routes.ts`)

#### POST /api/auth/register
```typescript
Body: {
  username: string (min 3 chars)
  email: string (valid email)
  password: string
}

Response: {
  success: true
  data: {
    user: {
      _id: string
      username: string
      email: string
      avatar: null
    }
    accessToken: string
  }
}

Errors:
- 409: Email or username already exists
- 400: Validation errors
```

**Side Effects:**
- Creates user with bcrypt-hashed password
- Generates access + refresh tokens
- Sets refresh token in Redis
- Sets HTTP-only cookie

#### POST /api/auth/login
```typescript
Body: {
  email: string
  password: string
}

Response: {
  success: true
  data: {
    user: { _id, username, email, avatar, displayName }
    accessToken: string
  }
}

Errors:
- 401: Invalid email or password
```

**Side Effects:**
- Updates user status to 'online'
- Sets refresh token cookie

#### POST /api/auth/refresh-token
```typescript
// Reads refreshToken from cookie

Response: {
  success: true
  data: {
    accessToken: string
  }
}

Errors:
- 401: No refresh token in cookie
- 401: Token invalid or revoked
```

#### POST /api/auth/logout
```typescript
// Requires: Authorization header with access token
// Reads: Refresh token from cookie

Response: { success: true, data: null }

Errors:
- 401: No access token
```

**Side Effects:**
- Deletes refresh token from Redis (revoke)
- Updates user status to 'offline' + lastSeen
- Clears refreshToken cookie

#### GET /api/auth/me
```typescript
// Requires: Authorization header

Response: {
  success: true
  data: {
    _id: string
    username: string
    email: string
    avatar: string | null
    displayName: string
    status: 'online' | 'offline' | 'away'
    lastSeen: Date
    bio: string
    createdAt: Date
    updatedAt: Date
  }
}

Errors:
- 401: No/invalid token
- 404: User not found (shouldn't happen)
```

### User Endpoints (`src/routes/user.routes.ts`)

#### GET /api/users/search?q={query}&limit={limit}
```typescript
Query:
- q: string (search term in username, displayName, email)
- limit: number (default: 10)

Response: {
  success: true
  data: [
    {
      _id: string
      username: string
      avatar: string | null
      displayName: string
      status: 'online' | 'offline' | 'away'
    }
  ]
}

Filters Out:
- Current user
- 404 if q not provided
```

#### GET /api/users/{id}
```typescript
Response: User document (full)

Errors:
- 404: User not found
```

#### PUT /api/users/{id}
```typescript
Requires: User ID must match authed user (own profile)

Body: {
  displayName?: string
  bio?: string
  avatar?: File (multipart)
}

Response: Updated user document

Errors:
- 403: Cannot update other user's profile
- 404: User not found
```

### Workspace Endpoints (`src/routes/workspace.routes.ts`)

#### POST /api/workspaces
```typescript
Body: {
  name: string (required)
  description?: string
}

Response: New workspace with:
- owner: current user
- members: [{ user: current user, role: 'owner' }]
- Slug auto-generated
- inviteCode auto-generated
- #general channel auto-created

Status: 201
```

#### GET /api/workspaces
```typescript
// Returns all workspaces where user is member

Response: {
  success: true
  data: [...workspaces with populated members]
}
```

#### GET /api/workspaces/{id}
```typescript
// Only members can view

Response: Workspace with populated members

Errors:
- 404: Not found
- 403: Not a member
```

#### GET /api/workspaces/join/{inviteCode}
```typescript
// Joins workspace via invite code

Response: Workspace

Side Effects:
- Adds user to workspace members (role: member)
- Adds user to all public/voice channels
- Broadcasts: workspace_member_added event

Errors:
- 404: Invalid invite code
```

#### PUT /api/workspaces/{id}
```typescript
// Only admin/owner

Body: {
  name?: string
  icon?: string
  aiEnabled?: boolean
  // other fields...
}

Response: Updated workspace

Broadcasts: workspace_updated event

Errors:
- 403: Not admin/owner
- 404: Workspace not found
```

#### PUT /api/workspaces/{id}/avatar
```typescript
Multipart: { avatar: File }

// Only admin/owner
// Updates workspace.avatar field
// Uploads to Cloudinary

Response: Updated workspace

Broadcasts: workspace_updated event
```

#### DELETE /api/workspaces/{id}
```typescript
// Only owner can delete fully

Response: { success: true, data: null }

Side Effects:
- Cascade delete all channels (deleted via service)
- Cascade delete all messages

Errors:
- 403: Not owner
- 404: Not found
```

#### POST /api/workspaces/{id}/members
```typescript
Body: { userId: string }

// Only admin/owner

Response: Updated workspace

Side Effects:
- Adds user to workspace
- Auto-adds to public/voice channels
- Broadcasts: workspace_member_added

Errors:
- 403: Not admin/owner
- 409: Already member
- 404: Not found
```

#### PUT /api/workspaces/{id}/members/{userId}/role
```typescript
Body: { role: 'owner' | 'admin' | 'member' }

// Only admin/owner
// Owner role change: only by current owner

Response: Updated workspace

Broadcasts: member_role_updated event

Errors:
- 403: Not admin/owner or insufficient permissions
- 400: Invalid role
```

#### DELETE /api/workspaces/{id}/members/{userId}
```typescript
// Admin/owner only (or self-remove)

Response: { success: true, data: null }

Side Effects:
- Removes from workspace
- Removes from all channels
- Broadcasts: workspace_member_removed event
- If removed by others: workspace_kicked broadcast to user

Errors:
- 403: Not admin/owner
- 404: Not found
```

### Channel Endpoints (`src/routes/channel.routes.ts`)

#### POST /api/channels
```typescript
Body: {
  workspaceId: string (required)
  name: string (required)
  type: 'public' | 'private' | 'dm' | 'voice' (default: public)
  description?: string
  encryptionEnabled?: boolean
  memberIds?: string[] (for private/dm)
}

Response: New channel

Validation:
- Private channels: admin/owner only
- Private members filtered: excludes AI bot
- Public/voice: auto-add all workspace members

Broadcasts: channel_created event

Status: 201
```

#### GET /api/channels/workspace/{workspaceId}
```typescript
// Returns channels user is member of
// Unread count calculated for each
// Auto-joins public/voice channels if not member

Response: [
  {
    ...channel
    unreadCount: number
  }
]
```

#### GET /api/channels/{id}
```typescript
// Only members can view

Response: Channel document

Errors:
- 404: Not found
- 403: Not member
```

#### GET /api/channels/{id}/key
```typescript
// Returns encryptionKey if enabled (admin/owner only)
// Security: Never exposed to regular members
```

#### GET /api/channels/{id}/members
```typescript
// Returns channel members with user fields
// Filters out AI bot from response

Response: [User, ...]
```

#### POST /api/channels/{id}/members
```typescript
Body: { userId: string }

// Private channels only
// Admin/owner only

Response: Updated channel

Errors:
- 400: Not a private channel
- 403: Not admin/owner
- 404: Channel/user not found
- 409: Already member
```

#### DELETE /api/channels/{id}/members/{userId}
```typescript
// Private channels only
// Admin/owner OR self-remove

Response: { success: true, data: null }

Errors:
- 400: Not a private channel
- 403: Insufficient permissions
```

#### PUT /api/channels/{id}
```typescript
// Creator or admin/owner

Body: {
  name?: string
  description?: string
  type?: string
  // ...
}

Response: Updated channel

Broadcasts: channel_updated event

Errors:
- 403: Not creator/admin/owner
- 404: Not found
```

#### DELETE /api/channels/{id}
```typescript
// Creator or admin/owner

Response: { success: true, data: null }

Side Effects:
- Deletes all messages in channel
- Broadcasts: channel_deleted event

Errors:
- 403: Not creator/admin/owner
- 404: Not found
```

#### POST /api/channels/dm
```typescript
Body: {
  workspaceId: string
  targetUserId: string
}

Response: DM channel (existing if already created)

Side Effects:
- Creates or retrieves existing DM between 2 users
- Both users auto-members

Status: 201 if created, 200 if existing
```

### Message Endpoints (`src/routes/message.routes.ts`)

#### GET /api/messages/channel/{channelId}
```typescript
Query:
- cursor?: ObjectId (for pagination)
- limit?: number (default: 50)

// Pagination: load 50 messages before cursor
// Returns next cursor for loading more

Response: {
  success: true
  data: {
    messages: [...] (reversed for chronological order)
    nextCursor: ObjectId | null
    hasMore: boolean
  }
}

Message Processing:
- Decrypts if channel encryption enabled
- Filters out deleted messages
- Converts reactions Map to Object
- Clears reply text if replied-to message deleted

Errors:
- 403: Not channel member
```

#### POST /api/messages/channel/{channelId}
```typescript
Body: {
  content: string
  type: 'text' | 'image' | 'file' (default: text)
  replyTo?: ObjectId
  attachment?: { url, name, size, mimeType, publicId }
}

Response: Created message (plaintext content returned)

Status: 201

Side Effects:
- Encrypts content if channel has encryption
- Updates channel lastActivity & lastMessage
- Triggers AI handler (async, no wait)
- Broadcasts: new_message event

Errors:
- 403: Not channel member
- 404: Channel not found
```

#### PUT /api/messages/{id}
```typescript
// Only message sender

Body: { content: string }

Response: Updated message

Side Effects:
- Sets isEdited: true, editedAt: now
- Broadcasts: message_updated event

Errors:
- 403: Not message sender
- 404: Not found
```

#### DELETE /api/messages/{id}
```typescript
// Sender OR admin/owner/channel member (permissions vary)

Response: { success: true, data: null }

Side Effects:
- Soft delete: isDeleted: true, content: ''
- If was AI command: delete linked AI response too
- Broadcasts: message_deleted event

Errors:
- 403: Not sender & not admin/owner
- 404: Not found
```

#### POST /api/messages/{id}/reactions
```typescript
Body: {
  emoji: string
  action: 'add' | 'remove'
}

Response: { reactions: { emoji: [userId, ...] } }

Side Effects:
- Updates reactions Map in message
- Broadcasts: reaction_updated event
- Removes reaction if user already voted (toggle behavior)

Errors:
- 404: Message not found
```

#### GET /api/messages/search?q={query}&channelId={channelId}
```typescript
// Full-text search on message content

Query:
- q: string (search term)
- channelId?: ObjectId (filter by channel)

Response: [messages, ...]

Errors:
- Empty if no q provided
```

### File Endpoints (`src/routes/file.routes.ts`)

#### POST /api/files/upload
```typescript
Multipart: { file: File }

Response: {
  success: true
  data: {
    url: string (Cloudinary secure_url)
    name: string
    size: number (bytes)
    mimeType: string
    publicId: string
  }
}

Status: 201

Validation:
- MIME type whitelist
- Max 10 MB

Errors:
- 400: No file
- 400: Invalid file type
- 413: File too large
```

#### DELETE /api/files/{publicId}
```typescript
// Deletes from Cloudinary
// publicId should be URL-encoded if special chars

Response: { success: true, data: null }

Errors:
- 400: publicId missing
```

### Task Endpoints (`src/routes/task.routes.ts`)

#### POST /api/tasks
```typescript
Body:
- workspaceId: string (required)
- channelId: string (required)
- taskType: 'work' | 'event' | 'poll' (required)
- title: string (required)
- description?: string
- priority?: 'low' | 'medium' | 'high' | 'urgent' (default: medium)
- assignee?: ObjectId (work task)
- dueDate?: Date (work task)
- sourceMessage?: ObjectId (link to message)
- eventAt?: Date (event task)
- location?: string (event task)
- pollQuestion?: string (poll task)
- pollOptions?: string[] (poll task)
- pollExpiresAt?: Date (poll task)
- pollAnonymous?: boolean (poll task)
- pollMultiChoice?: boolean (poll task)

Response: New task

Validation:
- Work task: admin/owner only
- Event task: any channel member
- Poll task: any channel member

Broadcasts: task_created event (workspace + channel)

Status: 201

Errors:
- 403: Insufficient permissions
- 404: Workspace/channel not found
```

#### GET /api/tasks/channel/{channelId}
```typescript
Query:
- status?: string (filter by status)

Response: [tasks, ...]

Errors:
- 403: Not channel member
```

#### GET /api/tasks/workspace/{workspaceId}
```typescript
// Returns first 300 tasks in workspace

Response: [tasks, ...]

Errors:
- 403: Not workspace member
```

#### GET /api/tasks/my-summary
```typescript
// Returns summary of current user's tasks

Response: Varies by context (personal view)
```

#### PUT /api/tasks/{id}
```typescript
// Member can edit own tasks, admin can edit all

Body: {
  title?: string
  description?: string
  status?: 'todo' | 'in_progress' | 'review' | 'done' | 'blocked'
  priority?: string
  assignee?: ObjectId
  dueDate?: Date
}

Response: Updated task

Broadcasts: task_updated event

Errors:
- 403: Not assignee & not admin/owner
- 404: Not found
```

#### DELETE /api/tasks/{id}
```typescript
// Admin/owner only (except for non-work tasks)

Response: { success: true, data: null }

Broadcasts: task_deleted event

Errors:
- 403: Insufficient permissions
- 404: Not found
```

#### POST /api/tasks/{id}/claim
```typescript
// User claims unassigned work task
// Auto-sets status to in_progress

Body: {}

Response: Updated task with assignee set to user

Errors:
- 400: Not a work task
- 409: Task already assigned to someone else
```

#### POST /api/tasks/{id}/vote
```typescript
// Vote on poll task

Body: {
  optionIndex: number
}

Response: Updated task with votes

Features:
- Single-choice: previous votes cleared
- Multi-choice: toggles vote on selection
- Anonymous: votes not tracked per user (implementation may vary)

Errors:
- 400: Not a poll task
- 400: Invalid option index
- 409: Poll expired
```

#### POST /api/tasks/{id}/rsvp
```typescript
// RSVP to event task

Body: {
  response: 'going' | 'maybe' | 'declined'
}

Response: Updated task with RSVP recorded

Errors:
- 400: Not an event task
```

---

## 🔧 Services & Utilities

### Presence Service (`src/services/presence.service.ts`)

```typescript
setOnline(userId: string)
- Redis: set `presence:{userId}` = 'online' with 5-min TTL
- DB: update User.status = 'online'

setOffline(userId: string)
- Redis: delete `presence:{userId}`
- DB: update User.status = 'offline', lastSeen = now

isOnline(userId: string): boolean
- Redis: check if `presence:{userId}` exists

getOnlineUsers(userIds: string[]): string[]
- Redis: mGet for all presence keys, return online IDs

refreshPresence(userId: string)
- Redis: reset TTL to 5 minutes (used in heartbeat)
```

**TTL:** 5 minutes per heartbeat  
**Redis Key:** `presence:{userId}`

### Notification Service (`src/services/notification.service.ts`)

```typescript
createNotification(data: {
  recipient: ObjectId
  type: 'mention' | 'dm' | 'reaction' | 'invite'
  actor: ObjectId
  payload?: { messageId, channelId, workspaceId, preview }
})
- Creates and returns Notification document

getNotifications(userId: string, limit = 20): Notification[]
- Sorted by createdAt descending
- Populated actor

markAsRead(notificationId: string, userId: string): Notification
- Sets isRead: true, readAt: now
- Returns updated notification

markAllAsRead(userId: string)
- Updates all unread notifications for user
```

### AI Service (`src/services/ai.service.ts`)

**Key Functions:**

```typescript
ensureAIUser(): User
- Returns existing AI bot user or creates new
- Username: "AI-Assistant"
- Email: "ai@chatapp.com"

parseAICommand(content: string): 
  { command: string, args: string } | null
- Extracts command after @ai
- Returns null if not a command

buildAIResponse(params: {
  channelId, workspaceId, senderId, command, args
}): string
- Builds response based on command intent
- Queries database for context
- Formats response appropriately
- Handles rate limiting

detectTaskSuggestion(content: string): string | null
- Detects natural language task patterns
- Returns suggested message or null

checkAIRateLimit(...): 
  { allowed: boolean, retryAfterSec: number }
- 6 commands/minute default
- Configurable via env vars
- Fail-open if Redis unavailable

buildRuleBasedSummary(messages): string
- Rule-based summary without LLM
- Fallback if LLM unavailable

buildRecapDoneForManager(channelId): string
- Manager recap of work task progress
- Groups by assignee

buildRecapEventForManager(channelId): string
- Manager recap of upcoming events
- Lists participants

buildRecapForMember(channelId, senderId): string
- Personal task summary
- Shows own assigned + overdue tasks

getStatsText(channelId): string
- Message count, unique senders, last activity

summarizeRecentMessages(channelId): string
- Summarizes 30 most recent messages
- Rule-based + potential LLM summary
```

### Upload Service (`src/services/upload.service.ts`)

```typescript
uploadToCloudinary(filePath: string, folder: string): 
  { url, publicId, size }
- Upload file to Cloudinary
- Resource type: auto-detect
- Returns secure URL + metadata

deleteFromCloudinary(publicId: string)
- Destroys resource from Cloudinary
```

### Utility: JWT (`src/utils/jwt.ts`)

```typescript
generateAccessToken(userId: string): string
- Payload: { userId }
- Secret: JWT_ACCESS_SECRET
- Expires: 15 minutes

generateRefreshToken(userId: string): string
- Payload: { userId }
- Secret: JWT_REFRESH_SECRET
- Expires: 7 days

verifyToken(token: string): { userId: string }
- Verifies access token
- Throws if invalid/expired
- Used in Socket.io auth + auth middleware

verifyRefreshToken(token: string): { userId: string }
- Verifies refresh token
- Throws if invalid/expired
- Used in refresh-token endpoint
```

### Utility: Bcrypt (`src/utils/bcrypt.ts`)

```typescript
hashPassword(password: string): Promise<string>
- Bcrypt rounds: 12
- Returns hash string

comparePassword(password: string, hash: string): Promise<boolean>
- Compares plaintext to hash
- Returns true if match
```

### Utility: Encryption (`src/utils/encryption.ts`)

```typescript
generateChannelKey(): string
- Generates random 32-byte hex key
- Used for channel message encryption

encryptMessage(plaintext: string, key: string): string
- AES encryption (CryptoJS)
- Returns encrypted string

decryptMessage(ciphertext: string, key: string): string
- AES decryption (CryptoJS)
- Returns plaintext
- Throws if decryption fails
```

### Utility: API Response (`src/utils/apiResponse.ts`)

```typescript
sendSuccess(res: Response, data: unknown, status = 200)
- { success: true, data }

sendError(res: Response, code: string, message: string, status = 400)
- { success: false, error: { code, message } }
```

---

## 🔍 Summary of Key Architectural Decisions

### 1. **Database Strategy**
- **MongoDB:** Primary data store (users, workspaces, channels, messages, tasks)
- **Redis:** Session (tokens), presence (TTL-based), real-time state (voice members)
- **Dual Write Pattern:** Some state in both (user status in DB + presence TTL in Redis)

### 2. **Authentication**
- **Short-lived access tokens:** 15 minutes (JWT + Bearer)
- **Long-lived refresh tokens:** 7 days (JWT + HTTP-only cookie + Redis blacklist)
- **Graceful expiration:** Client can refresh without full re-login

### 3. **Real-Time Architecture**
- **Socket.io rooms:** Namespacing by workspace/channel/user for broadcast efficiency
- **Dual comms:** REST for CRUD + Socket.io for real-time updates
- **Presence tracking:** Redis TTL + heartbeat mechanism

### 4. **Security**
- **Password hashing:** Bcrypt 12 rounds
- **Message encryption:** AES (CryptoJS) for opt-in channel encryption
- **CORS:** Whitelist + LAN detection for network flexibility
- **File upload:** Type whitelist + size limit + Cloudinary isolation

### 5. **Scalability Considerations**
- **Redis presence:** Scales to many users (TTL-based cleanup)
- **Socket rooms:** Room-based broadcasts vs individual sockets
- **Pagination:** Cursor-based message loading
- **Indexing:** MongoDB indexes on frequently queried fields

### 6. **AI Integration**
- **Rate limiting:** Per-workspace, per-user, Redis-backed
- **Async processing:** AI handler doesn't block message send
- **Graceful degradation:** Fails open if OpenAI API unavailable
- **Workspace control:** Can disable AI per-workspace

### 7. **Error Handling**
- **Centralized:** Single error handler middleware
- **Consistent:** JSON error format with code + message
- **Graceful:** Services with optional Redis continue without crash

---

## 📝 Environment Variables Required

```bash
# Server
PORT=3000
HOST=0.0.0.0
NODE_ENV=development

# Database
MONGO_URI=mongodb://localhost:27017/chatapp
REDIS_URL=redis://localhost:6379

# Authentication
JWT_ACCESS_SECRET=your-access-secret-min-32-chars
JWT_REFRESH_SECRET=your-refresh-secret-min-32-chars

# Cloudinary
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret

# OpenAI
OPENAI_API_KEY=sk-...

# CORS
CLIENT_URLS=http://localhost:5173,http://localhost:3000

# AI Settings (Optional)
AI_RATE_LIMIT_COUNT=6
AI_RATE_LIMIT_WINDOW_SEC=60
```

---

## 🚀 Startup & Deployment

### Development
```bash
npm run dev
# Uses tsx watch for hot reload
```

### Production Build
```bash
npm run build
# Compiles TypeScript to dist/
npm start
# Runs compiled JavaScript
```

### Dependencies Installation
```bash
npm install
# Installs all packages from package.json
```

---

## 📊 Data Flow Examples

### Example 1: User Login
1. Client: `POST /api/auth/login` { email, password }
2. Server: Find user by email, compare password hashes
3. If valid:
   - Generate access token (15m) + refresh token (7d)
   - Store refresh token in Redis
   - Set HTTP-only cookie
   - Return tokens to client
4. Client: Store access token in memory, refresh token auto-managed by cookie
5. Subsequent requests: Include `Authorization: Bearer {accessToken}`

### Example 2: Send Real-Time Message
1. Client: Connects to Socket.io with access token
2. Socket.io: Validates token, sets socket.userId
3. Client: `emit('join_channel', { channelId })`
4. Server: Validates membership, socket joins `channel:{channelId}` room
5. Client: `emit('send_message', { channelId, content, ... }, callback)`
6. Server:
   - Validate member (throw if not)
   - Encrypt content if channel encryption enabled
   - Save to MongoDB
   - Broadcast to `channel:{channelId}` room: `emit('new_message', ...)`
   - Trigger AI handler (async, doesn't block)
   - Return to client via callback
7. All clients in room receive `new_message` event
8. Client app updates UI

### Example 3: AI Command Processing
1. User sends: "@AI summarize" in channel
2. Message saved, broadcast like normal
3. AI handler triggered (async):
   - Parse command
   - Check rate limit (Redis)
   - Find recent 30 messages
   - Build AI prompt with context
   - Call OpenAI API
   - Create AI response message
   - Broadcast to channel: `emit('new_message', aiMessage)`
4. All users see AI response in chat

### Example 4: User Goes Online
1. User opens app
2. Client connects Socket.io with token
3. Socket.io auth passes, socket.userId set
4. Presence handler triggered:
   - `setOnline(userId)`: Redis + DB update
   - Get user's workspaces
   - For each workspace: Broadcast `user_status_changed` to workspace room
5. All users in those workspaces receive status update
6. UI updates to show user as online

---

## 🎯 Key Features Summary

| Feature | Implementation |
|---------|-----------------|
| Real-time messaging | Socket.io + MongoDB persistence |
| Presence tracking | Redis TTL + heartbeat |
| Voice channels | Redis member list + WebRTC signaling |
| Task management | MongoDB + Socket.io broadcasts |
| AI assistant | OpenAI integration + rate limiting |
| Encryption | AES per-channel (opt-in) |
| Authentication | JWT (access + refresh) + bcrypt |
| File uploads | Cloudinary + Multer |
| Message reactions | MongoDB Map fields |
| Message search | Full-text search on `content` field |
| RSVP events | Task type with custom RSVP array |
| Polls | Task type with vote tracking |
| Workspace invites | Auto-generated invite codes |
| Role-based access | Owner/Admin/Member hierarchy |

---

## 📚 File Structure Reference

```
src/
├── server.ts                 # Main entry point
├── config/                   
│   ├── db.ts                # MongoDB connection
│   ├── redis.ts             # Redis connection
│   └── cloudinary.ts        # Cloudinary config
├── controllers/             # Business logic
│   ├── auth.controller.ts
│   ├── user.controller.ts
│   ├── workspace.controller.ts
│   ├── channel.controller.ts
│   ├── message.controller.ts
│   ├── task.controller.ts
│   └── file.controller.ts
├── middleware/
│   ├── auth.middleware.ts   # JWT verification
│   ├── errorHandler.ts      # Centralized error handler
│   ├── upload.middleware.ts # Multer file upload
│   └── validate.middleware.ts # Zod schema validation
├── models/                  # MongoDB schemas
│   ├── User.ts
│   ├── Workspace.ts
│   ├── Channel.ts
│   ├── Message.ts
│   ├── Task.ts
│   └── Notification.ts
├── routes/                  # API route definitions
│   ├── index.ts
│   ├── auth.routes.ts
│   ├── user.routes.ts
│   ├── workspace.routes.ts
│   ├── channel.routes.ts
│   ├── message.routes.ts
│   ├── file.routes.ts
│   └── task.routes.ts
├── services/                # Business logic & integration
│   ├── ai.service.ts        # OpenAI integration
│   ├── presence.service.ts  # Online/offline state
│   ├── notification.service.ts
│   └── upload.service.ts
├── socket/                  # Real-time handlers
│   ├── index.ts             # Socket.io setup & auth
│   ├── instance.ts          # Global io instance
│   └── handlers/
│       ├── message.handler.ts
│       ├── presence.handler.ts
│       ├── video.handler.ts
│       ├── voice.handler.ts
│       └── ai.handler.ts
└── utils/                   # Utilities
    ├── apiResponse.ts       # Standard response format
    ├── bcrypt.ts            # Password hashing
    ├── encryption.ts        # AES message encryption
    └── jwt.ts               # Token generation/verification
```

---

**Document Version:** 1.0  
**Last Updated:** April 18, 2026  
**Codebase Status:** Production-ready with AI features

