# Styles

Direction: counting house. Neutral slate structure, white paper surfaces, blue-pen ink for actions, brass for "you are here", and statuses rendered as inked stamps.

- `tokens.css`: every colour, type size, radius, shadow and layout value (light default, `data-theme="dark"` override)
- `base.css`: element defaults, focus ring, reduced motion
- `components/*.css`: named patterns (`btn-*`, `input-field`, `card`, `stamp-*`, `nav-item-*`, `page`, `ledger`)
- `index.css`: the single import order, resolved by postcss-import

Rule: pages and components use these classes or Tailwind utilities backed by tokens. No raw hex values outside `tokens.css`.

## Component folders
`components/ui` primitives, `components/layout` shell and chrome, `components/invoices` feature components, `components/system` non-visual helpers.
