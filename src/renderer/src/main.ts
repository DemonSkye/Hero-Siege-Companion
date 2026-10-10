import { createApp } from "vue";
import App from "./App.vue";
import { installFloatingTooltips } from "./lib/floating-tooltip";
import "./styles.css";

createApp(App).mount("#app");
installFloatingTooltips();
