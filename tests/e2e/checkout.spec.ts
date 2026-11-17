import { expect, test } from "@playwright/test";

/**
 * Full customer flow (TEST 1 / TEST 2 in the browser). Requires E2E_LIVE=1 and a
 * Supabase project with the seed data (demo products) and a bank account marked
 * "show at checkout".
 */
test.skip(process.env.E2E_LIVE !== "1", "requires a seeded Supabase backend (E2E_LIVE=1)");

test("guest buys an in-stock product and submits a payment reference", async ({ page }) => {
  await page.goto("/collectie?type=in_stock");
  await page.locator('a[href^="/product/"]').first().click();
  const sizes = page.getByRole("radio");
  if (await sizes.count()) await sizes.first().click();
  await page.getByRole("button", { name: /In winkelwagen/ }).click();
  await page.goto("/winkelwagen");
  await expect(page.getByText("Vereiste aanbetaling")).toBeVisible();
  await page.getByRole("link", { name: "Afrekenen" }).click();

  await page.getByLabel("Volledige naam *").fill("E2E Testklant");
  await page.getByLabel("WhatsApp-nummer *").fill("+597 8000001");
  await page.getByLabel("District *").selectOption({ label: "Paramaribo (1–2 werkdagen)" });
  await page.getByLabel("Bezorgadres *").fill("Teststraat 1, Paramaribo");
  await page.getByRole("checkbox").last().check();
  await page.getByRole("button", { name: "Bestelling plaatsen" }).click();

  await expect(page).toHaveURL(/\/bestelling\/TSS-\d{4}-\d{6}/);
  await expect(page.getByText(/pas bevestigd nadat uw betaling/)).toBeVisible();
  await page.getByLabel(/Betaalreferentie/).fill("E2E-REF-1");
  await page.getByRole("button", { name: "Betaling doorgeven" }).click();
  await expect(page.getByText(/wordt gecontroleerd/)).toBeVisible();
});

test("guest pre-orders a product and sees estimated dates", async ({ page }) => {
  await page.goto("/collectie?type=preorder");
  await page.locator('a[href^="/product/"]').first().click();
  await expect(page.getByText(/schatting/i).first()).toBeVisible();
});
