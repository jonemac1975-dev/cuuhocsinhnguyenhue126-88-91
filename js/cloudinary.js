
const CLOUD_NAME = 'cuuhocsinh126';

const UPLOAD_PRESETS = {
  avatar: 'cuuhocsinh126_avatars',
  image: 'cuuhocsinh126_images',
  album: 'cuuhocsinh126_albums',
  video: 'cuuhocsinh126_videos',
  file: 'cuuhocsinh126_files'
};


async function compressImage(file, options = {}) {
  if (!file.type.startsWith('image/')) {
    throw new Error('Tệp được chọn không phải ảnh.');
  }

  if (file.type === 'image/svg+xml' || file.type === 'image/gif') {
    return file;
  }

  const maxSize = options.maxSize || 1200;
  const quality = options.quality || 0.8;

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');

  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('Không thể xử lý ảnh trên trình duyệt.');
  }

  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      result => result ? resolve(result) : reject(new Error('Không thể nén ảnh.')),
      'image/webp',
      quality
    );
  });

  return new File(
    [blob],
    file.name.replace(/\.[^.]+$/, '') + '.webp',
    { type: 'image/webp', lastModified: Date.now() }
  );
}

export async function uploadToCloudinary(file, type = 'image') {
  const preset = UPLOAD_PRESETS[type];

  if (!preset) {
    throw new Error('Loại tệp tải lên không hợp lệ.');
  }

  let uploadFile = file;

  if (file.type.startsWith('image/') && type !== 'file') {
    uploadFile = await compressImage(file, {
      maxSize: type === 'avatar' ? 600 : 1600,
      quality: 0.8
    });
  }

  const formData = new FormData();
  formData.append('file', uploadFile);
  formData.append('upload_preset', preset);

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/auto/upload`,
    { method: 'POST', body: formData }
  );

  const result = await response.json();

  if (!response.ok || !result.secure_url) {
    console.error('Cloudinary upload error:', result);
    throw new Error(result.error?.message || 'Upload Cloudinary thất bại.');
  }

  return {
    url: result.secure_url,
    publicId: result.public_id,
    bytes: result.bytes,
    format: result.format
  };
}
