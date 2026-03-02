import { Router } from 'express';
import { register, login, logout, refreshTokenHandler, getMe } from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.post('/register', register);
router.post('/login', login);
router.post('/logout', authenticate, logout);
router.post('/refresh-token', refreshTokenHandler);
router.get('/me', authenticate, getMe);

export default router;
