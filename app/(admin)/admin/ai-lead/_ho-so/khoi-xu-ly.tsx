"use client";

// Khối «Xử lý» của màn chi tiết hồ sơ chờ AI: nhận · bổ sung · duyệt · từ chối · chuyển · trả · báo đã nhận trong Page Inbox.
//
// Nguyên tắc (luật 12): nút nào sáng/tối, và LÝ DO tối, đến từ `bang` (hàm thuần `bangNut`) — component này KHÔNG tự suy điều kiện. Lý do tối hiện ngay cạnh nút (điện thoại không có hover).
// Server Action là cổng thật; ở đây chỉ bắt lỗi trả về và nói bằng tiếng người: mọi lỗi hiện CẢ trong khung (role="alert", đọc được bằng trình đọc màn hình) lẫn toast.
// Sau thành công `router.refresh()` để version mới về — KHÔNG giữ version cục bộ (giữ là tự tạo ra bản cũ).
// Không dùng useEffect. Hộp thoại chỉ cho việc cần chặn tiêu điểm (từ chối kèm lý do, chuyển người, xác nhận tạo lead / báo đã nhận); sửa thông tin nằm ngay trong khối.
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Loader2, UserCheck, XCircle, ArrowRightLeft, Undo2, MessagesSquare } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { BangNut, TrangThaiNut } from "@/lib/ai-lead/dich-vu/hanh-dong-kha-dung";
import {
  baoDaNhanAction,
  boSungAction,
  chuyenNguoiAction,
  duyetAction,
  nhanXuLyAction,
  traHoSoAction,
  tuChoiAction,
} from "../_actions";

type LoiHienThi = { message: string; field?: string };
type KetQuaAction = { ok: true; data?: unknown } | { ok: false; error: { code: string; message: string; field?: string } };

const NUT = "inline-flex h-11 min-w-0 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:h-10";
const NUT_CHINH = `${NUT} bg-primary text-primary-foreground hover:bg-primary/90`;
const NUT_PHU = `${NUT} border border-border bg-background text-foreground hover:bg-muted`;
const NUT_NGUY = `${NUT} border border-[color:var(--state-danger)] bg-background text-state-danger-ink hover:bg-[color:var(--state-danger-soft)]`;
const O_NHAP = "h-11 w-full min-w-0 overflow-hidden rounded-lg border border-border bg-background px-3 text-base text-foreground sm:text-sm outline-none transition-colors focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-60 sm:h-10";

const KHUNG_HOP = "admin-scope max-h-[calc(100dvh-2rem)] overflow-y-auto";

/**
 * Hộp xác nhận một bước. Thay `ConfirmDialog` dùng chung: Dialog render qua PORTAL nên nằm NGOÀI `.admin-scope`, `bg-primary` rơi về CAM `:root`
 * (nút «Duyệt, tạo lead» cam + chữ trắng ≈ 2,9:1, đo ở trình duyệt thật). `admin-scope` trên DialogContent trả đúng tím admin; nút cao 44px ở điện thoại.
 */
function HopXacNhan({ mo, datMo, tieuDe, moTa, nhanXacNhan, pending, onXacNhan }: { mo: boolean; datMo: (m: boolean) => void; tieuDe: string; moTa: string; nhanXacNhan: string; pending: boolean; onXacNhan: () => void }) {
  return (
    <Dialog open={mo} onOpenChange={(m) => !pending && datMo(m)}>
      <DialogContent showCloseButton={false} className={KHUNG_HOP}>
        <DialogHeader>
          <DialogTitle>{tieuDe}</DialogTitle>
          <DialogDescription>{moTa}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <button type="button" className={NUT_PHU} onClick={() => datMo(false)} disabled={pending}>Huỷ</button>
          <button type="button" className={NUT_CHINH} onClick={onXacNhan} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null} {nhanXacNhan}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type DauVaoKhoiXuLy = {
  draftId: string;
  version: number;
  bang: BangNut;
  /** Giá trị ban đầu của ô sửa. Thiếu quyền xem PII ⇒ CHUỖI RỖNG (server không đưa giá trị thật xuống trình duyệt); ô hiện giá trị đã che làm gợi ý. */
  ban: { fbName: string; phone: string; goiYFbName: string; goiYPhone: string };
  coSoCoThe: { id: string; ten: string }[];
  coSoHienTai: string | null;
  ungVien: { id: string; ten: string }[];
};

function NutCoLyDo({ n, children, onClick, kieu = NUT_PHU, pending, ghiChu, idGhiChu }: { n: TrangThaiNut; children: React.ReactNode; onClick: () => void; kieu?: string; pending: boolean; ghiChu: string | null; idGhiChu: string }) {
  const id = useId();
  if (!n.hien) return null;
  // Lý do khoá TRÙNG chữ với ghi chú chung của khối (vd «Đang do X xử lý.») thì không in lại dưới từng nút (đo: 5 lần trên một màn) — nút vẫn trỏ aria-describedby vào ghi chú.
  const chung = n.lyDoKhoa !== null && n.lyDoKhoa === ghiChu;
  return (
    <div className="min-w-0">
      <button type="button" className={`${kieu} w-full sm:w-auto`} onClick={onClick} disabled={!n.bat || pending} aria-describedby={chung ? idGhiChu : n.lyDoKhoa ? id : undefined}>
        {children}
      </button>
      {n.lyDoKhoa && !chung && (
        <p id={id} className="mt-1 text-xs text-muted-foreground">
          {n.lyDoKhoa}
        </p>
      )}
    </div>
  );
}

export function KhoiXuLy(p: DauVaoKhoiXuLy) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [loi, setLoi] = useState<LoiHienThi | null>(null);
  const [hop, setHop] = useState<null | "duyet" | "tuChoi" | "chuyen" | "baoNhan">(null);
  const [lyDo, setLyDo] = useState("");
  const [nguoiNhan, setNguoiNhan] = useState("");
  const [tenFb, setTenFb] = useState(p.ban.fbName);
  const [sdt, setSdt] = useState(p.ban.phone);
  const [coSo, setCoSo] = useState("");
  const [daDoiChieu, setDaDoiChieu] = useState(false);
  const idFb = useId();
  const idSdt = useId();
  const idCs = useId();
  const idLoi = useId();
  const idGhiChu = useId();

  function chay(viec: () => Promise<KetQuaAction>, thanhCong: string, dong?: () => void) {
    setLoi(null);
    start(async () => {
      const kq = await viec();
      if (kq.ok) {
        toast.success(thanhCong);
        dong?.();
        router.refresh();
      } else {
        setLoi({ message: kq.error.message, field: kq.error.field });
        toast.error(kq.error.message);
        // Xung đột phiên bản / người khác đã nhận: tải lại để thấy bản mới, không để người dùng bấm lại trên dữ liệu cũ.
        if (kq.error.code === "XUNG_DOT_PHIEN_BAN" || kq.error.code === "DA_NGUOI_KHAC_NHAN") router.refresh();
        // Lỗi gắn với MỘT ô (lý do trống, SĐT sai…) thì giữ hộp thoại mở để người dùng sửa ngay; lỗi khác thì đóng — dữ liệu phía sau đã đổi.
        if (!kq.error.field) dong?.();
      }
    });
  }

  const co = { draftId: p.draftId, version: p.version };
  const guiBoSung = () => {
    const tenDoi = tenFb.trim() !== "" && (tenFb.trim() !== p.ban.fbName.trim() || daDoiChieu);
    const sdtDoi = sdt.trim() !== "" && sdt.trim() !== p.ban.phone.trim();
    chay(
      () =>
        boSungAction({
          ...co,
          ...(tenDoi ? { fbName: tenFb } : {}),
          ...(sdtDoi ? { phone: sdt } : {}),
          ...(coSo ? { campusCenterId: coSo } : {}),
        }),
      "Đã lưu bổ sung.",
      () => setDaDoiChieu(false),
    );
  };
  const coGiTrongForm = (tenFb.trim() !== "" && (tenFb.trim() !== p.ban.fbName.trim() || daDoiChieu)) || (sdt.trim() !== "" && sdt.trim() !== p.ban.phone.trim()) || coSo !== "";

  const b = p.bang;
  const khongNut = ![b.nhanXuLy, b.boSung, b.duyet, b.tuChoi, b.chuyenNguoi, b.traHoSo, b.baoDaNhan].some((n) => n.hien);

  return (
    <div className="space-y-4">
      {khongNut && b.ghiChu && <p id={idGhiChu} className="rounded-lg bg-muted px-3 py-2.5 text-sm text-muted-foreground">{b.ghiChu}</p>}
      {!khongNut && b.ghiChu && <p id={idGhiChu} className="text-sm text-muted-foreground">{b.ghiChu}</p>}

      {loi && (
        <p id={idLoi} role="alert" className="rounded-lg border border-[color:var(--state-danger)] bg-[color:var(--state-danger-soft)] px-3 py-2.5 text-sm text-state-danger-ink">
          {loi.message}
        </p>
      )}

      {(b.nhanXuLy.hien || b.duyet.hien || b.tuChoi.hien) && (
        <div className="flex flex-wrap items-start gap-3 max-sm:flex-col max-sm:items-stretch">
          <NutCoLyDo ghiChu={b.ghiChu} idGhiChu={idGhiChu} n={b.nhanXuLy} pending={pending} onClick={() => chay(() => nhanXuLyAction(co), "Đã nhận xử lý hồ sơ.")}>
            <UserCheck aria-hidden /> Nhận xử lý
          </NutCoLyDo>
          <NutCoLyDo ghiChu={b.ghiChu} idGhiChu={idGhiChu} n={b.duyet} pending={pending} kieu={NUT_CHINH} onClick={() => setHop("duyet")}>
            {pending && hop === "duyet" ? <Loader2 className="animate-spin" aria-hidden /> : <CheckCircle2 aria-hidden />} Duyệt, tạo lead
          </NutCoLyDo>
          <NutCoLyDo ghiChu={b.ghiChu} idGhiChu={idGhiChu} n={b.tuChoi} pending={pending} kieu={NUT_NGUY} onClick={() => setHop("tuChoi")}>
            <XCircle aria-hidden /> Từ chối
          </NutCoLyDo>
        </div>
      )}

      {b.boSung.hien && (
        <fieldset disabled={!b.boSung.bat || pending} aria-describedby={b.boSung.lyDoKhoa && b.boSung.lyDoKhoa === b.ghiChu ? idGhiChu : undefined} className="min-w-0 space-y-3 rounded-xl border border-border p-3 sm:p-4">
          <legend className="px-1 text-sm font-semibold text-foreground">Bổ sung / xác minh</legend>
          {b.boSung.lyDoKhoa && b.boSung.lyDoKhoa !== b.ghiChu && <p className="text-xs text-muted-foreground">{b.boSung.lyDoKhoa}</p>}
          <div>
            <label htmlFor={idFb} className="mb-1 block text-xs font-medium text-muted-foreground">Tên Facebook của khách</label>
            <input id={idFb} className={O_NHAP} value={tenFb} onChange={(e) => setTenFb(e.target.value)} maxLength={120} autoComplete="off" placeholder={p.ban.fbName ? undefined : p.ban.goiYFbName || "Nhập đúng tên đang hiện trong Page Inbox"} aria-invalid={loi?.field === "fbName"} aria-describedby={loi?.field === "fbName" ? idLoi : undefined} />
            <label className="mt-2 flex min-h-11 cursor-pointer items-start gap-2 text-sm text-foreground sm:min-h-0">
              <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-[color:var(--primary)]" checked={daDoiChieu} onChange={(e) => setDaDoiChieu(e.target.checked)} />
              <span>Tôi đã đối chiếu tên này với hội thoại trong Page Inbox (đánh dấu «nhân viên đã xác minh»).</span>
            </label>
          </div>
          <div>
            <label htmlFor={idSdt} className="mb-1 block text-xs font-medium text-muted-foreground">Số điện thoại</label>
            <input id={idSdt} className={O_NHAP} value={sdt} onChange={(e) => setSdt(e.target.value)} inputMode="tel" maxLength={40} autoComplete="off" placeholder={p.ban.phone ? undefined : p.ban.goiYPhone || "09xx xxx xxx"} aria-invalid={loi?.field === "phone"} aria-describedby={loi?.field === "phone" ? idLoi : undefined} />
            {!p.ban.phone && p.ban.goiYPhone && <p className="mt-1 text-xs text-muted-foreground">Bạn không có quyền xem số đầy đủ. Chỉ nhập khi muốn thay bằng số khác.</p>}
          </div>
          <div>
            <label htmlFor={idCs} className="mb-1 block text-xs font-medium text-muted-foreground">Cơ sở</label>
            <select id={idCs} className={O_NHAP} value={coSo} onChange={(e) => setCoSo(e.target.value)} aria-invalid={loi?.field === "campusCenterId"}>
              <option value="">{p.coSoHienTai ? `Giữ nguyên: ${p.coSoHienTai}` : "Chưa chọn cơ sở"}</option>
              {p.coSoCoThe.map((c) => (
                <option key={c.id} value={c.id}>{c.ten}</option>
              ))}
            </select>
            {p.coSoCoThe.length === 0 && <p className="mt-1 text-xs text-muted-foreground">Page này chưa có cơ sở nào trong phạm vi của bạn nhận khách.</p>}
          </div>
          <button type="button" className={`${NUT_PHU} w-full sm:w-auto`} disabled={!coGiTrongForm || pending} onClick={guiBoSung}>
            {pending && hop === null ? <Loader2 className="animate-spin" aria-hidden /> : null} Lưu bổ sung
          </button>
        </fieldset>
      )}

      {(b.chuyenNguoi.hien || b.traHoSo.hien || b.baoDaNhan.hien) && (
        <div className="flex flex-wrap items-start gap-3 border-t border-border pt-4 max-sm:flex-col max-sm:items-stretch">
          <NutCoLyDo ghiChu={b.ghiChu} idGhiChu={idGhiChu} n={b.chuyenNguoi} pending={pending} onClick={() => setHop("chuyen")}>
            <ArrowRightLeft aria-hidden /> Chuyển người khác
          </NutCoLyDo>
          <NutCoLyDo ghiChu={b.ghiChu} idGhiChu={idGhiChu} n={b.traHoSo} pending={pending} onClick={() => chay(() => traHoSoAction(co), "Đã trả hồ sơ về hàng chờ.")}>
            <Undo2 aria-hidden /> Trả về hàng chờ
          </NutCoLyDo>
          <NutCoLyDo ghiChu={b.ghiChu} idGhiChu={idGhiChu} n={b.baoDaNhan} pending={pending} onClick={() => setHop("baoNhan")}>
            <MessagesSquare aria-hidden /> Báo đã nhận trong Page Inbox
          </NutCoLyDo>
        </div>
      )}

      <HopXacNhan
        mo={hop === "duyet"}
        datMo={(m) => !m && setHop(null)}
        tieuDe="Duyệt hồ sơ và tạo lead?"
        moTa="Hệ thống kiểm tra lại tên Facebook, số điện thoại và cơ sở rồi tạo lead trong CRM. Lead được chia cho Sale theo luật chia hiện hành; số điện thoại trùng lead đang mở sẽ gộp vào lead đó."
        nhanXacNhan="Duyệt, tạo lead"
        pending={pending}
        onXacNhan={() => chay(() => duyetAction(co), "Đã duyệt hồ sơ.", () => setHop(null))}
      />
      <HopXacNhan
        mo={hop === "baoNhan"}
        datMo={(m) => !m && setHop(null)}
        tieuDe="Xác nhận bạn đã nhận cuộc trò chuyện?"
        moTa="Đây là lời xác nhận của nhân viên. Agent chỉ ngừng trả lời hẳn khi chính Agent báo lại đã mất quyền hội thoại (theo tham số «cần Agent xác nhận»); đến lúc đó trạng thái hội thoại ở đây là «Chờ xác nhận tiếp quản»."
        nhanXacNhan="Tôi đã nhận trong Page Inbox"
        pending={pending}
        onXacNhan={() => chay(() => baoDaNhanAction(co), "Đã ghi nhận bạn tiếp quản.", () => setHop(null))}
      />

      <Dialog open={hop === "tuChoi"} onOpenChange={(o) => !pending && !o && setHop(null)}>
        <DialogContent showCloseButton={false} className={KHUNG_HOP}>
          <DialogHeader>
            <DialogTitle>Từ chối hồ sơ</DialogTitle>
            <DialogDescription>Hồ sơ sẽ đóng và không tạo lead. Lý do được lưu vào nhật ký, bắt buộc.</DialogDescription>
          </DialogHeader>
          <div>
            <label htmlFor="ly-do-tu-choi" className="mb-1 block text-xs font-medium text-muted-foreground">Lý do (ít nhất 5 ký tự)</label>
            <textarea id="ly-do-tu-choi" className={`${O_NHAP} h-28 resize-y py-2`} value={lyDo} onChange={(e) => setLyDo(e.target.value)} maxLength={500} aria-invalid={loi?.field === "lyDo"} />
            <p className="mt-1 text-right text-xs text-muted-foreground">{lyDo.trim().length}/500</p>
          </div>
          {loi?.field === "lyDo" && <p role="alert" className="text-sm text-state-danger-ink">{loi.message}</p>}
          <DialogFooter>
            <button type="button" className={NUT_PHU} onClick={() => setHop(null)} disabled={pending}>Không từ chối</button>
            <button type="button" className={NUT_NGUY} disabled={pending || lyDo.trim().length < 5} onClick={() => chay(() => tuChoiAction({ ...co, lyDo }), "Đã từ chối hồ sơ.", () => { setHop(null); setLyDo(""); })}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : null} Từ chối hồ sơ
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={hop === "chuyen"} onOpenChange={(o) => !pending && !o && setHop(null)}>
        <DialogContent showCloseButton={false} className={KHUNG_HOP}>
          <DialogHeader>
            <DialogTitle>Chuyển hồ sơ cho người khác</DialogTitle>
            <DialogDescription>Người nhận phải có quyền xử lý hồ sơ của cơ sở này. Họ nhận một thông báo (không kèm tên hay số điện thoại khách).</DialogDescription>
          </DialogHeader>
          {p.ungVien.length === 0 ? (
            <p className="rounded-lg bg-muted px-3 py-2.5 text-sm text-muted-foreground">Cơ sở này chưa có người nào khác được cấp quyền xử lý hồ sơ AI.</p>
          ) : (
            <div>
              <label htmlFor="nguoi-nhan" className="mb-1 block text-xs font-medium text-muted-foreground">Người nhận</label>
              <select id="nguoi-nhan" className={O_NHAP} value={nguoiNhan} onChange={(e) => setNguoiNhan(e.target.value)}>
                <option value="">Chọn người nhận…</option>
                {p.ungVien.map((u) => (
                  <option key={u.id} value={u.id}>{u.ten}</option>
                ))}
              </select>
            </div>
          )}
          <DialogFooter>
            <button type="button" className={NUT_PHU} onClick={() => setHop(null)} disabled={pending}>Huỷ</button>
            <button type="button" className={NUT_CHINH} disabled={pending || !nguoiNhan} onClick={() => chay(() => chuyenNguoiAction({ ...co, nguoiNhanId: nguoiNhan }), "Đã chuyển hồ sơ.", () => setHop(null))}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : null} Chuyển
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
