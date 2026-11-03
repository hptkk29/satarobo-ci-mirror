import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { HonorsSettingsClient } from "@/components/admin/honors/settings-client";

export const metadata = { title: "Cài đặt Hall of Fame | Admin" };

const FIELDS = [
  {
    key: "hero-title",
    label: "Tiêu đề Hero",
    placeholder: "Vinh danh nhân sự xuất sắc",
    type: "text" as const,
  },
  {
    key: "hero-subtitle",
    label: "Phụ đề Hero",
    placeholder: "Tri ân từ Ban Giám đốc Sata Robo",
    type: "text" as const,
  },
  {
    key: "ceo-quote",
    label: "CEO Quote",
    placeholder: "Quote từ CEO...",
    type: "textarea" as const,
  },
  {
    key: "ceo-name",
    label: "Tên CEO",
    placeholder: "Hồ Đắc Phúc",
    type: "text" as const,
  },
  {
    key: "ceo-title",
    label: "Chức danh CEO",
    placeholder: "Tổng Giám đốc — Sata Robo",
    type: "text" as const,
  },
  {
    key: "ceo-avatar-url",
    label: "Avatar CEO",
    placeholder: "https://cdn.satarobo.vn/...",
    type: "avatar" as const,
  },
];

export default async function HonorsSettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!["SUPER_ADMIN", "CENTER_MANAGER"].includes(session.user.role)) {
    redirect("/dashboard");
  }

  // SitePageContent là model global (∉ SCOPED_MODELS) → sdb pass-through.
  const actor = await resolveActor(session.user.id);
  const settings = await scopedDb(actor).sitePageContent.findMany({
    where: { pageKey: "honors" },
  });

  const initialValues: Record<string, string> = {};
  for (const s of settings) {
    initialValues[s.contentKey] = s.contentValue;
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Cài đặt trang Vinh Danh</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Sửa Hero text, CEO Quote, avatar CEO. Thay đổi sẽ tự revalidate trang public.
        </p>
      </div>

      <HonorsSettingsClient fields={FIELDS} initialValues={initialValues} />
    </div>
  );
}
