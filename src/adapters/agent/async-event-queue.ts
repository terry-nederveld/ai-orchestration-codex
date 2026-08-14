export class AsyncEventQueue<T> implements AsyncIterable<T> {
  readonly #events: T[] = [];
  readonly #waiters: Array<() => void> = [];
  #ended = false;
  #error: Error | undefined;

  public push(event: T): void {
    if (this.#ended) return;
    this.#events.push(event);
    this.#wake();
  }

  public end(): void {
    this.#ended = true;
    this.#wake();
  }

  public fail(error: unknown): void {
    this.#error = error instanceof Error ? error : new Error(String(error));
    this.#ended = true;
    this.#wake();
  }

  public async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      const event = this.#events.shift();
      if (event !== undefined) {
        yield event;
        continue;
      }
      if (this.#ended) {
        if (this.#error !== undefined) throw this.#error;
        return;
      }
      await new Promise<void>((resolve) => this.#waiters.push(resolve));
    }
  }

  #wake(): void {
    for (const waiter of this.#waiters.splice(0)) waiter();
  }
}
