import { expect, test } from "@playwright/test";

const pages = ["/", "/collectie", "/winkelwagen", "/afrekenen", "/volg-bestelling", "/login", "/registreren", "/contact", "/info/pre-order"];

for (const path of pages) {
  test(`renders without horizontal overflow or console errors: ${path}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && !m.text().includes("Failed to load resource") && errors.push(m.text()));
    await page.goto(path, { waitUntil: "networkidle" });
    const { sw, vw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth }));
    expect(sw).toBeLessThanOrEqual(vw);
    await expect(page.getByRole("link", { name: /THE SECRET SPOT/ }).first()).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test("security headers are set", async ({ request }) => {
  const res = await request.get("/");
  expect(res.headers()["x-frame-options"]).toBe("DENY");
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
});

test("protected endpoints reject anonymous access", async ({ request }) => {
  expect((await request.get("/api/cron/maintenance")).status()).toBe(401);
  expect((await request.get("/api/admin/export/orders")).status()).toBe(403);
  expect((await request.get("/api/admin/reports/pdf?from=2026-01-01&to=2026-01-31")).status()).toBe(403);
});
