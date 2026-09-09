import { expect, test } from "@playwright/test";

test.describe("public auth pages", () => {
  test("root redirects anonymous visitors to /login", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("protected route redirects to /login with next", async ({ page }) => {
    await page.goto("/mercato");
    await expect(page).toHaveURL(/\/login\?next=%2Fmercato$/);
  });

  test("login page renders the form without horizontal scroll", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Accedi" })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Accedi" })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("signup page asks for the league code", async ({ page }) => {
    await page.goto("/registrati");
    await expect(page.getByLabel("Codice lega")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("manifest is served", async ({ request }) => {
    const res = await request.get("/manifest.webmanifest");
    expect(res.ok()).toBe(true);
    const manifest = await res.json();
    expect(manifest.name).toBe("SuperLega");
    expect(manifest.display).toBe("standalone");
  });
});
