import { test, expect, type Page } from "@playwright/test";

const VIEW_DESCRIPTIONS: Record<string, string> = {
  dashboard: "Workspace command center",
  inbox: "Live WhatsApp conversations",
  contacts: "Customer records and lifecycle",
  automation: "Flows, triggers, and routing",
  templates: "Approved message templates",
  campaigns: "Broadcasts and audience sends",
  analytics: "Reports and performance",
  team: "Members, roles, and workload",
  tasks: "Tasks and calendar for your team",
  assistant: "AI tools and conversation insights",
  admin: "Platform controls",
  settings: "Workspace and integrations",
};

// Known-benign console noise, confirmed by inspecting a real run rather than assumed:
// - the SSE `/api/events` stream aborts when a test navigates away/tears down its page,
//   logged as a connection-closed resource error, not a real app defect.
// - a 403 on a plan-gated fetch (e.g. Automation, when the seeded workspace's plan doesn't
//   include the `automationBuilder` entitlement) is the pack-tier gate working as designed -
//   the UI itself renders a locked-state card for this, it doesn't crash.
const BENIGN_CONSOLE_PATTERNS = [/ERR_CONNECTION_CLOSED/, /responded with a status of 403/];

function trackConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && !BENIGN_CONSOLE_PATTERNS.some((pattern) => pattern.test(msg.text()))) {
      errors.push(msg.text());
    }
  });
  // Uncaught exceptions are never benign - always a real defect.
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

test.describe("main navigation - every view loads with no console errors", () => {
  for (const [view, description] of Object.entries(VIEW_DESCRIPTIONS)) {
    test(`${view} view renders`, async ({ page }) => {
      const errors = trackConsoleErrors(page);

      await page.goto(`/#/${view}`);
      await expect(page.getByText(description, { exact: true })).toBeVisible({ timeout: 15_000 });

      expect(errors, `console errors on the ${view} view: ${errors.join("\n")}`).toEqual([]);
    });
  }
});

test.describe("Tasks - real CRUD through the actual UI", () => {
  test("create, complete, and delete a task", async ({ page }) => {
    const title = `E2E task ${Date.now()}`;

    await page.goto("/#/tasks");
    // The empty-state card renders its own "New task" CTA alongside the header button when the
    // list has zero rows, so this locator can legitimately match two buttons - always take the
    // header one.
    await page.getByRole("button", { name: "New task" }).first().click();

    await page.getByLabel("Title").fill(title);
    await page.getByRole("button", { name: "Save task" }).click();

    const row = page.locator("tr", { hasText: title });
    await expect(row).toBeVisible({ timeout: 15_000 });

    // Toggle to completed - first cell in the row holds the status toggle button.
    await row.locator("td").first().locator("button").click();
    await expect(row.locator("span", { hasText: title })).toHaveClass(/line-through/);

    // Actions (edit/delete) only reveal on row hover.
    await row.hover();
    await row.locator("td").last().locator("button").last().click();

    await expect(page.locator("tr", { hasText: title })).toHaveCount(0);
  });
});

test.describe("Contacts - real CRUD through the actual UI", () => {
  test("create and delete a contact", async ({ page }) => {
    const name = `E2E Contact ${Date.now()}`;
    const phone = `+91 9${Date.now().toString().slice(-9)}`;

    await page.goto("/#/contacts");
    // Same empty-state-CTA-duplicates-the-header-button pattern as Tasks' "New task".
    await page.getByRole("button", { name: "New lead" }).first().click();

    await page.getByLabel("Name").fill(name);
    await page.getByLabel("Phone").fill(phone);
    await page.getByRole("button", { name: "Save contact" }).click();

    const row = page.locator("tr", { hasText: name });
    await expect(row).toBeVisible({ timeout: 15_000 });

    // The row itself opens the contact detail panel on click, so the row checkbox stops
    // propagation - checking it selects for bulk actions instead of navigating away.
    await row.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Delete" }).click();

    await expect(page.locator("tr", { hasText: name })).toHaveCount(0);
  });
});

test.describe("Templates - real create/edit/archive through the actual UI", () => {
  test("create, edit, and archive a template", async ({ page }) => {
    const name = `E2E Template ${Date.now()}`;
    const renamed = `${name} (edited)`;

    await page.goto("/#/templates");
    await page.getByRole("button", { name: "New template" }).first().click();

    await page.getByLabel("Template name").fill(name);
    await page.getByLabel("Body").fill("Hello {{name}}, this is a test template.");
    await page.getByRole("button", { name: "Save template" }).click();

    // Each template renders as its own Card (not a table row) - `.cursor-pointer` is that
    // card's own root class, scoping the locator to exactly one template.
    let card = page.locator(".cursor-pointer", { hasText: name });
    await expect(card).toBeVisible({ timeout: 15_000 });

    // Edit/Archive are icon-only buttons identified by their `title` attribute, not visible text.
    await card.locator('button[title="Edit"]').click();
    await page.getByLabel("Template name").fill(renamed);
    await page.getByRole("button", { name: "Save template" }).click();

    card = page.locator(".cursor-pointer", { hasText: renamed });
    await expect(card).toBeVisible({ timeout: 15_000 });

    await card.locator('button[title="Archive"]').click();
    await expect(card.getByText("archived", { exact: true })).toBeVisible({ timeout: 15_000 });
  });
});
