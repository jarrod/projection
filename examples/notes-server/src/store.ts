export type Note = { id: number; title: string; body: string; pinned: boolean };

const notes: Note[] = [];

export const store = {
  list: () => notes,
  get: (id: number) => notes.find((n) => n.id === id),
  add(title: string, body: string) {
    const n = { id: notes.length + 1, title, body, pinned: false };
    notes.push(n);
    return n;
  },
  pin(id: number) {
    const n = notes.find((x) => x.id === id);
    if (n) n.pinned = !n.pinned;
    return n;
  },
};
