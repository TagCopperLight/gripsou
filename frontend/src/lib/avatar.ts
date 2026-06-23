const SIZE = 128;

// Largest centered square of a source image (center-cover crop).
export function coverCrop(srcW: number, srcH: number): { sx: number; sy: number; side: number } {
  const side = Math.min(srcW, srcH);
  return { sx: (srcW - side) / 2, sy: (srcH - side) / 2, side };
}

// Load a user-picked image, center-crop to a square, downscale to 128px webp.
export function fileToAvatarDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const { sx, sy, side } = coverCrop(img.naturalWidth, img.naturalHeight);
      const canvas = document.createElement("canvas");
      canvas.width = SIZE;
      canvas.height = SIZE;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("no 2d context"));
      ctx.drawImage(img, sx, sy, side, side, 0, 0, SIZE, SIZE);
      resolve(canvas.toDataURL("image/webp", 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("failed to load image"));
    };
    img.src = url;
  });
}
