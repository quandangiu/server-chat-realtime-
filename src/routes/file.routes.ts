import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { upload } from '../middleware/upload.middleware';
import { uploadFile, deleteFile } from '../controllers/file.controller';

const router = Router();

router.post('/upload', authenticate, upload.single('file'), uploadFile);
router.delete('/:publicId', authenticate, deleteFile);

export default router;
