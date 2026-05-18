// App-wide event bus for cross-component signals that aren't suited to React
// state or context — typically: push-notification arrivals that need to
// invalidate data in hooks that are already mounted somewhere else in the tree.
//
// Compared to scrollToTopEmitter (which carries no payload), this emitter
// supports a typed payload per event.

type EventName =
  | "notification:friendRequest"
  | "notification:friendAccepted";

type Payload = {
  // friend_request: the sender is not currently included in the push payload
  // (the edge function sets reference_id to the recipient). Subscribers should
  // re-fetch the requests list rather than rely on payload contents.
  "notification:friendRequest": Record<string, never>;
  // friend_accepted: accepterId is the user who accepted (taken from the push
  // data.reference_id, which the edge function sets to the actor's id).
  "notification:friendAccepted": { accepterId?: string };
};

type Listener<E extends EventName> = (payload: Payload[E]) => void;

class TypedEventEmitter {
  private listeners: Map<EventName, Set<Listener<any>>> = new Map();

  on<E extends EventName>(event: E, listener: Listener<E>) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
  }

  off<E extends EventName>(event: E, listener: Listener<E>) {
    this.listeners.get(event)?.delete(listener);
  }

  emit<E extends EventName>(event: E, payload: Payload[E]) {
    this.listeners.get(event)?.forEach((listener) => listener(payload));
  }
}

export const appEvents = new TypedEventEmitter();
