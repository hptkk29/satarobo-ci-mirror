"use client";

// components/admin/nguon-hoa-hong/campaign/khoi-quy-tac.tsx — KHỐI «Quy tắc quy nguồn» của trang chi tiết campaign: (loại đối tác và/hoặc nhãn) → nguồn khách.
//
// ── Nút nói thật (luật 12) ────────────────────────────────────────────────────────────────────────────────────
// · Form thêm + nút Xoá CHỈ vẽ khi `coTheGhi` (trang truyền: người xem có `affiliate_campaigns:manage` — đúng khoá `themQuyTacAction`/`xoaQuyTacAction` kiểm) VÀ
//   `trangThaiDoiQuyTac(trangThai).duoc` (CÙNG hàm với cổng ghi). Campaign đang chạy ⇒ không có nút nào, thay bằng câu nói vì sao.
// · Ô «Nguồn» chỉ liệt kê nguồn CHỌN ĐƯỢC (cùng định nghĩa với ô chọn nguồn của lead mới); quy tắc đang trỏ tới nguồn đã hỏng hiện cảnh báo ngay trên dòng.
// · KHÔNG có ô chọn chính sách hoa hồng — và sẽ không có (AFF-L1 thu gọn): chính sách gắn vào campaign bằng PHẠM VI của chính sách (`scopeCampaignId`, mục «Hoa hồng»), không bằng cột `policyId` của quy tắc.
// · Lý do ≥ 10 ký tự chỉ khi cổng đòi (campaign đã từng chạy — PAUSED).
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { themQuyTacAction, xoaQuyTacAction } from "@/app/(admin)/admin/nguon-hoa-hong/campaign/_actions";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { LY_DO_TOI_THIEU_CAMPAIGN, taoQuyTacSchema, trangThaiDoiQuyTac, type KetQuaViecCon, type NguonChonView, type QuyTacView, type TrangThaiCampaign } from "@/lib/affiliate/ghi-campaign-dau-vao";
import { nhanTrangThaiNguon } from "@/lib/nguon/nhan-hien-thi";
import { cn } from "@/lib/utils";
import { BTN_OUTLINE, BTN_PRIMARY, FIELD, LOI_O, NHAN_O, NUT_NHO, TEXTAREA, VO_BANG } from "../classes";
import { HopThoaiLyDo } from "./hop-thoai-ly-do";

type Them = (i: { campaignId: string; vao: Record<string, unknown>; lyDo: string | null }) => Promise<KetQuaViecCon>;
type Xoa = (i: { campaignId: string; ruleId: string; lyDo: string | null }) => Promise<KetQuaViecCon>;
const THEM_MAC_DINH: Them = (i) => themQuyTacAction(i);
const XOA_MAC_DINH: Xoa = (i) => xoaQuyTacAction(i);

type Chon = { id: string; code: string; ten: string };

const TH = cn(adminTh, "px-3");
const TD = cn(adminTd, "px-3");

export function KhoiQuyTac({
  campaignId,
  trangThai,
  quyTac,
  loai,
  nhan,
  nguon,
  coTheGhi,
  them = THEM_MAC_DINH,
  xoa = XOA_MAC_DINH,
}: {
  campaignId: string;
  trangThai: TrangThaiCampaign;
  quyTac: readonly QuyTacView[];
  loai: readonly Chon[];
  nhan: readonly Chon[];
  nguon: readonly NguonChonView[];
  /** Người xem có `affiliate_campaigns:manage` không. BẮT BUỘC (luật 7). */
  coTheGhi: boolean;
  them?: Them;
  xoa?: Xoa;
}) {
  const [xoaRule, setXoaRule] = useState<QuyTacView | null>(null);
  const cho = trangThaiDoiQuyTac(trangThai);
  const veNut = coTheGhi && cho.duoc;
  return (
    <div>
      {quyTac.length === 0 ? (
        <p className="rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">
          Chưa có quy tắc nào. Khách của mọi đối tác sẽ nhận <b className="text-foreground">nguồn mặc định</b> của campaign, rồi đến nguồn mặc định của loại đối tác; thiếu cả hai thì khách vào hàng chờ «Cần xem tay».
        </p>
      ) : (
        <div className={VO_BANG}>
          <PhanTrangBang tenDonVi="quy tắc" cuonNgang>
            <table className="w-full min-w-[560px] border-collapse text-left">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th scope="col" className={TH}>
                    Loại đối tác
                  </th>
                  <th scope="col" className={TH}>
                    Nhãn đối tác
                  </th>
                  <th scope="col" className={TH}>
                    Gán nguồn
                  </th>
                  {veNut && (
                    <th scope="col" className={cn(TH, "text-right")}>
                      Thao tác
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {quyTac.map((r) => (
                  <tr key={r.id} className={adminTr}>
                    <td className={TD}>{r.loai ? r.loai.ten : <span className="text-muted-foreground">Mọi loại</span>}</td>
                    <td className={TD}>{r.nhan ? r.nhan.ten : <span className="text-muted-foreground">Mọi nhãn</span>}</td>
                    <td className={cn(TD, "whitespace-normal")}>
                      <span className="font-medium">{r.nguon.ten}</span>
                      {!r.nguon.chonDuoc && (
                        <span className="mt-0.5 flex items-center gap-1 text-xs text-state-warning-ink">
                          <TriangleAlert aria-hidden className="h-3.5 w-3.5 shrink-0" />
                          Nguồn này hiện «{nhanTrangThaiNguon(r.nguon.status)}» hoặc không chọn được — campaign sẽ không kích hoạt được cho tới khi sửa.
                        </span>
                      )}
                    </td>
                    {veNut && (
                      <td className={cn(TD, "text-right")}>
                        <button type="button" onClick={() => setXoaRule(r)} aria-label={`Xoá quy tắc: ${r.loai?.ten ?? "mọi loại"} / ${r.nhan?.ten ?? "mọi nhãn"} → ${r.nguon.ten}`} className={cn(BTN_OUTLINE, NUT_NHO)}>
                          <Trash2 aria-hidden className="h-3.5 w-3.5" />
                          Xoá
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </PhanTrangBang>
        </div>
      )}

      {coTheGhi && !cho.duoc && (
        <p role="status" className="mt-3 flex items-start gap-2 text-sm text-muted-foreground">
          <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{cho.lyDo}</span>
        </p>
      )}

      {veNut && cho.duoc && <FormThem campaignId={campaignId} canLyDo={cho.canLyDo} loai={loai} nhan={nhan} nguon={nguon} them={them} />}

      {xoaRule && (
        <HopThoaiLyDo
          tieuDe="Xoá quy tắc quy nguồn"
          moTa={
            <>
              {xoaRule.loai?.ten ?? "Mọi loại"} / {xoaRule.nhan?.ten ?? "Mọi nhãn"} → <b className="text-foreground">{xoaRule.nguon.ten}</b>. Đối tác khớp quy tắc này sẽ rơi về quy tắc yếu hơn hoặc nguồn mặc định.
            </>
          }
          nhanXacNhan="Xoá quy tắc"
          nguyHiem
          canLyDo={cho.duoc && cho.canLyDo}
          lyDoToiThieu={LY_DO_TOI_THIEU_CAMPAIGN}
          thanhCong="Đã xoá quy tắc."
          xacNhan={(lyDo) => xoa({ campaignId, ruleId: xoaRule.id, lyDo })}
          dong={() => setXoaRule(null)}
        />
      )}
    </div>
  );
}

function FormThem({ campaignId, canLyDo, loai, nhan, nguon, them }: { campaignId: string; canLyDo: boolean; loai: readonly Chon[]; nhan: readonly Chon[]; nguon: readonly NguonChonView[]; them: Them }) {
  const router = useRouter();
  const uid = useId();
  const [typeId, setTypeId] = useState("");
  const [tagId, setTagId] = useState("");
  const [sourceGroupId, setSourceGroupId] = useState("");
  const [lyDo, setLyDo] = useState("");
  const [loi, setLoi] = useState<{ truong: string; text: string } | null>(null);
  const [dangLuu, setDangLuu] = useState(false);

  async function nop(e: React.FormEvent) {
    e.preventDefault();
    if (dangLuu) return;
    const vao = { typeId: typeId || null, tagId: tagId || null, sourceGroupId };
    const kq = taoQuyTacSchema.safeParse(vao);
    if (!kq.success) {
      const i = kq.error.issues[0];
      setLoi({ truong: typeof i?.path[0] === "string" ? i.path[0] : "chung", text: i?.message ?? "Dữ liệu không hợp lệ." });
      return;
    }
    if (canLyDo && lyDo.trim().length < LY_DO_TOI_THIEU_CAMPAIGN) {
      setLoi({ truong: "lyDo", text: `Ghi lý do (tối thiểu ${LY_DO_TOI_THIEU_CAMPAIGN} ký tự).` });
      return;
    }
    setLoi(null);
    setDangLuu(true);
    let r: KetQuaViecCon;
    try {
      r = await them({ campaignId, vao, lyDo: lyDo.trim() === "" ? null : lyDo.trim() });
    } catch {
      r = { ok: false, loi: "Không lưu được lúc này. Thử lại sau ít giây." };
    }
    setDangLuu(false);
    if (!r.ok) {
      setLoi({ truong: r.truong ?? "chung", text: r.loi });
      return;
    }
    toast.success("Đã thêm quy tắc quy nguồn.");
    setTypeId("");
    setTagId("");
    setSourceGroupId("");
    setLyDo("");
    router.refresh();
  }

  const loiO = (t: string) => (loi && loi.truong === t ? loi.text : undefined);
  const khongCoGi = loai.length === 0 && nhan.length === 0;
  return (
    <form onSubmit={nop} noValidate aria-label="Thêm quy tắc quy nguồn" className="mt-4 rounded-xl border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold text-foreground">Thêm quy tắc</h3>
      {khongCoGi ? (
        <p className="text-sm text-muted-foreground">Chưa có loại hay nhãn đối tác nào để đặt quy tắc. Tạo loại / nhãn ở phần quản lý Affiliate, hoặc dùng «Nguồn mặc định» của campaign.</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor={`${uid}-loai`} className={NHAN_O}>
                Loại đối tác
              </label>
              <select
                id={`${uid}-loai`}
                value={typeId}
                onChange={(e) => {
                  setTypeId(e.target.value);
                  setLoi(null);
                }}
                aria-invalid={loiO("typeId") ? true : undefined}
                aria-describedby={loiO("typeId") ? `${uid}-loi` : undefined}
                className={FIELD}
              >
                <option value="">— Mọi loại —</option>
                {loai.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.ten}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`${uid}-nhan`} className={NHAN_O}>
                Nhãn đối tác
              </label>
              <select
                id={`${uid}-nhan`}
                value={tagId}
                onChange={(e) => {
                  setTagId(e.target.value);
                  setLoi(null);
                }}
                className={FIELD}
              >
                <option value="">— Mọi nhãn —</option>
                {nhan.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.ten}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`${uid}-nguon`} className={NHAN_O}>
                Gán nguồn
              </label>
              <select
                id={`${uid}-nguon`}
                value={sourceGroupId}
                onChange={(e) => {
                  setSourceGroupId(e.target.value);
                  setLoi(null);
                }}
                aria-invalid={loiO("sourceGroupId") ? true : undefined}
                aria-describedby={loiO("sourceGroupId") ? `${uid}-loi` : undefined}
                className={FIELD}
              >
                <option value="">— Chọn nguồn —</option>
                {nguon.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.ten}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">Chọn loại, nhãn hoặc cả hai. Khớp cả hai thì thắng khớp riêng loại; khớp riêng loại thắng khớp riêng nhãn. Bấm «Xem trước nguồn» bên dưới để thử với một đối tác cụ thể.</p>
          {canLyDo && (
            <div className="mt-3">
              <label htmlFor={`${uid}-lydo`} className={NHAN_O}>
                Lý do (tối thiểu {LY_DO_TOI_THIEU_CAMPAIGN} ký tự)
              </label>
              <textarea
                id={`${uid}-lydo`}
                rows={2}
                maxLength={500}
                value={lyDo}
                onChange={(e) => {
                  setLyDo(e.target.value);
                  setLoi(null);
                }}
                aria-invalid={loiO("lyDo") ? true : undefined}
                aria-describedby={loiO("lyDo") ? `${uid}-loi` : undefined}
                className={TEXTAREA}
              />
            </div>
          )}
          {loi && (
            <p id={`${uid}-loi`} role="alert" className={LOI_O}>
              {loi.text}
            </p>
          )}
          <div className="mt-3">
            <button type="submit" disabled={dangLuu} className={BTN_PRIMARY}>
              {dangLuu ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <Plus aria-hidden className="h-4 w-4" />}
              Thêm quy tắc
            </button>
          </div>
        </>
      )}
    </form>
  );
}
