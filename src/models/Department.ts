import mongoose, { Document as MongooseDocument, Schema } from 'mongoose';

export interface IDepartment extends MongooseDocument {
  name: string;
  code: string;               // short code e.g. "COAL-MP", "GEO-JH"
  description?: string;
  headUserId?: mongoose.Types.ObjectId;    // department head user
  adminUserIds: mongoose.Types.ObjectId[]; // users with dept-admin scope for this dept
  createdAt: Date;
  updatedAt: Date;
}

const DepartmentSchema = new Schema<IDepartment>({
  name: { type: String, required: true },
  code: { type: String, required: true, unique: true, uppercase: true },
  description: { type: String },
  headUserId: { type: Schema.Types.ObjectId, ref: 'User' },
  adminUserIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
}, { timestamps: true });

export default mongoose.model<IDepartment>('Department', DepartmentSchema);
