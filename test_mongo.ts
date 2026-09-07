import FolderModel from './src/models/Folder';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/sih26023';

async function test() {
  await mongoose.connect(mongoUri);

  console.log('Connected to DB:', mongoose.connection.name);

  // Find all folders created in DB
  const folders = await FolderModel.find({});
  console.log('All Folders in DB:', folders);

  await mongoose.disconnect();
}

test().catch(console.error);
