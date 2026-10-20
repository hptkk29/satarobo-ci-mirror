"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { LeadStatus } from "@prisma/client";
import { toast } from "sonner";
import {
  KANBAN_COLUMNS,
  LEAD_DROP_STATUSES,
  LEAD_STATUS_LABEL,
  LEAD_STATUS_ACCENT,
} from "@/lib/leads/status";
import { Badge } from "@/components/ui/badge";
import { updateLeadStatus, autoAssignLeadAction } from "../actions";
import { LyDoRotDialog } from "./ly-do-rot-dialog";
import { ChonSoDong } from "@/components/ui/chon-so-dong";
import { MUC_THE_MOI_COT, SO_THE_MOI_COT_MAC_DINH } from "@/lib/ui/phan-trang";
import { formatPhoneVN, telHrefVN } from "@/lib/phone";

export type KanbanLead = {
  id: string;
  parentName: string;
  phone: string;
  childName: string | null;
  status: LeadStatus;
  source: string | null;
  courseName: string | null;
  assignedToName: string | null;
  createdAt: string; // ISO
  overdue: boolean; // T1.2 — quá hạn follow-up (tạm false cho tới khi có LeadTask)
  lastTrialDate: string | null; // FL-R2 (item 6) — lần học thử gần nhất (ISO) hoặc null
  isSharedWithTeam: boolean; // SHARE T1 — lead bật "dùng chung" cho team
  assignedToId: string | null;
};

/** SHARE T1 — chip "Dùng chung": outline = lead người khác chia sẻ cho mình;
 *  secondary = lead mình đang chia sẻ cho team. */
function SharedBadge({
  lead,
  currentUserId,
}: {
  lead: KanbanLead;
  currentUserId: string;
}) {
  if (!lead.isSharedWithTeam) return null;
  if (lead.assignedToId === currentUserId) {
    return (
      <Badge variant="secondary" title="Bạn đang chia sẻ lead này">
        Dùng chung
      </Badge>
    );
  }
  return <Badge variant="outline">Dùng chung</Badge>;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
  });
}

export function LeadsKanban({
  leads,
  canUpdate,
  canCloseDeal = false,
  canAssign = false,
  currentUserId,
  soTheMoiCot = SO_THE_MOI_COT_MAC_DINH,
}: {
  leads: KanbanLead[];
  canUpdate: boolean;
  canCloseDeal?: boolean;
  canAssign?: boolean;
  currentUserId: string;
  /**
   * Số thẻ hiển thị tối đa MỖI CỘT. Cắt ở tầng HIỂN THỊ, không phải ở truy vấn:
   * con số trên phù hiệu mỗi cột vẫn là TỔNG THẬT của cột đó, nếu không thì người
   * dùng đọc "12" rồi đếm được 5 thẻ và không biết mình đang thiếu gì.
   */
  soTheMoiCot?: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [items, setItems] = useState<KanbanLead[]>(leads);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<LeadStatus | null>(null);

  // FL2-02 — đồng bộ lại khi server trả data mới (router.refresh / revalidate) → UI tự
  // cập nhật, không phải F5 tay. (useState chỉ init 1 lần nên cần sync prop→state.)
  useEffect(() => {
    setItems(leads);
  }, [leads]);

  /** FL2-01 — thả vào cột "Đã đăng ký" = chốt deal → ĐIỀU HƯỚNG vào trang chi tiết lead
   *  (convert v2 đa con + học phí 1/2 đợt), KHÔNG mở popup close-deal cũ.
   *
   *  GĐ5 — trước đây bàn cờ có HAI cột cuối: thả vào REGISTERED chỉ đổi trạng thái, thả
   *  vào ENROLLED mới điều hướng. Enum mới gộp chúng thành DA_DANG_KY nên chỉ còn MỘT
   *  cột, và cột đó mang nghĩa "chốt". Hệ quả cần biết: người CÓ quyền chốt deal không
   *  còn đường kéo-thả để chỉ ghi nhận "đã đăng ký" — họ đi qua màn chuyển đổi, nơi có
   *  cổng kiểm tiền. Người KHÔNG có quyền chốt vẫn kéo đổi trạng thái như cũ. */
  function requestMove(leadId: string, to: LeadStatus) {
    if (to === "DA_DANG_KY" && canCloseDeal) {
      router.push(`/leads/${leadId}`);
      return;
    }
    move(leadId, to);
  }

  function quickAssign(leadId: string) {
    startTransition(async () => {
      const res = await autoAssignLeadAction(leadId);
      if (res.ok) {
        toast.success("Đã phân công lead (round-robin)");
        router.refresh();
      } else {
        toast.error(res.error ?? "Không phân công được");
      }
    });
  }

  /** Bậc rơi đang chờ người dùng ghi lý do. `null` = không có gì đang chờ. */
  const [choLyDo, setChoLyDo] = useState<{ leadId: string; to: LeadStatus } | null>(
    null,
  );

  function move(leadId: string, to: LeadStatus) {
    const lead = items.find((l) => l.id === leadId);
    if (!lead || lead.status === to) return;

    // Bậc rơi phải có lý do. Hỏi TRƯỚC khi cập nhật lạc quan — đổi màu thẻ rồi mới
    // hỏi thì người bấm Huỷ thấy thẻ đã nằm ở cột mới trong khi DB không đổi gì.
    if (LEAD_DROP_STATUSES.includes(to)) {
      setChoLyDo({ leadId, to });
      return;
    }
    ganhKetQua(leadId, to);
  }

  /** Phần ghi thật — dùng chung cho đường thường và đường qua hộp thoại lý do. */
  function ganhKetQua(leadId: string, to: LeadStatus, lyDo?: string) {
    // Optimistic update
    const prev = items;
    setItems((cur) =>
      cur.map((l) => (l.id === leadId ? { ...l, status: to } : l)),
    );

    startTransition(async () => {
      const res = await updateLeadStatus(leadId, to, lyDo);
      if (!res.ok) {
        setItems(prev); // rollback
        toast.error(res.error ?? "Không đổi được trạng thái");
      } else {
        setChoLyDo(null);
        toast.success(`Đã chuyển sang "${LEAD_STATUS_LABEL[to]}"`);
        router.refresh();
      }
    });
  }

  const byStatus = (s: LeadStatus) => items.filter((l) => l.status === s);

  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0">
      <LyDoRotDialog
        status={choLyDo?.to ?? null}
        tenLead={items.find((l) => l.id === choLyDo?.leadId)?.parentName ?? null}
        dangGui={isPending}
        onHuy={() => setChoLyDo(null)}
        onXacNhan={(lyDo) => choLyDo && ganhKetQua(choLyDo.leadId, choLyDo.to, lyDo)}
      />
      <div className="flex min-w-max gap-3">
        {KANBAN_COLUMNS.map((col) => {
          const colLeads = byStatus(col);
          const hienThi = colLeads.slice(0, soTheMoiCot);
          const conLai = colLeads.length - hienThi.length;
          return (
            <div
              key={col}
              className={`flex w-72 flex-shrink-0 flex-col rounded-xl bg-muted ${overCol === col ? "ring-2 ring-primary" : ""}`}
              onDragOver={(e) => {
                if (!canUpdate || !dragId) return;
                e.preventDefault();
                setOverCol(col);
              }}
              onDragLeave={() => setOverCol((c) => (c === col ? null : c))}
              onDrop={(e) => {
                e.preventDefault();
                setOverCol(null);
                if (canUpdate && dragId) requestMove(dragId, col);
                setDragId(null);
              }}
            >
              <div
                className={`sticky top-0 flex items-center justify-between rounded-t-xl border-t-4 bg-card px-3 py-2 ${LEAD_STATUS_ACCENT[col]}`}
              >
                <span className="text-sm font-bold text-foreground">
                  {LEAD_STATUS_LABEL[col]}
                </span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                  {colLeads.length}
                </span>
              </div>

              <div className="flex-1 space-y-2 p-2">
                {colLeads.length === 0 && (
                  <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                    Trống
                  </p>
                )}
                {hienThi.map((lead) => (
                  <div
                    key={lead.id}
                    draggable={canUpdate}
                    onDragStart={() => setDragId(lead.id)}
                    onDragEnd={() => {
                      setDragId(null);
                      setOverCol(null);
                    }}
                    className={`rounded-lg border border-border bg-card p-3 shadow-sm transition ${canUpdate ? "cursor-grab active:cursor-grabbing" : ""} ${dragId === lead.id ? "opacity-50" : ""} ${lead.overdue ? "border-l-4 border-l-state-danger" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <Link
                        href={`/leads/${lead.id}`}
                        className="font-semibold text-foreground hover:text-primary hover:underline"
                      >
                        {lead.parentName}
                      </Link>
                      <div className="flex flex-shrink-0 items-center gap-1">
                        <SharedBadge
                          lead={lead}
                          currentUserId={currentUserId}
                        />
                        {lead.overdue && (
                          <span className="rounded bg-state-danger-soft px-1.5 py-0.5 text-[10px] font-bold text-state-danger-ink">
                            Quá hạn
                          </span>
                        )}
                      </div>
                    </div>
                    <a
                      href={telHrefVN(lead.phone)}
                      className="text-sm font-medium text-primary"
                    >
                      {formatPhoneVN(lead.phone)}
                    </a>
                    <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                      {lead.courseName && <div>Khoá: {lead.courseName}</div>}
                      {lead.source && <div>Nguồn: {lead.source}</div>}
                      <div className="flex flex-wrap items-center gap-1">
                        <span
                          className={
                            lead.assignedToName
                              ? ""
                              : "font-medium text-state-warning-ink"
                          }
                        >
                          Sale: {lead.assignedToName ?? "Chưa phân công"}
                        </span>
                        {!lead.assignedToName && canAssign && (
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() => quickAssign(lead.id)}
                            className="rounded bg-state-warning-soft px-1.5 py-0.5 text-[10px] font-semibold text-state-warning-ink hover:bg-state-warning-soft-hover disabled:opacity-50"
                          >
                            Phân công
                          </button>
                        )}
                        <span>· {fmtDate(lead.createdAt)}</span>
                      </div>
                      {lead.lastTrialDate && (
                        <div className="font-medium text-primary">
                          Đã học thử · {fmtDate(lead.lastTrialDate)}
                        </div>
                      )}
                    </div>

                    {/* Hiện cho MỌI trạng thái (kể cả đã ghi danh) và mọi role xem được lead. */}
                    <Link
                      href={`/leads/${lead.id}`}
                      className="mt-2 block w-full rounded-md bg-primary-soft px-2 py-1 text-center text-xs font-semibold text-primary hover:bg-primary-soft-hover"
                    >
                      Xem chi tiết lead
                    </Link>

                    {/* Mobile / fallback: đổi status qua select (native DnD không
                        chạy tốt trên touch). */}
                    {canUpdate && (
                      <select
                        value={lead.status}
                        disabled={isPending}
                        onChange={(e) =>
                          requestMove(lead.id, e.target.value as LeadStatus)
                        }
                        className="mt-2 w-full rounded border border-border bg-muted px-1.5 py-1 text-xs text-foreground sm:hidden"
                        aria-label="Đổi trạng thái"
                      >
                        {KANBAN_COLUMNS.map((s) => (
                          <option key={s} value={s}>
                            {LEAD_STATUS_LABEL[s]}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                ))}
                {conLai > 0 && (
                  // Nói thẳng còn bao nhiêu thẻ chưa hiện. Không có dòng này thì phù hiệu
                  // đếm 37 mà cột chỉ có 5 thẻ, và người dùng tưởng dữ liệu bị mất.
                  <p className="px-2 py-2 text-center text-xs text-muted-foreground">
                    còn {conLai} thẻ nữa — tăng &quot;Mỗi cột&quot; ở dưới để xem thêm
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Ô chọn số thẻ mỗi cột — ĐẶT DƯỚI CÙNG (chủ dự án chốt), giống chỗ đứng của thanh
          phân trang ở chế độ Bảng: người dùng cuộn hết cột rồi mới nảy ra nhu cầu xem
          thêm, lúc đó nút nằm ngay dưới tay.
          Dùng CHUNG tham số `?size=` với bảng — bốn mức 10/20/50/100 giữ nguyên khi bấm
          qua lại. Mức 5 chỉ Kanban có (xem `MUC_THE_MOI_COT`).
          ⚠️ `sticky left-0` là bắt buộc: khối cha cuộn NGANG (10 cột), không ghim thì
          ở cột thứ 7 ô chọn nằm ngoài màn hình và không ai tìm ra nó. */}
      <div className="sticky left-0 mt-3 flex justify-end">
        <ChonSoDong
          soDong={soTheMoiCot}
          macDinh={SO_THE_MOI_COT_MAC_DINH}
          muc={MUC_THE_MOI_COT}
          nhan="Mỗi cột"
          tenDonVi="thẻ"
        />
      </div>
    </div>
  );
}
