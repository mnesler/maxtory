// App.tsx — root layout with sidebar navigation

import { A, useLocation } from "@solidjs/router";
import type { JSX } from "solid-js";
import "./styles.css";

interface NavItem {
  href: string;
  label: string;
  icon: string;
}

const navItems: NavItem[] = [
  { href: "/", label: "Dashboard", icon: "◈" },
  { href: "/pipelines", label: "Pipelines", icon: "▤" },
  { href: "/new", label: "Agent", icon: "+" },
  { href: "/settings", label: "Settings", icon: "⚙" },
];

interface Props {
  children?: JSX.Element;
}

export default function App(props: Props) {
  const location = useLocation();

  return (
    <div class="layout">
      <aside class="sidebar">
        <div class="sidebar-logo">
          <h1>Attractor</h1>
          <div class="version">Pipeline Engine</div>
        </div>
        <nav class="sidebar-nav">
          {navItems.map((item) => (
            <A
              href={item.href}
              class={`nav-item${location.pathname === item.href ? " active" : ""}`}
              end={item.href === "/"}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </A>
          ))}
        </nav>
      </aside>
      <main class="main">{props.children}</main>
    </div>
  );
}
