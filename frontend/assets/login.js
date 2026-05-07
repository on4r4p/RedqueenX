document.getElementById("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = new FormData(event.currentTarget).get("password");
  const response = await fetch("/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password })
  });

  if (response.ok) {
    location.href = "/admin";
    return;
  }

  const error = document.getElementById("login-error");
  error.hidden = false;
  error.textContent = "Password refused.";
});
