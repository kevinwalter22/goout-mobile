import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./useAuth";
import { mediumHaptic } from "../utils/haptics";
import { captureWarning } from "../lib/logger";
import { appEvents } from "../utils/appEvents";

type FriendshipStatus =
  | "none"           // No friendship or request exists
  | "pending_sent"   // Current user sent a request (pending)
  | "pending_received" // Current user received a request (pending)
  | "accepted";      // Friendship is accepted (friends)

export function useFriendship(targetUserId: string | null) {
  const { user } = useAuth();
  const [status, setStatus] = useState<FriendshipStatus>("none");
  const [friendshipId, setFriendshipId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Track who initiated the friendship (for accept notifications)
  const initiatorId = useRef<string | null>(null);
  // Synchronous in-flight guard — prevents double-submit races that slip through
  // before setLoading(true) causes a re-render
  const inFlight = useRef(false);

  useEffect(() => {
    if (!user || !targetUserId) {
      setLoading(false);
      return;
    }
    loadFriendshipStatus();
  }, [user, targetUserId]);

  // Refresh when a friend-accepted push arrives — covers the case where the
  // sender has the recipient's profile already mounted (stale "Add Friend"
  // button) when the recipient accepts. Only refresh if the push is about
  // this exact target.
  useEffect(() => {
    if (!user || !targetUserId) return;
    const onAccepted = (payload: { accepterId?: string }) => {
      if (payload.accepterId && payload.accepterId !== targetUserId) return;
      loadFriendshipStatus();
    };
    appEvents.on("notification:friendAccepted", onAccepted);
    return () => appEvents.off("notification:friendAccepted", onAccepted);
  }, [user, targetUserId]);

  async function loadFriendshipStatus() {
    if (!user || !targetUserId) return;

    setLoading(true);

    // Check bidirectional: (me → them) OR (them → me)
    const { data } = await supabase
      .from("friendships")
      .select("id, user_id, friend_id, status")
      .or(
        `and(user_id.eq.${user.id},friend_id.eq.${targetUserId}),and(user_id.eq.${targetUserId},friend_id.eq.${user.id})`
      )
      .maybeSingle();

    if (!data) {
      setStatus("none");
      setFriendshipId(null);
      initiatorId.current = null;
    } else {
      const friendship = data as any;
      initiatorId.current = friendship.user_id;
      if (friendship.status === "accepted") {
        setStatus("accepted");
        setFriendshipId(friendship.id);
      } else if (friendship.status === "pending") {
        // Check if current user sent or received the request
        if (friendship.user_id === user.id) {
          setStatus("pending_sent");
        } else {
          setStatus("pending_received");
        }
        setFriendshipId(friendship.id);
      } else {
        // Declined - treat as none
        setStatus("none");
        setFriendshipId(null);
      }
    }

    setLoading(false);
  }

  async function sendFriendRequest() {
    if (!user || !targetUserId || loading || inFlight.current) return;

    inFlight.current = true;
    setLoading(true);
    // Optimistic update — flip the button immediately so the UI responds on the
    // first tap without waiting for the network round-trip.
    setStatus("pending_sent");

    try {
      const { data, error } = await supabase
        .from("friendships")
        .insert({ user_id: user.id, friend_id: targetUserId, status: "pending" } as any)
        .select()
        .single();

      if (!error && data) {
        mediumHaptic();
        setFriendshipId((data as any).id);
        initiatorId.current = user.id;

        // Fire-and-forget notification
        supabase.functions
          .invoke("send-notification", {
            body: { type: "friend_request", recipient_id: targetUserId },
          })
          .catch((err) => captureWarning("send-notification failed", { type: "friend_request", err }));
      } else {
        // Rollback optimistic update on failure
        setStatus("none");
      }
    } catch (error) {
      console.error("Error sending friend request:", error);
      setStatus("none");
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }

  async function acceptFriendRequest() {
    if (!user || !targetUserId || !friendshipId || loading) return;

    setLoading(true);

    try {
      const { error } = await (supabase
        .from("friendships")
        .update as any)({ status: "accepted" })
        .eq("id", friendshipId);

      if (!error) {
        mediumHaptic();
        setStatus("accepted");

        // Notify the original requester that their request was accepted
        const senderId = initiatorId.current;
        if (senderId && senderId !== user.id) {
          supabase.functions
            .invoke("send-notification", {
              body: { type: "friend_accepted", recipient_id: senderId },
            })
            .catch((err) => captureWarning("send-notification failed", { type: "friend_accepted", err }));
        }
      }
    } catch (error) {
      console.error("Error accepting friend request:", error);
    } finally {
      setLoading(false);
    }
  }

  async function declineFriendRequest() {
    if (!user || !targetUserId || !friendshipId || loading) return;

    setLoading(true);

    try {
      const { error } = await (supabase
        .from("friendships")
        .update as any)({ status: "declined" })
        .eq("id", friendshipId);

      if (!error) {
        mediumHaptic();
        setStatus("none");
        setFriendshipId(null);
      }
    } catch (error) {
      console.error("Error declining friend request:", error);
    } finally {
      setLoading(false);
    }
  }

  async function cancelFriendRequest() {
    if (!user || !targetUserId || !friendshipId || loading) return;

    setLoading(true);

    try {
      await supabase
        .from("friendships")
        .delete()
        .eq("id", friendshipId);

      mediumHaptic();
      setStatus("none");
      setFriendshipId(null);
    } catch (error) {
      console.error("Error canceling friend request:", error);
    } finally {
      setLoading(false);
    }
  }

  async function removeFriend() {
    if (!user || !targetUserId || !friendshipId || loading) return;

    setLoading(true);

    try {
      await supabase
        .from("friendships")
        .delete()
        .eq("id", friendshipId);

      mediumHaptic();
      setStatus("none");
      setFriendshipId(null);
    } catch (error) {
      console.error("Error removing friend:", error);
    } finally {
      setLoading(false);
    }
  }

  return {
    status,
    loading,
    sendFriendRequest,
    acceptFriendRequest,
    declineFriendRequest,
    cancelFriendRequest,
    removeFriend,
    refresh: loadFriendshipStatus,
  };
}
