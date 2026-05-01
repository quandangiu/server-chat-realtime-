import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import {
  createTask,
  getTasksByChannel,
  getTasksByWorkspace,
  updateTask,
  deleteTask,
  claimTask,
  voteTask,
  rsvpTask,
  getMyTaskSummary,
  addComment,
} from '../controllers/task.controller';

const router = Router();

router.post('/', authenticate, createTask);
router.get('/my-summary', authenticate, getMyTaskSummary);
router.get('/channel/:channelId', authenticate, getTasksByChannel);
router.get('/workspace/:workspaceId', authenticate, getTasksByWorkspace);
router.post('/:id/claim', authenticate, claimTask);
router.post('/:id/vote', authenticate, voteTask);
router.post('/:id/rsvp', authenticate, rsvpTask);
router.post('/:id/comment', authenticate, addComment);
router.put('/:id', authenticate, updateTask);
router.delete('/:id', authenticate, deleteTask);

export default router;
