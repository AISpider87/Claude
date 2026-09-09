import { expect, test } from "@playwright/test";

test.describe("cron endpoint", () => {
  test("rejects calls without the secret", async ({ request }) => {
    const res = await request.get("/api/cron/sync-quotations");
    expect(res.status()).toBe(401);
  });

  test("rejects calls with a wrong secret", async ({ request }) => {
    const res = await request.get("/api/cron/sync-quotations", {
      headers: { authorization: "Bearer wrong" },
    });
    expect(res.status()).toBe(401);
  });

  test("service worker and offline page are served", async ({ request }) => {
    const sw = await request.get("/sw.js");
    expect(sw.ok()).toBe(true);
    expect(sw.headers()["cache-control"]).toContain("no-cache");
    const offline = await request.get("/offline");
    expect(offline.ok()).toBe(true);
  });
});
