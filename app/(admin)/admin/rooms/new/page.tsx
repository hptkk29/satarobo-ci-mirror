import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { resolveActor } from "@/lib/auth/actor";
import { getSelectableOrgUnits } from "@/lib/org/org-service";
import { RoomForm } from "../_components/room-form";

export const dynamic = "force-dynamic";

/** Chỉ nhận đường về trang sửa cơ sở (server kiểm lại lần nữa khi lưu). */
function quayVeHopLe(v: string | undefined): string | undefined {
  return v && /^\/centers\/[A-Za-z0-9_-]+\/edit$/.test(v) ? v : undefined;
}

export default async function NewRoomPage({
  searchParams,
}: {
  // 01/10/2026 — mở từ trang cơ sở: `centerId` chọn sẵn cơ sở, `ve` để lưu xong quay lại.
  searchParams: Promise<{ centerId?: string; ve?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // Room = vị trí vật lý → chỉ chọn CENTER, loại HO (Hội sở không có phòng học).
  const actor = await resolveActor(session.user.id);
  const orgUnits = await getSelectableOrgUnits(actor, { types: ["CENTER"] });
  const sp = await searchParams;
  const quayVe = quayVeHopLe(sp.ve);
  const donViMacDinh = sp.centerId
    ? orgUnits.find((o) => o.centerId === sp.centerId)?.orgUnitId
    : undefined;

  if (orgUnits.length === 0) {
    return (
      <div className="max-w-3xl">
        <Link
          href="/rooms"
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Quay lại danh sách
        </Link>
        <h1 className="mb-4 text-3xl font-black text-foreground">Thêm phòng học</h1>
        <div className="rounded-xl border-2 border-dashed border-primary bg-primary-soft p-8 text-center">
          <p className="font-semibold text-foreground">Chưa có cơ sở nào đang hoạt động.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Tạo ít nhất 1 cơ sở (Active) trước khi thêm phòng.
          </p>
          <Link
            href="/centers/new"
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-dark"
          >
            Thêm cơ sở →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Link
        href={quayVe ?? "/rooms"}
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> {quayVe ? "Quay lại cơ sở" : "Quay lại danh sách"}
      </Link>
      <h1 className="mb-6 text-3xl font-black text-foreground">Thêm phòng học</h1>
      <RoomForm
        orgUnits={orgUnits.map((o) => ({ id: o.orgUnitId, name: o.name }))}
        quayVe={quayVe}
        donViMacDinh={donViMacDinh}
      />
    </div>
  );
}
