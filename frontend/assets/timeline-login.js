document.getElementById("timeline-login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const username = form.get("username");
  const password = form.get("password");
  const response = await fetch("/timeline/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password })
  });

  if (response.ok) {
    location.href = "/timeline";
    return;
  }

  const error = document.getElementById("timeline-login-error");
  error.hidden = false;
  error.textContent = "Login refused.";
});
