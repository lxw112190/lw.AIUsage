import { createApp } from "vue";
import { createPinia } from "pinia";
import { createRouter, createWebHistory } from "vue-router";
import App from "./App.vue";
import "./styles.css";
import "./filters.css";
import "./stats.css";
import "./theme.css";
import "./welcome.css";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", component: () => import("./pages/Overview.vue") },
    { path: "/usage", component: () => import("./pages/Usage.vue") },
    { path: "/stats", component: () => import("./pages/Stats.vue") },
    { path: "/agents", component: () => import("./pages/Agents.vue") },
    { path: "/settings", component: () => import("./pages/Settings.vue") },
  ],
});
createApp(App).use(createPinia()).use(router).mount("#app");
