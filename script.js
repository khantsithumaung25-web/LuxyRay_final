const ASSISTANT_STORAGE_KEY = "luxyray-assistant-history";
const ASSISTANT_STATE_KEY = "luxyray-assistant-state";
const CHAT_API_ENDPOINT = "/api/chat";
const MAX_HISTORY_ITEMS = 24;

document.addEventListener("DOMContentLoaded", () => {
  setupActiveNav();
  setupMobileNav();
  setupFaq();
  setupBookingForm();
  setupAssistant();
});

function setupActiveNav() {
  const currentPage = window.location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".site-nav a").forEach((link) => {
    const href = link.getAttribute("href");
    link.removeAttribute("aria-current");
    if (href === currentPage) {
      link.classList.add("is-active");
      link.setAttribute("aria-current", "page");
    }
  });
}

function setupMobileNav() {
  const toggle = document.querySelector("[data-nav-toggle]");
  const nav = document.querySelector("[data-site-nav]");

  if (!toggle || !nav) return;

  toggle.addEventListener("click", () => {
    const isOpen = nav.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", String(isOpen));
  });

  nav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      nav.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
    });
  });
}

function setupFaq() {
  document.querySelectorAll(".faq-item").forEach((item) => {
    const button = item.querySelector(".faq-question");
    if (!button) return;

    button.addEventListener("click", () => {
      const shouldOpen = !item.classList.contains("is-open");

      document.querySelectorAll(".faq-item").forEach((entry) => {
        entry.classList.remove("is-open");
        const entryButton = entry.querySelector(".faq-question");
        if (entryButton) {
          entryButton.setAttribute("aria-expanded", "false");
        }
      });

      item.classList.toggle("is-open", shouldOpen);
      button.setAttribute("aria-expanded", String(shouldOpen));
    });
  });
}

function setupBookingForm() {
  const form = document.querySelector("[data-booking-form]");
  const status = document.querySelector("[data-form-status]");

  if (!form || !status) return;

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    status.textContent =
      "Your consultation request has been received. The clinic team will review your details and contact you to confirm availability.";
    status.classList.add("is-visible");
    form.reset();
  });
}

function setupAssistant() {
  const assistant = document.querySelector("[data-assistant]");
  const toggle = document.querySelector("[data-assistant-toggle]");
  const close = document.querySelector("[data-assistant-close]");
  const sendButton = document.querySelector("[data-assistant-send]");
  const input = document.querySelector("[data-assistant-input]");
  const body = document.querySelector("[data-assistant-body]");

  if (!assistant || !toggle || !input || !body || !sendButton) return;

  const history = loadAssistantHistory();
  const savedState = loadAssistantState();

  renderAssistantHistory(body, history);
  if (savedState.isOpen) {
    setOpen(true);
  }

  toggle.addEventListener("click", () => {
    const shouldOpen = !assistant.classList.contains("is-open");
    setOpen(shouldOpen);
    if (shouldOpen) input.focus();
  });

  if (close) {
    close.addEventListener("click", () => setOpen(false));
  }

  sendButton.addEventListener("click", () => {
    void sendAssistantMessage();
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void sendAssistantMessage();
    }
  });

  function setOpen(open) {
    assistant.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    saveAssistantState({ isOpen: open });
  }

  async function sendAssistantMessage() {
    const message = input.value.trim();
    if (!message) {
      console.warn("[Assistant] Message was empty. Nothing was sent.");
      appendAssistantEntry(body, createEntry("bot", "LuxyRay Assistant", "Please type a message before sending."));
      return;
    }

    const nextHistory = [...loadAssistantHistory(), createEntry("user", "You", message)];
    saveAssistantHistory(nextHistory);
    renderAssistantHistory(body, nextHistory);
    input.value = "";
    setAssistantLoading(true);

    try {
      console.log("[Assistant] Sending message to backend.", {
        endpoint: CHAT_API_ENDPOINT,
        historyItems: nextHistory.length,
        messageLength: message.length,
      });

      const reply = await requestAssistantReply(message, nextHistory);
      const updatedHistory = [...loadAssistantHistory(), createEntry("bot", "LuxyRay Assistant", reply)];

      saveAssistantHistory(updatedHistory);
      renderAssistantHistory(body, updatedHistory);
    } catch (error) {
      console.error("[Assistant] Failed to get reply.", error);

      const fallbackReply = getAssistantErrorMessage(error);
      const failedHistory = [...loadAssistantHistory(), createEntry("bot", "LuxyRay Assistant", fallbackReply)];

      saveAssistantHistory(failedHistory);
      renderAssistantHistory(body, failedHistory);
    } finally {
      setAssistantLoading(false);
      input.focus();
    }
  }

  function setAssistantLoading(isLoading) {
    input.disabled = isLoading;
    sendButton.disabled = isLoading;
    sendButton.textContent = isLoading ? "..." : "Send";
  }
}

async function requestAssistantReply(message, history) {
  const response = await fetch(CHAT_API_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message,
      history: history.slice(-MAX_HISTORY_ITEMS),
    }),
  });

  const rawText = await response.text();
  console.log("[Assistant] Raw API response text:", rawText);

  let data;
  try {
    data = JSON.parse(rawText);
  } catch (error) {
    console.error("[Assistant] Could not parse server JSON.", error);
    throw new Error("The server returned invalid JSON.");
  }

  console.log("[Assistant] Parsed API response:", data);

  const reply = normalizeAssistantReply(data?.reply);

  if (!response.ok) {
    throw new Error(data?.error || reply || `Request failed with status ${response.status}.`);
  }

  if (!reply) {
    throw new Error("The server returned an empty reply.");
  }

  return reply;
}

function normalizeAssistantReply(reply) {
  return typeof reply === "string" ? reply.trim() : "";
}

function getAssistantErrorMessage(error) {
  const message = typeof error?.message === "string" ? error.message : "";

  if (message.includes("MISSING_API_KEY")) {
    return "The server is missing GROQ_API_KEY. Add your key to Vercel environment variables, then redeploy.";
  }

  if (message.includes("empty")) {
    return "The assistant did not receive a usable reply. Please try your message again.";
  }

  if (message.includes("invalid JSON")) {
    return "The server returned a response the chat UI could not read. Check the backend logs for details.";
  }

  if (message) {
    return `Something went wrong: ${message}`;
  }

  return "Something went wrong while contacting the assistant. Please try again.";
}

function createEntry(type, author, text) {
  return {
    type,
    author,
    text,
    time: Date.now(),
  };
}

function renderAssistantHistory(body, history) {
  const safeHistory = history.length
    ? history
    : [createEntry("bot", "LuxyRay Assistant", getDefaultGreeting())];

  body.innerHTML = "";
  safeHistory.forEach((entry) => appendAssistantEntry(body, entry));
  body.scrollTop = body.scrollHeight;
}

function appendAssistantEntry(body, entry) {
  const wrapper = document.createElement("div");
  wrapper.className = `assistant-message ${entry.type}`;
  wrapper.innerHTML = `<strong>${escapeHtml(entry.author)}</strong><span>${escapeHtml(entry.text)}</span>`;
  body.appendChild(wrapper);
  body.scrollTop = body.scrollHeight;
}

function loadAssistantHistory() {
  try {
    const raw = localStorage.getItem(ASSISTANT_STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((entry) => entry && typeof entry.text === "string" && typeof entry.type === "string")
      .slice(-MAX_HISTORY_ITEMS);
  } catch (error) {
    console.error("[Assistant] Failed to load history from localStorage.", error);
    return [];
  }
}

function saveAssistantHistory(history) {
  try {
    const trimmed = history.slice(-MAX_HISTORY_ITEMS);
    localStorage.setItem(ASSISTANT_STORAGE_KEY, JSON.stringify(trimmed));
  } catch (error) {
    console.error("[Assistant] Failed to save history to localStorage.", error);
  }
}

function loadAssistantState() {
  try {
    const raw = localStorage.getItem(ASSISTANT_STATE_KEY);
    if (!raw) return { isOpen: false };

    const parsed = JSON.parse(raw);
    return { isOpen: Boolean(parsed.isOpen) };
  } catch (error) {
    console.error("[Assistant] Failed to load assistant state.", error);
    return { isOpen: false };
  }
}

function saveAssistantState(state) {
  try {
    localStorage.setItem(ASSISTANT_STATE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error("[Assistant] Failed to save assistant state.", error);
  }
}

function getDefaultGreeting() {
  return "Ask me about LuxyRay treatments, doctors, promotions, contact details, FAQs, or booking. I will reply using the backend assistant.";
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
