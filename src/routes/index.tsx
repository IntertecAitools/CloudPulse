import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";

import landingCss from "../styles/landing.css?url";
import { getCreds } from "@/lib/auth";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "CloudPulse — Monitoring for Your Whole Stack" },
      {
        name: "description",
        content:
          "Metrics, logs, traces and uptime checks in one self-hosted platform. Watch AWS CloudWatch and your own infrastructure side by side.",
      },
      { property: "og:title", content: "CloudPulse — Monitoring for Your Whole Stack" },
      {
        property: "og:description",
        content: "Metrics, logs, traces and uptime checks in one self-hosted platform.",
      },
    ],
    links: [
      { rel: "stylesheet", href: landingCss },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Sora:wght@100..900&display=block",
      },
    ],
  }),
  component: Landing,
});

/** Feature list under the hero. Desktop layout is pixel-locked, so these want
 *  to stay around 20 characters or they overflow their 220u slots. */
const FEATURES = [
  { id: "f1", label: "Metrics & dashboards" },
  { id: "f2", label: "Logs & traces" },
  { id: "f3", label: "Uptime checks" },
  { id: "f4", label: "Threshold alerts" },
];

function Landing() {
  const navigate = useNavigate();
  const [entered, setEntered] = useState(false);

  // Already signed in? Skip the pitch.
  useEffect(() => {
    if (getCreds()) navigate({ to: "/overview", replace: true });
  }, [navigate]);

  // The page is a fixed full-viewport surface; stop the document scrolling
  // behind it. The template did this with a global html/body rule, which would
  // have leaked into every other route.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Drops the entrance animations once they've played so they can't replay.
  // A plain timer rather than an animationend listener, because under
  // prefers-reduced-motion no animation fires at all.
  useEffect(() => {
    const t = setTimeout(() => setEntered(true), 2600);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className={`landing${entered ? " is-entered" : ""}`}>
      <div className="bg" aria-hidden="true">
        <Topology />
      </div>
      <div className="veil" />

      <header className="bar">
        <Link className="brand" to="/">
          <svg viewBox="0 0 23 17" aria-hidden="true">
            <path d="M0.8 8.8 H5.2 L7.6 3.2 L11 14 L13.6 8.8 H22.2" />
          </svg>
          <span id="word">CLOUDPULSE</span>
        </Link>

        <input className="navtoggle" type="checkbox" id="nav-open" />
        <label className="scrim" htmlFor="nav-open" aria-hidden="true" />
        <label className="burger" htmlFor="nav-open" aria-label="Menu">
          <svg viewBox="0 0 22 14" aria-hidden="true">
            <path className="b1" d="M1 1 H21" />
            <path className="b2" d="M1 7 H21" />
            <path className="b3" d="M1 13 H21" />
          </svg>
        </label>

        <div className="navpanel">
          <nav className="menu">
            {/* TODO: no marketing pages exist yet -- these are placeholders. */}
            <a href="#">
              <span id="about">About</span>
            </a>
            <a href="#">
              <span id="product">Product</span>
            </a>
            <a href="#">
              <span id="solutions">Solutions</span>
              <svg className="caret" viewBox="0 0 9 6" aria-hidden="true">
                <path d="M0.7 1.1 L4.5 4.6 L8.3 1.1" />
              </svg>
            </a>
          </nav>
          <Link className="login" to="/login">
            <span id="login">Log in / Request access</span>
            <svg className="navarrow" viewBox="0 0 10 9" aria-hidden="true">
              <path d="M0 4.5 H9.1 M5.4 0.9 L9.2 4.5 L5.4 8.1" />
            </svg>
          </Link>
          <Link className="pill" to="/register">
            <span id="contact">Get started</span>
          </Link>
        </div>
      </header>

      <main className="hero">
        <h1 className="title">
          <span id="h1a">Know What Your Cloud Is Doing</span>
          <span id="h1b">Before Your Users Tell You.</span>
        </h1>
        <p className="sub">
          <span id="sub1">Metrics, logs, traces and uptime</span>
          <span id="sub2">in one self-hosted platform.</span>
        </p>
        <Link className="cta" to="/register">
          <span id="cta">Start monitoring</span>
          <svg className="arrow" viewBox="0 0 16 11" aria-hidden="true">
            <path d="M0 5.5 H14.6 M10.3 1.2 L14.9 5.5 L10.3 9.8" />
          </svg>
        </Link>
        <ul className="feats">
          {FEATURES.map((f) => (
            <li key={f.id}>
              <svg className="chev" viewBox="0 0 11 20" aria-hidden="true">
                <path d="M1.15 1.15 L9.6 10 L1.15 18.85" />
              </svg>
              <span id={f.id}>{f.label}</span>
            </li>
          ))}
        </ul>
        <span className="rule" aria-hidden="true" />
      </main>

      <footer className="foot">
        <span id="foot1">Built for teams who own their infrastructure.</span>
        <span id="foot2">2026</span>
      </footer>
    </div>
  );
}

/** Decorative service-topology backdrop: nodes, links, and traffic pulses. */
function Topology() {
  const links = [
    "M230 210 L560 130 L920 240 L1300 160",
    "M230 210 L410 560 L760 512 L920 240",
    "M760 512 L1080 640 L1300 160",
    "M410 560 L300 860 L680 900 L1080 640",
    "M680 900 L1080 640 L1300 780",
  ];
  const pulses = [
    { d: links[0], cls: "a" },
    { d: links[1], cls: "b" },
    { d: links[3], cls: "c" },
    { d: links[4], cls: "a" },
  ];
  const nodes = [
    { x: 230, y: 210, r: 7, core: 3.4, dim: false },
    { x: 560, y: 130, r: 6, core: 3, dim: true },
    { x: 920, y: 240, r: 7.5, core: 3.6, dim: false },
    { x: 1300, y: 160, r: 6, core: 3, dim: true },
    { x: 760, y: 512, r: 8.5, core: 4, dim: false },
    { x: 410, y: 560, r: 6, core: 3, dim: true },
    { x: 1080, y: 640, r: 7, core: 3.4, dim: false },
    { x: 300, y: 860, r: 6, core: 3, dim: true },
    { x: 680, y: 900, r: 6.5, core: 3.2, dim: false },
    { x: 1300, y: 780, r: 6, core: 3, dim: true },
  ];

  return (
    <svg className="topology" viewBox="0 0 1536 1024" preserveAspectRatio="xMidYMid slice">
      {[256, 512, 768].map((y) => (
        <line key={`h${y}`} className="grid-line" x1="0" y1={y} x2="1536" y2={y} />
      ))}
      {[384, 768, 1152].map((x) => (
        <line key={`v${x}`} className="grid-line" x1={x} y1="0" x2={x} y2="1024" />
      ))}
      {links.map((d, i) => (
        <path key={`l${i}`} className="link" d={d} />
      ))}
      {pulses.map((p, i) => (
        <path key={`p${i}`} className={`pulse ${p.cls}`} d={p.d} />
      ))}
      {nodes.map((n, i) => (
        <g key={`n${i}`} className={n.dim ? "node dim" : "node"}>
          <circle className="node-halo" cx={n.x} cy={n.y} r={n.r} />
          <circle className="node-core" cx={n.x} cy={n.y} r={n.core} />
        </g>
      ))}
    </svg>
  );
}
