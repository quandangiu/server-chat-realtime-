# THONG KE DU AN CHAT REALTIME (SERVER + CLIENT)

## 1. Thong tin tong quan
- Ten he thong:
  - Server: chat-realtime-server
  - Client: chat-realtime-client
- Muc tieu he thong:
  - Xay dung nen tang chat realtime theo mo hinh workspace/channel.
  - Ho tro nhan tin, file, task (work/event/poll), voice channel, video call.
- Kieu kien truc tong the:
  - Frontend SPA (React + Vite) giao tiep voi Backend (Express + Socket.IO).
  - Backend dung MongoDB (du lieu chinh) + Redis (presence/rate limit/voice state).
  - Media upload qua Cloudinary.

## 2. Kien truc cong nghe

### 2.1. Backend (server)
- Runtime + language: Node.js + TypeScript
- Framework: Express
- Realtime: Socket.IO
- Database: MongoDB (Mongoose)
- Cache/ephemeral state: Redis
- Auth: JWT access token + refresh token (cookie httpOnly)
- Upload: Multer + Cloudinary
- AI: ho tro quan ly task va thong ke task

Scripts chinh:
- dev: tsx watch src/server.ts
- build: tsc
- start: node dist/server.js

### 2.2. Frontend (client)
- Framework: React 18 + TypeScript
- Build tool: Vite
- Routing: react-router-dom
- State: Zustand
- HTTP client: Axios (co interceptor refresh token)
- Realtime: socket.io-client
- Voice/Video P2P: simple-peer (WebRTC signaling qua Socket)
- UI: TailwindCSS + react-hot-toast + lucide-react

Scripts chinh:
- dev: vite
- build: tsc && vite build
- preview: vite preview

## 3. Cau truc ma nguon

### 3.1. Server (thu muc src)
- config: ket noi db/redis/cloudinary
- controllers: xu ly nghiep vu REST
- middleware: auth, upload, error handler
- models: User, Workspace, Channel, Message, Task, Notification
- routes: auth, users, workspace, channel, message, file, task
- services: ai, presence, notification, upload
- socket:
  - index.ts: init socket + auth
  - handlers: presence, message, ai, video, voice
- utils: jwt, bcrypt, encryption, apiResponse

### 3.2. Client (thu muc src)
- pages: Home, Login, Register, Workspace, Channel, JoinInvite
- components: layout/chat/task/video/voice/ui
- router.tsx: guest/protected routes
- services: api, auth, workspace, channel, message, task, file, user
- socket: manager va event handlers
- hooks: useSocket, useMessages, useTyping, useWebRTC, useVoiceChannel, useFileUpload
- store: auth/workspace/channel/message/ui/voice stores (Zustand)
- types/utils/context: kieu du lieu va helper

## 4. Kien truc backend va data flow

### 4.1. Bootstrap server
1. Doc bien moi truong
2. Tao Express app + HTTP server
3. Cau hinh CORS (ho tro local/LAN)
4. Dang ky middleware (json, cookieParser)
5. Expose health endpoint: GET /api/health
6. Mount REST routes tai /api
7. Gan error handler
8. Khoi tao Socket.IO tren cung HTTP server
9. Ket noi MongoDB (bat buoc) + Redis (fail-open)
10. Listen host/port

### 4.2. Co che auth
- Access token:
  - Gui qua header Authorization: Bearer <token>
  - Kiem tra boi auth middleware cho REST va socket auth middleware cho WebSocket
- Refresh token:
  - Luu trong cookie refreshToken (httpOnly)
  - Luu key revoke trong Redis voi TTL 7 ngay
- Luong dang nhap:
  1) login -> validate password
  2) cap access + refresh
  3) luu refresh token vao Redis
  4) cap nhat status user = online
- Luong logout:
  1) revoke refresh token trong Redis
  2) cap nhat status user = offline + lastSeen
  3) clear cookie refreshToken

### 4.3. Co che realtime
- Moi socket connect duoc auth bang JWT token trong handshake.auth.token
- User duoc join room user:{userId}
- Presence:
  - set online/offline + heartbeat
  - join workspace de nhan online users va status changes
- Message realtime:
  - send_message -> tao Message -> emit new_message cho room channel:{id}
  - typing_start/typing_stop -> emit user_typing/user_stop_typing
  - mark_read -> cap nhat readBy va emit messages_read
- Voice:
  - join/leave voice channel
  - Redis luu danh sach voice members theo key voice:{channelId}
  - emit voice_channel_updated, voice_member_updated, voice_user_joined/left
- Video call:
  - call_user, accept/reject/end_call
  - relay webrtc_offer/webrtc_answer/webrtc_ice_candidate
- AI realtime:
  - AI duoc dung de ho tro quan ly task va thong ke task

## 5. REST API thong ke chuc nang

Tien to chung: /api

### 5.1. Auth
- POST /auth/register: dang ky
- POST /auth/login: dang nhap
- POST /auth/logout: dang xuat (auth)
- POST /auth/refresh-token: cap lai access token
- GET /auth/me: thong tin user hien tai (auth)

### 5.2. User
- GET /users/search: tim user (auth)
- GET /users/:id: chi tiet user (auth)
- PUT /users/:id: cap nhat profile + avatar (auth, upload)

### 5.3. Workspace
- POST /workspaces: tao workspace (auth)
- GET /workspaces: danh sach workspace cua user (auth)
- GET /workspaces/join/:inviteCode: join bang invite code (auth)
- GET /workspaces/:id: chi tiet workspace (auth)
- PUT /workspaces/:id: sua workspace (auth)
- PUT /workspaces/:id/avatar: cap nhat avatar workspace (auth, upload)
- DELETE /workspaces/:id: xoa workspace (auth)
- POST /workspaces/:id/members: them member (auth)
- PUT /workspaces/:id/members/:userId/role: doi role member (auth)
- DELETE /workspaces/:id/members/:userId: xoa member (auth)

### 5.4. Channel
- POST /channels: tao channel (auth)
- POST /channels/dm: tao/lay DM channel (auth)
- GET /channels/workspace/:workspaceId: lay channel theo workspace + unreadCount (auth)
- GET /channels/:id: chi tiet channel (auth)
- GET /channels/:id/key: lay encryption key neu co (auth)
- GET /channels/:id/members: lay danh sach thanh vien (auth)
- POST /channels/:id/members: them member private channel (auth)
- DELETE /channels/:id/members/:userId: xoa member private channel (auth)
- PUT /channels/:id: cap nhat channel (auth)
- DELETE /channels/:id: xoa channel (auth)

### 5.5. Message
- GET /messages/search: tim kiem fulltext message (auth)
- GET /messages/channel/:channelId: lay message cursor pagination (auth)
- POST /messages/channel/:channelId: gui message (auth)
- PUT /messages/:id: sua message (auth)
- DELETE /messages/:id: xoa message (auth)
- POST /messages/:id/reactions: them/xoa reaction (auth)

### 5.6. File
- POST /files/upload: upload file cloudinary (auth)
- DELETE /files/:publicId: xoa file cloudinary (auth)

### 5.7. Task
- POST /tasks: tao task (auth)
- GET /tasks/my-summary: thong ke task ca nhan (auth)
- GET /tasks/channel/:channelId: task theo channel (auth)
- GET /tasks/workspace/:workspaceId: task theo workspace (auth)
- POST /tasks/:id/claim: nhan task work (auth)
- POST /tasks/:id/vote: vote poll (auth)
- POST /tasks/:id/rsvp: RSVP event (auth)
- PUT /tasks/:id: cap nhat task (auth)
- DELETE /tasks/:id: xoa task (auth)

## 6. Mo hinh du lieu (MongoDB)

### 6.1. User
- username, email, passwordHash
- avatar, displayName, bio
- status: online/offline/away
- lastSeen

### 6.2. Workspace
- name, slug, icon, avatar
- aiEnabled
- owner
- members[]: user, role(owner/admin/member), joinedAt
- inviteCode

### 6.3. Channel
- workspace
- name, type(public/private/dm/voice), description
- members[]
- createdBy
- lastMessage, lastActivity
- dmUsers[]
- encryptionEnabled, encryptionKey

### 6.4. Message
- channel, sender
- content, type(text/image/file/system)
- attachment(url, name, size, mimeType, publicId)
- replyTo
- aiCommandOf (lien ket reply AI voi command goc)
- reactions (Map<emoji, userIds[]>)
- readBy[]
- isEdited, editedAt, isDeleted

### 6.5. Task
- workspace, channel, sourceMessage
- taskType: work/event/poll
- title, description
- status: todo/in_progress/review/done/blocked
- priority: low/medium/high/urgent
- assignee, createdBy
- dueDate, completedAt
- eventAt, location, eventRsvps[]
- pollQuestion, pollOptions[], pollExpiresAt, pollAnonymous, pollMultiChoice

### 6.6. Notification
- recipient, type(mention/dm/reaction/invite), actor
- payload(messageId/channelId/workspaceId/preview)
- isRead, readAt

## 7. Cac luong nghiep vu quan trong

### 7.1. Tao workspace
1. User tao workspace
2. He thong set owner/member mac dinh
3. Auto tao channel public mac dinh ten general

### 7.2. Gui message
1. User la member channel
2. Tao message (co the kem attachment/reply)
3. Cap nhat lastMessage + lastActivity cua channel
4. Emit new_message qua socket

### 7.3. Upload file
1. Request qua middleware upload (multer + cloudinary storage)
2. Validate type/size
3. Luu file len cloudinary folder chat/images hoac chat/files
4. Tra metadata url/publicId cho client

### 7.4. Voice channel
1. User join voice channel
2. Redis luu danh sach voice members
3. Broadcast danh sach de cac client lap P2P mesh
4. Ho tro mute/deafen/speaking/force mute/kick

### 7.5. Task management
- Work task: uu tien admin/owner tao va quan tri
- Event task: RSVP going/maybe/declined
- Poll task: bo phieu, ho tro multi-choice va han het han poll
- Realtime: task_created/task_updated/task_deleted

### 7.6. AI assistant
- AI duoc su dung de ho tro quan ly task va thong ke task.

## 8. Tong quan client-side implementation

### 8.1. Routing va access control
- Guest route: login/register (neu da login thi redirect)
- Protected route: workspace pages can user co user session

### 8.2. API va token refresh
- Axios request interceptor tu dong gan Bearer token
- Khi 401:
  - dung queue de tranh refresh trung lap
  - goi /auth/refresh-token
  - cap nhat token moi va retry request cu
  - neu refresh fail thi logout va ve /login

### 8.3. Realtime connection
- connect socket voi token
- auto rejoin workspace/channel sau reconnect
- gui heartbeat dinh ky de duy tri presence

### 8.4. State management
- authStore: user/token/session
- workspaceStore: workspace hien tai + online users
- channelStore: channels + typing + voice members
- messageStore: danh sach message theo channel + pagination
- uiStore: trang thai giao dien
- voiceStore: voice session phuc hoi sau refresh

## 9. Bao mat va phan quyen
- JWT auth cho REST va Socket
- Role-based cho workspace (owner/admin/member)
- Han che thao tac quan tri:
  - private channel, role update, remove member, work task management
- File upload co whitelist MIME + max size 10MB
- Refresh token revoke qua Redis
- Co ma hoa message theo channel (AES), key luu tren channel

## 10. Kha nang mo rong va rui ro ky thuat

### 10.1. Diem manh
- Tach lop ro rang: routes -> controllers -> models/services
- Realtime event architecture day du cho chat/task/voice/video
- Co fail-open cho Redis de he thong khong die ngay neu cache loi
- Da co health endpoint de giam sat basic

### 10.2. Rui ro/can cai tien
- Voice hien tai dung P2P mesh (O(N^2)), kho scale khi phong dong nguoi
- Chua thay pipeline test tu dong (unit/integration/e2e)
- Co nguy co conflict state giua REST va socket neu event ordering phuc tap
- CORS socket dang co che do dev mo (cho phep rong)
- Encryption key luu tren DB va tra qua API can quy trinh hardening bo sung neu len production

## 11. Cac thanh phan ha tang va bien moi truong
- MONGO_URI: ket noi MongoDB
- REDIS_URL: ket noi Redis
- CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET: upload media
- CLIENT_URLS: danh sach origin duoc phep
- OPENAI_API_KEY, OPENAI_MODEL: AI ho tro task va thong ke task
- PORT, HOST: server listen

## 12. De xuat bo cuc bao cao phan tich thiet ke he thong
Ban co the dua file nay cho nguoi viet bao cao va yeu cau trien khai theo bo cuc:
1) Boi canh bai toan va muc tieu he thong
2) Yeu cau chuc nang va phi chuc nang
3) Kien truc tong the (Context + Container)
4) Thiet ke backend (module, API, auth, data model)
5) Thiet ke frontend (routing, state, realtime, UX flow)
6) Thiet ke realtime communication (event catalog)
7) Thiet ke du lieu (ERD + indexing strategy)
8) Bao mat, phan quyen, va quan tri token
9) Kha nang mo rong, hieu nang, va quan sat he thong
10) Rui ro ky thuat va roadmap cai tien

---
Nguon thong tin tong hop truc tiep tu codebase server tai:
- C:\Users\Quan\node.js\server_chat realtime\server
Va codebase client tai:
- C:\Users\Quan\react\Chat Realtime
