export type EventHandler<T = unknown> = (payload: T) => void;

export class EventBus<EventMap extends Record<string, unknown>> {
  private listeners = new Map<keyof EventMap, Set<EventHandler<never>>>();

  public on<K extends keyof EventMap>(event: K, handler: EventHandler<EventMap[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler as EventHandler<never>);
    return () => {
      set?.delete(handler as EventHandler<never>);
    };
  }

  public emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) return;
    set.forEach((fn) => {
      (fn as EventHandler<EventMap[K]>)(payload);
    });
  }

  public clear(): void {
    this.listeners.clear();
  }
}
