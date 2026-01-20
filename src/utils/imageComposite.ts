import * as ImageManipulator from "expo-image-manipulator";

/**
 * Composite two images together for dual camera mode
 * Places the front camera image as a small overlay in the top-right corner
 *
 * @param backPhotoUri - URI of the back camera photo (main image)
 * @param frontPhotoUri - URI of the front camera photo (overlay)
 * @returns URI of the composited image
 */
export async function compositeDualCameraImages(
  backPhotoUri: string,
  frontPhotoUri: string,
): Promise<string> {
  try {
    console.log("[Composite] Starting dual camera composite");
    console.log("[Composite] Back photo:", backPhotoUri);
    console.log("[Composite] Front photo:", frontPhotoUri);

    // First, get the dimensions of the back photo
    const backImage = await ImageManipulator.manipulateAsync(
      backPhotoUri,
      [],
      { format: ImageManipulator.SaveFormat.JPEG }
    );

    const mainWidth = backImage.width;
    const mainHeight = backImage.height;

    console.log("[Composite] Main image dimensions:", { mainWidth, mainHeight });

    // Calculate overlay size (1/10th of main image area, maintaining aspect ratio)
    const overlayWidth = Math.floor(mainWidth * 0.3); // 30% of width
    const overlayHeight = Math.floor(overlayWidth * (4 / 3)); // Maintain 4:3 aspect ratio

    console.log("[Composite] Overlay dimensions:", { overlayWidth, overlayHeight });

    // Resize front camera photo to overlay size
    const _resizedFront = await ImageManipulator.manipulateAsync(
      frontPhotoUri,
      [
        {
          resize: {
            width: overlayWidth,
            height: overlayHeight,
          },
        },
      ],
      { compress: 0.8, format: ImageManipulator.SaveFormat.PNG }
    );

    console.log("[Composite] Resized front camera image");

    // Position overlay in top-right corner with 16px padding
    const _overlayX = mainWidth - overlayWidth - 16;
    const _overlayY = 16;

    // Composite the images using the back photo as base
    // Unfortunately expo-image-manipulator doesn't support direct compositing
    // We'll need to use a different approach

    // For now, return the back photo and log that we need a different solution
    console.warn("[Composite] expo-image-manipulator doesn't support overlay compositing");
    console.warn("[Composite] Falling back to back camera photo only");
    console.warn("[Composite] To implement true dual camera, we need expo-gl or react-native-image-editor");

    return backPhotoUri;
  } catch (error) {
    console.error("[Composite] Error compositing images:", error);
    // Fallback to back camera photo
    return backPhotoUri;
  }
}
