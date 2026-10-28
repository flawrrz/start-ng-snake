import "./style.css";
import { startPageSnake } from "./snake.js";

const canvas = document.getElementById("page-snake");
const hint = document.getElementById("snake-hint");
const live = document.getElementById("snake-live");

if (canvas) {
  const snake = startPageSnake(canvas);

  if (snake) {
    let held = false;

    const announce = (message) => {
      if (live) live.textContent = message;
    };

    const hideHint = () => {
      if (hint) hint.hidden = true;
    };

    const onSnakeUi = (event) => {
      const target = event.target;
      return target instanceof Element && Boolean(target.closest("[data-snake-ignore]"));
    };

    const leads = (event) => {
      if (onSnakeUi(event)) return false;
      // pointermove reports button -1; only pointerdown carries a real button id.
      return event.type !== "pointerdown" || event.button === 0;
    };

    window.addEventListener(
      "pointerdown",
      (event) => {
        if (!leads(event)) return;
        const now = performance.now();
        const wasIdle = !snake.commandActive(now);
        held = true;
        if (!snake.guideTo(event.clientX, event.clientY, now)) return;
        hideHint();
        if (wasIdle) announce("The snake is following your pointer.");
      },
      { capture: true },
    );

    window.addEventListener(
      "pointermove",
      (event) => {
        if (!held || !leads(event)) return;
        // A drag can end outside the window, so drop held state on any buttonless move.
        if (!event.buttons) {
          held = false;
          return;
        }
        snake.guideTo(event.clientX, event.clientY, performance.now(), false);
      },
      { capture: true, passive: true },
    );

    const releasePointer = () => {
      held = false;
    };
    window.addEventListener("pointerup", releasePointer, { capture: true });
    window.addEventListener("pointercancel", releasePointer, { capture: true });

    window.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !snake.commandActive(performance.now())) return;
      snake.releaseControl();
      announce("The snake is roaming on its own again.");
    });

    const hush = document.getElementById("snake-hush");
    const hushLabel = hush ? hush.querySelector("[data-snake-hush-label]") : null;
    const HUSH_KEY = "startng.snake.hushed";

    const paintHush = (on) => {
      if (!hush) return;
      const label = on ? "Wake the snake" : "Hush the snake";
      hush.setAttribute("aria-pressed", on ? "true" : "false");
      hush.setAttribute("aria-label", label);
      if (hushLabel) hushLabel.textContent = label;
    };

    let hushed = false;
    try {
      hushed = localStorage.getItem(HUSH_KEY) === "1";
    } catch {
      hushed = false;
    }
    snake.setHushed(hushed);
    paintHush(hushed);

    if (hush) {
      hush.addEventListener("click", () => {
        hushed = !hushed;
        try {
          localStorage.setItem(HUSH_KEY, hushed ? "1" : "0");
        } catch {
          /* Private mode: the choice still applies for this visit. */
        }
        snake.setHushed(hushed);
        paintHush(hushed);
        if (hushed) {
          hideHint();
          announce("The snake is hushed and stays off the page until you wake it.");
        } else {
          announce("The snake is back on the page.");
        }
      });
    }

    if (!hushed) {
      setTimeout(hideHint, 14000);
      setTimeout(() => {
        if (hint && !hint.hidden) hint.classList.add("is-visible");
      }, 1200);
    } else {
      hideHint();
    }

    const close = hint ? hint.querySelector("[data-snake-ignore]") : null;
    if (close) close.addEventListener("click", hideHint);
  }
}
