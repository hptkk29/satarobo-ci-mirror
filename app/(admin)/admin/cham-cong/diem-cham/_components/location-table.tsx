"use client";

// Danh sách điểm chấm công, xếp theo CƠ SỞ. Cố ý KHÔNG dùng bảng: cả hệ thống chỉ có 2–3 điểm,
// mỗi điểm 8 thuộc tính — bảng 8 cột cho 2 dòng đọc khó hơn thẻ, và trên prod hiện chưa cơ sở nào
// khai nên thứ người dùng thấy đầu tiên là TRẠNG THÁI RỖNG. Nhóm theo cơ sở để cơ sở chưa khai
// vẫn có mặt và nói rõ hệ quả (màn hình QR chưa mở được).
//
// Điều dễ vỡ: nút "Mở màn hình QR" trỏ `/cham-cong/man-hinh?centerId=…` — đó là màn treo TV ở quầy,
// đừng đổi đường dẫn (mã QR in ra đọc theo URL của nó).
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MapPin, Monitor, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { SectionCard } from "@/components/admin/cham-cong/section-card";
import { BTN_OUTLINE, BTN_PRIMARY, PILL } from "@/components/admin/cham-cong/classes";
import {
  LocationSheet,
  emptyLocation,
  type LocationCenter,
  type LocationValue,
} from "./location-form";
import { QrIn } from "./qr-in";

export type LocationRow = LocationValue & { id: string; qrKeyVersion: number };

function CoordLine({ row }: { row: LocationRow }) {
  if (row.latitude == null || row.longitude == null) {
    return (
      <span className={cn(PILL, "bg-state-warning-soft text-state-warning-ink")}>
        Chưa toạ độ — đo thực địa rồi nhập
      </span>
    );
  }
  return (
    <span className="tabular-nums text-muted-foreground">
      {row.latitude}, {row.longitude}
    </span>
  );
}

export function LocationList({
  rows,
  centers,
  canConfig,
}: {
  rows: LocationRow[];
  centers: LocationCenter[];
  /** Thu hồi mã đã in là hành động một chiều với người đang đứng ở quầy — chỉ người cấu hình. */
  canConfig: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<LocationValue | null>(null);
  const [open, setOpen] = useState(false);

  function openSheet(value: LocationValue) {
    setEditing(value);
    setOpen(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">
          <b className="tabular-nums text-foreground">{rows.length}</b> điểm trên{" "}
          <b className="tabular-nums text-foreground">{centers.length}</b> cơ sở bạn quản lý
        </span>
        <button
          type="button"
          className={cn(BTN_PRIMARY, "ml-auto")}
          onClick={() => openSheet(emptyLocation(centers[0].id))}
        >
          <Plus className="h-4 w-4" aria-hidden /> Thêm điểm
        </button>
      </div>

      {centers.map((c) => {
        const list = rows.filter((r) => r.centerId === c.id);
        return (
          <SectionCard
            key={c.id}
            title={c.name}
            tone={list.length === 0 ? "warning" : "default"}
            actions={
              <>
                <Link
                  href={`/cham-cong/man-hinh?centerId=${c.id}`}
                  className={cn(BTN_OUTLINE, "h-8 px-3 text-xs")}
                >
                  <Monitor className="h-4 w-4" aria-hidden /> Mở màn hình QR
                </Link>
                <button
                  type="button"
                  className={cn(BTN_OUTLINE, "h-8 px-3 text-xs")}
                  onClick={() => openSheet(emptyLocation(c.id))}
                >
                  <Plus className="h-4 w-4" aria-hidden /> Thêm điểm
                </button>
              </>
            }
          >
            {list.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {c.name} chưa có điểm chấm công — màn hình QR chưa mở được và lượt quét ở đây sẽ mang
                cờ &ldquo;Chưa toạ độ&rdquo;. Thêm một điểm cho quầy lễ tân là xong.
              </p>
            ) : (
              <ul className="space-y-2">
                {list.map((r) => (
                  <li
                    key={r.id}
                    className={cn(
                      "flex flex-wrap items-start gap-3 rounded-xl border border-border bg-card p-3 transition-colors hover:bg-muted/50",
                      !r.isActive && "opacity-60",
                    )}
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-mono font-semibold text-foreground">{r.code}</span>
                        <span className="max-w-[18rem] truncate text-foreground" title={r.name}>
                          {r.name}
                        </span>
                        <span
                          className={cn(
                            PILL,
                            r.isActive
                              ? "bg-state-success-soft text-state-success-ink"
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          {r.isActive ? "Đang dùng" : "Đã ngưng"}
                        </span>
                      </p>
                      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                        <CoordLine row={r} />
                        <span className="tabular-nums text-muted-foreground">
                          Bán kính {r.radiusMeters} m
                        </span>
                        <span
                          className={cn(
                            PILL,
                            r.geofenceEnabled
                              ? "bg-state-info-soft text-state-info-ink"
                              : "bg-muted text-muted-foreground",
                          )}
                          title="Bật + đã khai toạ độ ⇒ quét ngoài phạm vi bị TỪ CHỐI (từ 07/09, đi cùng QR tĩnh)"
                        >
                          Định vị {r.geofenceEnabled ? "bật" : "tắt"}
                        </span>
                      </p>
                      <QrIn
                        workLocationId={r.id}
                        centerId={r.centerId}
                        tenDiem={r.name}
                        maCoSo={r.code}
                        qrKeyVersion={r.qrKeyVersion}
                        coToaDo={r.latitude != null && r.longitude != null}
                        canConfig={canConfig}
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {r.latitude != null && r.longitude != null && (
                        <a
                          href={`https://www.google.com/maps?q=${r.latitude},${r.longitude}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={cn(BTN_OUTLINE, "h-8 px-3 text-xs")}
                        >
                          <MapPin className="h-4 w-4" aria-hidden /> Mở bản đồ
                        </a>
                      )}
                      <button
                        type="button"
                        className={cn(BTN_OUTLINE, "h-8 px-3 text-xs")}
                        onClick={() => openSheet(r)}
                      >
                        Sửa
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        );
      })}

      <LocationSheet
        open={open}
        onOpenChange={setOpen}
        value={editing}
        centers={centers}
        onSaved={() => {
          setOpen(false);
          router.refresh();
        }}
      />
    </div>
  );
}
