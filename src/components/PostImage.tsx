import { StyleProp } from "react-native";
import { Image, ImageStyle } from "expo-image";
import { getImageUrl } from "../utils/storage";
import { useTheme } from "../contexts/ThemeContext";

type PostImageProps = {
  photoPath: string;
  style?: StyleProp<ImageStyle>;
};

export function PostImage({ photoPath, style }: PostImageProps) {
  const { colors } = useTheme();
  const url = getImageUrl(photoPath);

  return (
    <Image
      source={url}
      style={[{ backgroundColor: colors.surfaceVariant }, style]}
      contentFit="cover"
      transition={200}
    />
  );
}
