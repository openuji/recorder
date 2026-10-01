import type { MainLandingPage } from "./types";

export const recorderPage: MainLandingPage = {
  meta: {
    title: "Recorder — OpenUJI",
    description:
      "Open-source infrastructure for capturing browser sessions as structured UX research evidence.",
  },
  header: {
    label: "Recorder",
    homeHref: "/",
    nav: [
      { label: "How it works", href: "#how-it-works" },
      { label: "UJG", href: "#ujg" },
      { label: "Pilots", href: "#pilots" },
      { label: "GitHub", href: "https://github.com/openuji/recorder" },
    ],
  },
  hero: {
    eyebrow: "OpenUJI / Recorder",
    title: "Capture journeys, not just clicks.",
    intro:
      "Recorder captures a browser session as structured evidence: what was visible, what happened, and how someone moved through a digital experience.",
    primary: { label: "Explore Recorder", href: "#how-it-works" },
    secondary: {
      label: "View source",
      href: "https://github.com/openuji/recorder",
      external: true,
    },
    pills: ["Open source", "UX research", "Experimental"],
  },
  features: {
    eyebrow: "How it works",
    title: "An observation layer for digital journeys.",
    intro:
      "Recorder creates inspectable evidence from deliberate research sessions. It is not a population analytics product.",
    items: [
      {
        number: "01",
        title: "Capture",
        body:
          "Observe visual state, navigation and interaction from a real browser session without requiring analytics instrumentation on the target website.",
      },
      {
        number: "02",
        title: "Structure",
        body:
          "Turn an ephemeral browsing session into a sequence of states and interactions that can be inspected after the session.",
      },
      {
        number: "03",
        title: "Research",
        body:
          "Use volunteered sessions as qualitative evidence with purpose, context and participant reflection — not as representative traffic metrics.",
      },
      {
        number: "04",
        title: "Interoperate",
        body:
          "Create evidence that can later be interpreted, related across sessions and represented with the User Journey Graph format.",
      },
    ],
  },
  journey: {
    eyebrow: "From session to evidence",
    title: "Preserve what happened before interpreting what it means.",
    intro:
      "Recorder focuses on the evidence layer. Journey reconstruction and UJG representation can build on top without hiding the original session.",
    steps: [
      "Browser session",
      "Frames + interactions + navigation",
      "Structured session evidence",
      "Research interpretation",
      "UJG / other tools",
    ],
    note:
      "Cross-session journey reconstruction is an active direction, not a claim that every recording already becomes a finished journey model automatically.",
  },
  pilots: {
    eyebrow: "Current pilots",
    title: "Test the method in real environments.",
    intro:
      "Pilots provide a bounded research context while Recorder remains general-purpose infrastructure.",
    items: [
      {
        title: "FU Digital Journeys",
        description:
          "A participatory pilot exploring how students experience the digital environment around studying at Freie Universität Berlin.",
        href: "/fu-pilot/",
        status: "planned",
      },
    ],
  },
  cta: {
    eyebrow: "Open infrastructure",
    title: "Build on the evidence, not a black box.",
    body:
      "Recorder is developed in the open as part of OpenUJI. Inspect the source, follow the architecture, or use a pilot to explore the research method.",
    primary: {
      label: "Open GitHub",
      href: "https://github.com/openuji/recorder",
      external: true,
    },
    secondary: { label: "View FU pilot", href: "/fu-pilot/" },
  },
  footer: {
    note: "Recorder is an experimental OpenUJI project.",
    links: [
      { label: "OpenUJI", href: "https://openuji.org/" },
      { label: "GitHub", href: "https://github.com/openuji/recorder" },
      { label: "FU pilot", href: "/fu-pilot/" },
    ],
  },
};
