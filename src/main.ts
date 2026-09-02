import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "@/App.vue";
import { router } from "@/router";
import "@/styles/theme.css";

const mount = document.getElementById("vue-migration-root");
if (mount) {
  const app = createApp(App);
  app.use(createPinia());
  app.use(router);
  app.mount(mount);
}
