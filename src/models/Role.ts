import mongoose, { Document as MongooseDocument, Schema } from 'mongoose';

export interface IRole extends MongooseDocument {
  name: 'super_admin' | 'dept_admin' | 'analyst' | 'viewer';
  displayName: string;
  permissions: string[];   // array of "resource:action" strings e.g. "folders:create"
  description: string;
  isSystem: boolean;       // system roles cannot be deleted
  level: number;           // hierarchy: super_admin=0, dept_admin=1, analyst=2, viewer=3
  createdAt: Date;
  updatedAt: Date;
}

const RoleSchema = new Schema<IRole>({
  name: {
    type: String,
    enum: ['super_admin', 'dept_admin', 'analyst', 'viewer'],
    required: true,
    unique: true,
  },
  displayName: { type: String, required: true },
  permissions: [{ type: String }],
  description: { type: String },
  isSystem: { type: Boolean, default: false },
  level: { type: Number, required: true },
}, { timestamps: true });

export default mongoose.model<IRole>('Role', RoleSchema);
