import { describe, expect, it } from "vitest";
import { PORTAL_STRINGS, interpolate, maskAccount, normalizeLocale, parseLocales, pickLocale, resolvePortalTexts } from "../app/lib/i18n";
import { BUILT_IN_TEMPLATES, EMAIL_TYPES, fillTemplate, isLegacyDefault } from "../app/lib/email-templates";
import { formatMoney } from "../app/lib/money";

describe("i18n", () => {
  it("has a French translation for every English key", () => {
    const en = Object.keys(PORTAL_STRINGS.en).sort();
    const fr = Object.keys(PORTAL_STRINGS.fr).sort();
    expect(fr).toEqual(en);
    for (const k of en) expect((PORTAL_STRINGS.fr as Record<string, string>)[k].length).toBeGreaterThan(0);
  });

  it("normalizes and picks locales", () => {
    expect(normalizeLocale("fr-FR")).toBe("fr");
    expect(normalizeLocale("de")).toBeNull();
    expect(parseLocales("fr, xx ,en,fr")).toEqual(["fr", "en"]);
    expect(pickLocale({ requested: "fr", enabled: ["en", "fr"], fallback: "en" })).toBe("fr");
    expect(pickLocale({ requested: "de", acceptLanguage: "fr-CA,fr;q=0.9", enabled: ["en", "fr"], fallback: "en" })).toBe("fr");
    expect(pickLocale({ requested: "fr", enabled: ["en"], fallback: "en" })).toBe("en");
  });

  it("applies legacy labels only to the default language and only when edited", () => {
    const legacy = { labelFindOrder: "Trouver ma commande", labelCta: "Find Order" };
    const en = resolvePortalTexts({ locale: "en", defaultLocale: "en", legacy, whiteLabel: false });
    expect(en.labelFindOrder).toBe("Trouver ma commande");
    expect(en.labelCta).toBe(PORTAL_STRINGS.en.labelCta); // untouched legacy default ignored
    const fr = resolvePortalTexts({ locale: "fr", defaultLocale: "en", legacy, whiteLabel: false });
    expect(fr.labelFindOrder).toBe(PORTAL_STRINGS.fr.labelFindOrder);
  });

  it("forces the attribution without white-label and allows hiding it with it", () => {
    const overrides = { en: { labelPoweredBy: "" } };
    expect(resolvePortalTexts({ locale: "en", defaultLocale: "en", overrides, whiteLabel: false }).labelPoweredBy).toBe("Secured by TrackBack");
    expect(resolvePortalTexts({ locale: "en", defaultLocale: "en", overrides, whiteLabel: true }).labelPoweredBy).toBe("");
  });

  it("interpolates and masks", () => {
    expect(interpolate("Step {n} of {total}", { n: 2, total: 5 })).toBe("Step 2 of 5");
    expect(maskAccount("+221 77 123 45 67")).toBe("••••••4567");
  });
});

describe("email templates", () => {
  it("ships every type in English and French without the demo store name", () => {
    for (const locale of ["en", "fr"] as const) {
      for (const type of EMAIL_TYPES) {
        const t = BUILT_IN_TEMPLATES[locale][type];
        expect(t.subject.length).toBeGreaterThan(5);
        expect(t.body).toContain("{{store_name}}");
        expect(t.body).not.toContain("Acme Store");
      }
    }
  });

  it("fills variables and blanks unknown ones", () => {
    expect(fillTemplate("Hi {{customer_name}} {{unknown}}!", { customer_name: "Awa" })).toBe("Hi Awa !");
  });

  it("recognizes untouched legacy defaults", () => {
    expect(isLegacyDefault("Approved", "Your return is approved — ship it back", "…\n— Acme Store")).toBe(true);
    expect(isLegacyDefault("Approved", "Custom subject", "…\n— Acme Store")).toBe(false);
  });
});

describe("money", () => {
  it("formats zero-decimal West African CFA francs", () => {
    const s = formatMoney(25000, "XOF", "fr-FR");
    expect(s).toMatch(/25\s?000/);
    expect(s).not.toMatch(/,00/);
  });
});
