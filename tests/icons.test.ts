import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { icons } from "lucide-react";
import { ICONS } from "../app/components/icon-registry";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.(tsx?|jsx?)$/.test(e.name) && !e.name.startsWith("icon-registry") ? [p] : [];
  });
}

const files = sourceFiles("app").map((f) => ({ f, src: readFileSync(f, "utf8") }));

describe("icon registry", () => {
  it("registers every lucide icon referenced by name in app/", () => {
    const missing = new Set<string>();
    for (const { src } of files) {
      for (const m of src.matchAll(/["'`]([A-Z][A-Za-z0-9]*)["'`]/g)) {
        if ((icons as Record<string, unknown>)[m[1]] && !ICONS[m[1]]) missing.add(m[1]);
      }
    }
    expect([...missing]).toEqual([]);
  });

  it("only uses registered names in <Icon name=…> (catches renamed lucide aliases)", () => {
    const unknown = new Set<string>();
    for (const { f, src } of files) {
      for (const m of src.matchAll(/<Icon\b[^>]*?\sname=["']([A-Za-z0-9]+)["']/g)) {
        if (!ICONS[m[1]]) unknown.add(`${m[1]} (${f})`);
      }
    }
    expect([...unknown]).toEqual([]);
  });

  it("maps every entry to a lucide component", () => {
    for (const [name, component] of Object.entries(ICONS)) expect(component, name).toBeTruthy();
  });
});
