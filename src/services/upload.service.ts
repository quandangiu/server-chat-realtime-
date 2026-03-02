import { cloudinary, ensureCloudinaryConfig } from '../config/cloudinary';

export const uploadToCloudinary = async (filePath: string, folder: string) => {
  ensureCloudinaryConfig();
  const result = await cloudinary.uploader.upload(filePath, {
    folder,
    resource_type: 'auto',
  });
  return {
    url: result.secure_url,
    publicId: result.public_id,
    size: result.bytes,
  };
};

export const deleteFromCloudinary = async (publicId: string) => {
  await cloudinary.uploader.destroy(publicId, { resource_type: 'raw' });
};
