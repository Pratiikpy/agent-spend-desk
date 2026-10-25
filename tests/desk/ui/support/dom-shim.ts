/**
 * A small stand-in for the browser's DOM, enough to run the interface's own client code (`src/desk/ui/client`) in Node and read what it builds. The
 * client touches very little of the DOM: it creates elements, sets attributes and text, appends and clears. A test installs this, imports a screen module,
 * renders it against a real server, and audits the tree it gets: the figures on it, the labels on them, the headings, the names of the controls.
 *
 * What it does not do: layout, styles, focus movement or events from a user. A click is simulated by calling the listeners the code registered.
 */
export class ShimNode {
  parent: ShimElement | null = null;
  get textContent(): string {
    return "";
  }
  remove(): void {
    this.parent?.removeChild(this);
  }
}

export class ShimText extends ShimNode {
  constructor(public data: string) {
    super();
  }
  override get textContent(): string {
    return this.data;
  }
}

export class ShimElement extends ShimNode {
  attrs = new Map<string, string>();
  children: ShimNode[] = [];
  listeners = new Map<string, ((e: unknown) => void)[]>();
  style: Record<string, string> = {};
  value = "";
  disabled = false;
  offsetWidth = 0;
  constructor(readonly tag: string, readonly ns: string | null = null) {
    super();
  }
  get tagName(): string {
    return this.tag.toUpperCase();
  }
  get dataset(): Record<string, string | undefined> {
    const out: Record<string, string | undefined> = {};
    for (const [k, v] of this.attrs) if (k.startsWith("data-")) out[k.slice(5).replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase())] = v;
    return out;
  }
  get firstChild(): ShimNode | null {
    return this.children[0] ?? null;
  }
  override get textContent(): string {
    return this.children.map((c) => c.textContent).join("");
  }
  override set textContent(v: string) {
    for (const c of this.children) c.parent = null;
    this.children = [new ShimText(String(v))];
    this.children[0]!.parent = this;
  }
  setAttribute(k: string, v: string): void {
    this.attrs.set(k, String(v));
  }
  getAttribute(k: string): string | null {
    return this.attrs.get(k) ?? null;
  }
  removeAttribute(k: string): void {
    this.attrs.delete(k);
  }
  hasAttribute(k: string): boolean {
    return this.attrs.has(k);
  }
  get className(): string {
    return this.attrs.get("class") ?? "";
  }
  append(...nodes: (ShimNode | string)[]): void {
    for (const n of nodes) {
      const node = typeof n === "string" ? new ShimText(n) : n;
      node.parent?.removeChild(node);
      node.parent = this;
      this.children.push(node);
    }
  }
  appendChild(n: ShimNode): ShimNode {
    this.append(n);
    return n;
  }
  removeChild(n: ShimNode): ShimNode {
    const i = this.children.indexOf(n);
    if (i >= 0) this.children.splice(i, 1);
    n.parent = null;
    return n;
  }
  contains(n: ShimNode | null): boolean {
    for (let x: ShimNode | null = n; x; x = x.parent) if (x === this) return true;
    return false;
  }
  addEventListener(type: string, fn: (e: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  removeEventListener(): void {}
  focus(): void {}
  getBoundingClientRect(): { left: number; bottom: number; top: number; right: number; width: number; height: number } {
    return { left: 0, bottom: 0, top: 0, right: 0, width: 0, height: 0 };
  }
  /** Elements below this one that match a simple selector: a tag name, `.class`, `#id` or `*`. */
  querySelectorAll(sel: string): ShimElement[] {
    const out: ShimElement[] = [];
    const test = (e: ShimElement): boolean => (sel === "*" ? true : sel.startsWith(".") ? e.className.split(/\s+/).includes(sel.slice(1)) : sel.startsWith("#") ? e.getAttribute("id") === sel.slice(1) : e.tag === sel);
    const visit = (e: ShimElement): void => {
      for (const c of e.children) if (c instanceof ShimElement) { if (test(c)) out.push(c); visit(c); }
    };
    visit(this);
    return out;
  }
  /** Simulate a click the way the page would: run the listeners the code registered. */
  click(): void {
    for (const fn of this.listeners.get("click") ?? []) fn({ target: this });
  }
}

/** Every element under `root`, depth first, with the chain of its ancestors, nearest first. */
export function* walk(root: ShimNode, up: ShimElement[] = []): Generator<{ node: ShimNode; ancestors: ShimElement[] }> {
  yield { node: root, ancestors: up };
  if (root instanceof ShimElement) {
    const next = [root, ...up];
    for (const c of [...root.children]) yield* walk(c, next);
  }
}

export function elements(root: ShimNode): { el: ShimElement; ancestors: ShimElement[] }[] {
  const out: { el: ShimElement; ancestors: ShimElement[] }[] = [];
  for (const { node, ancestors } of walk(root)) if (node instanceof ShimElement) out.push({ el: node, ancestors });
  return out;
}

export function installDom(opts: { origin: string; search?: string; hash?: string }): { document: ShimDocument; app: ShimElement; restore: () => void } {
  const doc = new ShimDocument();
  const app = new ShimElement("div");
  app.setAttribute("id", "app");
  doc.byId.set("app", app);
  doc.body.append(app);
  const g = globalThis as unknown as Record<string, unknown>;
  const saved: Record<string, unknown> = {};
  const set = (k: string, v: unknown): void => {
    saved[k] = g[k];
    g[k] = v;
  };
  const location = { origin: opts.origin, search: opts.search ?? "", hash: opts.hash ?? "", pathname: "/" };
  set("document", doc);
  set("Node", ShimNode);
  set("location", location);
  set("history", { replaceState: (_s: unknown, _t: unknown, url: string) => { location.hash = url.includes("#") ? url.slice(url.indexOf("#")) : ""; location.search = ""; } });
  set("localStorage", { getItem: () => null, setItem: () => {} });
  set("window", { addEventListener() {}, matchMedia: () => ({ matches: false }), scrollX: 0, scrollTo() {}, location });
  return { document: doc, app, restore: () => { for (const [k, v] of Object.entries(saved)) g[k] = v; } };
}

export class ShimDocument {
  readonly documentElement = new ShimElement("html");
  readonly body = new ShimElement("body");
  readonly byId = new Map<string, ShimElement>();
  title = "";
  constructor() {
    (this.documentElement as unknown as { clientWidth: number }).clientWidth = 1000;
  }
  createElement(tag: string): ShimElement {
    return new ShimElement(tag);
  }
  createElementNS(ns: string, tag: string): ShimElement {
    return new ShimElement(tag, ns);
  }
  createTextNode(data: string): ShimText {
    return new ShimText(data);
  }
  getElementById(id: string): ShimElement | null {
    return this.byId.get(id) ?? null;
  }
  addEventListener(): void {}
}
