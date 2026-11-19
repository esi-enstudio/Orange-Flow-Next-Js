# UI/UX Standards

> Detail spec referenced from [AGENTS.md](../../AGENTS.md). Rules here are binding; they are not optional guidance.

## UI/UX Rules

All UI must follow:
- Modern dashboard style
- Responsive design
- Accessibility
- Consistent spacing
- Professional appearance

Use:
- Shadcn UI components
- Tailwind CSS patterns

Avoid:
- Random custom UI
- Inconsistent styles
- Duplicate components

## Standard Page Header

Every page header, on both new and existing routes, follows the same structure:

1. **Breadcrumb** at the top: Home → section/category (when applicable) → current page. Link only to routes that exist; render non-routable categories as text. Use a localized `nav` element with `aria-label`, and mark the current page with `aria-current="page"`.
2. **Title row** below the breadcrumb: a 40×40 rounded, primary-tinted icon tile, the page `<h1>`, and the `PageGuideModal` immediately after the heading.
3. **Subtitle** directly below the title: one concise sentence explaining the page, with matching `en` and `bn` translation keys.
4. **Divider** below the header, using the existing light/dark border colors and spacing conventions.

Use the existing Tailwind theme colors, Lucide icons, translation system, and `PageGuideModal`; do not add inline styles, custom color scales, fake breadcrumb links, or a second guide control. Keep the header responsive and prevent horizontal overflow. See `frontend/src/app/reports/live-c2c/page.tsx` for the reference layout.

This standard applies to all routes. New pages must use it by default; when an existing page header is modified, bring it into compliance. A bulk retrofit of untouched pages requires a separate task.

### Project-wide Date Display Format

Display dates consistently as `DD MMM YYYY` with an English, abbreviated month, for example `06 Nov 2026`. Apply this format throughout the project anywhere a date is presented to users, including pages, tables, reports, exports, and notifications. Keep API/database date values and machine-readable formats unchanged; format them only at the presentation boundary. When a date is unavailable or invalid, use the existing localized empty-value convention.

### Cursor Feedback (Mouse Hover)

- Every clickable button and control (buttons, selects, date inputs, checkboxes, pagination controls) must show a **pointer cursor** on mouse hover using the `cursor-pointer` Tailwind class.
- Text inputs used for typing (e.g., search boxes) should keep the default text cursor (`cursor-text`) — do not force `cursor-pointer` on them.
- Disabled controls keep the default `cursor-not-allowed` behavior; do not add `cursor-pointer` when the element is disabled.

### Select Field (Dropdown) Design — Reusable Standard

All **select-like fields** (single-value `<select>` replaced by a styled button, and searchable multi-select dropdowns) must follow this exact design language. Reference implementation: GA Query page filters (`frontend/src/app/reports/ga-query/page.tsx` — Select Retailers, Employees, Product).

#### Use the Existing Reusable Component

Prefer the `EntitySelector` component (`frontend/src/app/zoom-in/_components/EntitySelector.tsx`) for any searchable multi-select dropdown. Do NOT hand-build a new trigger/label/menu — feed items and wire the handlers:

```tsx
<EntitySelector
  label={t("...label...")}
  items={options.map((o) => ({
    id: o.id,                       // string | number
    label: o.name,                  // main line
    sublabel: "...",                // optional secondary line (text-[11px])
    badge: o.type?.toUpperCase(),   // optional chip e.g. "RSO" / "BP"
  }))}
  selectedIds={selectedIds}
  onChange={(ids) => onChange(ids.map(String))}
  placeholder={t("..._placeholder")}
  searchPlaceholder={t("..._search")}
  emptyMessage={t("...empty...")}
  noResultsMessage={t("...no_results...")}
  onSearchChange={(q) => setSearch(q)}   // use for server-side search (e.g. retailers)
  disabled={!selectedHouseId}
  selectAllLabel={t("common.select_all")}
  clearLabel={t("common.clear")}
  selectedLabel={t("...selected...")}    // localizes "N selected"
/>
```

#### Built-in Design (do not restyle)

- **Label** — `block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1.5`. No icon inside the label.
- **Trigger button** — `rounded-xl`, `bg-white dark:bg-slate-900`, `border-gray-200 dark:border-slate-800`, `text-sm`, `outline-none`, `focus:ring-2 focus:ring-primary-500`, `disabled:opacity-50`. No conditional per-state border/background colors.
- **Placeholder** — muted `text-gray-400` when nothing selected; dedicated `_placeholder` translation key.
- **Selected** — single truncated line `"{N} {selectedLabel}"` plus a primary-500 count badge next to the chevron (wrapped in `<div className="flex items-center gap-1.5 shrink-0">`).
- **Dropdown menu** — `absolute z-50 mt-1.5 w-full rounded-xl` with animated search input (Search icon), "Select All" / "Clear" header row, `border-2` checkboxes, sublabels + badges, `max-h-48` scrollable list. Handles outside-click close itself.
- **Cursor** — `cursor-pointer` on the trigger, `disabled:cursor-not-allowed` (see Cursor Feedback section).
- **i18n** — always pass `selectedLabel`, `selectAllLabel`, `clearLabel`, and all text through `useLanguage().t()` keys, never hardcode English.

The GA Query page is the reference implementation. Use this exact component for every new select field; do not invent new button/label styles.

---

## Filter System — Right-Side Filter Drawer (Project-wide Standard)

### Principle

কোনো page/table/list-এ **inline filter section রাখা যাবে না**। সব ফিল্টার (house, date range, retailer/employee/product, text filters) একটি **right-side sliding filter panel**-এ থাকবে। Screen-এর বড় জায়গা data table-কে দিতে হবে, filter লাগলে user নিজে drawer খুলবে।

### Reference Implementation

`frontend/src/app/reports/ga-query/page.tsx` — filter icon → right drawer → Apply। নতুন page-এ ঠিক এই pattern follow করতে হবে।

### Mandatory Rules

1. **Trigger** — "Refine Results" toolbar-এ search field-এর **ঠিক পরে** icon-only filter button (`SlidersHorizontal` from `lucide-react`) থাকবে। `title` ও `aria-label` translation key থেকে আসবে। Active filter থাকলে ছোট count badge দেখানো যাবে।
2. **Panel** — `AnimatePresence` + `motion.aside` দিয়ে **ডান দিক থেকে slide-in** (sidebar-এর মতো): `initial={{ x: "100%" }}`, `animate={{ x: 0 }}`, `exit={{ x: "100%" }}`, `transition={{ type: "spring", damping: 25, stiffness: 200 }}`. Width: `w-full sm:max-w-md`, `fixed inset-y-0 right-0 z-[101]`, `flex flex-col`।
3. **Backdrop** — panel open থাকলে পেছনের screen হালকা blur + dim হবে: `fixed inset-0 z-[100] bg-black/30 backdrop-blur-sm`; click করলে panel বন্ধ হবে। Panel header-এ close (`X`) button থাকবে।
4. **One column** — panel body-তে প্রতিটি filter field **full-width, এক কলামে** (`flex-1 overflow-y-auto px-5 py-4 space-y-4`)। কখনো একাধিক column grid ব্যবহার করা যাবে না।
5. **Date fields** — Start Date ও End Date আলাদা input হিসেবে দেখানো যাবে না। সবসময় shared `DateRangePicker` (`@/components/date-picker`) ব্যবহার করতে হবে:
   ```tsx
   <DateRangePicker
     label={t("...date_range...")}
     value={{ from: startDate || null, to: endDate || null }}
     onChange={(range) => { setStartDate(range.from ?? ""); setEndDate(range.to ?? ""); }}
   />
   ```
6. **Staged apply** — filter values draft হিসেবে রাখতে হবে; panel-এর footer-এ full-width **Apply** button click করলে filter apply হবে এবং panel বন্ধ হবে। Apply ছাড়া filter data request trigger করবে না। Backdrop/X-এ বন্ধ করলে draft apply হবে না।
7. **i18n** — panel title, trigger label, Apply, close — সব text translation key দিয়ে en/bn দুটোতেই থাকবে।
8. **Cursor / Responsive / Permission** — Apply enabled হলে `cursor-pointer`, disabled হলে `cursor-not-allowed`; mobile-এ panel full-width; filter action page-এর view permission-এর অধীন।
9. **No duplicates** — একই filter একবারই panel-এ থাকবে; toolbar search আলাদা (immediate search), panel-এর filter গুলো staged apply হিসেবে চলবে।

### Checklist — Filter Drawer

- [ ] Page body-তে কোনো inline filter section নেই
- [ ] Toolbar search-এর পরে filter icon button আছে (bilingual title/aria-label)
- [ ] Panel ডান দিক থেকে slide-in হয়, backdrop blurred, एक column fields
- [ ] Start/End date-এর বদলে `DateRangePicker` ব্যবহৃত
- [ ] Apply করলে filter apply + panel বন্ধ হয়; Apply ছাড়া কিছু apply হয় না
- [ ] Mobile (375px)-এ panel full-width ও scrollable

---

## Dynamic Page Title & HTML Lang Synchronization

### Objective

প্রতিটি পেজে ভিজিট করার সময় ব্রাউজার ট্যাবের টাইটেল (`document.title`) ডায়নামিকালি পরিবর্তিত হতে হবে (যেমন: `"Live Monitor | OrangeFlow"` বা `"লাইভ মনিটর | OrangeFlow"`), এবং ব্যবহারকারী বাংলা/ইংরেজি ভাষা পরিবর্তন করলে HTML ট্যাগের `lang` এট্রিবিউট (`<html lang="en">` / `<html lang="bn">`) স্বয়ংক্রিয়ভাবে আপডেট হতে হবে।

### Mandatory Rules for New Pages / Routes

1. **Register in Navigation Items (`navItems`)**:
   - প্রতিটি নতুন পেজ বা মডিউল তৈরি করার সময় `frontend/src/lib/constants.ts`-এর `navItems` এ তার `title`, `href` এবং `translationKey` যুক্ত করুন।

2. **Bilingual Translations**:
   - `translationKey`-এর মান `frontend/src/i18n/translations.ts` এর `en` এবং `bn` উভয় অবজেক্টেই সংজ্ঞায়িত করুন।

3. **Non-Nav / Dynamic Sub-Routes**:
   - কোনো পেজ যদি `navItems`-এ না থাকে (যেমন `/zoom-in/create`, `/cv/[slug]`, `/pricing` ইত্যাদি), তবে তার পাথ এবং ইংরেজি/বাংলা নাম `frontend/src/components/layout/DynamicPageTitle.tsx`-এর `ROUTE_TITLE_MAP` অথবা প্যাটার্ন হ্যান্ডলারে অবশ্যই রেজিস্টার করুন।

4. **Dynamic Execution Mechanism**:
   - `frontend/src/components/layout/DynamicPageTitle.tsx` কম্পোনেন্টটি `usePathname()` এবং `useLanguage()` ট্র্যাক করে `document.title` এবং `document.documentElement.lang` হ্যান্ডেল করে।

---

## Loading / Skeleton Guidelines

### Principle

ডেটা লোড হওয়ার সময় ব্যবহারকারীকে **অপেক্ষার অনুভূতি না দিয়ে** বোঝাতে হবে যে কাজ হচ্ছে। শুধু spinner দেখানো যথেষ্ট নয় — বাস্তব UI-এর মতো skeleton দেখানো user experience-এর জন্য অনেক ভালো।

### Rules

1. **Skeleton, Not Spinner** — শুধু একটি `Loader2` spinner না রেখে **content-aware skeleton** ব্যবহার করতে হবে। টেবিলের জন্য skeleton row, কার্ডের জন্য skeleton card, ফর্মের জন্য skeleton field
2. **animate-pulse** — Tailwind-এর `animate-pulse` ব্যবহার করে shimmer effect তৈরি করুন। আলাদা CSS কীফ্রেম না লিখে
3. **Match Layout** — skeleton-এর আকৃতি ও কলাম সংখ্যা আসল content-এর মতো হতে হবে। টেবিলে যত কলাম, skeleton-এও তত কলাম
4. **Responsive Skeleton** — মোবাইলের জন্য skeleton-এ কম কলাম দেখাতে হবে, বড় স্ক্রিনে বেশি (যেমন `hidden sm:block`, `hidden md:block`)
5. **Per-Item Skeleton** — list/table-এ প্রতি পৃষ্ঠায় যত আইটেম দেখানো হয়, skeleton-এও ততটি আইটেম দেখান (যেমন per_page = 5 হলে ৫টি skeleton row)
6. **Card Skeleton** — grid layout-এর ক্ষেত্রে (যেমন dashboard cards), প্রতিটি কার্ডের জন্য separate skeleton কার্ড দেখান
7. **Form Skeleton** — ফর্ম লোড হতে সময় নিলে (যেমন edit page), প্রতিটি input field-এর জায়গায় skeleton দেখান
8. **Avoid Layout Shift** — skeleton-এর মাত্রা (height/width) আসল content-এর কাছাকাছি রাখুন, যাতে লোড হওয়ার পর হঠাৎ লেআউট না নড়ে

### Implementation Pattern

```tsx
{loading ? (
  <div className="divide-y divide-gray-50 dark:divide-slate-800">
    {Array.from({ length: 5 }).map((_, i) => (
      <div key={i} className="flex items-center gap-4 px-6 py-5 animate-pulse">
        <div className="w-10 h-10 rounded-xl bg-gray-200 dark:bg-slate-700 shrink-0" />
        <div className="space-y-2 flex-1">
          <div className="h-3 w-32 bg-gray-200 dark:bg-slate-700 rounded-md" />
          <div className="h-2.5 w-24 bg-gray-100 dark:bg-slate-800 rounded-md" />
        </div>
        <div className="hidden sm:block flex-1 space-y-2">
          <div className="h-3 w-20 bg-gray-200 dark:bg-slate-700 rounded-md" />
          <div className="h-2.5 w-16 bg-gray-100 dark:bg-slate-800 rounded-md" />
        </div>
      </div>
    ))}
  </div>
) : (
  <RealContent />
)}
```

### When NOT to Use Skeleton

- API call ২০০ms-এর কম সময় নিলে skeleton দেখানোর দরকার নেই — সরাসরি content দেখান
- Error state-এ skeleton নয়, error message দেখান
- Empty state-এ skeleton নয়, "No data" message দেখান

---

## Table/List Module Rules

Every data table should support when required:
- Search
- Filtering
- Sorting
- Pagination (see Pagination API Contract)
- Export
- Import
- Action buttons

Action buttons must be permission controlled.

Example:

Edit button:
Requires:
module.edit

Delete button:
Requires:
module.delete

### Table Cell Styling Rules

1. **`<td>` class** — All `<td>` elements must have `class="px-2 py-1"`. This applies to every table cell across the entire application.

2. **Subtitle Font Size** — If a `<td>` contains a subtitle (secondary text below the main value), the subtitle must use `font-size: 11px` (via Tailwind class `text-[11px]` or inline style). The subtitle should also use a muted text color (`text-gray-500 dark:text-gray-400`).

```tsx
// Example: <td> with main value and subtitle
<td className="px-2 py-1">
  <p className="font-medium">Main Value</p>
    <p className="text-[11px] text-gray-500 dark:text-gray-400">Subtitle text</p>
</td>
```

3. **Responsive — Collapsible Rows** — Small screen-এ (`lg` breakpoint-এর নিচে) টেবিলের row গুলো **collapsible/expandable accordion**-এ convert হবে। Desktop টেবিল (`hidden lg:table`) লুকিয়ে mobile-friendly accordion list (`lg:hidden`) দেখাতে হবে। প্রতিটি accordion-এ শুধু মূল তথ্য (name, identifier) visible থাকবে, остальные details click-এ expand হবে। একসাথে শুধু একটি row expand রাখতে হবে। সম্পূর্ণ spec: [ui-components.md → Responsive Table — Accordion Behavior](ui-components.md#responsive-table--accordion-behavior)।
