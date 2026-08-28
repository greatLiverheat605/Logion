# Radix UI compatibility and bundle report

## Environment

- Date: 2026-08-26
- Next.js: 16.2.11
- React: 19.2.7
- Build command: `pnpm --filter @logion/web build`
- Bundler: Turbopack production build

## Before Radix

- Build result: passed, 35 application routes generated
- `.next/static` files: 52
- `.next/static` bytes: 2,129,169
- `.next/static/chunks` files: 49
- `.next/static/chunks` bytes: 2,128,420

## Approved dependency boundary

Only the following primitives may be added: Dialog, Popover, Dropdown Menu,
Tabs, Tooltip, Select, and Context Menu. Radix Themes, cmdk, Base UI, React
Aria Components, and visual component suites are outside this migration.

## Installed packages

| Package | Version | npm unpacked bytes |
|---|---:|---:|
| `@radix-ui/react-dialog` | 1.1.23 | 99,377 |
| `@radix-ui/react-popover` | 1.1.23 | 93,837 |
| `@radix-ui/react-dropdown-menu` | 2.1.24 | 107,334 |
| `@radix-ui/react-tabs` | 1.1.21 | 54,303 |
| `@radix-ui/react-tooltip` | 1.2.16 | 139,023 |
| `@radix-ui/react-select` | 2.3.7 | 352,057 |
| `@radix-ui/react-context-menu` | 2.3.7 | 114,995 |

Total npm unpacked size: 960,926 bytes. This is package metadata, not the
browser transfer size. Every installed package declares React and React DOM
peer support through React 19.

## After Radix

- Compatibility tests: 3 passed
- TypeScript check: passed
- Production build: passed, 35 application routes generated
- `.next/static` files: 52
- `.next/static` bytes: 2,129,169
- `.next/static/chunks` files: 49
- `.next/static/chunks` bytes: 2,128,420
- Change before production imports: 0 bytes

The zero-byte result only proves unused packages do not enter route chunks.
The report must be measured again after the shared adapters and three sample
workbenches import the primitives.

## A3 shared primitive checkpoint

- Shared `AppModal` production import: Radix Dialog
- Global workbench styles: imported
- Project-level headless adapters: implemented, not yet imported by a product route
- Compatibility and adapter tests: 8 passed
- Web lint and TypeScript check: passed
- Web test suite: 43 files and 145 tests passed
- Production build: passed, 35 application routes generated
- `.next/static` files: 53
- `.next/static` bytes: 2,172,786
- `.next/static/chunks` files: 50
- `.next/static/chunks` bytes: 2,172,037
- Change from pre-Radix baseline: +43,617 bytes (+2.05%)

These are uncompressed build-directory bytes, not network transfer bytes. The
three-sample Gate 1 measurement remains required because Popover, Dropdown
Menu, Tabs, Tooltip, Select, and Context Menu do not enter a production route
until the sample workbenches consume their adapters.
