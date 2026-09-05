import { createApp } from "vue";
import { createPinia } from "pinia";
import { createRouter, createWebHistory } from "vue-router";
import App from "./App.vue";
import Overview from "./pages/Overview.vue";
import Usage from "./pages/Usage.vue";
import Agents from "./pages/Agents.vue";
import Settings from "./pages/Settings.vue";
import Stats from "./pages/Stats.vue";
import "./styles.css";
import "./filters.css";
import "./stats.css";
import "./theme.css";
import "./welcome.css";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", component: Overview },
    { path: "/usage", component: Usage },
    { path: "/stats", component: Stats },
    { path: "/agents", component: Agents },
    { path: "/settings", component: Settings },
  ],
});
createApp(App).use(createPinia()).use(router).mount("#app");
