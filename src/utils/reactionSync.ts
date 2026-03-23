// Lightweight event emitter for syncing reactions across mounted ReactionBar instances.
// Same pattern as scrollToTopEmitter but callbacks receive data payloads.

type ReactionUpdate = {
  reactions: { post_id: string; emoji: string; user_id: string }[];
  userReaction: string | null;
};

type Listener = (update: ReactionUpdate) => void;

const listeners = new Map<string, Set<Listener>>();

export const reactionSync = {
  subscribe(postId: string, listener: Listener): () => void {
    if (!listeners.has(postId)) listeners.set(postId, new Set());
    listeners.get(postId)!.add(listener);
    return () => {
      listeners.get(postId)?.delete(listener);
    };
  },
  emit(postId: string, update: ReactionUpdate) {
    listeners.get(postId)?.forEach((fn) => fn(update));
  },
};
