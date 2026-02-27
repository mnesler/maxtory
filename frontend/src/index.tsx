/* render */
import { render } from "solid-js/web";
import { Router, Route } from "@solidjs/router";
import App from "./App.js";
import Dashboard from "./pages/Dashboard.js";
import Pipelines from "./pages/Pipelines.js";
import RunDetail from "./pages/RunDetail.js";
import NewPipeline from "./pages/NewPipeline.js";
import Logs from "./pages/Logs.js";
import Settings from "./pages/Settings.js";

render(
  () => (
    <Router root={App}>
      <Route path="/" component={Dashboard} />
      <Route path="/pipelines" component={Pipelines} />
      <Route path="/runs/:id" component={RunDetail} />
      <Route path="/runs/:id/logs" component={Logs} />
      <Route path="/new" component={NewPipeline} />
      <Route path="/settings" component={Settings} />
    </Router>
  ),
  document.getElementById("root")!,
);
