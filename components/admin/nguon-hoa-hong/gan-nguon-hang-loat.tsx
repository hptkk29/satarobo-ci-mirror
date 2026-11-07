"use client";

// components/admin/nguon-hoa-hong/gan-nguon-hang-loat.tsx — HỘP THOẠI «Gán nguồn hàng loạt» của hàng chờ nguồn (mở từ thanh chọn lead: `chon-lead-hang-cho.tsx`).
//
// Vì sao có: hàng trăm lead cùng một lý do (nhập từ file Excel cũ, thiếu người giới thiệu…) — mở từng lead để gán là không ai làm nổi. Đây là đường thoát có XEM TRƯỚC, có lý do, có nhật ký.
//
// ── Nút nói thật (luật 12) ────────────────────────────────────────────────────────────────────────────
//  · thanh chọn CHỈ vẽ khi người xem có đúng khoá mà action kiểm (`sources:manage`) ∧ đã tick ít nhất một lead (hoặc chọn cả bộ lọc);
//  · hai bước: XEM TRƯỚC (chạy cùng vòng lọc với bước ghi nhưng KHÔNG ghi) rồi XÁC NHẬN. Hộp thoại nói thẳng lead nào sẽ BỊ BỎ QUA và vì sao, để không ai tưởng «207 lead» là «207 lead sẽ đổi»;
//  · chạy theo LÔ nhỏ, hiện tiến độ; lỗi giữa chừng không mất phần đã làm (con trỏ giữ lại) — «Tiếp tục» chạy nốt.
// Chỉ liệt kê nguồn KHÔNG đòi người giới thiệu / giải trình (hai thứ đó là dữ liệu riêng của từng lead — danh sách do máy chủ lọc, máy chủ cũng kiểm lại).
import { useRef, useState } from "react";
import { CheckCircle2, Loader2, TriangleAlert } from "lucide-react";
import { ganNguonHangLoatAction } from "@/app/(admin)/admin/nguon-hoa-hong/nguon/_actions-gan-hang-loat";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  LO_RONG,
  congDonLo,
  kiemLyDoGanHangLoat,
  type KetQuaGanHangLoatAction,
  type KetQuaLoGanHangLoat,
  type NguonChoHangLoat,
  type PhamViGan,
} from "@/lib/nguon/gan-nguon-hang-loat-nhan";
import { cn } from "@/lib/utils";
import { BTN_OUTLINE, BTN_PRIMARY, LOI_O, NHAN_O, NUT_CHAN, O_NHAP, TEXTAREA } from "./classes";
import { soVN } from "./nhan-nguon";

type Chay = (i: { groupId: string; lyDo: string; coSoId: string | null; pham: PhamViGan; conTro: string | null; chiXem: boolean }) => Promise<KetQuaGanHangLoatAction>;
const CHAY_MAC_DINH: Chay = (i) => ganNguonHangLoatAction(i);

/** Nguồn chọn sẵn: «khách tự đến» là câu trả lời mặc định của quy tắc «không có dấu vết giới thiệu ⇒ khách tự tìm đến». Không có thì không chọn sẵn gì. */
const MA_CHON_SAN = "WALK_IN";

export type GanHangLoatView = {
  /** Số lead sẽ được xét: số đã tick, hoặc tổng của bộ lọc khi «chọn cả bộ lọc». */
  soLead: number;
  /** Phạm vi gửi lên máy chủ: các id đã tick, hoặc cả bộ lọc. */
  pham: PhamViGan;
  coSoId: string | null;
  /** Câu mô tả phạm vi in lên hộp thoại («3 lead đã chọn» / «207 lead «Chưa rõ nguồn» ở CS2»). */
  moTa: string;
  nguon: NguonChoHangLoat[];
};

type Pha = "nhap" | "xemTruoc" | "xacNhan" | "chay" | "xong" | "loi";

/** `khiDong(coDoi)`: nơi gọi bỏ chọn + làm mới trang khi đã đổi được lead nào. Hộp thoại không tự đóng khi đang chạy. */
export function HopGanNguonHangLoat({ view: viewMoi, chay = CHAY_MAC_DINH, khiDong }: { view: GanHangLoatView; chay?: Chay; khiDong: (coDoi: boolean) => void }) {
  // ĐÓNG BĂNG số liệu lúc mở: trang có thể được làm mới giữa chừng; `tong` đổi theo lô là thanh tiến độ chạy lùi.
  const [view] = useState(viewMoi);
  const [groupId, setGroupId] = useState(() => view.nguon.find((n) => n.code === MA_CHON_SAN)?.id ?? "");
  const [lyDo, setLyDo] = useState("");
  const [loiLyDo, setLoiLyDo] = useState<string | null>(null);
  const [loiNguon, setLoiNguon] = useState<string | null>(null);
  const [pha, setPha] = useState<Pha>("nhap");
  const [xem, setXem] = useState<KetQuaLoGanHangLoat>(LO_RONG);
  const [thuc, setThuc] = useState<KetQuaLoGanHangLoat>(LO_RONG);
  const [loi, setLoi] = useState<string | null>(null);
  // Con trỏ + số cộng dồn giữ qua «Tiếp tục»: ref chứ không state — vòng lặp đọc giá trị MỚI NHẤT, không đợi render.
  const conTro = useRef<string | null>(null);
  const cong = useRef<KetQuaLoGanHangLoat>(LO_RONG);
  const dangChayRef = useRef(false);

  const nguonChon = view.nguon.find((n) => n.id === groupId) ?? null;
  const dangChay = pha === "xemTruoc" || pha === "chay";
  const phanTram = view.soLead > 0 ? Math.min(100, Math.round(((pha === "chay" ? thuc.daQuet : xem.daQuet) / view.soLead) * 100)) : 0;

  /** Chạy MỌI lô từ con trỏ hiện tại tới hết. `chiXem` = không ghi. Trả `true` khi chạy hết, `false` khi dừng vì lỗi. */
  async function chayCacLo(chiXem: boolean): Promise<boolean> {
    for (let vong = 0; vong < 2000; vong++) {
      let r: KetQuaGanHangLoatAction;
      try {
        r = await chay({ groupId, lyDo: lyDo.trim(), coSoId: view.coSoId, pham: view.pham, conTro: conTro.current, chiXem });
      } catch {
        r = { ok: false, error: "Mất kết nối giữa chừng. Phần đã đổi vẫn còn nguyên — bấm «Tiếp tục» để chạy nốt." };
      }
      if (!r.ok) {
        setLoi(r.error);
        setPha("loi");
        return false;
      }
      cong.current = congDonLo(cong.current, r);
      (chiXem ? setXem : setThuc)(cong.current);
      if (r.hetLead || r.conTro === null || r.conTro === conTro.current) return true;
      conTro.current = r.conTro;
    }
    return true;
  }

  async function chayXemTruoc() {
    if (dangChayRef.current) return;
    if (!nguonChon) {
      setLoiNguon("Chọn nguồn sẽ gán cho các lead này.");
      return;
    }
    const loiNhap = kiemLyDoGanHangLoat(lyDo);
    if (loiNhap) {
      setLoiLyDo(loiNhap);
      return;
    }
    setLoiNguon(null);
    setLoiLyDo(null);
    setLoi(null);
    dangChayRef.current = true;
    conTro.current = null;
    cong.current = LO_RONG;
    setXem(LO_RONG);
    setPha("xemTruoc");
    try {
      if (await chayCacLo(true)) setPha("xacNhan");
    } finally {
      dangChayRef.current = false;
    }
  }

  async function chayThat(tuDau: boolean) {
    if (dangChayRef.current) return;
    setLoi(null);
    dangChayRef.current = true;
    if (tuDau) {
      conTro.current = null;
      cong.current = LO_RONG;
      setThuc(LO_RONG);
    }
    setPha("chay");
    try {
      if (await chayCacLo(false)) setPha("xong");
    } finally {
      dangChayRef.current = false;
    }
  }

  function dongVaLamMoi() {
    khiDong(thuc.daDoi > 0);
  }

  const ketQua = pha === "xong" || (pha === "loi" && thuc.daQuet > 0) || pha === "chay" ? thuc : xem;
  const nhapDuoc = pha === "nhap" || (pha === "loi" && thuc.daQuet === 0);

  return (
    <Dialog open onOpenChange={(m) => !m && !dangChay && dongVaLamMoi()}>
      {/* `admin-scope` TRÊN CHÍNH PANEL: hộp thoại render qua portal ra ngoài khung admin, nơi `--primary` rơi về CAM của :root. */}
      <DialogContent showCloseButton={false} className="admin-scope max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Gán nguồn hàng loạt</DialogTitle>
          <DialogDescription render={<div />} className="text-sm text-muted-foreground">
            {view.moTa}
          </DialogDescription>
        </DialogHeader>

        {pha !== "xong" ? (
          <>
            {nhapDuoc || pha === "xemTruoc" ? (
              <>
                <div>
                  <label htmlFor="gan-hang-loat-nguon" className={NHAN_O}>
                    Gán tất cả sang nguồn
                  </label>
                  <select
                    id="gan-hang-loat-nguon"
                    value={groupId}
                    disabled={dangChay}
                    onChange={(e) => {
                      setGroupId(e.target.value);
                      setLoiNguon(null);
                    }}
                    aria-invalid={loiNguon ? true : undefined}
                    className={O_NHAP}
                  >
                    <option value="">— Chọn nguồn —</option>
                    {view.nguon.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.name}
                      </option>
                    ))}
                  </select>
                  {loiNguon && (
                    <p role="alert" className={LOI_O}>
                      {loiNguon}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">Chỉ liệt kê nguồn KHÔNG đòi người giới thiệu hay giải trình riêng — hai thứ đó phải khai từng lead.</p>
                </div>
                {nguonChon?.commissionEnabled && (
                  <div role="note" className="flex items-start gap-2 rounded-lg bg-state-warning-soft px-3 py-2.5 text-sm text-state-warning-ink">
                    <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                    <p>
                      Nguồn «{nguonChon.name}» CÓ tính hoa hồng. Gán hàng loạt sang nguồn này là quyết định về tiền khi các lead sau này thu học phí — chỉ làm khi có căn cứ.
                    </p>
                  </div>
                )}
                <div>
                  <label htmlFor="gan-hang-loat-ly-do" className={NHAN_O}>
                    Lý do (tối thiểu 10 ký tự)
                  </label>
                  <textarea
                    id="gan-hang-loat-ly-do"
                    rows={2}
                    maxLength={500}
                    value={lyDo}
                    disabled={dangChay}
                    onChange={(e) => {
                      setLyDo(e.target.value);
                      setLoiLyDo(null);
                    }}
                    aria-invalid={loiLyDo ? true : undefined}
                    aria-describedby={loiLyDo ? "gan-hang-loat-loi-ly-do" : undefined}
                    placeholder="Ví dụ: Lead nhập từ file Excel cũ, không còn căn cứ nguồn — xếp vào khách tự đến."
                    className={TEXTAREA}
                  />
                  {loiLyDo && (
                    <p id="gan-hang-loat-loi-ly-do" role="alert" className={LOI_O}>
                      {loiLyDo}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">Lý do này được ghi vào nhật ký của TỪNG lead.</p>
                </div>
              </>
            ) : (
              <p className="text-sm text-foreground">
                Gán sang <b className="font-semibold">{nguonChon?.name ?? "—"}</b>. Lý do: «{lyDo.trim()}»
              </p>
            )}

            {(pha === "xacNhan" || pha === "chay" || (pha === "loi" && ketQua.daQuet > 0)) && <BangKetQua kq={ketQua} chiXem={pha === "xacNhan" || (pha === "loi" && thuc.daQuet === 0)} />}

            {loi && (
              <div role="alert" className="flex items-start gap-2 rounded-lg bg-state-danger-soft px-3 py-2.5 text-sm text-state-danger-ink">
                <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                <p className="min-w-0 flex-1">{loi}</p>
              </div>
            )}

            {dangChay && (
              <div aria-live="polite">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-foreground">{pha === "xemTruoc" ? "Đang xem trước (chưa ghi gì)…" : "Đang gán nguồn…"}</span>
                  <span className="whitespace-nowrap font-semibold tabular-nums text-foreground">
                    {soVN(Math.min(view.soLead, ketQua.daQuet))} / {soVN(view.soLead)} lead
                  </span>
                </div>
                <div role="progressbar" aria-label="Tiến độ" aria-valuemin={0} aria-valuemax={view.soLead} aria-valuenow={Math.min(ketQua.daQuet, view.soLead)} className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full bg-primary" style={{ width: `${phanTram}%` }} />
                </div>
              </div>
            )}
          </>
        ) : (
          <div role="status" className="flex items-start gap-2 text-sm text-foreground">
            <CheckCircle2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-state-success-ink" />
            <div className="min-w-0 space-y-2">
              <p>
                Đã gán <b className="tabular-nums">{soVN(thuc.daDoi)}</b> lead sang «{nguonChon?.name}». Mỗi lead có một dòng trong nhật ký đổi nguồn kèm lý do của anh/chị.
              </p>
              <BangKetQua kq={thuc} chiXem={false} />
            </div>
          </div>
        )}

        <DialogFooter>
          <button type="button" onClick={dongVaLamMoi} disabled={dangChay} className={cn(BTN_OUTLINE, NUT_CHAN)}>
            {pha === "xong" ? "Đóng" : "Huỷ"}
          </button>
          {nhapDuoc && (
            <button type="button" onClick={() => void chayXemTruoc()} className={cn(BTN_PRIMARY, NUT_CHAN)}>
              Xem trước
            </button>
          )}
          {pha === "xemTruoc" && (
            <button type="button" disabled className={cn(BTN_PRIMARY, NUT_CHAN)}>
              <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
              Đang xem trước
            </button>
          )}
          {pha === "xacNhan" && (
            <>
              <button type="button" onClick={() => setPha("nhap")} className={cn(BTN_OUTLINE, NUT_CHAN)}>
                Sửa lại
              </button>
              <button type="button" disabled={xem.daDoi === 0} onClick={() => void chayThat(true)} className={cn(BTN_PRIMARY, NUT_CHAN)}>
                Đổi {soVN(xem.daDoi)} lead
              </button>
            </>
          )}
          {(pha === "chay" || (pha === "loi" && thuc.daQuet > 0)) && (
            <button type="button" disabled={dangChay} onClick={() => void chayThat(false)} className={cn(BTN_PRIMARY, NUT_CHAN)}>
              {dangChay && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
              {pha === "loi" ? "Tiếp tục" : "Đang gán"}
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Bảng đếm: SẼ ĐỔI / ĐÃ ĐỔI + từng nhóm bị bỏ qua và vì sao. Chỉ in dòng có số > 0. */
function BangKetQua({ kq, chiXem }: { kq: KetQuaLoGanHangLoat; chiXem: boolean }) {
  const dong: { nhan: string; so: number; ghiChu?: string }[] = [
    { nhan: chiXem ? "Sẽ đổi nguồn" : "Đã đổi nguồn", so: kq.daDoi },
    { nhan: "Bỏ qua — đã có khoản thu / sổ hoa hồng", so: kq.boQuaCoTien, ghiChu: "Đổi nguồn sau khi thu tiền phải qua duyệt hai cấp; xử lý từng lead ở trang lead." },
    { nhan: "Bỏ qua — nguồn đang bị khoá", so: kq.boQuaKhoa },
    { nhan: "Bỏ qua — đã ở đúng nguồn này", so: kq.boQuaCungNguon },
    { nhan: "Bỏ qua — vừa bị người khác đổi", so: kq.boQuaVuaDoi },
    { nhan: "Không đổi được (thiếu quyền tại cơ sở của lead…)", so: kq.khongDoiDuoc, ghiChu: kq.loiDauTien ?? undefined },
  ];
  return (
    <ul className="space-y-1 text-sm">
      {dong
        .filter((d, i) => i === 0 || d.so > 0)
        .map((d) => (
          <li key={d.nhan} className="border-b border-border py-1.5 last:border-b-0">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-foreground">{d.nhan}</span>
              <span className="whitespace-nowrap font-semibold tabular-nums text-foreground">{soVN(d.so)} lead</span>
            </div>
            {d.ghiChu && <p className="mt-0.5 text-xs text-muted-foreground">{d.ghiChu}</p>}
          </li>
        ))}
    </ul>
  );
}
