import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { getSelectableOrgUnits } from "@/lib/org/org-service";
import { RoomForm } from "../../_components/room-form";
import { DeleteRoomButton } from "../../_components/delete-button";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ve?: string }>;
}

export const dynamic = "force-dynamic";

/** Chỉ nhận đường về trang sửa cơ sở (server kiểm lại lần nữa khi lưu). */
function quayVeHopLe(v: string | undefined): string | undefined {
  return v && /^\/centers\/[A-Za-z0-9_-]+\/edit$/.test(v) ? v : undefined;
}

export default async function EditRoomPage({ params, searchParams }: Props) {
  const { id } = await params;
  const quayVe = quayVeHopLe((await searchParams).ve);

  const session = await auth();
  if (!session?.user) redirect("/login");
  const actor = await resolveActor(session.user.id);

  // Room = vị trí vật lý → chỉ chọn CENTER, loại HO (Hội sở không có phòng học).
  // Cách ly cơ sở (A0-04): Room ∈ SCOPED_MODELS — sdb.findUnique null-filter phòng
  // ngoài tầm nhìn cơ sở (chống IDOR) → notFound.
  const sdb = scopedDb(actor);
  const [room, orgUnits] = await Promise.all([
    sdb.room.findUnique({ where: { id } }),
    getSelectableOrgUnits(actor, { types: ["CENTER"] }),
  ]);

  if (!room) notFound();

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Link
            href={quayVe ?? "/rooms"}
            className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" /> {quayVe ? "Quay lại cơ sở" : "Quay lại danh sách"}
          </Link>
          <h1 className="text-3xl font-black text-foreground">
            Sửa phòng:{" "}
            <span className="font-mono text-primary">{room.code}</span>{" "}
            <span className="font-bold text-foreground">— {room.name}</span>
          </h1>
        </div>
        <DeleteRoomButton id={room.id} name={`${room.code} — ${room.name}`} />
      </div>

      <RoomForm
        room={{
          id: room.id,
          name: room.name,
          code: room.code,
          orgUnitId: room.orgUnitId,
          capacity: room.capacity,
          equipment: room.equipment,
          status: room.status,
          notes: room.notes,
          displayOrder: room.displayOrder,
        }}
        orgUnits={orgUnits.map((o) => ({ id: o.orgUnitId, name: o.name }))}
        quayVe={quayVe}
      />
    </div>
  );
}
