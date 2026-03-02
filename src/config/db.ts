import mongoose from 'mongoose';

export const connectDB = async () => {
  try {
    const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/chatapp';
    await mongoose.connect(uri);
    console.log('✅ MongoDB connected:', uri);
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error);
    throw error; // MongoDB is critical, so we throw error
  }
};
