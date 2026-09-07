import mongoose, { Document as MongooseDocument, Schema } from 'mongoose';

export interface IFolder extends MongooseDocument {
  name: string;
  description: string;
  // Note: No per-folder collectionId — all GTWY RAG resources share one workspace.
  // Folder ownership is tracked via Document.folderId in MongoDB.
  analyticsMetrics: any; // JSON containing word clouds, topic modeling extracted by AI
  reports: Array<{
    title: string;
    content: string;
    createdAt: Date;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

const FolderSchema = new Schema<IFolder>({
  name: { type: String, required: true },
  description: { type: String },
  analyticsMetrics: { type: Schema.Types.Mixed, default: {} },
  reports: [{
    title: String,
    content: String,
    createdAt: { type: Date, default: Date.now }
  }]
}, { timestamps: true });

export default mongoose.model<IFolder>('Folder', FolderSchema);

