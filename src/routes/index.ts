import { Router } from 'express';
import authRoutes from './auth.routes';
import userRoutes from './user.routes';
import workspaceRoutes from './workspace.routes';
import channelRoutes from './channel.routes';
import messageRoutes from './message.routes';
import fileRoutes from './file.routes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/workspaces', workspaceRoutes);
router.use('/channels', channelRoutes);
router.use('/messages', messageRoutes);
router.use('/files', fileRoutes);

export default router;
