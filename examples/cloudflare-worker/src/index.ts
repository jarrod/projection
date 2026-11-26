import { handleMcp } from "./server.js";
import { ui } from "./ui.js";

export default {
  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/mcp") return handleMcp(request);
    if (pathname === "/ui" || pathname.startsWith("/ui/")) return (await ui.site!.fetch(request)) ?? new Response("Not found", { status: 404 });
    if (pathname === "/") return Response.redirect(new URL("/ui/", request.url).href, 302);
    return new Response("Not found", { status: 404 });
  },
};
