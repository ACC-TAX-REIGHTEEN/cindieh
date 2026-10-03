/* ============================================================
   Cindieh microsite — behaviour

   Nothing here is load-bearing. The seven feature tabs are a CSS
   radio group that works with JavaScript disabled, and every rule
   in the stylesheet that hides content is scoped to `.js`. This
   file only upgrades what is already there.
   ============================================================ */

// ── Scroll reveal ─────────────────────────────────────────────
// Skipped outright when the reader asked for less motion, rather
// than animating and letting the media query undo it in CSS.
const revealTargets = document.querySelectorAll(".reveal");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

if (reducedMotion || !("IntersectionObserver" in window)) {
  revealTargets.forEach((el) => el.classList.add("in"));
} else {
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      });
    },
    { threshold: 0.12 },
  );
  revealTargets.forEach((el) => io.observe(el));
}

// ── Feature tabs ─────────────────────────────────────────────
// Upgrades the radio group into an ARIA tablist. The radios stay
// exactly where they are — the stylesheet drives the show/hide
// from `#tN:checked` — but they stop being the thing a screen
// reader meets, and the labels become the tabs instead.
const radios = Array.from(document.querySelectorAll('input[name="tabs"]'));
const labelRow = document.querySelector(".tab-labels");

if (radios.length && labelRow) {
  const labels = Array.from(labelRow.querySelectorAll("label"));

  // The radios become a private state store for the CSS. They are dropped
  // from the accessibility tree AND from the tab order in the same step:
  // aria-hidden must never wrap something that can still take focus.
  radios.forEach((radio) => {
    radio.setAttribute("aria-hidden", "true");
    radio.tabIndex = -1;
  });

  labelRow.setAttribute("role", "tablist");
  labelRow.setAttribute("aria-label", "Fitur Cindieh");

  // `#t3` drives `#p3`; anything else is left alone rather than guessed at.
  const panelIdFor = (radioId) => radioId.replace(/^t(\d+)$/, "p$1");

  const tabs = labels.map((label, index) => {
    const radio = radios[index];
    const panelId = panelIdFor(radio.id);
    const panel = document.getElementById(panelId);

    label.id = `tab-${index + 1}`;
    label.setAttribute("role", "tab");
    label.setAttribute("aria-controls", panelId);

    if (panel) {
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", label.id);
      // Lets a keyboard reader scroll a panel that is taller than the
      // viewport once focus has moved into it.
      panel.tabIndex = 0;
    }

    return { label, radio };
  });

  const sync = () => {
    for (const tab of tabs) {
      const selected = tab.radio.checked;
      tab.label.setAttribute("aria-selected", String(selected));
      // Roving tabindex: one stop for the whole strip, then arrows to move.
      tab.label.tabIndex = selected ? 0 : -1;
    }
  };

  tabs.forEach((tab, index) => {
    // The native label -> radio hand-off is replaced here. Left alone, a click
    // on a label would move focus onto the now-hidden radio and drop the
    // keyboard user out of the tab strip entirely.
    tab.label.addEventListener("click", (event) => {
      event.preventDefault();
      tab.radio.checked = true;
      tab.label.focus();
      sync();
    });

    tab.label.addEventListener("keydown", (event) => {
      const key = event.key;
      let next = null;

      if (key === "ArrowRight" || key === "ArrowDown") next = (index + 1) % tabs.length;
      else if (key === "ArrowLeft" || key === "ArrowUp") next = (index - 1 + tabs.length) % tabs.length;
      else if (key === "Home") next = 0;
      else if (key === "End") next = tabs.length - 1;
      else if (key === "Enter" || key === " ") {
        event.preventDefault();
        tab.radio.checked = true;
        sync();
        return;
      }

      if (next === null) return;
      event.preventDefault();
      // Automatic activation: moving focus also selects, which is what the
      // radios already did under the keyboard before this upgrade.
      const target = tabs[next];
      target.radio.checked = true;
      target.label.focus();
      sync();
    });

    // Catches anything that changes the radio without going through a label.
    tab.radio.addEventListener("change", sync);
  });

  sync();
}