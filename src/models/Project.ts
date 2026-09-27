import mongoose, { Document as MongooseDocument, Schema } from 'mongoose';

export interface IProject extends MongooseDocument {
  name: string;
  code: string;
  departmentId: mongoose.Types.ObjectId;
  description?: string;
  folderId?: mongoose.Types.ObjectId;   // optional link to a Folder workspace
  createdAt: Date;
  updatedAt: Date;
}

const ProjectSchema = new Schema<IProject>({
  name: { type: String, required: true },
  code: { type: String, required: true, unique: true, uppercase: true },
  departmentId: { type: Schema.Types.ObjectId, ref: 'Department', required: true },
  description: { type: String },
  folderId: { type: Schema.Types.ObjectId, ref: 'Folder' },
}, { timestamps: true });

export default mongoose.model<IProject>('Project', ProjectSchema);
