import mongoose from 'mongoose';

let isConnected = false;

export const connectDB = async (): Promise<void> => {
  const mongoURI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/sih26023';

  if (!process.env.MONGO_URI) {
    console.warn('⚠️ [MongoDB] CAUTION: MONGO_URI environment variable is not set. Defaulting to local: ' + mongoURI);
    console.warn('ℹ️ [MongoDB] If deploying on Render, set MONGO_URI in your Render Web Service Environment settings (e.g. MongoDB Atlas connection string).');
  }

  const tryConnect = async (attempt = 1) => {
    try {
      console.log(`[MongoDB] Connecting to database (attempt ${attempt})...`);
      await mongoose.connect(mongoURI, {
        serverSelectionTimeoutMS: 6000,
      });
      isConnected = true;
      console.log('✅ [MongoDB] Connected successfully');
    } catch (error: any) {
      isConnected = false;
      console.error(`❌ [MongoDB] Connection notice (${error.message}).`);
      console.warn('ℹ️ [MongoDB] Web server remains live for health checks. Retrying database connection in 10s...');
      setTimeout(() => tryConnect(attempt + 1), 10000);
    }
  };

  await tryConnect();
};

export const getDBStatus = () => isConnected;
