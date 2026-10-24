import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getPortalContext } from "@/lib/portal/session";
import { isPortalV2Enabled } from "@/lib/flags";
import { getParentProfile } from "@/lib/portal/parent-profile";
import { HoSoPageV2 } from "@/components/portal/ho-so-page";
import { ProfileForm } from "./_components/profile-form";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Hồ sơ | Sata Robo",
  robots: { index: false },
};

export default async function HoSoPage() {
  const session = await auth();
  if (!session?.user || session.user.role !== "PARENT") redirect("/login");
  const ctx = await getPortalContext();

  // Portal v2 — trang Hồ sơ gia đình giống SataUI.
  if (isPortalV2Enabled()) {
    const profile = await getParentProfile(
      session.user.id,
      ctx?.activeStudent?.id ?? null,
    );
    return <HoSoPageV2 profile={profile} />;
  }

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold text-neutral-900">Hồ sơ phụ huynh</h1>

      {/* AUTH-SĐT P6 — truyền cả SĐT: sau P5 phần lớn phụ huynh KHÔNG có email,
          hiển thị mỗi ô Email rỗng thì màn hồ sơ không cho biết họ đăng nhập bằng gì. */}
      <ProfileForm
        email={session.user.email ?? ""}
        phone={session.user.phone ?? ""}
        initialName={session.user.name ?? ""}
      />

      {ctx && ctx.children.length > 0 && (
        <section className="rounded-xl border border-neutral-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-neutral-700">
            Học viên liên kết
          </h2>
          <ul className="space-y-2">
            {ctx.children.map((c) => (
              <li
                key={c.id}
                className="flex items-center gap-2 rounded-lg bg-neutral-50 px-3 py-2 text-sm"
              >
                <span className="font-medium text-neutral-800">{c.name}</span>
                {c.studentCode && (
                  <span className="text-xs text-neutral-600">
                    {c.studentCode}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
