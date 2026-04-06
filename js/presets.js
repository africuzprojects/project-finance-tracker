/**
 * Rich preset lists for categories, vendors, and quick templates.
 * Amounts are suggestions in the user's book currency (edit before save).
 */
(function (global) {
  const EXPENSE_CATEGORIES = [
    "AI & dev tools",
    "Cloud & hosting",
    "Domains & SSL",
    "Software licenses",
    "Hardware & gear",
    "Marketing & ads",
    "Contractors & freelancers",
    "Own time (imputed labor)",
    "Legal & accounting",
    "Bank & payment fees",
    "Travel & transport",
    "Office & supplies",
    "Education & courses",
    "Subscriptions",
    "Insurance",
    "Taxes & licenses",
    "Misc",
  ];

  const INCOME_CATEGORIES = [
    "Client invoice",
    "Product sales",
    "SaaS / recurring",
    "Affiliate / referral",
    "Consulting",
    "Licensing",
    "Grants / funding",
    "Interest / returns",
    "Reimbursement",
    "Other income",
  ];

  /** Quick picks: label shown, maps to category + description hint */
  const EXPENSE_TEMPLATES = [
    { label: "Cursor — Pro (monthly)", category: "AI & dev tools", amount: 20, description: "Cursor AI Pro subscription" },
    { label: "Cursor — Pro (annual)", category: "AI & dev tools", amount: 200, description: "Cursor AI Pro yearly" },
    { label: "GitHub Copilot", category: "AI & dev tools", amount: 10, description: "GitHub Copilot individual" },
    { label: "ChatGPT Plus", category: "AI & dev tools", amount: 20, description: "OpenAI ChatGPT Plus" },
    { label: "Claude Pro / API", category: "AI & dev tools", amount: 20, description: "Anthropic Claude" },
    { label: "JetBrains / IDE", category: "Software licenses", amount: 15, description: "IDE subscription" },
    { label: "Figma Professional", category: "Software licenses", amount: 15, description: "Figma" },
    { label: "Adobe Creative Cloud", category: "Software licenses", amount: 55, description: "Adobe CC" },
    { label: "Notion / Linear / Slack", category: "Subscriptions", amount: 12, description: "Team productivity stack" },
    { label: "Vercel / Netlify Pro", category: "Cloud & hosting", amount: 20, description: "Frontend hosting" },
    { label: "AWS / GCP / Azure", category: "Cloud & hosting", amount: 50, description: "Cloud usage" },
    { label: "Domain renewal", category: "Domains & SSL", amount: 15, description: "Annual domain" },
    { label: "Google Workspace", category: "Subscriptions", amount: 8, description: "Per user / month" },
    { label: "Microsoft 365", category: "Subscriptions", amount: 10, description: "M365" },
    { label: "Apple Developer", category: "Software licenses", amount: 8.25, description: "Annual Apple dev program" },
    { label: "Stock assets / icons", category: "Marketing & ads", amount: 29, description: "Asset pack" },
    { label: "Freelancer payout", category: "Contractors & freelancers", amount: 500, description: "Contract work" },
    { label: "Payment processor fee", category: "Bank & payment fees", amount: 0, description: "Stripe / PayPal fees" },
  ];

  const INCOME_TEMPLATES = [
    { label: "Milestone invoice", category: "Client invoice", amount: 2500, description: "Project milestone payment" },
    { label: "Monthly retainer", category: "Consulting", amount: 3000, description: "Retainer" },
    { label: "SaaS MRR", category: "SaaS / recurring", amount: 499, description: "Subscription revenue" },
    { label: "Digital product sale", category: "Product sales", amount: 49, description: "One-time product" },
  ];

  const ASSET_CATEGORIES = [
    "Vehicle",
    "Computer & desk",
    "Camera & AV",
    "Sports & fitness",
    "Tools & equipment",
    "Phone & tablet",
    "Home office",
    "Other asset",
  ];

  const PAYMENT_METHODS = [
    "Card",
    "Bank transfer",
    "PayPal",
    "Stripe",
    "Cash",
    "Crypto",
    "Invoice / terms",
    "Other",
  ];

  /** @deprecated legacy — migrated to lifecycle */
  const PROJECT_STATUSES = ["active", "paused", "completed", "archived"];

  const PROJECT_LIFECYCLES = [
    { value: "in_progress", label: "In progress (building, pre-revenue)", css: "phase-in_progress" },
    { value: "in_market", label: "In market / launched", css: "phase-in_market" },
    { value: "completed", label: "Completed", css: "phase-completed" },
    { value: "cancelled", label: "Cancelled", css: "phase-cancelled" },
    { value: "on_hold", label: "On hold", css: "phase-on_hold" },
    { value: "archived", label: "Archived", css: "phase-archived" },
  ];

  function lifecycleCss(value) {
    const x = PROJECT_LIFECYCLES.find((l) => l.value === value);
    return x ? x.css : "phase-in_progress";
  }

  const RECURRING_FREQUENCIES = [
    { value: "", label: "One-time" },
    { value: "weekly", label: "Weekly" },
    { value: "monthly", label: "Monthly" },
    { value: "quarterly", label: "Quarterly" },
    { value: "yearly", label: "Yearly" },
  ];

  const CURRENCIES = [
    { code: "USD", symbol: "$", name: "US Dollar" },
    { code: "ZAR", symbol: "R", name: "South African Rand" },
    { code: "EUR", symbol: "€", name: "Euro" },
    { code: "GBP", symbol: "£", name: "British Pound" },
  ];

  global.PFTPresets = {
    EXPENSE_CATEGORIES,
    INCOME_CATEGORIES,
    EXPENSE_TEMPLATES,
    INCOME_TEMPLATES,
    ASSET_CATEGORIES,
    PAYMENT_METHODS,
    PROJECT_STATUSES,
    PROJECT_LIFECYCLES,
    lifecycleCss,
    RECURRING_FREQUENCIES,
    CURRENCIES,
  };
})(typeof window !== "undefined" ? window : globalThis);
