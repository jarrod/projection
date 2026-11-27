export type WebOptions = {
    /** Public origin the browser uses, e.g. "https://app.example.com": scheme, host and port only. Requires `secret` and
     *  `mcp`. Without it, the UI is served on this machine only (127.0.0.1, a free port) by a listener projector starts itself. */
    origin?: string;
    /** Mount path. Default "/ui". */
    base?: string;
    /** Seconds a link stays redeemable. Default 120. */
    linkTtl?: number;
    /** Seconds a browser session lasts at most. It also ends when its token expires, and as soon as the server refuses it. Default 3600. */
    sessionTtl?: number;
    /** Encrypts links and session cookies: at least 32 characters, random, the same on every instance. Required with
     *  `origin`; without it a random key is made per process. Changing it ends every link and session. */
    secret?: string;
    /** Marks a link used: returns `true` the first time it is called for an `id`, and never again. Must be atomic across
     *  instances (an insert with a unique key). The id can be forgotten once `exp` (ms since 1970) has passed.
     *  Anything but `true` refuses the link. Default: in this process's memory, which is enough for a single instance only. */
    claim?: (id: string, exp: number) => boolean | Promise<boolean>;
    /** The server's own MCP endpoint, which every browser request is sent to (Streamable HTTP, with the agent's bearer
     *  token, behind the same auth as the agent's requests): its URL, absolute or relative to `origin`, or a fetch handler
     *  for it in this process (needed on Workers, where it gets the request as POSTed to <origin>/mcp). It must be
     *  stateless: each browser request is one tools/call, with no initialize and no session. Required with `origin`, and
     *  for links minted from an authenticated request. Only without either does a browser run its calls in this process,
     *  on the attached server. */
    mcp?: string | ((req: Request) => Promise<Response>);
};
type Deps = {
    name: string;
    css: string;
    runtime: string;
    tag: string;
    state: (s: object) => string;
    /** A tools/call for a browser of the self-started local listener without web.mcp, in this process. */
    local: (name: string, args: unknown) => Promise<any>;
};
/** In the `_meta` of every tools/call projector sends for a browser. Only ever makes a request refuse to mint a link,
 *  so a client that sets it harms nobody but itself. */
export declare const WEB_META = "mcp-projector/web";
export declare function createWeb(d: Deps, opts: WebOptions): {
    fetch: (req: Request) => Promise<Response | null>;
    node: (req: any, res: any, next?: () => void) => Promise<any>;
    /** Without an origin, start serving on 127.0.0.1 at a free port (once). The listener never keeps the process alive.
     *  It refuses requests naming another Host (DNS rebinding); a failed start is retried on the next call. */
    listen: () => Promise<void>;
    /** Mint a single-use link that carries this authInfo's bearer token. Use ui.link(extra), which reads it from the MCP request. */
    link(a?: {
        token?: string;
        expiresAt?: number;
    }): Promise<string>;
    close: () => void;
};
export {};
