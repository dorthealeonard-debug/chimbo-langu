export interface CloudinaryUploadResult {
  secureUrl: string;
  publicId: string;
  resourceType: string;
  format: string;
  uploadedAt: string;
}

// Read API URL from Vite environment variables, falling back to local server port 5000
const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:5000').replace(/\/$/, '');

/**
 * Uploads a file to Cloudinary using secure, signed uploads.
 * 1. Obtains a secure signature and timestamp from the Express backend.
 * 2. Uploads the file directly to Cloudinary's secure upload API using the signature.
 * 3. Returns the upload metadata to be stored in Firestore.
 */
export async function uploadFileToCloudinary(
  file: File,
  folder: string
): Promise<CloudinaryUploadResult> {
  try {
    // 1. Fetch secure signature from Render backend
    console.log(`[Cloudinary Service] Requesting signature from backend: ${API_URL}/api/v1/cloudinary/sign for folder "${folder}"...`);
    const signRes = await fetch(`${API_URL}/api/v1/cloudinary/sign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ folder })
    });

    if (!signRes.ok) {
      const errText = await signRes.text();
      throw new Error(`Backend signature request failed with status ${signRes.status}: ${errText}`);
    }

    const signData = await signRes.json();
    if (signData.status === 'error') {
      throw new Error(signData.message || 'Failed to generate secure upload signature');
    }

    const { signature, timestamp, apiKey, cloudName } = signData;
    console.log('[Cloudinary Service] Signature retrieved successfully. Initiating direct upload...');

    // 2. Build Multipart Form Data for Cloudinary
    const formData = new FormData();
    formData.append('file', file);
    formData.append('api_key', apiKey);
    formData.append('timestamp', String(timestamp));
    formData.append('signature', signature);
    formData.append('folder', folder);

    // 3. Upload directly to Cloudinary
    const uploadUrl = `https://api.cloudinary.com/v1_1/${cloudName}/upload`;
    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      body: formData
    });

    if (!uploadRes.ok) {
      const uploadErrText = await uploadRes.text();
      throw new Error(`Cloudinary direct upload failed with status ${uploadRes.status}: ${uploadErrText}`);
    }

    const uploadData = await uploadRes.json();
    if (uploadData.error) {
      throw new Error(uploadData.error.message || 'Cloudinary returned an upload error.');
    }

    console.log('[Cloudinary Service] Direct upload completed successfully:', uploadData.secure_url);

    // 4. Return metadata to write to Firestore
    return {
      secureUrl: uploadData.secure_url,
      publicId: uploadData.public_id,
      resourceType: uploadData.resource_type,
      format: uploadData.format,
      uploadedAt: uploadData.created_at || new Date().toISOString()
    };
  } catch (error) {
    console.error('[Cloudinary Service Error] Direct upload workflow failed:', error);
    throw error;
  }
}
