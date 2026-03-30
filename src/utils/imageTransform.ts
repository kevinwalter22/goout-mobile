import * as ImageManipulator from "expo-image-manipulator";
import { Image } from "react-native";

function getImageDimensions(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    Image.getSize(uri, (w, h) => resolve({ width: w, height: h }), reject);
  });
}

/**
 * Normalizes a captured photo before upload:
 *   1. Center-crops landscape images to 3:4 portrait (consistent feed layout)
 *   2. Flips front camera images horizontally (mirrors the preview the user saw)
 *   3. Resizes to 1080×1440 (1080p-class, avoids uploading 4K originals)
 *   4. Compresses to JPEG at 0.90 (single compression pass — caller must capture at quality: 1)
 */
export async function normalizePostImage(
  uri: string,
  options: { isFromFrontCamera?: boolean } = {}
): Promise<string> {
  const { width, height } = await getImageDimensions(uri);

  const actions: ImageManipulator.Action[] = [];

  // If landscape: center-crop to 3:4 portrait before resizing
  if (width > height) {
    const targetWidth = Math.floor(height * 3 / 4);
    const originX = Math.floor((width - targetWidth) / 2);
    actions.push({ crop: { originX, originY: 0, width: targetWidth, height } });
  }

  // Front camera: flip horizontally so saved image matches the mirrored preview
  if (options.isFromFrontCamera) {
    actions.push({ flip: ImageManipulator.FlipType.Horizontal });
  }

  // Resize to 1080px wide → 1080×1440 for a correctly-cropped 3:4 image
  actions.push({ resize: { width: 1080 } });

  const result = await ImageManipulator.manipulateAsync(
    uri,
    actions,
    { compress: 0.90, format: ImageManipulator.SaveFormat.JPEG }
  );

  return result.uri;
}
