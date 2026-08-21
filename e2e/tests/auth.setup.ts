import { test as setup, expect } from "@playwright/test";

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || "admin@test.com";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || "123456";
const AUTH_FILE = ".auth/admin.json";

// Real UI login (not a token bypass) - proves the actual login form works, and every
// other spec then reuses the resulting storageState instead of re-logging-in per test.
setup("authenticate as the seeded admin", async ({ page }) => {
  // Login is this suite's single most failure-prone step - keep these listeners so a failure's
  // trace/log actually says whether the request ever left the browser, not just "text not found."
  page.on("pageerror", (err) => console.log(`[pageerror] ${err.message}`));
  page.on("requestfailed", (req) => console.log(`[requestfailed] ${req.method()} ${req.url()} -> ${req.failure()?.errorText}`));
  page.on("response", (res) => {
    if (res.url().includes("/auth/login")) console.log(`[response] ${res.status()} ${res.url()}`);
  });

  await page.goto("/");

  await page.getByLabel("Email address").fill(ADMIN_EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(ADMIN_PASSWORD);

  const loginResponse = page.waitForResponse((res) => res.url().includes("/auth/login"), { timeout: 25_000 });
  await page.getByRole("button", { name: "Sign in" }).click();
  const response = await loginResponse;
  console.log(`[login] responded ${response.status()} in this browser context`);

  // Lands on the Dashboard view after login - its description string is unique, visible text
  // (nav items are icon-based, not reliably matched by getByText).
  await expect(page.getByText("Workspace command center", { exact: true })).toBeVisible({ timeout: 15_000 });

  await page.context().storageState({ path: AUTH_FILE });
});
