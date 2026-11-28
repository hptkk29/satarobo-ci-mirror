"use client";

// components/admin/nguon-hoa-hong/campaign/nut-membership.tsx — THAO TÁC TRÊN MỘT DÒNG THÀNH VIÊN: Duyệt · Từ chối · Tạm ngừng · Cho tham gia lại · Kết thúc · Sửa.
//
// ── Nút nói thật (luật 12) ────────────────────────────────────────────────────────────────────────────────────
// · Danh sách nút LẤY TỪ `thaoTacKhaDung` (lib/affiliate/ghi-membership-dau-vao.ts) — cùng bảng chuyển và cùng `chanVaoCampaign` với `doiTrangThaiMembership`. Thao tác chắc chắn bị từ chối
//   (duyệt vào campaign đã kết thúc; duyệt đối tác không còn hoạt động) KHÔNG vẽ nút: hiện câu lý do.
// · Trang chỉ vẽ component này khi người xem có `affiliate_memberships:manage` (đúng khoá mà action kiểm ở đầu hàm).
// · «Sửa» không có ở dòng đã kết thúc (muốn quay lại thì thêm lại đối tác — mở lại đúng dòng cũ).
// · Khoá lạc quan: gửi `capNhatLuc` của dòng; «vừa được đổi» ⇒ banner + «Tải lại».
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { doiTrangThaiMembershipAction, suaMembershipAction } from "@/app/(admin)/admin/nguon-hoa-hong/campaign/_actions";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { DongMembershipView, TrangThaiCampaign } from "@/lib/affiliate/ghi-campaign-dau-vao";
import {
  LY_DO_TOI_THIEU_MEMBERSHIP,
  kiemSuaMembership,
  suaMembershipSchema,
  thaoTacKhaDung,
  type KetQuaDoiMembership,
  type KetQuaSuaMembership,
  type ThaoTacMembership,
  type TrangThaiMembership,
} from "@/lib/affiliate/ghi-membership-dau-vao";
import { isoTuNgayVN, ngayVNTuISO } from "@/lib/nguon/form-nguon";
import { cn } from "@/lib/utils";
import { BTN_DANGER_OUTLINE, BTN_OUTLINE, BTN_PRIMARY, FIELD, LOI_O, NHAN_O, NUT_CHAN, NUT_NHO, TEXTAREA } from "../classes";
import { HopThoaiLyDo } from "./hop-thoai-ly-do";

type Doi = (i: { id: string; updatedAtDaThay: string; den: TrangThaiMembership; lyDo: string | null }) => Promise<KetQuaDoiMembership>;
type Sua = (i: { id: string; updatedAtDaThay: string; vao: Record<string, unknown>; lyDo: string | null }) => Promise<KetQuaSuaMembership>;
const DOI_MAC_DINH: Doi = (i) => doiTrangThaiMembershipAction(i);
const SUA_MAC_DINH: Sua = (i) => suaMembershipAction(i);

export function NutMembership({ dong, campaignStatus, doi = DOI_MAC_DINH, sua = SUA_MAC_DINH }: { dong: DongMembershipView; campaignStatus: TrangThaiCampaign; doi?: Doi; sua?: Sua }) {
  const [moChuyen, setMoChuyen] = useState<ThaoTacMembership | null>(null);
  const [moSua, setMoSua] = useState(false);
  const khaDung = thaoTacKhaDung({ status: dong.status, campaign: { status: campaignStatus }, doiTac: { status: dong.doiTac.status as "DRAFT" | "PENDING" | "ACTIVE" | "SUSPENDED" | "ENDED" } });
  const chan = khaDung.filter((k) => k.lyDoChan !== null);
  if (khaDung.length === 0) return <span className="text-xs text-muted-foreground">Đã kết thúc — thêm lại đối tác để mở lại</span>;
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-2">
      {khaDung
        .filter((k) => k.lyDoChan === null)
        .map(({ thaoTac }) => (
          <button
            key={thaoTac.den}
            type="button"
            onClick={() => setMoChuyen(thaoTac)}
            aria-label={`${thaoTac.nhan}: ${dong.doiTac.ten}`}
            className={cn(thaoTac.den === "ACTIVE" ? BTN_PRIMARY : thaoTac.den === "ENDED" ? BTN_DANGER_OUTLINE : BTN_OUTLINE, NUT_NHO)}
          >
            {thaoTac.nhan}
          </button>
        ))}
      <button type="button" onClick={() => setMoSua(true)} aria-label={`Sửa thành viên: ${dong.doiTac.ten}`} className={cn(BTN_OUTLINE, NUT_NHO)}>
        <Pencil aria-hidden className="h-3.5 w-3.5" />
        Sửa
      </button>
      {chan.map((k) => (
        <span key={k.thaoTac.den} className="basis-full text-right text-xs text-muted-foreground">
          {k.lyDoChan}
        </span>
      ))}
      {moChuyen && (
        <HopThoaiLyDo
          tieuDe={`${moChuyen.nhan}: ${dong.doiTac.ten}`}
          moTa={moChuyen.moTa}
          nhanXacNhan={moChuyen.nhan}
          nguyHiem={moChuyen.den === "ENDED"}
          canLyDo={moChuyen.canLyDo}
          lyDoToiThieu={LY_DO_TOI_THIEU_MEMBERSHIP}
          thanhCong={`${moChuyen.nhan} «${dong.doiTac.ten}»: xong.`}
          xacNhan={(lyDo) => doi({ id: dong.id, updatedAtDaThay: dong.capNhatLuc, den: moChuyen.den, lyDo })}
          dong={() => setMoChuyen(null)}
        />
      )}
      {moSua && <HopThoaiSua dong={dong} sua={sua} dongHop={() => setMoSua(false)} />}
    </span>
  );
}

function HopThoaiSua({ dong, sua, dongHop }: { dong: DongMembershipView; sua: Sua; dongHop: () => void }) {
  const router = useRouter();
  const uid = useId();
  const goc = { nhan: dong.groupLabel ?? "", tu: ngayVNTuISO(dong.effectiveFrom), den: ngayVNTuISO(dong.effectiveTo) };
  const [nhan, setNhan] = useState(goc.nhan);
  const [tu, setTu] = useState(goc.tu);
  const [den, setDen] = useState(goc.den);
  const [lyDo, setLyDo] = useState("");
  const [loi, setLoi] = useState<{ truong: string; text: string } | null>(null);
  const [vuaDoi, setVuaDoi] = useState(false);
  const [dangLuu, setDangLuu] = useState(false);

  const patch: Record<string, unknown> = {};
  if (nhan !== goc.nhan) patch.groupLabel = nhan;
  if (tu !== goc.tu && dong.status === "PENDING") patch.effectiveFrom = isoTuNgayVN(tu) ?? tu;
  if (den !== goc.den) patch.effectiveTo = den.trim() === "" ? null : (isoTuNgayVN(den) ?? den);
  const khongDoi = Object.keys(patch).length === 0;
  const parsed = suaMembershipSchema.safeParse(patch);
  const kiem = parsed.success
    ? kiemSuaMembership({ status: dong.status, hienTai: { groupLabel: dong.groupLabel, effectiveFrom: new Date(dong.effectiveFrom), effectiveTo: dong.effectiveTo ? new Date(dong.effectiveTo) : null }, patch: parsed.data, lyDo })
    : null;
  // Cổng đòi lý do ⇒ `kiemSuaMembership` trả `{ ok: false, truong: "lyDo" }` khi ô còn trống: coi đó là «cần lý do» (nếu chỉ tin nhánh ok thì ô lý do KHÔNG BAO GIỜ hiện).
  const canLyDo = kiem !== null && (kiem.ok ? kiem.canLyDo : kiem.truong === "lyDo");

  async function nop() {
    if (dangLuu || khongDoi) return;
    if (!parsed.success) {
      setLoi({ truong: "chung", text: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ." });
      return;
    }
    if (kiem && !kiem.ok) {
      setLoi({ truong: kiem.truong, text: kiem.loi });
      return;
    }
    setLoi(null);
    setVuaDoi(false);
    setDangLuu(true);
    let r: KetQuaSuaMembership;
    try {
      r = await sua({ id: dong.id, updatedAtDaThay: dong.capNhatLuc, vao: patch, lyDo: lyDo.trim() === "" ? null : lyDo.trim() });
    } catch {
      r = { ok: false, loi: "Không lưu được lúc này. Thử lại sau ít giây." };
    }
    setDangLuu(false);
    if (!r.ok) {
      setVuaDoi(r.truong === "vuaDoi");
      setLoi({ truong: r.truong ?? "chung", text: r.loi });
      return;
    }
    toast.success(r.doi ? `Đã lưu thành viên «${dong.doiTac.ten}».` : "Không có gì thay đổi.");
    dongHop();
    router.refresh();
  }

  const loiO = (t: string) => (loi && loi.truong === t ? loi.text : undefined);
  return (
    <Dialog open onOpenChange={(m) => !m && !dangLuu && dongHop()}>
      <DialogContent showCloseButton={false} className="admin-scope sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Sửa thành viên: {dong.doiTac.ten}</DialogTitle>
          <DialogDescription render={<div />}>Nhãn nhóm và hiệu lực của đối tác trong campaign này. Trạng thái đổi bằng các nút trên dòng.</DialogDescription>
        </DialogHeader>

        {loi && (loi.truong === "vuaDoi" || loi.truong === "chung" || loi.truong === "trangThai") && (
          <div role="alert" className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg bg-state-danger-soft px-3 py-2.5 text-sm text-state-danger-ink">
            <p className="min-w-0 flex-1">{loi.text}</p>
            {vuaDoi && (
              <button
                type="button"
                onClick={() => {
                  dongHop();
                  router.refresh();
                }}
                className={cn(BTN_OUTLINE, NUT_NHO)}
              >
                Tải lại
              </button>
            )}
          </div>
        )}

        <div>
          <label htmlFor={`${uid}-nhan`} className={NHAN_O}>
            Nhãn nhóm
          </label>
          <input id={`${uid}-nhan`} type="text" maxLength={80} value={nhan} onChange={(e) => setNhan(e.target.value)} className={FIELD} />
          <p className="mt-1 text-sm text-muted-foreground">Chữ tự do để phân nhóm đối tác — chưa ảnh hưởng cách tính tiền.</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={`${uid}-tu`} className={NHAN_O}>
              Hiệu lực từ ngày
            </label>
            <input id={`${uid}-tu`} type="date" value={tu} onChange={(e) => setTu(e.target.value)} disabled={dong.status !== "PENDING"} aria-invalid={loiO("effectiveFrom") ? true : undefined} className={FIELD} />
            {dong.status !== "PENDING" && <p className="mt-1 text-sm text-muted-foreground">Chỉ đổi được khi còn «Chờ duyệt».</p>}
          </div>
          <div>
            <label htmlFor={`${uid}-den`} className={NHAN_O}>
              Hết hiệu lực vào ngày
            </label>
            <input id={`${uid}-den`} type="date" value={den} onChange={(e) => setDen(e.target.value)} aria-invalid={loiO("effectiveTo") ? true : undefined} aria-describedby={loiO("effectiveTo") ? `${uid}-loi-den` : undefined} className={FIELD} />
            {loiO("effectiveTo") && (
              <p id={`${uid}-loi-den`} role="alert" className={LOI_O}>
                {loiO("effectiveTo")}
              </p>
            )}
          </div>
        </div>

        {canLyDo && (
          <div>
            <label htmlFor={`${uid}-lydo`} className={NHAN_O}>
              Lý do (tối thiểu {LY_DO_TOI_THIEU_MEMBERSHIP} ký tự)
            </label>
            <textarea id={`${uid}-lydo`} rows={2} maxLength={500} value={lyDo} onChange={(e) => setLyDo(e.target.value)} aria-invalid={loiO("lyDo") ? true : undefined} aria-describedby={loiO("lyDo") ? `${uid}-loi-lydo` : undefined} className={TEXTAREA} />
            {loiO("lyDo") && (
              <p id={`${uid}-loi-lydo`} role="alert" className={LOI_O}>
                {loiO("lyDo")}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <button type="button" onClick={dongHop} disabled={dangLuu} className={cn(BTN_OUTLINE, NUT_CHAN)}>
            Huỷ
          </button>
          <button type="button" onClick={() => void nop()} disabled={dangLuu || khongDoi} className={cn(BTN_PRIMARY, NUT_CHAN)}>
            {dangLuu && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
            Lưu
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
