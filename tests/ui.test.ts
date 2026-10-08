import { describe, it, expect } from "vitest";
import { StatusBarManager } from "../src/ui/StatusBarManager";
import { FakeStatusBarItem } from "./mocks/vscode";

const itemOf = (bar: StatusBarManager) => (bar as unknown as { item: FakeStatusBarItem }).item;

describe("StatusBarManager", () => {
  it("a violation opens the last review instead of starting a new one (U5)", () => {
    const bar = new StatusBarManager();
    bar.setViolationFound();
    expect(itemOf(bar).command).toBe("blueprint.showLastReview");
    expect(itemOf(bar).text).toContain("Violation");
  });

  it("handling every violation returns to idle (U17)", () => {
    const bar = new StatusBarManager();
    bar.setViolationFound();
    bar.clearViolation();
    expect(itemOf(bar).text).not.toContain("Violation");
    expect(itemOf(bar).command).toBe("blueprint.openHub");
    expect(itemOf(bar).backgroundColor).toBeUndefined();
  });

  it("clearing a violation never interrupts a later state", () => {
    const bar = new StatusBarManager();
    bar.setViolationFound();
    bar.setChecking(); // a new review started before the last violation was handled
    bar.clearViolation();
    expect(itemOf(bar).text).toContain("Checking");
  });
});
