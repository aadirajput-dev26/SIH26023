import mongoose, { Document as MongooseDocument, Schema } from 'mongoose';

export interface IFolder extends MongooseDocument {
  name: string;
  description: string;
  collectionId: string; // From Hippocampus RAG service
  analyticsMetrics: any; // JSON containing word clouds, topic modeling extracted by AI
  createdAt: Date;
  updatedAt: Date;
}

const FolderSchema = new Schema<IFolder>({
  name: { type: String, required: true },
  description: { type: String },
  collectionId: { type: String, required: true },
  analyticsMetrics: { type: Schema.Types.Mixed, default: {} },
}, { timestamps: true });

export default mongoose.model<IFolder>('Folder', FolderSchema);
