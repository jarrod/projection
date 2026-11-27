import { WEB_META, type WebOptions } from "./web.js";
export { WEB_META };
import { type Html } from "./html.js";
export declare const MCP_APP_MIME = "text/html;profile=mcp-app";
declare const FROM_WEB: unique symbol;
/** View state. Lives in the viewer's browser; changed with `set` on a Button, Input, Form or Menu item. */
export type Params = Record<string, any>;
export type ViewCtx = {
    /** Who is viewing: the MCP user (authInfo). On the web too: the browser sends the agent's own token with every request. */
    user: string;
    params: Params;
    /** Run one of the server's own read tools as this viewer, through its tools/call handler, and get its result back
     *  as the tool returns it. The view's only way to data. Only tools annotated readOnlyHint, or listed in `reads`. */
    call: ReadTool;
};
/** Calls a read tool and returns its CallToolResult (`content`, `structuredContent`, `isError`). */
export type ReadTool = (tool: string, args?: Record<string, unknown>) => Promise<any>;
export type View = (ctx: ViewCtx) => Html | Promise<Html>;
export type SyncState = {
    params?: Params;
    h?: string;
};
export type SyncResult = {
    h: string;
    html?: string;
};
export type UiOptions = {
    /** Short name, used for the default resource URI ui://<name>/app.html. */
    name: string;
    /** The UI: a function of the viewer and their view params that returns HTML. It reads data with `call`, through the
     *  server's own tools, and runs again after every tool call. */
    view: View;
    /** Tools the view may `call` that are not annotated readOnlyHint, and that change nothing.
     *  Lets a UI read through a server's tools without editing the server. */
    reads?: string[];
    /** Seconds between an open page's checks for changes. Default 5. A page also checks straight after its own action,
     *  and not at all while hidden. */
    poll?: number;
    /** Existing tools whose results should open the UI in MCP Apps hosts (adds _meta.ui.resourceUri). */
    attachTo?: string[];
    /** Extra CSS appended after the kit. */
    css?: string;
    /** Skip the built-in kit CSS entirely. */
    bare?: boolean;
    /** Map an MCP request to a stable user id. Default: the context's http.authInfo.extra.sub, or "local" when the request carries no auth.
     *  An authenticated request with no subject throws: a client id names the agent app, not the person using it. */
    identify?: (extra: any) => string;
    /** Override the ui:// URI. */
    uri?: string;
    /** The same UI on a normal URL, reached through single-use links. On by default. Without `origin` it is served on this
     *  machine only (127.0.0.1, a free port); for a hosted server give `origin` and serve ui.site.node or ui.site.fetch there.
     *  `false` turns web mode off. */
    web?: false | (WebOptions & {
        /** Model-visible tool that opens the UI in the user's browser (URL elicitation, link fallback).
         *  Default `open_<name>_in_browser`; `false` for none. */
        tool?: string | false;
        toolDescription?: string;
    });
};
type Auth = {
    token?: string;
    clientId?: string;
    expiresAt?: number;
    extra?: Record<string, unknown>;
};
/** The part of a tool handler's context (its second argument) that this library reads. */
export type Extra = {
    mcpReq?: {
        id?: string | number;
        signal?: AbortSignal;
        envelope?: object;
        _meta?: Record<string, unknown>;
    };
    http?: {
        authInfo?: Auth;
        req?: Request;
    };
    [FROM_WEB]?: true;
};
type ServerLike = {
    registerTool: (...a: any[]) => any;
    registerResource: (...a: any[]) => any;
    server: any;
};
export declare function defineUi(o: UiOptions): {
    attach: <S extends ServerLike>(server: S) => S;
    /** Render the view to an HTML string (tests, snapshots). */
    render: (params?: Params, user?: string, call?: ReadTool) => Promise<string>;
    /** Standalone HTML document with styles and no runtime, for screenshots and design review. */
    preview(params?: Params, opts?: {
        user?: string;
        theme?: "light" | "dark";
    }): Promise<string>;
    sync: (user: string, s?: SyncState, call?: ReadTool) => Promise<SyncResult>;
    /** Web site (unless web: false): fetch handler, Node adapter. */
    site: {
        fetch: (req: Request) => Promise<Response | null>;
        node: (req: any, res: any, next?: () => void) => Promise<any>;
        listen: () => Promise<void>;
        link(a?: {
            token?: string;
            expiresAt?: number;
        }): Promise<string>;
        close: () => void;
    } | undefined;
    link: (extra: Extra) => Promise<string>;
    openInBrowser: (extra: Extra, opts: {
        message?: string;
        server: ServerLike;
    }) => Promise<{
        opened: boolean;
        declined: boolean;
        url: string;
    }>;
    /** The user id for an MCP request, as the view receives it. Use it in tool handlers so tools and view agree on who is asking. */
    identify: (extra?: Extra) => string;
    uri: string;
    shell: () => string;
};
export type Ui = ReturnType<typeof defineUi>;
