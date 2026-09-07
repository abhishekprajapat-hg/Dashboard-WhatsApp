import { Router } from "express";

// A plain server-rendered page, same philosophy as legal.js - this needs to work from a cold
// email-link click with no app state/session at all, so it deliberately isn't part of the React
// SPA (which only handles authenticated hash-routed views and its own in-memory login/signup
// state). No build step, no bundler - just HTML + a small inline script hitting the real API.
export const resetPasswordRouter = Router();

function page(bodyHtml) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Reset password — Dashboard-WhatsApp</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    line-height: 1.6;
    color: #1a1a1a;
    background: #fafafa;
    display: flex;
    min-height: 100vh;
    align-items: center;
    justify-content: center;
  }
  @media (prefers-color-scheme: dark) {
    body { color: #e5e7eb; background: #0b0f0d; }
    .card { background: #111815 !important; border-color: #1f2b25 !important; }
    input { background: #0b0f0d !important; color: #e5e7eb !important; border-color: #1f2b25 !important; }
  }
  .wrap { width: 100%; max-width: 400px; padding: 24px; }
  .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 24px; }
  .brand .mark { width: 32px; height: 32px; border-radius: 8px; background: #22c55e; display: flex; align-items: center; justify-content: center; }
  .brand .mark svg { width: 18px; height: 18px; }
  .brand span { font-weight: 600; font-size: 15px; }
  .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 28px; }
  h1 { font-size: 19px; margin: 0 0 16px; }
  label { display: block; font-size: 13px; font-weight: 500; margin: 14px 0 6px; }
  input { width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 8px; border: 1px solid #d1d5db; font-size: 14px; }
  button { width: 100%; margin-top: 20px; padding: 11px; border: none; border-radius: 8px; background: #22c55e; color: #06210f; font-weight: 600; font-size: 14px; cursor: pointer; }
  button:disabled { opacity: 0.6; cursor: default; }
  #notice { font-size: 13px; margin-top: 14px; display: none; }
  #notice.error { color: #dc2626; }
  #notice.success { color: #16a34a; }
  a { color: #16a34a; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="brand">
      <span class="mark"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M18 17h28a7 7 0 0 1 7 7v14a7 7 0 0 1-7 7H32l-11 8v-8h-3a7 7 0 0 1-7-7V24a7 7 0 0 1 7-7z" fill="#fff"/><path d="M22 29h20M22 37h14" stroke="#16a34a" stroke-width="5" stroke-linecap="round"/></svg></span>
      <span>Dashboard-WhatsApp</span>
    </div>
    <div class="card">
      ${bodyHtml}
    </div>
  </div>
</body>
</html>`;
}

resetPasswordRouter.get("/reset-password", (req, res) => {
  const token = String(req.query.token || "");
  const email = String(req.query.email || "");

  if (!token || !email) {
    return res.type("html").send(page(`
      <h1>Invalid reset link</h1>
      <p style="font-size:14px;opacity:0.85;">This link is missing required information. Request a new password reset from the <a href="/">login page</a>.</p>
    `));
  }

  res.type("html").send(page(`
    <h1>Set a new password</h1>
    <form id="reset-form">
      <label for="password">New password</label>
      <input id="password" type="password" autocomplete="new-password" required minlength="8" />
      <label for="confirm">Confirm password</label>
      <input id="confirm" type="password" autocomplete="new-password" required minlength="8" />
      <button type="submit" id="submit-btn">Reset password</button>
    </form>
    <div id="notice"></div>
    <script>
      const form = document.getElementById("reset-form");
      const notice = document.getElementById("notice");
      const submitBtn = document.getElementById("submit-btn");

      function showNotice(message, kind) {
        notice.textContent = message;
        notice.className = kind;
        notice.style.display = "block";
      }

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const password = document.getElementById("password").value;
        const confirm = document.getElementById("confirm").value;
        if (password !== confirm) {
          showNotice("Passwords do not match.", "error");
          return;
        }
        submitBtn.disabled = true;
        submitBtn.textContent = "Resetting...";
        try {
          const response = await fetch("/api/auth/reset-password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: ${JSON.stringify(email)},
              token: ${JSON.stringify(token)},
              password,
            }),
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(data.message || "Could not reset password.");
          form.style.display = "none";
          showNotice("Password reset. You can now sign in with your new password.", "success");
        } catch (error) {
          showNotice(error instanceof Error ? error.message : "Could not reset password.", "error");
          submitBtn.disabled = false;
          submitBtn.textContent = "Reset password";
        }
      });
    </script>
  `));
});
