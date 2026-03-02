import mongoose from 'mongoose';

export const connectDB = async () => {
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/chatapp';
  await mongoose.connect(uri);
  console.log('✅ MongoDB connected:', uri);
};
