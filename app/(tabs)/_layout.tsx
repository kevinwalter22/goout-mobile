import { Tabs, usePathname } from "expo-router";
import { Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { scrollToTopEmitter } from "../../src/utils/scrollToTop";
import { Colors } from "../../src/config/theme";
import { useTheme } from "../../src/contexts/ThemeContext";
import { SwipeableTabsContainer } from "../../src/components/SwipeableTabsContainer";

export default function TabsLayout() {
  const { colors } = useTheme();
  const pathname = usePathname();

  return (
    <SwipeableTabsContainer>
    <Tabs
      backBehavior="history"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.gray[400],
        tabBarStyle: {
          paddingTop: Platform.OS === "ios" ? 8 : 0,
          borderTopColor: colors.border,
          backgroundColor: colors.tabBar,
        },
      }}
    >
      <Tabs.Screen
        name="feed"
        options={{
          title: "Feed",
          tabBarLabel: "Feed",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home" size={size} color={color} />
          ),
        }}
        listeners={{
          tabPress: (e) => {
            if (pathname === "/feed") {
              e.preventDefault();
              scrollToTopEmitter.emit("scrollToTop:feed");
            }
          },
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: "Explore",
          tabBarLabel: "Explore",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="compass" size={size} color={color} />
          ),
        }}
        listeners={{
          tabPress: (e) => {
            if (pathname === "/explore") {
              e.preventDefault();
              scrollToTopEmitter.emit("scrollToTop:explore");
            }
          },
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarLabel: "Profile",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person" size={size} color={color} />
          ),
        }}
        listeners={{
          tabPress: (e) => {
            if (pathname === "/profile") {
              e.preventDefault();
              scrollToTopEmitter.emit("scrollToTop:profile");
            }
          },
        }}
      />
    </Tabs>
    </SwipeableTabsContainer>
  );
}
