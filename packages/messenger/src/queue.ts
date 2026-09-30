// A tiny async channel: the producer pushes, the consumer awaits.
export interface Queue<T> extends AsyncIterable<T> {
  push(item: T): void;
  close(): void;
}

export function createQueue<T>(): Queue<T> {
  const items: T[] = []; // pushed but not read yet
  const waiters: ((r: IteratorResult<T>) => void)[] = []; // readers waiting for the next item
  let closed = false;

  return {
    push(item) {
      if (closed) return;
      const waiter = waiters.shift();
      if (waiter)
        waiter({ value: item, done: false }); // someone is waiting: hand it over
      else items.push(item); // nobody waiting: buffer it
    },

    close() {
      closed = true;
      for (const waiter of waiters.splice(0))
        waiter({ value: undefined, done: true });
    },

    async *[Symbol.asyncIterator]() {
      while (true) {
        if (items.length > 0) {
          yield items.shift() as T;
          continue;
        }
        if (closed) return;
        const next = await new Promise<IteratorResult<T>>((resolve) =>
          waiters.push(resolve),
        );
        if (next.done) return;
        yield next.value;
      }
    },
  };
}
