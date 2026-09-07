import mongoose, { Document as MongooseDocument, Schema } from 'mongoose';

export interface IDocument extends MongooseDocument {
  folderId: mongoose.Types.ObjectId;
  originalName: string;
  title?: string;
  description?: string;
  mimetype: string;
  size: number;
  sourceUrl?: string;   // When uploaded via a public URL (link type)
  status: 'pending' | 'processing' | 'completed' | 'failed';
  gtwyResourceId?: string; // The _id returned by GTWY RAG API after resource creation
  analytics?: any;
  createdAt: Date;
  updatedAt: Date;
}

const DocumentSchema = new Schema<IDocument>({
  folderId: { type: Schema.Types.ObjectId, ref: 'Folder', required: true },
  originalName: { type: String, required: true },
  title: { type: String },
  description: { type: String },
  mimetype: { type: String, required: true },
  size: { type: Number, default: 0 },
  sourceUrl: { type: String },
  status: { type: String, enum: ['pending', 'processing', 'completed', 'failed'], default: 'pending' },
  gtwyResourceId: { type: String },
  analytics: { type: Schema.Types.Mixed },
}, { timestamps: true });

export default mongoose.model<IDocument>('Document', DocumentSchema);

