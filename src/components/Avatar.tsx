import { useState } from "react";
import { Image, View, ImageStyle } from "react-native";
import { getAvatarUrl } from "../utils/avatar";
import { useTheme } from "../contexts/ThemeContext";

type AvatarProps = {
  avatarUrl: string | null;
  size?: number;
  style?: ImageStyle;
};

export function Avatar({ avatarUrl, size = 40, style }: AvatarProps) {
  const { colors } = useTheme();
  const url = getAvatarUrl(avatarUrl);
  const [imgError, setImgError] = useState(false);

  const placeholder = (
    <View
      style={[
        { backgroundColor: colors.surfaceVariant },
        { width: size, height: size, borderRadius: size / 2 },
        style,
      ]}
    />
  );

  if (url && !imgError) {
    return (
      <Image
        source={{ uri: url }}
        style={[
          { backgroundColor: colors.surfaceVariant },
          { width: size, height: size, borderRadius: size / 2 },
          style,
        ]}
        onError={() => setImgError(true)}
      />
    );
  }

  return placeholder;
}
