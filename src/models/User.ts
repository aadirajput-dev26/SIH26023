import mongoose, { Document as MongooseDocument, Schema } from 'mongoose';

export interface IUser extends MongooseDocument {
  name: string;
  email: string;
  passwordHash: string;
  designation?: string;
  departmentId?: mongoose.Types.ObjectId;
  roleId: mongoose.Types.ObjectId;
  // Scope: which departments / projects a user can access
  // super_admin: all (departmentScope & projectScope ignored)
  // dept_admin: can manage users within their departmentScope[]
  // analyst/viewer: can access only projectScope[] folders
  departmentScope: mongoose.Types.ObjectId[];
  projectScope: mongoose.Types.ObjectId[];
  status: 'active' | 'suspended' | 'pending';
  emailVerified: boolean;
  createdBy?: mongoose.Types.ObjectId;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  designation: { type: String },
  departmentId: { type: Schema.Types.ObjectId, ref: 'Department' },
  roleId: { type: Schema.Types.ObjectId, ref: 'Role', required: true },
  departmentScope: [{ type: Schema.Types.ObjectId, ref: 'Department' }],
  projectScope: [{ type: Schema.Types.ObjectId, ref: 'Project' }],
  status: { type: String, enum: ['active', 'suspended', 'pending'], default: 'active' },
  emailVerified: { type: Boolean, default: false },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  lastLoginAt: { type: Date },
}, { timestamps: true });

export default mongoose.model<IUser>('User', UserSchema);
