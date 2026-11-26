export type Note = { id: number; title: string; body: string; pinned: boolean };

// Notes are kept per user. The server's own code knows nothing of projector: it reads the user from the MCP request,
// which is what projector's default identify() reads too, so tools and UI agree.
export const userOf = (extra: any) => String(extra?.authInfo?.extra?.sub ?? "local");
const all = new Map<string, Note[]>();
const of = (user: string) => all.get(user) ?? (all.set(user, []), all.get(user)!);

export const store = {
  list: (user: string) => of(user),
  add(user: string, title: string, body: string) {
    const notes = of(user), n = { id: notes.length + 1, title, body, pinned: false };
    notes.push(n);
    return n;
  },
  pin(user: string, id: number) {
    const n = of(user).find((x) => x.id === id);
    if (n) n.pinned = !n.pinned;
    return n;
  },
};
