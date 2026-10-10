"use client";

// Chọn phiếu lead để NỐI với học viên (25/09/2026, chủ dự án chốt D1 — nút "Gắn lead").
//
// Một bộ chọn, hai chỗ đặt:
//   · INLINE trong khung "Lead nguồn" khi học viên chưa nối — gợi ý + ô tìm nằm ngay đó,
//     không bắt mở hộp thoại cho việc chính của khung;
//   · trong HỘP THOẠI cho "Đổi lead" (đã nối, muốn đổi) và nút "Gắn lead" ở dải đầu trang
//     (trên điện thoại khung Lead nguồn nằm tít dưới form).
//
// Mọi dữ liệu phiếu ở đây ĐÃ được che theo quyền ở server (`lib/students/lead-nguon.ts`) —
// client không tự che, không bao giờ nhận bản thô.
//
// ⚠️ Chọn đứa trẻ: action KHÔNG tự chọn con khi phiếu chỉ có một con (học viên có thể là
// anh/chị/em chưa được khai vào phiếu). Ở đây chỉ CHỌN SẴN khi tên con trùng tên học viên —
// người dùng nhìn thấy và đổi được — còn lại để trống.

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Link2, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { StatusPill } from "@/components/admin/ui/status-pill";
import { ngayVN } from "@/lib/format/date";
import type { LeadGoiY } from "@/lib/students/lead-nguon-types";
import { cn } from "@/lib/utils";
import { ganLeadChoHocVien, timLeadDeGanAction } from "../../[id]/_lien-ket-lead-actions";
import { NUT_CHINH, NUT_VIEN, O_NHAP } from "./o-nhap";

const SO_KY_TU_TOI_THIEU = 3;

function chuanHoaTen(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Con trùng tên học viên (đúng MỘT con) ⇒ chọn sẵn; không thì để trống. */
function conChonSan(cacCon: LeadGoiY["cacCon"], tenHocVien: string): string {
  const ten = chuanHoaTen(tenHocVien);
  const khop = cacCon.filter((c) => chuanHoaTen(c.ten) === ten);
  return khop.length === 1 ? khop[0].id : "";
}

const NHAN_LY_DO: Record<LeadGoiY["lyDo"], string | null> = {
  VET_GHI_DANH: "Vết ghi danh",
  CUNG_SDT: "Cùng SĐT",
  TIM_KIEM: null,
};

function DongLead({
  lead,
  studentId,
  tenHocVien,
  dangNoi,
  conDangNoiId,
  onXong,
}: {
  lead: LeadGoiY;
  studentId: string;
  tenHocVien: string;
  dangNoi: boolean;
  /** Đứa trẻ đang nối (khi `dangNoi`) — ô chọn con BẮT ĐẦU ở đó. */
  conDangNoiId: string | null;
  onXong?: () => void;
}) {
  const router = useRouter();
  // Phiếu ĐANG NỐI ⇒ bắt đầu ở đúng đứa đang nối: action gửi `leadChildId` tường minh, nên
  // bắt đầu ở "không chọn" thì bấm "Cập nhật" mà không đụng ô là XOÁ đứa đang nối — mất
  // luôn tên con + lớp tại trung tâm ở khung Lead nguồn (lượt rà đối kháng 25/09).
  const [con, setCon] = useState(() =>
    dangNoi ? (conDangNoiId ?? "") : conChonSan(lead.cacCon, tenHocVien),
  );
  const [dangGan, startGan] = useTransition();
  const [loi, setLoi] = useState<string | null>(null);
  // useId: cùng một phiếu có thể hiện ở khung inline VÀ trong hộp thoại cùng lúc.
  const idCon = useId();
  const nhanLyDo = NHAN_LY_DO[lead.lyDo];

  function gan() {
    setLoi(null);
    startGan(async () => {
      try {
        const res = await ganLeadChoHocVien({
          studentId,
          leadId: lead.leadId,
          // Truyền TƯỜNG MINH (kể cả null): bỏ trống khoá là "giữ con cũ nếu cùng phiếu".
          leadChildId: con || null,
        });
        if (!res.ok) {
          setLoi(res.error);
          return;
        }
        toast.success(
          `Đã nối lead ${lead.tenPhuHuynh}` +
            (res.soODaDien > 0 ? ` · điền ${res.soODaDien} ô còn trống từ lead` : ""),
        );
        onXong?.();
        router.refresh();
      } catch {
        setLoi("Mất kết nối — chưa lưu được liên kết. Thử lại.");
      }
    });
  }

  return (
    <li className="space-y-2 py-3 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <p className="break-words text-sm font-semibold text-foreground">{lead.tenPhuHuynh}</p>
          <p className="text-xs tabular-nums text-muted-foreground">
            {lead.sdt ?? "Chưa có SĐT"} · nhận {ngayVN(lead.ngayNhanLead)}
          </p>
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <StatusPill tone="muted">{lead.trangThai}</StatusPill>
            {nhanLyDo && (
              <StatusPill tone={lead.lyDo === "VET_GHI_DANH" ? "info" : "warning"}>
                {nhanLyDo}
              </StatusPill>
            )}
            {dangNoi && <StatusPill tone="brand">Đang nối</StatusPill>}
            {(lead.salePhuTrach || lead.coSo) && (
              <span className="text-xs text-muted-foreground">
                {[lead.salePhuTrach && `Sale ${lead.salePhuTrach}`, lead.coSo]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={gan}
          disabled={dangGan}
          aria-label={
            dangNoi
              ? `Cập nhật con của lead ${lead.tenPhuHuynh}`
              : `Gắn lead ${lead.tenPhuHuynh}`
          }
          className={cn(dangNoi ? NUT_VIEN : NUT_CHINH, "px-3")}
        >
          {dangGan ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Link2 className="size-4" aria-hidden />}
          {dangNoi ? "Cập nhật" : "Gắn"}
        </button>
      </div>

      {lead.cacCon.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <label htmlFor={idCon} className="text-xs font-semibold text-muted-foreground">
            Con trong phiếu
          </label>
          <select
            id={idCon}
            value={con}
            onChange={(e) => setCon(e.target.value)}
            className={cn(O_NHAP, "h-10 w-auto min-w-[12rem] flex-1 sm:h-9")}
          >
            <option value="">— Không chọn con cụ thể —</option>
            {lead.cacCon.map((c) => (
              <option key={c.id} value={c.id}>
                {c.ten}
              </option>
            ))}
          </select>
        </div>
      )}

      {loi && (
        <p role="alert" className="text-xs text-state-danger-ink">
          {loi}
        </p>
      )}
    </li>
  );
}

export function BoChonLead({
  studentId,
  tenHocVien,
  goiY,
  leadDangNoiId = null,
  conDangNoiId = null,
  onXong,
  tuFocusTim = false,
}: {
  studentId: string;
  tenHocVien: string;
  goiY: LeadGoiY[];
  leadDangNoiId?: string | null;
  conDangNoiId?: string | null;
  onXong?: () => void;
  tuFocusTim?: boolean;
}) {
  const [q, setQ] = useState("");
  const [ketQua, setKetQua] = useState<LeadGoiY[] | null>(null);
  const [dangTim, setDangTim] = useState(false);
  const [loiTim, setLoiTim] = useState<string | null>(null);
  const luot = useRef(0);
  const henGio = useRef<number | null>(null);
  const idTim = useId();

  // Dọn hẹn giờ khi đóng hộp thoại giữa chừng — không để một lượt tìm trả về vào state chết.
  useEffect(
    () => () => {
      if (henGio.current) window.clearTimeout(henGio.current);
    },
    [],
  );

  /** Tìm có DEBOUNCE 300ms + bỏ kết quả của lượt cũ (gõ nhanh thì lượt trước về sau). */
  function doiTuKhoa(v: string) {
    setQ(v);
    if (henGio.current) window.clearTimeout(henGio.current);
    const t = v.trim();
    const id = ++luot.current;
    if (t.length < SO_KY_TU_TOI_THIEU) {
      setKetQua(null);
      setDangTim(false);
      setLoiTim(null);
      return;
    }
    setDangTim(true);
    henGio.current = window.setTimeout(async () => {
      let res: Awaited<ReturnType<typeof timLeadDeGanAction>>;
      try {
        res = await timLeadDeGanAction({ studentId, q: t });
      } catch {
        res = { ok: false, error: "Mất kết nối — không tìm được. Thử lại." };
      }
      if (id !== luot.current) return;
      setDangTim(false);
      if (res.ok) {
        setKetQua(res.items);
        setLoiTim(null);
      } else {
        setKetQua(null);
        setLoiTim(res.error);
      }
    }, 300);
  }

  const daGoiY = new Set(goiY.map((g) => g.leadId));
  const ketQuaMoi = (ketQua ?? []).filter((k) => !daGoiY.has(k.leadId));

  return (
    <div className="space-y-4">
      {goiY.length > 0 && (
        <section aria-labelledby={`${idTim}-goi-y`} className="space-y-2">
          <div>
            <h3 id={`${idTim}-goi-y`} className="text-xs font-semibold text-foreground">
              Gợi ý ({goiY.length})
            </h3>
            <p className="text-xs leading-relaxed text-muted-foreground">
              <b className="font-semibold">Vết ghi danh</b> = một ghi danh của em mang dấu phiếu
              này, gần như chắc chắn. <b className="font-semibold">Cùng SĐT</b> = chỉ trùng số
              phụ huynh — xem tên con trước khi gắn.
            </p>
          </div>
          <ul className="divide-y divide-border">
            {goiY.map((g) => (
              <DongLead
                key={g.leadId}
                lead={g}
                studentId={studentId}
                tenHocVien={tenHocVien}
                dangNoi={g.leadId === leadDangNoiId}
                conDangNoiId={conDangNoiId}
                onXong={onXong}
              />
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <label htmlFor={idTim} className="block text-xs font-semibold text-foreground">
          {goiY.length > 0 ? "Không có trong gợi ý? Tìm phiếu" : "Tìm phiếu lead"}
        </label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            id={idTim}
            type="search"
            value={q}
            onChange={(e) => doiTuKhoa(e.target.value)}
            placeholder="Tên phụ huynh hoặc SĐT"
            autoComplete="off"
            autoFocus={tuFocusTim}
            aria-describedby={`${idTim}-trang-thai`}
            className={cn(O_NHAP, "pl-9")}
          />
        </div>
        <p id={`${idTim}-trang-thai`} aria-live="polite" className="text-xs text-muted-foreground">
          {q.trim().length < SO_KY_TU_TOI_THIEU
            ? `Gõ ít nhất ${SO_KY_TU_TOI_THIEU} ký tự. Chỉ thấy phiếu trong phạm vi bạn được xem.`
            : dangTim
              ? "Đang tìm…"
              : loiTim
                ? ""
                : ketQua && ketQuaMoi.length === 0
                  ? `Không thấy phiếu nào khớp “${q.trim()}” trong phạm vi bạn được xem.`
                  : ketQuaMoi.length > 0
                    ? `${ketQuaMoi.length} phiếu khớp.`
                    : ""}
        </p>
        {loiTim && (
          <p role="alert" className="text-xs text-state-danger-ink">
            {loiTim}
          </p>
        )}
        {ketQuaMoi.length > 0 && (
          <ul className={cn("divide-y divide-border", dangTim && "opacity-60")}>
            {ketQuaMoi.map((k) => (
              <DongLead
                key={k.leadId}
                lead={k}
                studentId={studentId}
                tenHocVien={tenHocVien}
                dangNoi={k.leadId === leadDangNoiId}
                conDangNoiId={conDangNoiId}
                onXong={onXong}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Nút mở hộp thoại chọn lead — "Gắn lead" (chưa nối) hoặc "Đổi lead" (đã nối). */
export function NutMoChonLead({
  studentId,
  tenHocVien,
  goiY,
  leadDangNoiId = null,
  conDangNoiId = null,
  nhan,
  className,
}: {
  studentId: string;
  tenHocVien: string;
  goiY: LeadGoiY[];
  leadDangNoiId?: string | null;
  conDangNoiId?: string | null;
  nhan: string;
  className: string;
}) {
  const [mo, setMo] = useState(false);
  const doiLead = !!leadDangNoiId;
  return (
    <Dialog open={mo} onOpenChange={setMo}>
      <DialogTrigger render={<button type="button" className={className} />}>
        <Link2 className="size-4" aria-hidden />
        {nhan}
      </DialogTrigger>
      {/* Hộp thoại được portal ra `document.body` — NGOÀI `.admin-scope` của khung admin, nên
          `bg-primary` rơi về màu cam của :root và `hover:bg-primary-dark` không có biến nào
          (nút mất nền, chữ trắng biến mất khi rê chuột). Gắn lại scope ngay trên hộp thoại. */}
      <DialogContent className="admin-scope max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">
            {doiLead ? "Đổi lead nguồn" : "Gắn lead nguồn"}
          </DialogTitle>
          <DialogDescription>
            {doiLead
              ? `Nối ${tenHocVien} sang phiếu khác. Các ô đã điền trên hồ sơ giữ nguyên; chỉ ô còn trống mới lấy thêm từ phiếu mới.`
              : `Nối ${tenHocVien} với phiếu lead gia đình đã đăng ký. Ô còn trống trên hồ sơ sẽ lấy từ phiếu — ô đã có không bị ghi đè.`}
          </DialogDescription>
        </DialogHeader>
        <BoChonLead
          studentId={studentId}
          tenHocVien={tenHocVien}
          goiY={goiY}
          leadDangNoiId={leadDangNoiId}
          conDangNoiId={conDangNoiId}
          onXong={() => setMo(false)}
          tuFocusTim={goiY.length === 0}
        />
      </DialogContent>
    </Dialog>
  );
}
