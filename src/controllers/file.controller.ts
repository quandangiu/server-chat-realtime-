import { Request, Response, NextFunction } from 'express';
import { cloudinary, ensureCloudinaryConfig } from '../config/cloudinary';
import { sendSuccess, sendError } from '../utils/apiResponse';

export const uploadFile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) return sendError(res, 'VALIDATION_ERROR', 'Không có file', 400);

    const file = req.file as any;
    sendSuccess(res, {
      url: file.path,
      name: file.originalname,
      size: file.size,
      mimeType: file.mimetype,
      publicId: file.filename,
    }, 201);
  } catch (err) { next(err); }
};

export const deleteFile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    ensureCloudinaryConfig();
    const { publicId } = req.params;
    await cloudinary.uploader.destroy(decodeURIComponent(publicId), { resource_type: 'raw' });
    sendSuccess(res, null);
  } catch (err) { next(err); }
};
