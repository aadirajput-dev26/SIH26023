import mongoose, { Document as MongooseDocument, Schema } from 'mongoose';

/**
 * Embedded document sub-document stored directly in the Folder.
 * The separate Document collection has been removed — all document metadata
 * and RAG pipeline references live here to avoid dual-collection redundancy.
 */
export interface IEmbeddedDocument {
  _id: mongoose.Types.ObjectId;
  originalName: string;
  title?: string;
  description?: string;
  mimetype: string;
  size: number;
  sourceUrl?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  /** UUID returned by the FastAPI RAG Pipeline after ingestion */
  ragDocumentId?: string;
  analytics?: any;
  createdAt: Date;
  updatedAt: Date;
}

export interface IFolder extends MongooseDocument {
  name: string;
  description?: string;
  /** Array of embedded document metadata (consolidated from former Document collection) */
  documents: IEmbeddedDocument[];
  analyticsMetrics: any;
  reports: Array<{
    _id?: mongoose.Types.ObjectId;
    title: string;
    content: string;
    createdAt: Date;
  }>;
  /** ID of the owning user (null = global / super-admin owned) */
  ownerId?: mongoose.Types.ObjectId;
  /** Which department this folder belongs to */
  departmentId?: mongoose.Types.ObjectId;
  /** Which projects can access this folder */
  projectIds: mongoose.Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const EmbeddedDocumentSchema = new Schema<IEmbeddedDocument>(
  {
    originalName: { type: String, required: true },
    title: { type: String },
    description: { type: String },
    mimetype: { type: String, required: true },
    size: { type: Number, default: 0 },
    sourceUrl: { type: String },
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed'],
      default: 'pending',
    },
    ragDocumentId: { type: String },
    analytics: { type: Schema.Types.Mixed },
  },
  { timestamps: true, _id: true },
);

const FolderSchema = new Schema<IFolder>(
  {
    name: { type: String, required: true },
    description: { type: String },
    documents: { type: [EmbeddedDocumentSchema], default: [] },
    analyticsMetrics: { type: Schema.Types.Mixed, default: {} },
    reports: [
      {
        title: String,
        content: String,
        createdAt: { type: Date, default: Date.now },
      },
    ],
    ownerId: { type: Schema.Types.ObjectId, ref: 'User' },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department' },
    projectIds: [{ type: Schema.Types.ObjectId, ref: 'Project' }],
  },
  { timestamps: true },
);

export default mongoose.model<IFolder>('Folder', FolderSchema);
