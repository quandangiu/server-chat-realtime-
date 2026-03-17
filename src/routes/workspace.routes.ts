import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import {
  createWorkspace, getMyWorkspaces, getWorkspaceById,
  updateWorkspace, deleteWorkspace, addMember, removeMember, joinByInvite, uploadAvatar,
  updateMemberRole
} from '../controllers/workspace.controller';
import { upload } from '../middleware/upload.middleware';

const router = Router();

router.post('/', authenticate, createWorkspace);
router.get('/', authenticate, getMyWorkspaces);
router.get('/join/:inviteCode', authenticate, joinByInvite);
router.get('/:id', authenticate, getWorkspaceById);
router.put('/:id', authenticate, updateWorkspace);
router.put('/:id/avatar', authenticate, upload.single('avatar'), uploadAvatar);
router.delete('/:id', authenticate, deleteWorkspace);
router.post('/:id/members', authenticate, addMember);
router.put('/:id/members/:userId/role', authenticate, updateMemberRole);
router.delete('/:id/members/:userId', authenticate, removeMember);

export default router;
