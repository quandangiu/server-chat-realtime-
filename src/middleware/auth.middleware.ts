import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt';

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export const authenticate = (req: Request, res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer '))
    return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Không có token' } });

  try {
    const decoded = verifyToken(header.split(' ')[1]);
    req.userId = decoded.userId;
    next();
  } catch {
    res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Token không hợp lệ hoặc hết hạn' } });
  }
};
