import { beforeEach, describe, expect, it, vi } from "vitest";

const setIcon = vi.hoisted(() => vi.fn());

vi.mock("obsidian", () => ({ setIcon }));

import {
  renderActiveNoteStatus,
  renderPendingV1,
} from "../../../src/adapters/obsidian/status-bar.js";

interface FakeElement {
  attributes: Record<string, string>;
  children: Array<{ text?: string }>;
  createSpan(options?: { text?: string }): HTMLElement;
  empty(): void;
  setAttribute(name: string, value: string): void;
  setText(text: string): void;
  style: Record<string, string>;
  text: string;
}

function fakeElement(): HTMLElement & FakeElement {
  const element: FakeElement = {
    attributes: {},
    children: [],
    createSpan(options) {
      const child = options?.text === undefined ? {} : { text: options.text };
      this.children.push(child);
      return child as unknown as HTMLElement;
    },
    empty() {
      this.children = [];
      this.text = "";
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    setText(text) {
      this.text = text;
    },
    style: {},
    text: "",
  };
  return element as HTMLElement & FakeElement;
}

describe("Obsidian status-bar rendering", () => {
  beforeEach(() => setIcon.mockClear());

  it("hides the active-note item when no Markdown note is active", () => {
    const element = fakeElement();

    renderActiveNoteStatus(element, null);

    expect(element.style.display).toBe("none");
    expect(element.text).toBe("");
  });

  it("shows the computed active-note status", () => {
    const element = fakeElement();

    renderActiveNoteStatus(element, "Note: 2 new");

    expect(element.style.display).toBe("");
    expect(element.text).toBe("Note: 2 new");
  });

  it("hides the migration item when there are no pending v1 cards", () => {
    const element = fakeElement();
    element.children.push({ text: "old" });

    renderPendingV1(element, 0);

    expect(element.style.display).toBe("none");
    expect(element.children).toEqual([]);
  });

  it("shows an accessible warning for pending v1 cards", () => {
    const element = fakeElement();

    renderPendingV1(element, 3);

    expect(element.style.display).toBe("inline-flex");
    expect(element.children.at(-1)?.text).toBe("Vault: 3 pending migration");
    expect(element.attributes["aria-label"]).toContain("3 flashcards");
    expect(setIcon).toHaveBeenCalledWith(element.children[0], "alert-triangle");
  });
});
