import { expect, test } from "@playwright/test";

/** Admin flows. Requires E2E_LIVE=1 plus E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD of a test super admin. */
test.skip(process.env.E2E_LIVE !== "1" || !process.env.E2E_ADMIN_EMAIL, "requires live backend + admin credentials");

test("admin verifies a submitted payment", async ({ page }) => {
  await page.goto("/login?next=/admin/payments");
  await page.getByLabel("E-mailadres").fill(process.env.E2E_ADMIN_EMAIL!);
  await page.getByLabel("Wachtwoord").fill(process.env.E2E_ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "Inloggen" }).click();
  await expect(page).toHaveURL(/\/admin\/payments/);
  const approve = page.getByRole("button", { name: "Goedkeuren" }).first();
  test.skip(!(await approve.count()), "no payments waiting");
  page.once("dialog", (d) => d.accept());
  await approve.click();
  await expect(page.getByText("Betaling geverifieerd")).toBeVisible();
});

test("customers are redirected away from the admin", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login/);
});
