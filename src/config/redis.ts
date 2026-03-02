import { createClient } from 'redis';

export const redis = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});

redis.on('error', (err) => console.error('❌ Redis error:', err));

export const connectRedis = async () => {
  try {
    await redis.connect();
    console.log('✅ Redis connected:', process.env.REDIS_URL || 'redis://localhost:6379');
  } catch (error) {
    console.warn('⚠️  Redis connection failed, continuing without Redis:', error);
    // Server continues without Redis - presence features may not work
  }
};
