/* A self-contained workflow demonstration. No clipboard, native shortcuts,
   storage, analytics, dependencies, or network calls are used by this page. */
(() => {
  "use strict";

  const menuToggle = document.querySelector(".menu-toggle");
  const mobileNav = document.querySelector("#mobile-nav");

  function closeMenu() {
    mobileNav.hidden = true;
    menuToggle.setAttribute("aria-expanded", "false");
    menuToggle.setAttribute("aria-label", "Open navigation");
    menuToggle.querySelector("use").setAttribute("href", "#icon-menu");
  }

  menuToggle.addEventListener("click", () => {
    const open = menuToggle.getAttribute("aria-expanded") !== "true";
    mobileNav.hidden = !open;
    menuToggle.setAttribute("aria-expanded", String(open));
    menuToggle.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
    menuToggle.querySelector("use").setAttribute("href", open ? "#icon-x" : "#icon-menu");
  });

  mobileNav.addEventListener("click", (event) => {
    if (event.target.closest("a")) closeMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !mobileNav.hidden) {
      closeMenu();
      menuToggle.focus();
    }
  });

  const desktopBreakpoint = window.matchMedia("(min-width: 640px)");
  desktopBreakpoint.addEventListener("change", (event) => {
    if (event.matches) closeMenu();
  });

  const thoughts = document.querySelector("#demo-thought");
  const queued = document.querySelector("#queued-thought");
  const destination = document.querySelector("#demo-destination");
  const captureButton = document.querySelector("#capture-button");
  const pasteButton = document.querySelector("#paste-button");
  const announcement = document.querySelector("#demo-announcement");
  const workspace = document.querySelector("#demo-workspace");
  const stepButtons = [...document.querySelectorAll("[data-step]")];
  const screens = {
    capture: document.querySelector("#demo-capture"),
    queue: document.querySelector("#demo-queue"),
    paste: document.querySelector("#demo-paste"),
  };
  const originalThought = thoughts.value;
  let activeStep = "capture";
  let capturedThought = "";

  function showStep(step, focus = false) {
    activeStep = step;
    for (const [name, screen] of Object.entries(screens)) screen.hidden = name !== step;
    for (const button of stepButtons) {
      const selected = button.dataset.step === step;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-pressed", String(selected));
    }
    if (focus) {
      const target = step === "capture" ? thoughts : step === "queue" ? pasteButton : document.querySelector("#try-again");
      target.focus({ preventScroll: true });
    }
  }

  function capture(focus = true) {
    const value = thoughts.value.trim();
    if (!value) {
      captureButton.disabled = true;
      announcement.textContent = "Write a thought before capturing it.";
      thoughts.focus({ preventScroll: true });
      return false;
    }
    capturedThought = value;
    queued.textContent = capturedThought;
    destination.value = "";
    showStep("queue", focus);
    announcement.textContent = "Captured in the demo queue. Ready to paste back.";
    return true;
  }

  function paste(focus = true) {
    if ((activeStep === "capture" || !capturedThought) && !capture(false)) return;
    destination.value = capturedThought;
    showStep("paste", focus);
    announcement.textContent = "Your thought was pasted into the demo writing field.";
  }

  function reset(focus = true) {
    thoughts.value = originalThought;
    capturedThought = "";
    queued.textContent = originalThought;
    destination.value = "";
    captureButton.disabled = false;
    showStep("capture", focus);
    announcement.textContent = "Demo reset. Edit the thought and capture it.";
  }

  thoughts.addEventListener("input", () => {
    captureButton.disabled = thoughts.value.trim().length === 0;
  });
  captureButton.addEventListener("click", () => capture());
  pasteButton.addEventListener("click", () => paste());
  document.querySelector("#try-again").addEventListener("click", () => reset());
  document.querySelector("#demo-reset").addEventListener("click", () => reset());

  for (const button of stepButtons) {
    button.addEventListener("click", () => {
      const step = button.dataset.step;
      if (step === "capture") showStep("capture");
      if (step === "queue") capture(false);
      if (step === "paste") paste(false);
    });
  }

  // Shortcuts are scoped to the demo, so the page never captures a global
  // keyboard shortcut or interferes with the installed Captura application.
  workspace.addEventListener("keydown", (event) => {
    if (event.altKey && event.code === "Space" && activeStep === "capture") {
      event.preventDefault();
      capture();
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      if (activeStep === "capture") capture();
      else if (activeStep === "queue") paste();
    }
  });

  function openLinkedQuestion(id) {
    const detail = document.getElementById(id);
    if (detail instanceof HTMLDetailsElement) detail.open = true;
  }

  document.querySelectorAll("[data-open-faq]").forEach((link) => {
    link.addEventListener("click", () => {
      openLinkedQuestion(link.dataset.openFaq);
      document.getElementById(link.dataset.openFaq).querySelector("summary").focus({ preventScroll: true });
    });
  });

  window.addEventListener("hashchange", () => openLinkedQuestion(location.hash.slice(1)));
  openLinkedQuestion(location.hash.slice(1));
})();
