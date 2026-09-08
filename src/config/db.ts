import mongoose from 'mongoose';

let isConnected = false;

export const connectDB = async (): Promise<void> => {
  let mongoURI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/sih26023';

  // Ensure Atlas URI specifies the database name if missing
  if (mongoURI.includes('mongodb.net/?')) {
    mongoURI = mongoURI.replace('mongodb.net/?', 'mongodb.net/sih26023?');
  } else if (mongoURI.endsWith('mongodb.net/')) {
    mongoURI = mongoURI + 'sih26023';
  } else if (mongoURI.endsWith('mongodb.net')) {
    mongoURI = mongoURI + '/sih26023';
  }

  const tryConnect = async (uri: string, isFallback = false): Promise<boolean> => {
    try {
      const displayHost = isFallback ? 'Local MongoDB (127.0.0.1:27017)' : (uri.split('@')[1]?.split('/')[0] || 'Database');
      console.log(`[MongoDB] Connecting to ${displayHost}...`);
      
      await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 5000,
      });
      isConnected = true;
      console.log(`✅ [MongoDB] Connected successfully to ${displayHost}`);
      return true;
    } catch (error: any) {
      isConnected = false;
      console.error(`❌ [MongoDB] Connection error: ${error.message}`);

      if (uri.includes('mongodb.net')) {
        console.warn(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️  MONGODB ATLAS IP ACCESS BLOCKED:
Your current IP is not whitelisted in MongoDB Atlas Network Access!
To fix:
1. Open MongoDB Atlas: https://cloud.mongodb.com
2. Go to "Network Access" in the left sidebar.
3. Click "+ Add IP Address" -> Select "Allow Access from Anywhere" (0.0.0.0/0).
4. Click "Confirm".
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        `);
      }
      return false;
    }
  };

  // 1. Attempt configured URI
  const success = await tryConnect(mongoURI);

  // 2. If configured URI (e.g. Atlas) failed due to IP whitelist, attempt local MongoDB fallback
  if (!success && !mongoURI.includes('127.0.0.1') && !mongoURI.includes('localhost')) {
    console.log('🔄 [MongoDB] Atlas connection blocked. Attempting local MongoDB (127.0.0.1:27017) fallback...');
    const localSuccess = await tryConnect('mongodb://127.0.0.1:27017/sih26023', true);
    if (localSuccess) {
      console.log('✅ [MongoDB] Using local MongoDB fallback while Atlas whitelist is updated.');
      return;
    }
  }

  // 3. If both failed, schedule background retry
  if (!isConnected) {
    console.warn('ℹ️ [MongoDB] Retrying database connection in 10s...');
    setTimeout(() => connectDB(), 10000);
  }
};

export const getDBStatus = () => isConnected;
