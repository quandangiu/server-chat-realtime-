import { Router } from 'express';
import { searchUsers, getUserById, updateProfile } from '../controllers/user.controller';
import { authenticate } from '../middleware/auth.middleware';
import { upload } from '../middleware/upload.middleware';

const router = Router();

router.get('/search', authenticate, searchUsers);
router.get('/:id', authenticate, getUserById);
router.put('/:id', authenticate, upload.single('avatar'), updateProfile);

export default router;
