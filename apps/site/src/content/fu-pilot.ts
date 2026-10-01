import type { PilotLandingPage } from "./types";

export const fuPilotPage: PilotLandingPage = {
  meta: {
    title: "FU Digital Journeys — Recorder / OpenUJI",
    description:
      "A voluntary pilot inviting students to contribute one real digital journey through FU's online environment.",
  },
  header: {
    label: "FU Pilot",
    homeHref: "/fu-pilot/",
    backLabel: "← Recorder",
    nav: [
      { label: "How it works", href: "#how-it-works" },
      { label: "Why", href: "#why" },
      { label: "Privacy", href: "/fu-pilot/privacy/" },
      { label: "Participate", href: "/fu-pilot/participate/" },
    ],
  },
  hero: {
    eyebrow: "FU Digital Journeys / pilot",
    title: "How do you actually get things done at FU?",
    intro:
      "Studying often means moving through websites, portals, PDFs, search results and services. Contribute one real digital journey so those experiences can become visible and discussable.",
    primary: { label: "Contribute a journey", href: "/fu-pilot/participate/" },
    secondary: { label: "How it works", href: "#how-it-works" },
    pills: ["Voluntary", "Review before sharing", "Open source"],
  },
  steps: {
    eyebrow: "One real journey",
    title: "Bring something you actually need to do.",
    intro:
      "This is not a scripted usability task. Pick a genuine purpose, record your attempt, review it, and decide whether to contribute it.",
    items: [
      { number: "01", title: "Choose", body: "Pick something you genuinely need to accomplish at FU." },
      { number: "02", title: "Record", body: "Use Recorder while you try to do it in the way you normally would." },
      { number: "03", title: "Review", body: "See what was captured and remove anything you do not want to contribute." },
      { number: "04", title: "Describe", body: "Add a few words about what you were trying to achieve and, optionally, what felt confusing, surprising or useful." },
      { number: "05", title: "Contribute", body: "Share the journey only when you are comfortable with it." },
    ],
  },
  tasks: {
    eyebrow: "Possible starting points",
    title: "There is no correct path.",
    intro: "Choose a task that is relevant to you right now.",
    items: [
      "Find a course",
      "Understand a module",
      "Locate a deadline",
      "Register for something",
      "Find a university service",
      "Find information you actually need",
    ],
    note:
      "Searching elsewhere, going backwards, getting confused or abandoning the task are all meaningful parts of the experience.",
  },
  statement: {
    eyebrow: "What this pilot can tell us",
    title: "Examples of experience, not population statistics.",
    paragraphs: [
      "Participation is voluntary. Contributed sessions therefore show concrete experiences; they do not tell us how frequently a path is used across FU students.",
      "The goal is to explore how independently contributed experiences can be compared, related and discussed as qualitative UX research material while keeping the evidence behind each interpretation visible.",
    ],
  },
  principles: {
    eyebrow: "Participation principles",
    title: "Your journey belongs to you first.",
    intro:
      "The pilot is being designed around deliberate contribution rather than passive tracking.",
    items: [
      { title: "You start the recording.", body: "Nothing should be collected before you deliberately begin a session." },
      { title: "You stop the recording.", body: "A research session has a clear boundary that you control." },
      { title: "You review before contributing.", body: "You should be able to inspect what was captured before anything becomes research material." },
      { title: "You can remove material.", body: "Sensitive or irrelevant parts should not have to become part of a contribution." },
      { title: "You decide whether to contribute.", body: "Recording a session and sharing it are separate decisions." },
    ],
  },
  cta: {
    eyebrow: "Take part",
    title: "Have one real thing you need to do at FU?",
    body:
      "Use it as your journey. The pilot is interested in the path you actually experience — including detours, uncertainty and dead ends.",
    primary: { label: "Prepare a journey", href: "/fu-pilot/participate/" },
    secondary: { label: "Read privacy notes", href: "/fu-pilot/privacy/" },
  },
  footer: {
    note:
      "An independent OpenUJI open-source pilot. It is not an official FU Berlin service.",
    links: [
      { label: "Recorder", href: "/" },
      { label: "Privacy", href: "/fu-pilot/privacy/" },
      { label: "GitHub", href: "https://github.com/openuji/recorder" },
    ],
  },
};
