"use client";

// components/admin/nguon-hoa-hong/affiliate/khoi-tai-khoan-truy-cap.tsx — KHỐI «TÀI KHOẢN TRUY CẬP CỔNG» của trang chi tiết đối tác (AFF-L3a): danh sách tài khoản User được vào cổng
// `/portal/gioi-thieu` thay mặt đối tác; liên kết tài khoản có sẵn · gỡ · đổi người đại diện · tạm ngừng / mở lại cổng.
//
// ── Nói thật (luật 12) ────────────────────────────────────────────────────────────────────────────────────────
//  · Mọi nút GHI chỉ vẽ khi `coTheGhi` (= `scope.has("affiliates:manage")`, ĐÚNG khoá mà các action ở `[id]/_actions.ts` kiểm ở đầu hàm). Người chỉ xem thấy danh sách, không thấy nút.
//  · Danh sách nút trên từng dòng lấy từ `thaoTacKhaDung` (tai-khoan-truy-cap-dau-vao.ts); thao tác chắc chắn bị từ chối hiện CÂU LÝ DO thay vì nút.
//  · Mỗi dòng nói THẬT tài khoản có vào được cổng không (`vaoDuocCong` / `lyDoKhongVao`): tài khoản chưa liên kết học viên nào thì liên kết xong vẫn chưa vào được cổng phụ huynh — màn không để quản trị viên tưởng ngược lại.
//  · Màn KHÔNG tạo tài khoản: ô tìm chỉ trả tài khoản phụ huynh có sẵn (tối thiểu 3 ký tự, tối đa 8 kết quả, SĐT/email đã che).
//  · Gỡ / tạm ngừng cần lý do ≥ 10 ký tự (cùng `LY_DO_TOI_THIEU_TRUY_CAP` mà hàm ghi kiểm); gỡ KHÔNG xoá đối tác, lead hay sổ.
//  · Khoá lạc quan: gửi `capNhatLuc` của dòng; «vừa được đổi» ⇒ banner + «Tải lại».
// Hàm gọi máy chủ được TIÊM (`hanhDong`) — test dựng bằng hàm giả.
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search, ShieldAlert, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { doiDaiDienAction, goLienKetAction, lienKetUserAction, moLaiCongAction, tamNgungCongAction, timUserAction } from "@/app/(admin)/admin/nguon-hoa-hong/affiliate/[id]/_actions";
import { StatusPill, type PillTone } from "@/components/admin/ui/status-pill";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { DongTruyCap, UserUngVien } from "@/lib/affiliate/tai-khoan-truy-cap";
import {
  LY_DO_TOI_THIEU_TRUY_CAP,
  DO_DAI_TIM_USER_TOI_THIEU,
  NHAN_TRANG_THAI_TRUY_CAP,
  NHAN_VAI_TRUY_CAP,
  VAI_TRUY_CAP,
  type KetQuaTruyCap,
  type ThaoTacTruyCap,
  type TrangThaiTruyCap,
  type VaiTruyCap,
} from "@/lib/affiliate/tai-khoan-truy-cap-dau-vao";
import { cn } from "@/lib/utils";
import { BTN_DANGER_OUTLINE, BTN_OUTLINE, BTN_PRIMARY, FIELD, LOI_O, NHAN_O, NUT_CHAN, NUT_NHO } from "../classes";
import { INK_THEO_TONE } from "../trang-thai-nguon-pill";
import { HopThoaiLyDo } from "../campaign/hop-thoai-ly-do";

export type KetQuaTim = { ok: true; ketQua: UserUngVien[] } | { ok: false; error: string };

export type HanhDongTruyCap = {
  tim: (i: { partyId: string; q: string }) => Promise<KetQuaTim>;
  lienKet: (i: { partyId: string; userId: string; vai: VaiTruyCap }) => Promise<KetQuaTruyCap<{ id: string }>>;
  go: (i: { id: string; updatedAtDaThay: string; lyDo: string | null }) => Promise<KetQuaTruyCap>;
  tamNgung: (i: { id: string; updatedAtDaThay: string; lyDo: string | null }) => Promise<KetQuaTruyCap>;
  moLai: (i: { id: string; updatedAtDaThay: string; lyDo: string | null }) => Promise<KetQuaTruyCap>;
  doiDaiDien: (i: { partyId: string; id: string; updatedAtDaThay: string }) => Promise<KetQuaTruyCap>;
};

const HANH_DONG_MAC_DINH: HanhDongTruyCap = {
  tim: (i) => timUserAction(i),
  lienKet: (i) => lienKetUserAction(i),
  go: (i) => goLienKetAction(i),
  tamNgung: (i) => tamNgungCongAction(i),
  moLai: (i) => moLaiCongAction(i),
  doiDaiDien: (i) => doiDaiDienAction(i),
};

const TONE_TRANG_THAI: Record<TrangThaiTruyCap, PillTone> = { ACTIVE: "success", SUSPENDED: "warning", REVOKED: "muted" };

function PillTrangThai({ trangThai }: { trangThai: TrangThaiTruyCap }) {
  return (
    <StatusPill tone={TONE_TRANG_THAI[trangThai]} className={INK_THEO_TONE[TONE_TRANG_THAI[trangThai]]}>
      {NHAN_TRANG_THAI_TRUY_CAP[trangThai]}
    </StatusPill>
  );
}

const NHAN_THAO_TAC: Record<ThaoTacTruyCap, string> = { TAM_NGUNG: "Tạm ngừng cổng", MO_LAI: "Mở lại cổng", GO: "Gỡ liên kết", DAT_DAI_DIEN: "Đặt làm người đại diện" };

type DangMo = { loai: ThaoTacTruyCap; dong: DongTruyCap } | null;

export function KhoiTaiKhoanTruyCap({
  partyId,
  doiTacKetThuc,
  dong,
  coTheGhi,
  hanhDong = HANH_DONG_MAC_DINH,
}: {
  partyId: string;
  doiTacKetThuc: boolean;
  dong: readonly DongTruyCap[];
  /** `scope.has("affiliates:manage")` — page tính, khối không đoán (luật 7: bắt buộc). */
  coTheGhi: boolean;
  hanhDong?: HanhDongTruyCap;
}) {
  const [moLienKet, setMoLienKet] = useState(false);
  const [dangMo, setDangMo] = useState<DangMo>(null);
  const coDaiDien = dong.some((d) => d.vai === "REPRESENTATIVE" && d.trangThai !== "REVOKED");
  const hienDong = dong.filter((d) => d.trangThai !== "REVOKED");
  const daGo = dong.filter((d) => d.trangThai === "REVOKED");

  return (
    <div>
      {coTheGhi && !doiTacKetThuc && (
        <div className="mb-3">
          <button type="button" onClick={() => setMoLienKet(true)} className={BTN_OUTLINE}>
            <UserPlus aria-hidden className="h-4 w-4" />
            Liên kết tài khoản
          </button>
        </div>
      )}

      {hienDong.length === 0 ? (
        <p data-rong="tai-khoan" className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
          Chưa có tài khoản nào được liên kết — đối tác này chưa xem được gì ở cổng phụ huynh.
          {coTheGhi && !doiTacKetThuc ? " Bấm «Liên kết tài khoản» để nối một tài khoản phụ huynh có sẵn." : ""}
        </p>
      ) : (
        <ul className="space-y-3" aria-label="Tài khoản truy cập cổng">
          {hienDong.map((d) => (
            <li key={d.id} data-tai-khoan={d.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 break-words text-sm font-semibold text-foreground">{d.ten}</span>
                <StatusPill tone={d.vai === "REPRESENTATIVE" ? "info" : "muted"} className={INK_THEO_TONE[d.vai === "REPRESENTATIVE" ? "info" : "muted"]}>
                  {NHAN_VAI_TRUY_CAP[d.vai]}
                </StatusPill>
                <PillTrangThai trangThai={d.trangThai} />
              </div>
              <p className="mt-0.5 break-words text-xs text-muted-foreground">{[d.email, d.dienThoai].filter(Boolean).join(" · ") || "Không có liên hệ"}</p>
              <p className={cn("mt-1.5 flex items-start gap-1.5 text-sm", d.vaoDuocCong ? "text-state-success-ink" : "text-state-warning-ink")}>
                {!d.vaoDuocCong && <ShieldAlert aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                <span data-cong={d.vaoDuocCong ? "mo" : "dong"}>{d.vaoDuocCong ? `Vào được cổng · ${d.soHocVien} học viên liên kết` : d.lyDoKhongVao}</span>
              </p>
              {d.trangThai === "SUSPENDED" && d.lyDo && <p className="mt-1 text-xs text-muted-foreground">Lý do tạm ngừng: {d.lyDo}</p>}
              {coTheGhi && d.thaoTac.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {d.thaoTac
                    .filter((t) => t.lyDoChan === null)
                    .map((t) => (
                      <button
                        key={t.thaoTac}
                        type="button"
                        onClick={() => setDangMo({ loai: t.thaoTac, dong: d })}
                        aria-label={`${NHAN_THAO_TAC[t.thaoTac]}: ${d.ten}`}
                        className={cn(t.thaoTac === "GO" ? BTN_DANGER_OUTLINE : BTN_OUTLINE, NUT_NHO)}
                      >
                        {NHAN_THAO_TAC[t.thaoTac]}
                      </button>
                    ))}
                  {d.thaoTac
                    .filter((t) => t.lyDoChan !== null)
                    .map((t) => (
                      <span key={t.thaoTac} className="basis-full text-xs text-muted-foreground">
                        {NHAN_THAO_TAC[t.thaoTac]}: {t.lyDoChan}
                      </span>
                    ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {daGo.length > 0 && (
        <p data-da-go className="mt-3 text-xs text-muted-foreground">
          Đã gỡ trước đây: {daGo.map((d) => d.ten).join(", ")}. Liên kết lại tài khoản sẽ mở lại đúng dòng cũ.
        </p>
      )}

      {moLienKet && <HopThoaiLienKet partyId={partyId} coDaiDien={coDaiDien} hanhDong={hanhDong} dong={() => setMoLienKet(false)} />}

      {dangMo && (dangMo.loai === "TAM_NGUNG" || dangMo.loai === "GO") && (
        <HopThoaiLyDo
          tieuDe={`${NHAN_THAO_TAC[dangMo.loai]}: ${dangMo.dong.ten}`}
          moTa={
            dangMo.loai === "GO"
              ? "Tài khoản này không vào được cổng của đối tác nữa. Đối tác, lead và hoa hồng giữ nguyên — không xoá gì. Liên kết lại được sau."
              : "Tài khoản này tạm thời không vào được cổng của đối tác; dữ liệu giữ nguyên và mở lại được bất cứ lúc nào."
          }
          nhanXacNhan={NHAN_THAO_TAC[dangMo.loai]}
          nguyHiem={dangMo.loai === "GO"}
          canLyDo
          lyDoToiThieu={LY_DO_TOI_THIEU_TRUY_CAP}
          thanhCong={`${NHAN_THAO_TAC[dangMo.loai]}: ${dangMo.dong.ten} — xong.`}
          xacNhan={(lyDo) => (dangMo.loai === "GO" ? hanhDong.go : hanhDong.tamNgung)({ id: dangMo.dong.id, updatedAtDaThay: dangMo.dong.capNhatLuc, lyDo })}
          dong={() => setDangMo(null)}
        />
      )}
      {dangMo && dangMo.loai === "MO_LAI" && (
        <HopThoaiLyDo
          tieuDe={`Mở lại cổng: ${dangMo.dong.ten}`}
          moTa="Tài khoản này vào lại được cổng của đối tác."
          nhanXacNhan="Mở lại cổng"
          canLyDo={false}
          lyDoToiThieu={LY_DO_TOI_THIEU_TRUY_CAP}
          thanhCong={`Đã mở lại cổng cho ${dangMo.dong.ten}.`}
          xacNhan={(lyDo) => hanhDong.moLai({ id: dangMo.dong.id, updatedAtDaThay: dangMo.dong.capNhatLuc, lyDo })}
          dong={() => setDangMo(null)}
        />
      )}
      {dangMo && dangMo.loai === "DAT_DAI_DIEN" && (
        <HopThoaiLyDo
          tieuDe={`Đặt làm người đại diện: ${dangMo.dong.ten}`}
          moTa="Người đại diện hiện tại (nếu có) trở thành thành viên. Mỗi đối tác chỉ có một người đại diện."
          nhanXacNhan="Đặt làm người đại diện"
          canLyDo={false}
          lyDoToiThieu={LY_DO_TOI_THIEU_TRUY_CAP}
          thanhCong={`${dangMo.dong.ten} là người đại diện.`}
          xacNhan={() => hanhDong.doiDaiDien({ partyId, id: dangMo.dong.id, updatedAtDaThay: dangMo.dong.capNhatLuc })}
          dong={() => setDangMo(null)}
        />
      )}
    </div>
  );
}

// ── Hộp thoại liên kết ───────────────────────────────────────────────────────────────────────────────────────

function HopThoaiLienKet({ partyId, coDaiDien, hanhDong, dong }: { partyId: string; coDaiDien: boolean; hanhDong: HanhDongTruyCap; dong: () => void }) {
  const router = useRouter();
  const uid = useId();
  const [q, setQ] = useState("");
  const [vai, setVai] = useState<VaiTruyCap>(coDaiDien ? "MEMBER" : "REPRESENTATIVE");
  const [ketQua, setKetQua] = useState<UserUngVien[] | null>(null);
  const [loi, setLoi] = useState<string | null>(null);
  const [dangTim, setDangTim] = useState(false);
  const [dangLuu, setDangLuu] = useState<string | null>(null);

  async function tim(e: React.FormEvent) {
    e.preventDefault();
    if (dangTim) return;
    if (q.trim().length < DO_DAI_TIM_USER_TOI_THIEU) {
      setLoi(`Gõ ít nhất ${DO_DAI_TIM_USER_TOI_THIEU} ký tự (tên, email hoặc số điện thoại).`);
      setKetQua(null);
      return;
    }
    setLoi(null);
    setDangTim(true);
    let r: KetQuaTim;
    try {
      r = await hanhDong.tim({ partyId, q });
    } catch {
      r = { ok: false, error: "Không tìm được lúc này. Thử lại sau ít giây." };
    }
    setDangTim(false);
    if (!r.ok) {
      setLoi(r.error);
      setKetQua(null);
      return;
    }
    setKetQua(r.ketQua);
  }

  async function lienKet(u: UserUngVien) {
    if (dangLuu) return;
    setLoi(null);
    setDangLuu(u.userId);
    let r: KetQuaTruyCap<{ id: string }>;
    try {
      r = await hanhDong.lienKet({ partyId, userId: u.userId, vai });
    } catch {
      r = { ok: false, loi: "Không lưu được lúc này. Thử lại sau ít giây." };
    }
    setDangLuu(null);
    if (!r.ok) {
      setLoi(r.loi);
      return;
    }
    toast.success(`Đã liên kết ${u.ten}.`);
    dong();
    router.refresh();
  }

  return (
    <Dialog open onOpenChange={(m) => !m && !dangLuu && dong()}>
      <DialogContent showCloseButton={false} className="admin-scope sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Liên kết tài khoản với đối tác</DialogTitle>
          <DialogDescription render={<div />}>
            Chọn một tài khoản phụ huynh CÓ SẴN. Màn này không tạo tài khoản mới. Tài khoản nhân viên không liên kết được (họ không vào được cổng phụ huynh).
          </DialogDescription>
        </DialogHeader>

        <div>
          <label htmlFor={`${uid}-vai`} className={NHAN_O}>
            Vai của tài khoản
          </label>
          <select id={`${uid}-vai`} value={vai} onChange={(e) => setVai(e.target.value as VaiTruyCap)} className={cn(FIELD, "max-w-xs")}>
            {VAI_TRUY_CAP.map((v) => (
              <option key={v} value={v} disabled={v === "REPRESENTATIVE" && coDaiDien}>
                {NHAN_VAI_TRUY_CAP[v]}
                {v === "REPRESENTATIVE" && coDaiDien ? " (đã có — dùng «Đặt làm người đại diện»)" : ""}
              </option>
            ))}
          </select>
        </div>

        <form onSubmit={tim} role="search" aria-label="Tìm tài khoản phụ huynh" className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <label htmlFor={`${uid}-q`} className={NHAN_O}>
              Tìm tài khoản (tên, email hoặc số điện thoại)
            </label>
            <input id={`${uid}-q`} value={q} onChange={(e) => setQ(e.target.value)} maxLength={60} autoComplete="off" className={FIELD} />
          </div>
          <button type="submit" disabled={dangTim} className={cn(BTN_OUTLINE, NUT_NHO)}>
            {dangTim ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <Search aria-hidden className="h-4 w-4" />}
            Tìm
          </button>
        </form>

        {loi && (
          <p role="alert" className={LOI_O}>
            {loi}
          </p>
        )}

        {ketQua && (
          <ul aria-label="Kết quả tìm tài khoản" className="max-h-72 space-y-2 overflow-y-auto">
            {ketQua.length === 0 ? (
              <li data-rong="tim" className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
                Không có tài khoản phụ huynh nào khớp (tài khoản đã liên kết với đối tác này, tài khoản nhân viên và tài khoản bị khoá không hiện ở đây).
              </li>
            ) : (
              ketQua.map((u) => (
                <li key={u.userId} data-ung-vien={u.userId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3">
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-medium text-foreground">{u.ten}</p>
                    <p className="break-words text-xs text-muted-foreground">{[u.email, u.dienThoai].filter(Boolean).join(" · ") || "Không có liên hệ"}</p>
                    {u.lyDoKhongVao && <p className="mt-0.5 text-xs text-state-warning-ink">{u.lyDoKhongVao}</p>}
                  </div>
                  <button type="button" disabled={dangLuu !== null} onClick={() => void lienKet(u)} aria-label={`Liên kết ${u.ten}`} className={cn(BTN_PRIMARY, NUT_NHO)}>
                    {dangLuu === u.userId && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
                    Liên kết
                  </button>
                </li>
              ))
            )}
          </ul>
        )}

        <DialogFooter>
          <button type="button" onClick={dong} disabled={dangLuu !== null} className={cn(BTN_OUTLINE, NUT_CHAN)}>
            Đóng
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
