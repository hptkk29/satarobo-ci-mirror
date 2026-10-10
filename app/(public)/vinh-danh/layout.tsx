import { notFound } from "next/navigation";

// Temporarily hide the /vinh-danh section from the public site.
// This layout 404s every nested route (/vinh-danh, /vinh-danh/[slug],
// /vinh-danh/tat-ca, /vinh-danh/[slug]/og). Re-enable by deleting this file
// and re-uncommenting the "Vinh danh" entry in components/public/header.tsx.
// Admin /admin/honors is untouched — data is still manageable.
export default function VinhDanhHiddenLayout() {
  notFound();
}
