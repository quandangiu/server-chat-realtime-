import { Request, Response, NextFunction } from 'express';

export const errorHandler = (err: any, _req: Request, res: Response, _next: NextFunction) => {
  const message = err?.message || err?.toString?.() || 'Lỗi server không xác định';
  const statusCode = err?.statusCode || 500;
  console.error('❌ Error:', message);
  res.status(statusCode).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message },
  });
};
