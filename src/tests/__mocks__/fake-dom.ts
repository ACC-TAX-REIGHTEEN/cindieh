// ============================================================
// FAKE-DOM.TS — Minimal DOM/window stub for DOM-heavy tests
// ============================================================
// A small fake for `document`/`window` enough to drive the extension's
// injected UI (ui-filters, ui-badge) without jsdom/happy-dom: element
// creation, id lookup, append/insert/remove, classList, closest/matches,
// descendant querySelector, attributes, text nodes, event listeners
// (element + document + window), and a window stub.
//
// Mirrors the pattern of xhr-mock.ts: a pure helper imported directly by
// tests, plus stubFakeDom() to wire the globals via vi.stubGlobal.
// ============================================================

import { vi } from "vitest";

export type FakeListener = (event?: unknown) => void;

export class FakeEl {
  id = "";
  style: Record<string, string> = {};
  value = "";
  title = "";
  type = "";
  /** Reflected property for <script> markers (scraper boot harness). */
  src = "";
  htmlFor = "";
  rows = 0;
  /**
   * The DOM's tabIndex property. A real element defaults to -1, and the panel
   * sets it explicitly to -1 so it can hold focus; a fake that had no such
   * field would make "is the panel focusable" untestable and would let a
   * missing tabIndex pass unnoticed.
   */
  tabIndex = -1;
  /**
   * The reflected `inert` property. The panel parks the portal behind itself
   * while it is open, so a fake without the field would make "is the background
   * really inert" untestable.
   */
  inert = false;
  placeholder = "";
  textContent = "";
  children: FakeEl[] = [];
  listeners: Record<string, FakeListener[]> = {};
  attributes: Record<string, string> = {};
  parentElement: FakeEl | null = null;
  nextSibling: FakeEl | null = null;
  classList: {
    classes: Set<string>;
    add(c: string): void;
    remove(c: string): void;
    toggle(c: string, force?: boolean): boolean;
    contains(c: string): boolean;
  };
  tagName: string;
  doc: FakeDoc;

  /**
   * The backing store for BOTH className and classList.
   *
   * In the real DOM they are two views of one list, and the code under test
   * writes them interchangeably -- `el.className = "a b"` to build an element,
   * `el.classList.add("ch-hidden")` to hide it later. The fake used to keep an
   * independent Set, so an element built with a class string was invisible to
   * its own classList: a `contains("ch-hidden")` guard read false for an
   * element that was, in the browser, plainly hidden. That is exactly the shape
   * of bug a fake is supposed to rule out, and it hid the panel's Escape
   * handler while the tests stayed green. One source of truth, faithfully.
   */
  private classSet = new Set<string>();

  constructor(tagName: string, doc: FakeDoc) {
    this.tagName = tagName;
    this.doc = doc;
    const classes = this.classSet;
    this.classList = {
      classes,
      add(c: string): void {
        classes.add(c);
      },
      remove(c: string): void {
        classes.delete(c);
      },
      toggle(c: string, force?: boolean): boolean {
        const shouldAdd = force ?? !classes.has(c);
        if (shouldAdd) classes.add(c);
        else classes.delete(c);
        return shouldAdd;
      },
      contains(c: string): boolean {
        return classes.has(c);
      },
    };
  }

  /** The DOM's single class list, seen through either name. */
  get className(): string {
    return [...this.classSet].join(" ");
  }

  set className(value: string) {
    // Replace the CONTENTS, not the Set object: classList's methods closed over
    // this one instance in the constructor, so swapping the instance would
    // silently split the two views again -- which is the very bug this class of
    // fake exists to rule out.
    this.classSet.clear();
    for (const c of value.split(/\s+/).filter(Boolean)) this.classSet.add(c);
  }

  /**
   * Mirror the DOM contract that appending an already-parented node MOVES it
   * instead of cloning it — the in-place toolbar reshaping in ui.ts depends on
   * a node appearing under exactly one parent.
   */
  private detachFromPreviousParent(child: FakeEl): void {
    const previous = child.parentElement;
    if (!previous) return;
    const idx = previous.children.indexOf(child);
    if (idx > -1) previous.children.splice(idx, 1);
  }

  appendChild(child: FakeEl): FakeEl {
    this.detachFromPreviousParent(child);
    this.children.push(child);
    child.parentElement = this;
    child.nextSibling = null;
    if (this.children.length > 1) {
      this.children[this.children.length - 2].nextSibling = child;
    }
    this.doc.register(child);
    return child;
  }

  insertBefore(child: FakeEl, ref: FakeEl | null): FakeEl {
    if (!ref) return this.appendChild(child);
    const idx = this.children.indexOf(ref);
    if (idx === -1) return this.appendChild(child);
    this.detachFromPreviousParent(child);
    this.children.splice(idx, 0, child);
    child.parentElement = this;
    this.doc.register(child);
    return child;
  }

  remove(): void {
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx > -1) this.parentElement.children.splice(idx, 1);
      this.parentElement = null;
    }
    // Removing an element makes its whole subtree unreachable from the
    // document — unregister every descendant id, like a real DOM would.
    this.unregisterSubtree();
  }

  private unregisterSubtree(): void {
    this.doc.unregister(this);
    for (const child of this.children) {
      child.unregisterSubtree();
    }
  }

  setAttribute(key: string, value: string): void {
    this.attributes[key] = value;
  }

  getAttribute(key: string): string | null {
    return this.attributes[key] ?? null;
  }

  removeAttribute(key: string): void {
    delete this.attributes[key];
    // Mirror the DOM: removing an attribute also clears the reflected property
    // (scraper.ts relies on this for its <script src> injection marker).
    if (key in this) {
      (this as unknown as Record<string, unknown>)[key] = "";
    }
  }

  addEventListener(type: string, fn: FakeListener): void {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(fn);
  }

  getBoundingClientRect(): {
    bottom: number;
    left: number;
    top: number;
    right: number;
    width: number;
    height: number;
  } {
    return { bottom: 0, left: 0, top: 0, right: 0, width: 0, height: 0 };
  }

  /**
   * Records the call instead of moving focus anywhere. The real DOM would move
   * it, and a test asserting "focus went into the panel" needs to be able to see
   * that, but the fake has no focus tree to move it through. `focusCalls` on the
   * document is the assertion surface; the last one is the current owner, which
   * is what "focus is on the panel" means in practice.
   */
  focus(options?: { preventScroll?: boolean }): void {
    void options;
    this.doc.focusCalls.push(this);
  }

  matches(sel: string): boolean {
    if (sel.startsWith("#")) return this.id === sel.slice(1);
    if (sel.startsWith(".")) return this.classList.contains(sel.slice(1));
    return this.tagName.toLowerCase() === sel.toLowerCase();
  }

  closest(sel: string): FakeEl | null {
    if (this.matches(sel)) return this;
    if (!this.parentElement) return null;
    return this.parentElement.closest(sel);
  }

  contains(node: FakeEl): boolean {
    if (node === this) return true;
    if (!node.parentElement) return false;
    return this.contains(node.parentElement);
  }

  querySelector(sel: string): FakeEl | null {
    for (const child of this.children) {
      if (child.matches(sel)) return child;
      const found = child.querySelector(sel);
      if (found) return found;
    }
    return null;
  }
}

export class FakeDoc {
  byId = new Map<string, FakeEl>();
  buttons: FakeEl[] = [];
  body: FakeEl;
  /** Injection target for <script> tags (main-boot harness). */
  head: FakeEl;
  documentElement: FakeEl;
  /** main.ts branches on this at import time; "loading" keeps init on `load`. */
  readyState = "loading";
  listeners = new Map<string, Set<FakeListener>>();
  /**
   * Every element focus() was called on, in order. The fake has no focus tree,
   * so this is the only way a test can see that focus moved; the last entry is
   * the element that would currently hold it.
   */
  focusCalls: FakeEl[] = [];

  /**
   * The element that would hold focus, as the real document reports it. The
   * fake has no focus tree, so the last focus() call IS the current owner —
   * which is what code that hands focus back after closing a dialog needs to
   * read.
   */
  get activeElement(): FakeEl | null {
    return this.focusCalls[this.focusCalls.length - 1] ?? null;
  }

  constructor() {
    this.body = new FakeEl("body", this);
    this.head = new FakeEl("head", this);
    this.documentElement = new FakeEl("html", this);
  }

  createElement(tag: string): FakeEl {
    return new FakeEl(tag, this);
  }

  createTextNode(text: string): FakeEl {
    const node = new FakeEl("#text", this);
    node.textContent = text;
    return node;
  }

  getElementById(id: string): FakeEl | null {
    return this.byId.get(id) ?? null;
  }

  querySelectorAll(sel: string): FakeEl[] {
    return sel === "button" ? this.buttons : [];
  }

  /** Subtree lookup over body/head; returns null when the stub has no match. */
  querySelector(sel: string): FakeEl | null {
    return this.body.querySelector(sel) ?? this.head.querySelector(sel);
  }

  register(el: FakeEl): void {
    if (el.id) this.byId.set(el.id, el);
  }

  unregister(el: FakeEl): void {
    if (el.id && this.byId.get(el.id) === el) this.byId.delete(el.id);
  }

  addEventListener(type: string, fn: FakeListener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)?.add(fn);
  }

  removeEventListener(type: string, fn: FakeListener): void {
    this.listeners.get(type)?.delete(fn);
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

export interface FakeWindow {
  scrollY: number;
  scrollX: number;
  addEventListener(type: string, fn: FakeListener): void;
  removeEventListener(type: string, fn: FakeListener): void;
  listenerCount(type: string): number;
}

export function makeWindowStub(): FakeWindow {
  const listeners = new Map<string, Set<FakeListener>>();
  return {
    scrollY: 0,
    scrollX: 0,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)?.add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    listenerCount(type) {
      return listeners.get(type)?.size ?? 0;
    },
  };
}

/**
 * Stub global `document`/`window` with a fresh fake pair.
 * Returns the instances so tests can drive and assert against them.
 */
export function stubFakeDom(): { doc: FakeDoc; win: FakeWindow } {
  const doc = new FakeDoc();
  const win = makeWindowStub();
  vi.stubGlobal("document", doc as unknown as Document);
  vi.stubGlobal("window", win as unknown as Window & typeof globalThis);
  return { doc, win };
}
