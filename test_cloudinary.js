import crypto from 'crypto';

const CLOUDINARY_CLOUD_NAME = 'dumeeolat';
const CLOUDINARY_API_KEY = '974974629213967';
const CLOUDINARY_API_SECRET = 'QV1Eaopm3LN-nFV0w2UBiGht1Wg';

async function testUpload() {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const publicId = 'test_image';
  
  const toSign = `public_id=${publicId}&timestamp=${timestamp}${CLOUDINARY_API_SECRET}`;
  
  // Cloudinary now defaults to SHA-256 for signatures on new accounts
  // and we recently changed the backend to use SHA-256 or SHA-1 based on fallback.
  // Wait, let's look at how cloudinary.js does it.
  
  // Let's copy the code from src/utils/cloudinary.js
}
