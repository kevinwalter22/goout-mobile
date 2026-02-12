import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  ImageStyle,
  StyleProp,
  Text,
  View,
  ViewStyle,
} from "react-native";
import { getPostImageUrl } from "../utils/storage";
import { useTheme } from "../contexts/ThemeContext";

type PostImageProps = {
  photoPath: string;
  style?: StyleProp<ImageStyle | ViewStyle>;
};

export function PostImage({ photoPath, style }: PostImageProps) {
  const { colors } = useTheme();
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function loadUrl() {
      try {
        setLoading(true);
        setError(false);

        const url = await getPostImageUrl(photoPath);

        if (!mounted) return;

        if (url) {
          setImageUrl(url);
        } else {
          if (__DEV__) console.warn("[PostImage] Failed to get URL for:", photoPath);
          setError(true);
        }
      } catch (err) {
        if (__DEV__) console.warn("[PostImage] Error loading URL:", err);
        if (mounted) {
          setError(true);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadUrl();

    return () => {
      mounted = false;
    };
  }, [photoPath]);

  if (loading) {
    return (
      <View
        style={[
          style,
          {
            justifyContent: "center",
            alignItems: "center",
            backgroundColor: colors.surfaceVariant,
          },
        ]}
      >
        <ActivityIndicator color={colors.textTertiary} />
      </View>
    );
  }

  if (error || !imageUrl) {
    return (
      <View
        style={[
          style,
          {
            justifyContent: "center",
            alignItems: "center",
            backgroundColor: colors.surfaceVariant,
          },
        ]}
      >
        <Text style={{ color: colors.textTertiary }}>Image unavailable</Text>
      </View>
    );
  }

  return (
    <Image
      source={{ uri: imageUrl }}
      style={style as StyleProp<ImageStyle>}
      resizeMode="cover"
      onError={() => {
        setError(true);
      }}
    />
  );
}
