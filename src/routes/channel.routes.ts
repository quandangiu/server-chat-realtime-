import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import {
  createChannel, getChannelsByWorkspace, getChannelById,
  updateChannel, deleteChannel, createOrGetDM, getChannelKey,
  getChannelMembers,
} from '../controllers/channel.controller';

const router = Router();

router.post('/', authenticate, createChannel);
router.post('/dm', authenticate, createOrGetDM);
router.get('/workspace/:workspaceId', authenticate, getChannelsByWorkspace);
router.get('/:id', authenticate, getChannelById);
router.get('/:id/key', authenticate, getChannelKey);
router.get('/:id/members', authenticate, getChannelMembers);
router.put('/:id', authenticate, updateChannel);
router.delete('/:id', authenticate, deleteChannel);

export default router;
