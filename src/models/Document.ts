import mongoose, { Document as MongooseDocument, Schema } from 'mongoose';

export interface IDocument extends MongooseDocument {
  folderId: mongoose.Types.ObjectId;
  originalName: string;
  mimetype: string;
  size: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  hippocampusDocumentId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const DocumentSchema = new Schema<IDocument>({
  folderId: { type: Schema.Types.ObjectId, ref: 'Folder', required: true },
  originalName: { type: String, required: true },
  mimetype: { type: String, required: true },
  size: { type: Number, required: true },
  status: { type: String, enum: ['pending', 'processing', 'completed', 'failed'], default: 'pending' },
  hippocampusDocumentId: { type: String },
}, { timestamps: true });

export default mongoose.model<IDocument>('Document', DocumentSchema);
