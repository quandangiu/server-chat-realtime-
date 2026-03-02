import express from 'express';
import http from 'http';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import { connectDB } from './config/db';
import { connectRedis } from './config/redis';
import { initSocket } from './socket';
import routes from './routes';
import { errorHandler } from './middleware/errorHandler';

dotenv.config();

const app = express();
const server = http.createServer(app);

// CORS — cho phép nhiều origin từ .env (hỗ trợ mạng LAN)
const allowedOrigins = (process.env.CLIENT_URLS || 'http://localhost:5173')
  .split(',')
  .map(s => s.trim());

app.use(cors({
  origin: (origin, callback) => {
    // Cho phép requests không có origin (Postman, curl, mobile app)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    // Cho phép tất cả origin trên mạng local (192.168.x.x, 10.x.x.x)
    if (/^http:\/\/(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(origin)) {
      return callback(null, true);
    }
    callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ success: true, message: 'Server is running', timestamp: new Date() });
});

// API routes
app.use('/api', routes);

// Error handler (phải đặt cuối cùng)
app.use(errorHandler);

// Socket.io
const io = initSocket(server);

// Start
const start = async () => {
  await connectDB();
  await connectRedis();

  const PORT = process.env.PORT || 3000;
  const HOST = process.env.HOST || '0.0.0.0';

  server.listen(Number(PORT), HOST, () => {
    console.log(`✅ Server running at http://${HOST}:${PORT}`);
    console.log(`📡 Allowed origins: ${allowedOrigins.join(', ')}`);
    console.log(`🌐 LAN access: http://<YOUR_IP>:${PORT}`);
  });
};

start().catch(console.error);
