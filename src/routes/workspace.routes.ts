import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import {
  createWorkspace, getMyWorkspaces, getWorkspaceById,
  updateWorkspace, deleteWorkspace, addMember, removeMember, joinByInvite,
} from '../controllers/workspace.controller';

const router = Router();

router.post('/', authenticate, createWorkspace);
router.get('/', authenticate, getMyWorkspaces);
router.get('/join/:inviteCode', authenticate, joinByInvite);
router.get('/:id', authenticate, getWorkspaceById);
router.put('/:id', authenticate, updateWorkspace);
router.delete('/:id', authenticate, deleteWorkspace);
router.post('/:id/members', authenticate, addMember);
router.delete('/:id/members/:userId', authenticate, removeMember);

export default router;
