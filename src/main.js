import "./style.css";
import { startPageSnake } from "./snake.js";

const canvas = document.getElementById("page-snake");
if (canvas) {
  startPageSnake(canvas);
}
