declare module 'penpal' {
  export type AsyncMethodReturns<T> = {
    [K in keyof T]: T[K] extends (...args: infer A) => infer R
      ? R extends PromiseLike<unknown>
        ? T[K]
        : (...args: A) => Promise<R>
      : T[K];
  };

  export type CallSender = {
    [index: string]: (...args: unknown[]) => unknown;
  };

  type Connection<TCallSender extends object = CallSender> = {
    /**
     * A promise which will be resolved once a connection has been established.
     */
    promise: Promise<AsyncMethodReturns<TCallSender>>;
    /**
     * A method that, when called, will disconnect any messaging channels.
     * You may call this even before a connection has been established.
     */
    destroy: () => void;
  };

  export type Methods = {
    [index: string]: (...args: never[]) => unknown;
  };

  type Options = {
    /**
     * The iframe to which a connection should be made.
     */
    iframe: HTMLIFrameElement;
    /**
     * Methods that may be called by the iframe.
     */
    methods?: Methods;
    /**
     * The child origin to use to secure communication. If
     * not provided, the child origin will be derived from the
     * iframe's src or srcdoc value.
     */
    childOrigin?: string;
    /**
     * The amount of time, in milliseconds, Penpal should wait
     * for the iframe to respond before rejecting the connection promise.
     */
    timeout?: number;
    /**
     * Whether log messages should be emitted to the console.
     */
    debug?: boolean;
  };

  export function connectToChild<TCallSender extends object = CallSender>(
    options: Options,
  ): Connection<TCallSender>;
}
