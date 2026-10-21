# VYNOX LAYER — Complete Design Reference

> A source-based description of the current VYNOX LAYER platform: its identity, visual language, screen structure, shared components, and interaction rules.
>
> This document describes the workspace design and approved design constraints. It is not a claim that every feature is enabled or that the latest workspace changes have been published. Prices, payment methods, product availability, and customer content must come from the application, not this document.

## Contents

1. Brand and product identity
2. Design principles
3. Color system and themes
4. Typography
5. Spacing, surfaces, and composition
6. Logo and artwork
7. Public website
8. Product catalog and product pages
9. Authentication
10. Customer account and ordering
11. Super Admin
12. White Label Exchange website
13. Tenant Exchange administration
14. Shared components
15. Motion and responsiveness
16. Accessibility and content
17. Screen and route inventory
18. Implementation references
19. Design preservation checklist

---

## 1. Brand and product identity

**Official name:** VYNOX LAYER  
**Product category:** White-label crypto infrastructure platform  
**Flagship offering:** White Label Exchange  
**Primary public headline:** “One layer for every crypto product you brand.”

The platform presents a family of related digital-finance products through one visual identity. Public marketing, the customer account, Super Admin, and tenant administration should feel like parts of the same platform.

### Three distinct surfaces

| Surface | Identity | Purpose |
|---|---|---|
| Public VYNOX platform | VYNOX LAYER | Explain the offering, explore products, inspect plans, and begin a request |
| Authenticated platform | VYNOX LAYER | Customer requests, operator review, administration, and account management |
| Customer’s public Exchange | Customer-owned identity | Present the customer’s Exchange using the approved shared template |

Tenant public websites must retain their own names, logos, colors, domains, and authored content. They must not silently inherit the VYNOX logo as a fallback.

## 2. Design principles

### One platform, one visual language

- Reuse the approved public platform’s purple, violet, deep-blue, and lavender palette.
- Share cards, buttons, typography, tables, dialogs, and responsive navigation across roles.
- Change navigation and permissions by role—not the entire visual identity.
- Do not create a second Admin Panel design to add new functionality.

### Premium presentation, practical administration

Marketing uses atmospheric backgrounds, gradient typography, glass surfaces, and illustrated product scenes. Administration uses the same colors and type language with denser, task-oriented layouts and restrained motion.

### Accurate availability

- Distinguish illustrative previews from working services.
- Distinguish a submitted request from an approved, prepared, or delivered website.
- Do not use decorative “Live,” “Paid,” or “Delivered” labels where operational state does not support them.
- Display unavailable actions with an understandable explanation.
- Never invent prices, transactions, customers, or testimonials to fill empty states.

### Preserve the approved master

The current NovaX Exchange is the approved shared White Label Exchange template. Extend tenant configuration around it rather than creating customer-specific frontend copies.

## 3. Color system and themes

### Canonical brand palette

These values come from the shared `VYNOX` palette.

| Token | Hex | Role |
|---|---|---|
| Royal purple | `#5B2FD0` | Light-theme primary action and core brand color |
| Electric violet | `#7B5CFF` | Dark-theme primary action and marketing emphasis |
| Deep blue | `#1B2A8C` | Secondary brand depth and gradient support |
| Soft lavender | `#C9BDFF` | Accent, highlights, and gradient text |
| Violet glow | `#8F7BFF` | Ambient light and supporting emphasis |

### Dark theme

| Token | Hex |
|---|---|
| Base background | `#070817` |
| Primary | `#7B5CFF` |
| Foreground | `#EEEBFF` |
| Muted text | `#A9A5CC` |
| Danger | `#FF8A80` |

Dark mode is the configured platform marketing default. It combines a deep navy-violet base with luminous violet accents and pale text.

### Light theme

| Token | Hex |
|---|---|
| Base background | `#FBFAFF` |
| Primary | `#5B2FD0` |
| Foreground | `#14102E` |
| Muted text | `#5A5680` |
| Card | `#FFFFFF` |
| Border | `#CFC7F0` |
| Danger | `#B3261E` |

Light mode remains recognizably purple rather than becoming an unrelated neutral dashboard.

### Semantic variables

The public website uses variables such as:

```css
--s-bg
--s-bg2
--s-fg
--s-muted
--s-primary
--s-primary-fg
--s-primary-ink
--s-accent
--s-accent-ink
--s-card
--s-line
--s-glow
--s-font
--s-r1
--s-r2
```

Authenticated screens derive their semantic background, foreground, card, border, sidebar, primary, and chart variables from the same theme generator.

**Important:** The base console stylesheet also contains fallback tokens. The active console theme is derived at runtime; those fallback declarations alone are not the complete rendered design.

### Color rules

- Use semantic tokens rather than scattering hard-coded purple values.
- Text and focus colors may be adjusted by the theme generator for contrast.
- Keep danger colors for errors and destructive actions, not ordinary chart categories.
- Do not interpret the legacy class name `text-copper` as a copper brand requirement; it maps to the active accent.
- Tenant public colors are configurable and separate from the platform palette.

## 4. Typography

### Primary platform typeface

**Space Grotesk** is the configured platform theme font.

```css
font-family: 'Space Grotesk', system-ui, sans-serif;
```

The authenticated console inherits the shared platform theme font.

### Supporting and fallback families

The base console declares:

- Sans: Bricolage Grotesque
- Serif: Instrument Serif, with Georgia fallback
- Monospace: Spline Sans Mono

These are supporting/fallback declarations, not a replacement for the active platform theme. Public-site monospace treatments also use system monospace stacks.

Tenant theme font options include system, Inter, Manrope, DM Sans, and Space Grotesk.

### Hierarchy

| Element | Existing design treatment |
|---|---|
| Marketing hero heading | `clamp(2.3rem, 6.4vw, 5rem)`, line-height `1`, weight `650`, tracking `-0.04em` |
| Shared display heading | `clamp(2.3rem, 4.7vw, 4.15rem)`, tight line-height and negative tracking |
| Shared section heading | `clamp(1.9rem, 4.4vw, 3.35rem)`, line-height about `1.04` |
| Console headings | Shared theme font, weight `650`, balanced wrapping, tight tracking |
| Eyebrows | Small uppercase labels with increased letter spacing |
| Body copy | Comfortable line-height, muted secondary text, constrained line length |
| Identifiers and metadata | Compact monospace where useful |

Hero text can use an animated violet-to-lavender gradient. Dense forms and administrative tables use solid, readable text.

## 5. Spacing, surfaces, and composition

### Layout approach

- Center public content in shared width-constrained containers.
- Use generous vertical spacing for marketing sections.
- Use tighter, consistent spacing in operational screens.
- Let content grids collapse naturally rather than forcing desktop widths.
- Preserve `min-width: 0` and safe wrapping around long identifiers, names, and domains.

### Existing marketing measurements

| Element | Measurement |
|---|---|
| Hero top padding | `clamp(3rem, 8vw, 6.5rem)` |
| Hero bottom padding | `clamp(2.5rem, 6vw, 4.5rem)` |
| Section vertical padding | `clamp(3rem, 7vw, 5.5rem)` |
| Marketing card padding | `1.4rem` |
| Marketing card radius | `1.25rem` |
| General marketing grid gap | `1rem` |
| Hero orbit maximum width | `34rem` |

### Radius families

The public theme supports:

| Style | Small / medium / large |
|---|---|
| Sharp | `3px / 4px / 6px` |
| Soft | `8px / 12px / 18px` |
| Rounded | `12px / 20px / 30px` |

The platform uses the rounded public-theme configuration. Base console primitives also define an `8px` radius foundation; choose the existing component rather than forcing every surface to one radius.

### Surface treatment

- Glass cards use translucent fills, thin borders, and backdrop blur.
- Illuminated surfaces use subtle radial light, an inset highlight, and restrained shadow.
- Background atmosphere includes violet light, fine grid structure, and orbital geometry.
- Functional content must remain readable without the decorative layers.
- Customer data tables should not compete with the marketing hero’s visual intensity.

## 6. Logo and artwork

### Official assets

The console’s public assets include:

- `vynox-logo-dark.png`
- `vynox-logo-light.png`
- `vynox-logo.png`
- `vynox-logo.webp`
- `vynox-icon.png`
- `vynox-icon-32.png`
- `vynox-icon-180.png`

Use the shared `BrandLogo` component and brand constants where possible.

### Logo rules

1. Preserve the official supplied master artwork.
2. Preserve transparency and original proportions.
3. Choose the variant for the actual surface behind it.
4. Use the full wordmark where space permits and the icon in small spaces.
5. Do not recreate or restyle the lettering with generated artwork.
6. Do not repeat the name beside a full wordmark that already contains it.
7. Do not use the VYNOX identity as a tenant-public-site fallback.

### Product illustrations

Each complete product scene should normally contain **one prominent VYNOX brand placement**: the main dashboard, primary app screen, core engine, or physical card.

Secondary phones, floating panels, graphs, nodes, and badges should not each repeat the logo. Preserve breathing room and strong visual hierarchy. If the desktop primary screen disappears on mobile, provide one appropriate mobile-visible brand placement.

## 7. Public website

### Header

The public navigation combines:

- VYNOX logo
- Exchange, core-products, ecosystem, and catalog navigation
- Theme toggle
- Sign in
- Get Started
- Primary Exchange action

Use a compact, themed navigation bar. On smaller screens, keep core actions reachable through responsive navigation rather than squeezing every desktop item into one line.

### Hero

Desktop structure:

```text
┌──────────────────────────────────────────────────────────────┐
│ Logo      Product navigation      Theme / Sign in / Actions   │
├─────────────────────────────┬────────────────────────────────┤
│ Category eyebrow            │                                │
│ Large gradient headline     │ Animated product orbit         │
│ Supporting explanation      │ around one VYNOX core          │
│ Primary + secondary actions │                                │
│ Availability/context strip  │                                │
└─────────────────────────────┴────────────────────────────────┘
```

The desktop hero uses approximately a `6fr / 5fr` split at widths of at least `1024px`. On smaller screens, text and illustration stack.

Primary actions in the current hero implementation:

- Explore Exchange
- Browse all products
- Get Started

The orbit is a linked product illustration, not a live network monitor. Product nodes depend on the available catalog entries.

### Homepage section sequence

The main landing composition includes:

1. Hero
2. Exchange spotlight, when Exchange is available in the catalog
3. Product catalog
4. How-it-works journey
5. Supporting commercial content as configured
6. FAQ
7. Shared footer

### Exchange spotlight

The flagship section combines a product explanation with an illustrative Exchange scene.

Core copy: “A white-label Exchange, branded as yours.”

Actions lead to Exchange exploration and plans. The scene must clearly remain an illustration when it is not a working customer service.

### How it works

Four numbered cards:

1. **Choose** — identify suitable products.
2. **Brand** — provide name, logo, colors, and preferred domain.
3. **Review** — operator reviews the request and pricing.
4. **Deliver** — delivery follows verified payment and readiness.

The journey describes the intended lifecycle; it must not bypass actual operational restrictions.

### FAQ

Use accessible expandable questions with simple answers about readiness, ordering, examples, and the account flow. Update availability copy when product policy changes; do not assume old marketing text is authoritative payment policy.

## 8. Product catalog and product pages

### Catalog

- Responsive product-card grid.
- Clear product names and category labels.
- Product-specific visual scenes.
- Honest readiness labels such as Preview or Coming Soon.
- Explore actions that lead to the product’s existing route.
- Loading, retry, and empty states rather than fabricated catalog entries.

### Product detail

Use the shared platform identity with product-specific imagery and information hierarchy:

1. Product identity and proposition
2. Main visual or preview
3. Capabilities and supporting explanation
4. Relevant configuration or demo entry points
5. Plans, where published and applicable
6. Request action

Visual variations are presentations of the catalog, not necessarily separate products or database records.

### Pricing design

- Starter, Standard, and Premium are the established commercial tier names.
- Prices and availability come from published configuration.
- Distinguish recurring, setup, and custom-design charges.
- Support monthly/yearly presentation only when available.
- Render descriptive features as ordered label/value rows.
- Descriptive marketing rows must not become permissions or entitlements.
- A promoted tier can use an accent border and restrained glow.
- Pricing cards become a single column at narrower widths.

Do not hard-code tier prices into a design reproduction.

## 9. Authentication

Authentication uses the platform identity, consistent form controls, readable errors, and clear progression.

Screen families:

- Sign in
- Sign up
- Forgot password
- Reset password
- Verify email
- Two-factor verification
- Account security

### Form behavior

- Explicit labels, not placeholder-only fields.
- Pending states on submissions.
- Clear validation and server-error feedback.
- No false success messaging.
- Appropriate separation of password, verification, and recovery steps.
- Preserve the original account and security model; redesigning a screen is not permission to change authentication behavior.

## 10. Customer account and ordering

### Account shell

Use the shared VYNOX console appearance with customer-specific navigation. The account exposes requests/orders, White Label products, delivered Admin Panels, configuration, and account/security functions as authorized.

### Request configuration

Collect the actual request details in the existing flow:

- Project and brand identity
- Preferred domain
- Exchange actions
- Selected plan and applicable add-ons
- Billing period
- Standard or custom design selection
- Brand colors and theme preference
- Logo/favicon/reference attachments where supported
- Reference website and design notes
- Requirements and supporting attachments

Keep uploaded assets and input associated with the requesting customer. Do not imply that completing a form creates or delivers a running website immediately.

### Customer order detail

```text
Order reference / Project name / Status / All orders
Lifecycle stage tracker

┌───────────────────────────────┬───────────────────────┐
│ Request and design summary    │ Payment / invoice     │
│ Plan and selected options     │ Customer-visible      │
│ Attachments and details       │ status and notes      │
└───────────────────────────────┴───────────────────────┘
```

The wide layout uses a flexible main column and a `320px` supporting column. It stacks on smaller screens.

### Invoice and payment presentation

- Present invoice amount, currency, status, payment method, instructions, and reference as applicable.
- “Create invoice” is a checkout action, not merely a document download.
- A customer-reported transfer is not a verified payment.
- Show only payment methods actually approved and available.
- Where an action is blocked, explain why before the customer attempts it.
- Payment authorization and publication state are operational configuration, not design constants.

### Customer communications

Customer timelines show only customer-visible events. Internal operator notes must never appear in this view.

### Delivered access

Website and Admin Panel links must reflect delivered access and actual authorization. A prepared draft is not a delivered product.

## 11. Super Admin

### Shared shell

- Platform logo and themed navigation
- Role-appropriate sections
- Page eyebrow, heading, supporting context, and actions
- Cards, tables, filters, drawers/dialogs, and status indicators
- Responsive navigation without creating an unrelated mobile design

### Main administration areas

- Customer requests and orders
- White Label records
- Customers and client projects
- Domains
- Provisioning
- Providers and integrations
- Exchange catalog
- Plans and add-ons
- Product/module administration
- Landing-product and catalog presentation
- Activity

### Order detail

Header:

- Order reference
- Project name
- Current status
- Customer context
- Back-to-orders action
- Quick lifecycle actions

Tabs:

1. Summary
2. Review & pricing
3. Payment
4. Delivery
5. Internal notes
6. Customer notes
7. Timeline

### Review & pricing

The review form includes:

- Status
- Currency
- Recurring price
- Setup fee
- Customization fee
- Custom-design decision where applicable
- Approved plan
- Approved add-ons

Actions must reflect both valid lifecycle transitions and current operational permissions. An “Approved” transition can prepare a website; it must not be treated as a harmless note edit.

### Confirmation pattern

The existing shared pattern is:

```text
Edit → Review proposed values → Confirm → Apply → Result
```

The review dialog presents a label/value summary, pending state, errors, cancel action, and final apply action.

### Notes

- Internal notes and customer-visible notes are separate.
- Visibility is explicitly labeled.
- Existing notes are append-oriented rather than silently overwritten.
- Note drafts belong to the correct order and audience.

### Payment administration

Operator payment views distinguish:

- No invoice
- Pending invoice
- Reported payment
- Verified payment
- Rejection or reconciliation conditions

Manual settlement controls must not equate a customer reference with evidence of funds received.

### Delivery and provisioning

Preparation, sandbox activation, readiness, and delivery are separate stages. Keep their controls and explanations distinct. A button’s presence must not imply that a restricted action is available.

## 12. White Label Exchange website

### Shared master

Use the approved current NovaX structure. Customer differentiation comes from isolated configuration and branding—not copied frontend projects.

### Product scope

The active Exchange scope is:

- **Swap:** Crypto/Fiat
- **Convert:** Crypto/Crypto

Historical Buy/Sell references do not authorize reintroducing those products.

### Core presentation

- Customer-branded header and navigation
- Exchange-focused hero
- Main Swap/Convert widget
- Asset/currency and amount controls
- Supported-assets and relevant informational sections
- Customer-configured content, support, and footer
- Shared responsive layouts, theme behavior, and animations

### Empty and unavailable states

Keep the full master structure visible for:

- Initial setup
- Sandbox
- Paused state
- Loading
- Empty configuration

Use disabled controls and honest placeholders inside the normal composition. Do not replace the entire Exchange with a small status message, hide whole sections just because counts are zero, or copy demo balances/rates/assets into a customer’s website.

### Customer branding

Configurable presentation can include:

- Name and logo
- Favicon
- Primary, accent, secondary, and glow colors
- Font selection
- Surface and radius style
- Theme preference
- Website copy
- Support details and social links
- Legal/footer content

Honor independently authored customer text even when the business brand changes.

## 13. Tenant Exchange administration

Tenant administration remains visually part of VYNOX LAYER, while managing the tenant’s own isolated Exchange.

Use the existing console structure for areas such as:

- Exchange overview
- Orders and order details
- Configuration
- Assets/currencies and routes
- Payment-method configuration
- Pricing and related settings
- Integrations
- Website presentation

Do not transplant an older Exchange dashboard’s visual style to introduce advanced organization, bulk actions, or drawers. Reuse existing components and retain authorized functionality.

Filter design must preserve selections correctly and keep filters/reset controls visible even when there are zero matches.

## 14. Shared components

| Component | Design/behavior |
|---|---|
| Page header | Eyebrow, clear title, optional description/context, grouped actions |
| Primary button | Brand-colored, high emphasis, clear verb |
| Secondary button | Lower emphasis, consistent dimensions |
| Outline/ghost button | Supporting navigation or low-priority actions |
| Destructive action | Explicit label and confirmation when appropriate |
| Input/select/textarea | Theme-aware surface, border, focus ring, label, error |
| Checkbox | Clear selection, accessible label, predictable grouping |
| Card/panel | Bordered surface, title, optional explanatory note |
| Badge | Concise status label; not color alone |
| Table/list | Readable columns, stable controls, loading/error/empty states |
| Tabs | Consistent selected state; horizontal overflow where necessary |
| Dialog | Focus-managed overlay, clear title, cancel and apply actions |
| Timeline | Chronological events with correct visibility |
| Skeleton | Recognizable placeholder shape without fabricated content |
| Error state | Specific failure context and retry action |
| Empty state | Explain absence and offer a valid next action |
| Toast | Concise result feedback; not the only place to show a form error |

## 15. Motion and responsiveness

### Motion language

Existing marketing motion includes:

- Entrance: `14px` upward reveal over approximately `0.8s`
- Stagger: approximately `90ms` between hero elements
- Gradient shift: `9s` loop
- Orbital rings: slow rotations, including `48s`, `60s`, and `70s`
- Core float: `6s` loop, approximately `8px` travel
- Pulse: `3.2s`
- Card hover: approximately `4px` upward movement
- Panel reveal: approximately `0.45s`

Motion supports hierarchy; it must not communicate actual transactions, connectivity, or market activity where none exists.

### Reduced motion

The marketing stylesheet disables orbital, gradient, pulse, float, and reveal motion under `prefers-reduced-motion: reduce`. The console also reduces animations/transitions. Preserve these accommodations.

### Responsive behavior

- Hero split activates at `1024px`.
- Supporting split sections use a breakpoint around `900px`.
- Three-tier pricing collapses to one column at `860px` and below.
- Product grids use auto-fitting columns.
- Cards and fields use safe minimum widths and wrapping.
- Wide tab lists scroll horizontally instead of clipping labels.
- Order detail sidebars stack on small screens.
- Dialogs constrain height and scroll internally.
- Keep one visible primary logo in responsive product illustrations.

These are observed component rules, not a requirement to replace every existing breakpoint with a universal set.

## 16. Accessibility and content

### Accessibility requirements to preserve

- Visible keyboard focus.
- Label every control.
- Use semantic headings and landmarks.
- Provide meaningful image alternatives where images convey content.
- Keep decorative layers non-interactive and hidden from assistive technology when appropriate.
- Use accessible selected/expanded states for tabs and accordions.
- Convey status in text, not color alone.
- Honor reduced motion.
- Ensure both theme variants remain readable.

This document is not a certification of full accessibility compliance.

### Content tone

Use direct, short, professional language:

- “Create invoice”
- “Review & pricing”
- “Customer notes”
- “Internal only”
- “Retry refresh”
- “Deliver to customer”

Errors should explain the user’s next step. Avoid exposing an internal preparation-policy message as the sole customer explanation.

### Security-sensitive presentation

- Never expose internal notes in customer views.
- Never use platform branding to imply tenant ownership.
- Never make a preview look like proof of live connectivity.
- Never present an unverified report as a paid invoice.
- Never show a delivered Admin Panel link before actual access is granted.

## 17. Screen and route inventory

Routes below describe the existing application structure. Their presence does not imply anonymous access or current availability.

### Public and authentication

| Route | Surface |
|---|---|
| `/` | Platform landing |
| `/products/:productKey` | Product detail |
| `/demo/admin` | Demo administration entry |
| `/sign-in` | Sign in |
| `/sign-up` | Sign up |
| `/forgot-password` | Recovery request |
| `/reset-password` | Password reset |
| `/verify-email` | Email verification |
| `/two-factor` | Two-factor verification |

### Customer

| Route | Surface |
|---|---|
| `/account` | Account overview |
| `/account/orders` | Customer order list |
| `/account/orders/:orderId` | Customer order detail |
| `/account/white-labels` | Customer White Labels |
| `/account/admin-panels` | Authorized Admin Panels |
| `/account/configure` | Request configuration |
| `/account/profile/*?` | Profile routes |
| `/account/security` | Security settings |

### Administration

| Route | Surface |
|---|---|
| `/admin` | Administration entry |
| `/white-label-requests` | Request queue |
| `/white-label-requests/:orderId` | Operator order detail |
| `/white-labels` | White Label management |
| `/customer-domains` | Customer domain management |
| `/provisioning` | Provisioning |
| `/providers` | Providers |
| `/exchange-catalog` | Exchange catalog |
| `/integrations` | Integrations |
| `/customers/:customerId` | Customer detail |
| `/clients` | Client projects |
| `/clients/new` | Client setup |
| `/clients/:id` | Client detail |
| `/clients/:id/exchange/:section?/:orderId?` | Tenant Exchange administration |
| `/clients/:id/integrations` | Tenant integrations |
| `/modules` | Modules |
| `/plans` | Plans |
| `/plans/new` | New plan |
| `/plans/:id` | Plan detail/edit |
| `/add-ons` | Add-ons |
| `/landing-products` | Landing-product management |
| `/catalog-preview` | Catalog preview |
| `/abracadabra-preview` | Protected preview surface |
| `/activity` | Activity |

## 18. Implementation references

These workspace-relative references identify the source of the design. They are not links to public pages.

### Identity and shared theme

- `artifacts/private-label-console/src/lib/brand.ts`
- `artifacts/private-label-console/src/components/brand-logo.tsx`
- `artifacts/private-label-console/src/lib/platform-site.ts`
- `artifacts/private-label-console/src/lib/console-theme.ts`
- `artifacts/private-label-website/src/lib/theme.ts`
- `artifacts/private-label-console/src/index.css`

### Marketing

- `artifacts/private-label-console/src/styles/vynox-marketing.css`
- `artifacts/private-label-console/src/styles/platform-catalog.css`
- `artifacts/private-label-console/src/components/landing/catalog-landing.tsx`
- `artifacts/private-label-console/src/components/landing/vynox-hero.tsx`
- `artifacts/private-label-console/src/components/landing/home-sections.tsx`
- `artifacts/private-label-console/src/components/landing/platform-catalog.tsx`
- `artifacts/private-label-console/src/components/landing/product-showcase.tsx`
- `artifacts/private-label-console/src/components/landing/explore-premium.tsx`

### Operational screens

- `artifacts/private-label-console/src/styles/console.css`
- `artifacts/private-label-console/src/pages/account-order.tsx`
- `artifacts/private-label-console/src/pages/white-label-order.tsx`
- `artifacts/private-label-console/src/components/operator/review-form.tsx`
- `artifacts/private-label-console/src/components/operator/notes-delivery.tsx`
- `artifacts/private-label-console/src/components/commerce/payment-panel.tsx`
- `artifacts/private-label-console/src/components/super-admin/kit.tsx`
- `artifacts/private-label-console/src/components/ui/`
- `artifacts/private-label-console/src/App.tsx`

### Shared customer-site presentation

- `artifacts/private-label-website/src/styles/site-base.css`
- `artifacts/private-label-website/src/styles/site-atmosphere.css`
- `artifacts/private-label-website/src/styles/site-widget.css`
- `artifacts/private-label-website/src/styles/site-sections.css`
- `artifacts/private-label-website/src/styles/site-showcase.css`
- `artifacts/private-label-website/src/styles/site-instrument.css`

## 19. Design preservation checklist

- [ ] Official logo remains unmodified, proportional, and transparent.
- [ ] One prominent brand placement per complete product illustration.
- [ ] Public and authenticated platform screens use the same brand system.
- [ ] Customer public websites retain customer-owned branding.
- [ ] Runtime theme tokens are respected in light and dark mode.
- [ ] Platform typography follows the configured theme.
- [ ] Marketing decoration does not reduce functional readability.
- [ ] The approved Exchange master layout remains intact.
- [ ] Swap and Convert remain the supported Exchange actions.
- [ ] No fabricated commercial data or live-service claims.
- [ ] Internal and customer-visible communications remain separate.
- [ ] Pending, empty, error, disabled, and success states are designed.
- [ ] Permissions and availability drive operational actions.
- [ ] Mobile layouts preserve navigation, controls, and readable content.
- [ ] Keyboard focus and reduced-motion behavior are preserved.
- [ ] A visual update does not silently change authentication, data, payment policy, or delivery permissions.

---

**Document boundary:** This is a comprehensive design reference and handoff, not an export of all application source, a pixel-perfect specification of every runtime state, or a deployment confirmation. For exact rendering, the components, theme generator, official assets, and authorized runtime configuration remain the source of truth.
