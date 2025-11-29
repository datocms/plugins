declare module 'penpal' {
  export type FunctionPropertyNames<T> = {
    [K in keyof T]: T[K] extends Function ? K : never;
  }[keyof T];

  export type AsyncMethodReturns<
    T,
    K extends keyof T = FunctionPropertyNames<T>
  > = {
    [KK in K]: T[KK] extends (...args: any[]) => PromiseLike<any>
      ? T[KK]
      : T[KK] extends (...args: infer A) => infer R
      ? (...args: A) => Promise<R>
      : T[KK];
  };

  export type CallSender = {
    [index: string]: Function;
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
    [index: string]: Function;
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
    options: Options
  ): Connection<TCallSender>;
}
