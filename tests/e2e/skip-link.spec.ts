import { expect, test } from "@playwright/test";

// The root layout's "Vai al contenuto" link must land on a real #main on every page,
// including the public ones rendered by the (auth) layout.
for (const path of ["/login", "/registrati", "/offline"]) {
  test(`skip link target exists on ${path}`, async ({ page }) => {
    await page.goto(path);
    const skip = page.locator('a[href="#main"]');
    await expect(skip).toHaveCount(1);
    await expect(page.locator("#main")).toHaveCount(1);
    await page.keyboard.press("Tab");
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
  });
}
