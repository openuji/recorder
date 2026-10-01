export interface PageMeta {
  title: string;
  description: string;
  canonical?: string;
}

export interface NavItem {
  label: string;
  href: string;
}

export interface LinkAction {
  label: string;
  href: string;
  external?: boolean;
}

export interface HeaderContent {
  label: string;
  homeHref?: string;
  backLabel?: string;
  nav: NavItem[];
}

export interface HeroContent {
  eyebrow?: string;
  title: string;
  intro: string;
  primary?: LinkAction;
  secondary?: LinkAction;
  pills?: string[];
}

export interface FeatureItem {
  number?: string;
  title: string;
  body: string;
}

export interface StepItem {
  number?: string;
  title: string;
  body: string;
}

export interface PrincipleItem {
  title: string;
  body: string;
}

export interface PilotCard {
  title: string;
  description: string;
  href: string;
  status?: "active" | "planned" | "complete";
}

export interface StatementContent {
  eyebrow?: string;
  title: string;
  paragraphs: string[];
}

export interface JourneyExampleContent {
  eyebrow?: string;
  title: string;
  intro?: string;
  steps: string[];
  note?: string;
}

export interface CtaContent {
  eyebrow?: string;
  title: string;
  body: string;
  primary: LinkAction;
  secondary?: LinkAction;
}

export interface FooterContent {
  note: string;
  links: NavItem[];
}

export interface MainLandingPage {
  meta: PageMeta;
  header: HeaderContent;
  hero: HeroContent;
  features: {
    eyebrow?: string;
    title: string;
    intro?: string;
    items: FeatureItem[];
  };
  journey: JourneyExampleContent;
  pilots: {
    eyebrow?: string;
    title: string;
    intro?: string;
    items: PilotCard[];
  };
  cta: CtaContent;
  footer: FooterContent;
}

export interface PilotLandingPage {
  meta: PageMeta;
  header: HeaderContent;
  hero: HeroContent;
  steps: {
    eyebrow?: string;
    title: string;
    intro?: string;
    items: StepItem[];
  };
  tasks: {
    eyebrow?: string;
    title: string;
    intro?: string;
    items: string[];
    note?: string;
  };
  statement: StatementContent;
  principles: {
    eyebrow?: string;
    title: string;
    intro?: string;
    items: PrincipleItem[];
  };
  cta: CtaContent;
  footer: FooterContent;
}
