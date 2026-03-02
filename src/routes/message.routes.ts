import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import {
  getMessages, sendMessage, updateMessage,
  deleteMessage, toggleReaction, searchMessages,
} from '../controllers/message.controller';

const router = Router();

router.get('/search', authenticate, searchMessages);
router.get('/channel/:channelId', authenticate, getMessages);
router.post('/channel/:channelId', authenticate, sendMessage);
router.put('/:id', authenticate, updateMessage);
router.delete('/:id', authenticate, deleteMessage);
router.post('/:id/reactions', authenticate, toggleReaction);

export default router;
