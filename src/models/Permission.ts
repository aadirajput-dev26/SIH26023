import mongoose, { Document as MongooseDocument, Schema } from 'mongoose';

export type PermissionAction = 'create' | 'read' | 'update' | 'delete' | 'manage';

export interface IPermission extends MongooseDocument {
  resource: string;        // e.g. 'folders', 'documents', 'users', 'access_requests', 'reports'
  action: PermissionAction;
  description: string;
  createdAt: Date;
  updatedAt: Date;
}

const PermissionSchema = new Schema<IPermission>({
  resource: { type: String, required: true },
  action: {
    type: String,
    enum: ['create', 'read', 'update', 'delete', 'manage'],
    required: true,
  },
  description: { type: String, required: true },
}, { timestamps: true });

PermissionSchema.index({ resource: 1, action: 1 }, { unique: true });

export default mongoose.model<IPermission>('Permission', PermissionSchema);
