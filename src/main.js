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

    setTimeout(hideHint, 14000);
    setTimeout(() => {
      if (hint && !hint.hidden) hint.classList.add("is-visible");
    }, 1200);

    const close = hint ? hint.querySelector("[data-snake-ignore]") : null;
    if (close) close.addEventListener("click", hideHint);
  }
}
