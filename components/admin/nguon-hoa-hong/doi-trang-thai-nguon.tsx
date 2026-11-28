"use client";

// components/admin/nguon-hoa-hong/doi-trang-thai-nguon.tsx — NÚT + HỘP THOẠI «Đổi trạng thái» của một nguồn (Kích hoạt · Ngừng · Lưu trữ · Khôi phục). SPEC nguồn động §4.
//
// Dùng được ở BẢNG danh sách nguồn và (nếu muốn) ở trang chi tiết: nhận một dòng tối thiểu + mã đích mặc định, không đọc DB.
//
// ── Nút nói thật (luật 12) — và giới hạn của lời đó ────────────────────────────────────────────────────────────
// Danh sách chuyển được LẤY TỪ `thaoTacTrangThai` (lib/nguon/form-nguon.ts), hàm chạy LẠI các cổng mà `doiTrangThaiNguon` chạy trước phép ghi: `kiemDoiTrangThai` (bảng chuyển + luật hệ thống / UNKNOWN)
// → `lamHongDichMacDinh` (đích mặc định của quy nguồn) → `chanNguonHoatDongKhongChu` (kích hoạt nguồn chưa có người phụ trách khi rule chủ-nguồn đang chạy) → cổng quyền «đụng tiền».
// ⚠️ Bản trước tuyên bố «nút và cổng ghi không thể lệch nhau» nhưng chỉ chạy HAI cổng đầu — «Kích hoạt» vẫn vẽ cho nguồn chưa có chủ rồi máy chủ mới từ chối (W2, res2 R2-M1). Dữ liệu đưa vào (`nguon.ownerEmployeeId`,
// `chinhSachRieng`, `ruleChuChay`, `coQuyenKichHoat`) do trang đọc lúc dựng nên có thể cũ vài giây: MÁY CHỦ vẫn là bên quyết định, nút chỉ đoán đúng ở mọi trạng thái trang đã thấy (lưới `[FUI-DB-05]` đo trên nhiều tổ hợp). Nên:
//  · nguồn hệ thống KHÔNG có lựa chọn «Lưu trữ»; UNKNOWN không có lựa chọn nào; nguồn là đích mặc định không có «Ngừng / Lưu trữ» — thay vào đó hộp thoại NÓI LÝ DO (đúng câu cổng ghi sẽ trả);
//  · không có gì chuyển được ⇒ nút đổi tên thành «Vì sao cố định?» và hộp thoại chỉ đọc, không vẽ nút xác nhận;
//  · lý do ≥ 10 ký tự chỉ đòi khi cổng đòi (kích hoạt BẢN NHÁP thì không);
//  · KHÔNG có nút xoá — danh mục chỉ lưu trữ, không xoá cứng.
// Khoá lạc quan: gửi `capNhatLuc` của dòng; máy chủ báo «vừa được người khác đổi» ⇒ banner + «Tải lại».
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, Loader2, Lock, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { doiTrangThaiNguonAction } from "@/app/(admin)/admin/nguon-hoa-hong/nguon/_actions";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { kiemDoiTrangThai, LY_DO_TOI_THIEU_NGUON, type TrangThaiNguon } from "@/lib/nguon/danh-muc-ghi-dau-vao";
import { thaoTacTrangThai } from "@/lib/nguon/form-nguon";
import type { KetQuaDoiTrangThaiAction } from "@/lib/nguon/ket-qua-action";
import { cn } from "@/lib/utils";
import { BTN_OUTLINE, BTN_PRIMARY, LOI_O, NHAN_O, NUT_CHAN, NUT_NHO, TEXTAREA } from "./classes";
import { NguonStatusPill } from "./trang-thai-nguon-pill";

type Doi = (i: { id: string; updatedAtDaThay: string; den: TrangThaiNguon; lyDo: string | null }) => Promise<KetQuaDoiTrangThaiAction>;
const DOI_MAC_DINH: Doi = (i) => doiTrangThaiNguonAction(i);

/** Dòng tối thiểu mà nút cần — danh sách và trang chi tiết đều dựng được từ dữ liệu có sẵn. */
export type NguonDeDoiTrangThai = {
  id: string;
  code: string;
  name: string;
  status: TrangThaiNguon;
  isSystem: boolean;
  /** ISO của `updatedAt` — mốc khoá lạc quan. */
  capNhatLuc: string;
  /** `Employee.id` người phụ trách; null = chưa khai. «Kích hoạt» nguồn chưa có chủ khi rule SOURCE_OWNER đang chạy bị cổng ghi từ chối ⇒ nút nói trước. */
  ownerEmployeeId: string | null;
  /** Có chính sách RIÊNG đang ACTIVE — đổi trạng thái nguồn này đòi `commission_policies:activate`. */
  chinhSachRieng: boolean;
  /** Rule vai SOURCE_OWNER CHẠY trên nguồn này (rule chung hoặc riêng) — `ruleChuChayChoNguon`. */
  ruleChuChay: boolean;
};

export function NutDoiTrangThai({
  nguon,
  dichMacDinh,
  coQuyenKichHoat,
  nowIso,
  doi = DOI_MAC_DINH,
  bieuTuong = false,
  className,
}: {
  nguon: NguonDeDoiTrangThai;
  /** Mã nguồn mà quy nguồn dùng làm đích mặc định (`docMaDichMacDinh`). BẮT BUỘC (luật 7). */
  dichMacDinh: readonly string[];
  /** Người xem CÓ `commission_policies:activate` không (`coQuyenKichHoatChinhSach`) — trang đọc, nút không đoán. BẮT BUỘC (luật 7). */
  coQuyenKichHoat: boolean;
  /** Mốc «bây giờ» lúc trang dựng — biểu mẫu không đọc đồng hồ (luật 19). */
  nowIso: string;
  doi?: Doi;
  /** Nút chỉ có BIỂU TƯỢNG (ô Thao tác của bảng dày — chữ «Đổi trạng thái» làm bảng tràn khung). Tên truy cập (`aria-label`) và `title` vẫn nói đủ việc. Mặc định: nút chữ. */
  bieuTuong?: boolean;
  className?: string;
}) {
  const [mo, setMo] = useState(false);
  const tt = useMemo(
    () =>
      thaoTacTrangThai({
        nguon,
        dichMacDinh: new Set(dichMacDinh),
        dinhTien: { chinhSachRieng: nguon.chinhSachRieng, ruleChuChay: nguon.ruleChuChay },
        coQuyenKichHoat,
        now: new Date(nowIso),
      }),
    [nguon, dichMacDinh, coQuyenKichHoat, nowIso],
  );
  if (tt.duoc.length === 0 && tt.khongDuoc.length === 0) return null;
  const chiDoc = tt.duoc.length === 0;
  return (
    <>
      <button
        type="button"
        onClick={() => setMo(true)}
        aria-label={`${chiDoc ? "Vì sao không đổi trạng thái được" : "Đổi trạng thái"}: nguồn ${nguon.name}`}
        title={chiDoc ? "Vì sao cố định?" : "Đổi trạng thái"}
        className={cn(BTN_OUTLINE, bieuTuong ? "h-10 w-10 justify-center px-0 md:h-8 md:w-8" : NUT_NHO, className)}
      >
        {chiDoc ? <Lock aria-hidden className="h-3.5 w-3.5" /> : bieuTuong ? <ArrowLeftRight aria-hidden className="h-3.5 w-3.5" /> : null}
        {bieuTuong ? null : chiDoc ? "Vì sao cố định?" : "Đổi trạng thái"}
      </button>
      {mo && <HopThoai nguon={nguon} tt={tt} doi={doi} dong={() => setMo(false)} />}
    </>
  );
}

type Banner = { loai: "vuaDoi" | "khac"; text: string };

/** Gộp các thao tác bị chặn có CÙNG câu lý do (giữ thứ tự xuất hiện đầu tiên). */
function gopTheoLyDo(ds: readonly { nhan: string; lyDo: string }[]): { nhan: string[]; lyDo: string }[] {
  const ra: { nhan: string[]; lyDo: string }[] = [];
  for (const d of ds) {
    const co = ra.find((r) => r.lyDo === d.lyDo);
    if (co) co.nhan.push(d.nhan);
    else ra.push({ nhan: [d.nhan], lyDo: d.lyDo });
  }
  return ra;
}

function HopThoai({ nguon, tt, doi, dong }: { nguon: NguonDeDoiTrangThai; tt: ReturnType<typeof thaoTacTrangThai>; doi: Doi; dong: () => void }) {
  const router = useRouter();
  const chiDoc = tt.duoc.length === 0;
  const [chon, setChon] = useState<TrangThaiNguon | null>(tt.duoc.length === 1 ? tt.duoc[0]!.den : null);
  const [lyDo, setLyDo] = useState("");
  const [loiChon, setLoiChon] = useState<string | null>(null);
  const [loiLyDo, setLoiLyDo] = useState<string | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [dangLuu, setDangLuu] = useState(false);
  const thaoTac = tt.duoc.find((t) => t.den === chon) ?? null;

  async function xacNhan() {
    if (dangLuu) return;
    setBanner(null);
    if (!thaoTac) {
      setLoiChon("Chọn trạng thái muốn chuyển sang.");
      return;
    }
    setLoiChon(null);
    // Cùng cổng với máy chủ: lý do ≥ 10 ký tự chỉ khi cổng đòi.
    const kq = kiemDoiTrangThai({ nguon, den: thaoTac.den, lyDo });
    if (!kq.ok) {
      if (kq.truong === "lyDo") setLoiLyDo(kq.loi);
      else setBanner({ loai: "khac", text: kq.loi });
      return;
    }
    setLoiLyDo(null);
    setDangLuu(true);
    let r: KetQuaDoiTrangThaiAction;
    try {
      r = await doi({ id: nguon.id, updatedAtDaThay: nguon.capNhatLuc, den: thaoTac.den, lyDo: lyDo.trim() === "" ? null : lyDo.trim() });
    } catch {
      r = { ok: false, error: "Không lưu được lúc này. Thử lại sau ít giây." };
    }
    setDangLuu(false);
    if (!r.ok) {
      if (r.field === "lyDo") setLoiLyDo(r.error);
      else setBanner({ loai: r.field === "vuaDoi" ? "vuaDoi" : "khac", text: r.error });
      return;
    }
    toast.success(`${thaoTac.nhan} nguồn «${nguon.name}»: xong.`);
    dong();
    router.refresh();
  }

  return (
    <Dialog open onOpenChange={(m) => !m && !dangLuu && dong()}>
      {/* `admin-scope` TRÊN CHÍNH PANEL: hộp thoại render qua portal ra ngoài khung admin, nơi `--primary` rơi về CAM của :root (nút xác nhận hiện cam thay vì tím). */}
      <DialogContent showCloseButton={false} className="admin-scope sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{chiDoc ? `Nguồn «${nguon.name}» giữ nguyên trạng thái` : `Đổi trạng thái nguồn «${nguon.name}»`}</DialogTitle>
          <DialogDescription render={<div />} className="flex items-center gap-2">
            Hiện tại: <NguonStatusPill status={nguon.status} />
          </DialogDescription>
        </DialogHeader>

        {banner && (
          <div role="alert" className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg bg-state-danger-soft px-3 py-2.5 text-sm text-state-danger-ink">
            <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="min-w-0 flex-1">{banner.text}</p>
            {banner.loai === "vuaDoi" && (
              <button
                type="button"
                onClick={() => {
                  dong();
                  router.refresh();
                }}
                className={cn(BTN_OUTLINE, NUT_NHO)}
              >
                Tải lại
              </button>
            )}
          </div>
        )}

        {!chiDoc && (
          <fieldset className="min-w-0">
            <legend className={NHAN_O}>Chuyển sang</legend>
            <div className="space-y-1">
              {tt.duoc.map((t) => (
                <label key={t.den} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg px-2 py-2 hover:bg-muted">
                  <input
                    type="radio"
                    name="den"
                    value={t.den}
                    checked={chon === t.den}
                    onChange={() => {
                      setChon(t.den);
                      setLoiChon(null);
                      setLoiLyDo(null);
                    }}
                    className="mt-1 h-4 w-4 accent-primary"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">{t.nhan}</span>
                    <span className="block text-sm text-muted-foreground">{t.moTa}</span>
                  </span>
                </label>
              ))}
            </div>
            {loiChon && (
              <p role="alert" className={LOI_O}>
                {loiChon}
              </p>
            )}
          </fieldset>
        )}

        {tt.khongDuoc.length > 0 && (
          <div className="min-w-0">
            <p className="mb-1 text-sm font-semibold text-foreground">Không làm được</p>
            <ul className="space-y-1.5">
              {/* Các việc cùng một lý do (vd Ngừng · Lưu trữ cùng thiếu quyền kích hoạt) gộp thành MỘT dòng — không lặp một đoạn dài hai lần. */}
              {gopTheoLyDo(tt.khongDuoc).map((k) => (
                <li key={k.lyDo} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <Lock aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    <b className="font-medium text-foreground">{k.nhan.join(" · ")}</b> — {k.lyDo}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {thaoTac && (
          <div>
            <label htmlFor="doi-trang-thai-ly-do" className={NHAN_O}>
              {thaoTac.canLyDo ? `Lý do (tối thiểu ${LY_DO_TOI_THIEU_NGUON} ký tự)` : "Lý do (tuỳ chọn)"}
            </label>
            <textarea
              id="doi-trang-thai-ly-do"
              rows={2}
              maxLength={500}
              value={lyDo}
              onChange={(e) => {
                setLyDo(e.target.value);
                setLoiLyDo(null);
              }}
              aria-invalid={loiLyDo ? true : undefined}
              aria-describedby={loiLyDo ? "doi-trang-thai-loi-ly-do" : undefined}
              className={TEXTAREA}
            />
            {loiLyDo && (
              <p id="doi-trang-thai-loi-ly-do" role="alert" className={LOI_O}>
                {loiLyDo}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <button type="button" onClick={dong} disabled={dangLuu} className={cn(BTN_OUTLINE, NUT_CHAN)}>
            {chiDoc ? "Đóng" : "Huỷ"}
          </button>
          {!chiDoc && (
            <button type="button" onClick={() => void xacNhan()} disabled={dangLuu} className={cn(BTN_PRIMARY, NUT_CHAN)}>
              {dangLuu && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
              {thaoTac ? thaoTac.nhan : "Xác nhận"}
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
