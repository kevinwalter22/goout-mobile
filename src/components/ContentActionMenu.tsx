import { useState } from "react";
import { Alert, Modal, Pressable, Text, View, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../contexts/ThemeContext";
import { useAuth } from "../hooks/useAuth";
import { Colors } from "../config/theme";
import type { ReportTargetType } from "../types/database";

type ContentActionMenuProps = {
  /** The user who authored the content */
  authorUserId: string;
  targetType: ReportTargetType;
  targetId: string;
  onReport: () => void;
  onBlockUser: () => void;
  /** Called when the user deletes their own content. Only shown for own content. */
  onDelete?: () => void;
  /** Size of the trigger icon */
  size?: number;
};

export function ContentActionMenu({
  authorUserId,
  targetType,
  targetId,
  onReport,
  onBlockUser,
  onDelete,
  size = 20,
}: ContentActionMenuProps) {
  const { user } = useAuth();
  const { colors } = useTheme();
  const [menuVisible, setMenuVisible] = useState(false);

  const isOwnContent = user?.id === authorUserId;

  // Don't show menu on own content unless delete is available
  if (isOwnContent && !onDelete) return null;

  const targetLabel =
    targetType === "post" ? "Post" : targetType === "comment" ? "Comment" : "User";

  return (
    <>
      <Pressable
        onPress={() => setMenuVisible(true)}
        hitSlop={8}
        style={{ padding: 4 }}
      >
        <Ionicons
          name="ellipsis-horizontal"
          size={size}
          color={colors.textTertiary}
        />
      </Pressable>

      <Modal
        visible={menuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuVisible(false)}
      >
        <Pressable
          style={styles.overlay}
          onPress={() => setMenuVisible(false)}
        >
          <View
            style={[styles.menu, { backgroundColor: colors.surface }]}
            onStartShouldSetResponder={() => true}
          >
            {isOwnContent && onDelete ? (
              /* Owner menu — delete only */
              <Pressable
                style={styles.menuItem}
                onPress={() => {
                  setMenuVisible(false);
                  Alert.alert(
                    `Delete ${targetLabel}`,
                    "This will permanently delete this post. This action cannot be undone.",
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Delete",
                        style: "destructive",
                        onPress: onDelete,
                      },
                    ]
                  );
                }}
              >
                <Ionicons name="trash-outline" size={20} color={Colors.error} />
                <Text style={[styles.menuLabel, { color: Colors.error }]}>
                  Delete {targetLabel}
                </Text>
              </Pressable>
            ) : (
              /* Other user menu — report + block */
              <>
                <Pressable
                  style={[styles.menuItem, { borderBottomColor: colors.borderLight }]}
                  onPress={() => {
                    setMenuVisible(false);
                    onReport();
                  }}
                >
                  <Ionicons name="flag-outline" size={20} color={colors.text} />
                  <Text style={[styles.menuLabel, { color: colors.text }]}>
                    Report {targetLabel}
                  </Text>
                </Pressable>

                <Pressable
                  style={styles.menuItem}
                  onPress={() => {
                    setMenuVisible(false);
                    Alert.alert(
                      "Block User",
                      "They won't be able to see your content, and their content will be hidden from your feed.",
                      [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Block",
                          style: "destructive",
                          onPress: onBlockUser,
                        },
                      ]
                    );
                  }}
                >
                  <Ionicons name="ban-outline" size={20} color={Colors.error} />
                  <Text style={[styles.menuLabel, { color: Colors.error }]}>
                    Block User
                  </Text>
                </Pressable>
              </>
            )}

            <Pressable
              style={[styles.cancelItem, { borderTopColor: colors.separator }]}
              onPress={() => setMenuVisible(false)}
            >
              <Text style={[styles.cancelText, { color: colors.textSecondary }]}>
                Cancel
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  menu: {
    borderRadius: 14,
    overflow: "hidden",
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "transparent",
  },
  menuLabel: {
    fontSize: 16,
    fontWeight: "500",
  },
  cancelItem: {
    padding: 16,
    alignItems: "center",
    borderTopWidth: 1,
  },
  cancelText: {
    fontSize: 16,
    fontWeight: "600",
  },
});
