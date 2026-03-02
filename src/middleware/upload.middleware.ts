import multer from 'multer';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import { cloudinary, ensureCloudinaryConfig } from '../config/cloudinary';

const ALLOWED_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf', 'text/plain', 'application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];
const MAX_SIZE = 10 * 1024 * 1024;

let _upload: multer.Multer | null = null;

const getUpload = () => {
  if (!_upload) {
    ensureCloudinaryConfig();
    const storage = new CloudinaryStorage({
      cloudinary,
      params: async (_req: any, file: any) => ({
        folder: file.mimetype.startsWith('image/') ? 'chat/images' : 'chat/files',
        resource_type: file.mimetype.startsWith('image/') ? 'image' : 'raw',
        public_id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      }),
    });
    _upload = multer({
      storage,
      limits: { fileSize: MAX_SIZE },
      fileFilter: (_req, file, cb) => {
        ALLOWED_TYPES.includes(file.mimetype) ? cb(null, true) : cb(new Error('Loại file không được hỗ trợ'));
      },
    });
  }
  return _upload;
};

export const upload = {
  single: (field: string) => (req: any, res: any, next: any) => getUpload().single(field)(req, res, next),
  array: (field: string, maxCount?: number) => (req: any, res: any, next: any) => getUpload().array(field, maxCount)(req, res, next),
};
