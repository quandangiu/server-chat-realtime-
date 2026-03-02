import crypto from 'crypto';
import CryptoJS from 'crypto-js';

export const generateChannelKey = (): string => {
  return crypto.randomBytes(32).toString('hex');
};

export const encryptMessage = (plaintext: string, key: string): string => {
  return CryptoJS.AES.encrypt(plaintext, key).toString();
};

export const decryptMessage = (ciphertext: string, key: string): string => {
  const bytes = CryptoJS.AES.decrypt(ciphertext, key);
  return bytes.toString(CryptoJS.enc.Utf8);
};
