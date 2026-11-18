# Responsive / Mobile-Friendly Requirement

> Detail spec referenced from [AGENTS.md](../../AGENTS.md). Rules here are binding; they are not optional guidance.

## Responsive / Mobile-Friendly Requirement

### Principle

প্রতিটি মডিউল, পেজ, কম্পোনেন্ট, ফর্ম, টেবিল, এবং ড্যাশবোর্ড **ডেস্কটপ ও মোবাইল — উভয় ডিভাইসেই** সঠিকভাবে কাজ করতে হবে।

### Compact One-Column Mobile Layout (All Pages)

This rule is binding for **all existing and new pages**:

1. Below Tailwind `sm` (640px), keep the combined outer page gutter to **8px**. Do not stack large page-root padding on top of the shared layout gutter.
2. Stack page sections, form field groups, and grouped action buttons in **one column**. Grouped action buttons should be full-width; controls must retain a minimum 44x44px touch target.
3. Forms and their field grids use one column on mobile; they may expand at `sm` or wider.
4. Data tables are the exception to one-column section layout: keep using the responsive table patterns below (card view, contained horizontal scrolling, or collapsible rows). A table's horizontal scrolling must not create document-level horizontal overflow.
5. Apply this standard when changing legacy pages; do not add blanket CSS that forces every nested flex/grid control into a column, because that breaks table cells and compact inline controls.

### Rules

1. **Mobile-First Approach** — প্রথমে মোবাইল স্ক্রিনের জন্য ডিজাইন করুন, তারপর বড় স্ক্রিনের জন্য expand করুন
2. **Breakpoints** — Tailwind CSS breakpoints ব্যবহার করুন (sm, md, lg, xl, 2xl)
3. **No Horizontal Scroll** — মোবাইল ডিভাইসে কোনো পেজে horizontal scrollbar আসা যাবে না
4. **Responsive Tables** — ডেটা টেবিল মোবাইলে responsive হতে হবে (card view, horizontal scroll, বা collapsible row)
5. **Touch-Friendly** — বাটন, লিংক, ফর্ম ফিল্ড — সবকিছু至少要 44x44px touch target size maintain করতে হবে
6. **Forms** — মোবাইলে ফর্ম ফিল্ড full-width হবে, labels properly aligned থাকবে
7. **Sidebar/Navigation** — মোবাইলে sidebar auto-collapse হবে (hamburger menu)
8. **Modals & Drawers** — মোবাইলে modal full-screen বা bottom sheet আকারে দেখাতে হবে
9. **Font & Spacing** — ছোট স্ক্রিনে font-size ও spacing কমাতে হবে, কিন্তু readability বজায় রাখতে হবে

### Testing

প্রতিটি মডিউল ডেলিভারির আগে নিম্নলিখিত ব্রেকপয়েন্টে টেস্ট করতে হবে:

- **Mobile:** 375px (iPhone SE) — সবচেয়ে ছোট স্ক্রিন
- **Mobile:** 414px (iPhone Plus/Pro Max)
- **Tablet:** 768px (iPad)
- **Desktop:** 1280px+
- **Large Screen:** 1536px+

### Checklist

প্রতিটি নতুন মডিউলের জন্য:
- [ ] Mobile (375px) এ সব কনটেন্ট visible এবং readable
- [ ] Tablet (768px) এ লেআউট ঠিক আছে
- [ ] Desktop (1280px+) এ পূর্ণ লেআউট কাজ করছে
- [ ] Horizontal scroll নেই
- [ ] Touch target size (44x44px) maintain করা হয়েছে
- [ ] Navigation / sidebar মোবাইলে ঠিকমতো কাজ করছে
