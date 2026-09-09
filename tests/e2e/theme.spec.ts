import { expect, test } from "@playwright/test";

test.describe("theme", () => {
  test("defaults to dark and honours a saved light preference before first paint", async ({
    page,
  }) => {
    await page.goto("/login");
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(page.locator("html")).not.toHaveClass(/light/);

    await page.evaluate(() => localStorage.setItem("superlega-theme", "light"));
    await page.reload();
    await expect(page.locator("html")).toHaveClass(/light/);
    const themeColors = await page
      .locator('meta[name="theme-color"]')
      .evaluateAll((els) => els.map((el) => el.getAttribute("content")));
    expect(themeColors.length).toBeGreaterThan(0);
    for (const c of themeColors) expect(c).toBe("#f4f7fb");
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe("rgb(244, 247, 251)");
  });

  test("skip link and PWA icons are present", async ({ page, request }) => {
    await page.goto("/login");
    await expect(page.locator('a[href="#main"]')).toHaveText("Vai al contenuto");
    for (const icon of [
      "icon-192.png",
      "icon-512.png",
      "maskable-512.png",
      "apple-touch-icon.png",
    ]) {
      const res = await request.get(`/icons/${icon}`);
      expect(res.ok(), icon).toBe(true);
      expect(res.headers()["content-type"]).toContain("image/png");
    }
  });
});
