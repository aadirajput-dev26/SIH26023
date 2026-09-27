import mongoose, { Document as MongooseDocument, Schema } from 'mongoose';

export interface IAccessRequest extends MongooseDocument {
  name: string;
  email: string;
  designation: string;
  department: string;         // free-text department name from the form
  requestedRole: 'dept_admin' | 'analyst' | 'viewer';
  projectScope?: string;      // free-text project/scope description
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewedBy?: mongoose.Types.ObjectId;
  reviewNote?: string;
  reviewedAt?: Date;
  // Password setup token (for approved requests)
  passwordSetupToken?: string;       // hashed token stored here
  passwordSetupTokenExpiresAt?: Date;
  passwordSetupCompleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const AccessRequestSchema = new Schema<IAccessRequest>({
  name: { type: String, required: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  designation: { type: String, required: true },
  department: { type: String, required: true },
  requestedRole: {
    type: String,
    enum: ['dept_admin', 'analyst', 'viewer'],
    required: true,
  },
  projectScope: { type: String },
  reason: { type: String, required: true },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  reviewNote: { type: String },
  reviewedAt: { type: Date },
  passwordSetupToken: { type: String },         // stores hashed token
  passwordSetupTokenExpiresAt: { type: Date },
  passwordSetupCompleted: { type: Boolean, default: false },
}, { timestamps: true });

AccessRequestSchema.index({ email: 1 });
AccessRequestSchema.index({ status: 1 });

export default mongoose.model<IAccessRequest>('AccessRequest', AccessRequestSchema);
