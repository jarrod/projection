/** The MCP client: `Client` from @modelcontextprotocol/client. */
type TestClient = {
    callTool(params: {
        name: string;
        arguments?: Record<string, unknown>;
    }, ...options: any[]): Promise<any>;
    listTools(...options: any[]): Promise<{
        tools: any[];
    }>;
    close(): Promise<void>;
    [member: string]: any;
};
type Factory = () => {
    connect(t: any): Promise<void>;
} | Promise<{
    connect(t: any): Promise<void>;
}>;
export declare function testUi(factory: Factory): Promise<{
    agent: TestClient;
    host: TestClient;
    tools: any[];
    modelTools: any[];
    resourceUri: string | undefined;
    mount: (params?: Record<string, unknown>) => Promise<{
        html: () => string;
        text: () => string;
        /** Call a tool the way a click on hx-tool would. Throws if the tool reports an error. */
        click(tool: string, args?: Record<string, unknown>): Promise<any>;
        /** Change view params the way a `set` control would. */
        set(p: Record<string, unknown>): Promise<void>;
        /** Check for changes until the visible text matches (a real page checks every few seconds; this checks at once and often). */
        until(pred: (text: string, html: string) => boolean, ms?: number): Promise<void>;
        /** Stop the view. Nothing is held open, so this only exists for symmetry with a real page. */
        close(): void;
    }>;
    close: () => Promise<void>;
}>;
export {};
