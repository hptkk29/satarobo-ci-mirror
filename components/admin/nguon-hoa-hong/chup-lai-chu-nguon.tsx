"use client";

// components/admin/nguon-hoa-hong/chup-lai-chu-nguon.tsx — NÚT + HỘP THOẠI «Chụp lại chủ nguồn cho lead cũ» ở mục «Đối tượng liên quan» của trang chi tiết nguồn (W3 · gt2 R1-H1).
//
// Vì sao có: lead ghi nhận từ trước giữ BẢN CHỤP chủ nguồn lúc ấy (để đổi chủ giữa hai đợt thu không chia lại tiền). Nguồn chưa có chủ lúc ghi, hoặc chủ đã chụp nghỉ việc, thì phần hoa hồng của
// chủ nguồn treo mãi. Nút này là đường thoát HÀNG LOẠT, có lý do, có nhật ký — thay cho «Đổi nguồn» từng lead.
//
// ── Nút nói thật (luật 12) ────────────────────────────────────────────────────────────────────────────
//  · trang CHỈ vẽ nút khi người xem có ĐÚNG hai khoá mà action kiểm VÀ có ít nhất một lead cần chụp lại (đếm bằng chính hàm chọn lô) — không có nút «bấm rồi báo 0»;
//  · hộp thoại nói TRƯỚC điều sẽ xảy ra (ghi ai · cho bao nhiêu lead · vì sao từng nhóm) và điều KHÔNG đổi (chủ còn làm việc · cửa sổ · ngày ghi nhận);
//  · chạy theo LÔ nhỏ, hiện tiến độ; lỗi giữa chừng không mất phần đã làm (idempotent) — «Tiếp tục» chạy tiếp từ con trỏ.
// Khoá chủ: gửi `chuDuKien` (người đã thấy trong hộp thoại). Chủ vừa đổi ⇒ máy chủ từ chối, không bao giờ chụp nhầm người.
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, TriangleAlert } from "lucide-react";
import { chupLaiChuNguonAction } from "@/app/(admin)/admin/nguon-hoa-hong/nguon/_actions-chup-lai";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NHAN_LY_DO_CHUP_LAI, kiemLyDoChupLai, type LyDoChupLai } from "@/lib/nguon/chup-lai-chu-nguon-nhan";
import type { KetQuaChupLaiAction } from "@/lib/nguon/ket-qua-action";
import { cn } from "@/lib/utils";
import { BTN_OUTLINE, BTN_PRIMARY, LOI_O, NHAN_O, NUT_CHAN, NUT_NHO, TEXTAREA } from "./classes";
import { soVN } from "./nhan-nguon";

type Chup = (i: { nguonId: string; chuDuKien: string; lyDo: string; conTro: string | null }) => Promise<KetQuaChupLaiAction>;
const CHUP_MAC_DINH: Chup = (i) => chupLaiChuNguonAction(i);

export type ChupLaiView = {
  nguonId: string;
  tenNguon: string;
  chu: { employeeId: string; ten: string; maNv: string | null };
  tong: number;
  theoLyDo: Record<LyDoChupLai, number>;
  /** Lead mà chủ đã chụp nghỉ việc / không còn hồ sơ NHƯNG đã có khoản chi cho họ ⇒ GIỮ chủ cũ, không nằm trong `tong`. BẮT BUỘC khai (luật 7): quên là hộp thoại im về đúng ca nguy hiểm. */
  giuChuCu: number;
  /** Vì sao chưa chụp lại được (chủ nghỉ việc / chưa có tài khoản); `null` = chụp được. Hộp thoại không bao giờ mở khi có giá trị này (`tong = 0`), nhưng mục «Đối tượng liên quan» in nó. */
  khongChupDuoc: string | null;
};

const THU_TU: readonly LyDoChupLai[] = ["THIEU_CHU", "CHU_NGHI_VIEC", "CHU_KHONG_CON_HO_SO"];

export function NutChupLaiChuNguon({ view, chup = CHUP_MAC_DINH, className }: { view: ChupLaiView; chup?: Chup; className?: string }) {
  const [mo, setMo] = useState(false);
  if (view.tong <= 0) return null;
  return (
    <>
      <button type="button" onClick={() => setMo(true)} className={cn(BTN_OUTLINE, NUT_NHO, className)}>
        Chụp lại chủ nguồn cho lead cũ
      </button>
      {mo && <HopThoai view={view} chup={chup} dong={() => setMo(false)} />}
    </>
  );
}

type Pha = "nhap" | "chay" | "xong" | "loi";

function HopThoai({ view: viewMoi, chup, dong }: { view: ChupLaiView; chup: Chup; dong: () => void }) {
  const router = useRouter();
  // ĐÓNG BĂNG số liệu lúc mở: trang có thể được làm mới (server) giữa lúc đang chạy; `tong` thay đổi theo lô là thanh tiến độ chạy lùi.
  const [view] = useState(viewMoi);
  const [lyDo, setLyDo] = useState("");
  const [loiLyDo, setLoiLyDo] = useState<string | null>(null);
  const [pha, setPha] = useState<Pha>("nhap");
  const [daChup, setDaChup] = useState(0);
  const [boQua, setBoQua] = useState(0);
  const [loi, setLoi] = useState<{ text: string; vuaDoi: boolean } | null>(null);
  // Con trỏ giữ qua lần «Tiếp tục» (lỗi giữa chừng) — ref chứ không state: vòng lặp đọc giá trị MỚI NHẤT, không đợi render.
  const conTro = useRef<string | null>(null);
  const chayDo = useRef(false);

  const dangChay = pha === "chay";
  const phanTram = view.tong > 0 ? Math.min(100, Math.round((daChup / view.tong) * 100)) : 0;

  async function batDau() {
    if (chayDo.current) return;
    const loiNhap = kiemLyDoChupLai(lyDo);
    if (loiNhap) {
      setLoiLyDo(loiNhap);
      return;
    }
    setLoiLyDo(null);
    setLoi(null);
    chayDo.current = true;
    setPha("chay");
    try {
      // Mỗi vòng = MỘT lô ngắn ở máy chủ. Không có vòng nào chạy khi hộp thoại đã đóng (đang chạy thì không đóng được).
      for (let vong = 0; vong < 1000; vong++) {
        let r: KetQuaChupLaiAction;
        try {
          r = await chup({ nguonId: view.nguonId, chuDuKien: view.chu.employeeId, lyDo: lyDo.trim(), conTro: conTro.current });
        } catch {
          r = { ok: false, error: "Mất kết nối giữa chừng. Phần đã chụp lại vẫn còn nguyên — bấm «Tiếp tục» để chạy nốt." };
        }
        if (!r.ok) {
          setLoi({ text: r.error, vuaDoi: r.field === "chuDoi" });
          setPha("loi");
          return;
        }
        setDaChup((n) => n + r.daChup);
        setBoQua((n) => n + r.boQua);
        if (r.hetLead) {
          setPha("xong");
          return;
        }
        if (r.conTro === null) break; // không còn con trỏ mà chưa hết: dừng, không lặp vô tận
        conTro.current = r.conTro;
      }
      setPha("xong");
    } finally {
      chayDo.current = false;
    }
  }

  function dongVaLamMoi() {
    dong();
    // Làm mới khi ĐÃ GHI gì đó, HOẶC khi máy chủ báo chủ nguồn vừa đổi: banner «Tải lại» mà chỉ đóng hộp thoại (daChup = 0) thì trang giữ
    // `chu` cũ, mở lại gửi cùng `chuDuKien` cũ và bị từ chối lần nữa — vòng lặp không lối ra.
    if (daChup > 0 || loi?.vuaDoi) router.refresh();
  }

  return (
    <Dialog open onOpenChange={(m) => !m && !dangChay && dongVaLamMoi()}>
      {/* `admin-scope` TRÊN CHÍNH PANEL: hộp thoại render qua portal ra ngoài khung admin, nơi `--primary` rơi về CAM của :root. */}
      {/* `max-h` + cuộn: `DialogContent` nền không giới hạn chiều cao — ở 375×800 hộp thoại (có ghi chú «giữ chủ cũ») cao 837px, nút «Huỷ» rơi khỏi màn hình và không cuộn tới được (đo khi chụp). */}
      <DialogContent showCloseButton={false} className="admin-scope max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Chụp lại chủ nguồn cho lead cũ</DialogTitle>
          <DialogDescription render={<div />} className="text-sm text-muted-foreground">
            Nguồn «{view.tenNguon}» · chủ nguồn hiện tại:{" "}
            <b className="font-semibold text-foreground">
              {view.chu.ten}
              {view.chu.maNv ? ` (${view.chu.maNv})` : ""}
            </b>
          </DialogDescription>
        </DialogHeader>

        {pha === "nhap" || pha === "loi" || pha === "chay" ? (
          <>
            <p className="text-sm text-foreground">
              Lead ghi nhận từ trước đang giữ bản chụp chủ nguồn lúc đó, nên phần hoa hồng của chủ nguồn bị treo. Bấm xác nhận sẽ ghi{" "}
              <b className="font-semibold">{view.chu.ten}</b> làm chủ nguồn cho <b className="tabular-nums">{soVN(view.tong)}</b> lead sau:
            </p>
            <ul className="space-y-1 text-sm">
              {THU_TU.filter((k) => view.theoLyDo[k] > 0).map((k) => (
                <li key={k} className="flex items-baseline justify-between gap-3 border-b border-border py-1.5 last:border-b-0">
                  <span className="text-foreground">{NHAN_LY_DO_CHUP_LAI[k]}</span>
                  <span className="whitespace-nowrap font-semibold tabular-nums text-foreground">{soVN(view.theoLyDo[k])} lead</span>
                </li>
              ))}
            </ul>
            {view.giuChuCu > 0 && (
              <div role="note" className="flex items-start gap-2 rounded-lg bg-state-warning-soft px-3 py-2.5 text-sm text-state-warning-ink">
                <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0 flex-1 space-y-1">
                  <p>
                    <b className="font-semibold tabular-nums">{soVN(view.giuChuCu)} lead</b> GIỮ chủ cũ vì đã có khoản chi cho chủ cũ — chụp lại sẽ đòi lại tiền đã trả hợp lệ.
                  </p>
                  <p>Chuyển người nhận của lead đó chỉ có «Đổi nguồn» ở trang lead: nó tự ghi điều chỉnh THU HỒI phần đã chi cho chủ cũ, không qua người duyệt.</p>
                </div>
              </div>
            )}
            <div className="space-y-1 text-sm text-muted-foreground">
              <p>Không đổi: lead có chủ đã chụp còn làm việc · lead đã có khoản chi cho chủ cũ · cửa sổ ghi công · ngày ghi nhận · nhóm nguồn.</p>
              <p>Sau đó Tính lại kỳ: khoản thu đã tính hiện ở tab Sổ → Cần xử lý → «Chờ điều chỉnh» để người duyệt áp dụng; khoản chưa tính sẽ tính thẳng.</p>
            </div>

            {loi && (
              <div role="alert" className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg bg-state-danger-soft px-3 py-2.5 text-sm text-state-danger-ink">
                <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                <p className="min-w-0 flex-1">{loi.text}</p>
                {loi.vuaDoi && (
                  <button
                    type="button"
                    onClick={dongVaLamMoi}
                    className={cn(BTN_OUTLINE, NUT_NHO)}
                  >
                    Tải lại
                  </button>
                )}
              </div>
            )}

            <div>
              <label htmlFor="chup-lai-ly-do" className={NHAN_O}>
                Lý do (tối thiểu 10 ký tự)
              </label>
              <textarea
                id="chup-lai-ly-do"
                rows={2}
                maxLength={500}
                value={lyDo}
                disabled={dangChay}
                onChange={(e) => {
                  setLyDo(e.target.value);
                  setLoiLyDo(null);
                }}
                aria-invalid={loiLyDo ? true : undefined}
                aria-describedby={loiLyDo ? "chup-lai-loi-ly-do" : undefined}
                placeholder="Ví dụ: Đã khai chủ nguồn sau khi lead được ghi nhận."
                className={TEXTAREA}
              />
              {loiLyDo && (
                <p id="chup-lai-loi-ly-do" role="alert" className={LOI_O}>
                  {loiLyDo}
                </p>
              )}
            </div>

            {(dangChay || daChup > 0) && (
              <div aria-live="polite">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-foreground">{dangChay ? "Đang chụp lại…" : "Đã dừng giữa chừng"}</span>
                  <span className="whitespace-nowrap font-semibold tabular-nums text-foreground">
                    {soVN(daChup)} / {soVN(view.tong)} lead
                  </span>
                </div>
                <div role="progressbar" aria-label="Tiến độ chụp lại" aria-valuemin={0} aria-valuemax={view.tong} aria-valuenow={Math.min(daChup, view.tong)} className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full bg-primary" style={{ width: `${phanTram}%` }} />
                </div>
              </div>
            )}
          </>
        ) : (
          <div role="status" className="flex items-start gap-2 text-sm text-foreground">
            <CheckCircle2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-state-success-ink" />
            <div className="min-w-0 space-y-1">
              <p>
                Đã chụp lại chủ nguồn cho <b className="tabular-nums">{soVN(daChup)}</b> lead. Nhật ký đã ghi lý do, danh sách lead và chủ cũ của từng lead. Tính lại kỳ để khoản thu đã tính hiện ở tab Sổ → Cần xử lý → «Chờ điều chỉnh».
              </p>
              {boQua > 0 && (
                <p className="text-state-warning-ink">
                  <b className="font-semibold tabular-nums">{soVN(boQua)}</b> lead được BỎ QUA (vừa bị người khác đổi trong lúc chạy, hoặc bản chụp hỏng) nên chưa chụp lại — tải lại trang để xem số còn lại.
                </p>
              )}
              {view.giuChuCu > 0 && (
                <p className="text-muted-foreground">
                  <span className="tabular-nums">{soVN(view.giuChuCu)}</span> lead đã chi cho chủ cũ vẫn giữ chủ cũ.
                </p>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <button type="button" onClick={dongVaLamMoi} disabled={dangChay} className={cn(BTN_OUTLINE, NUT_CHAN)}>
            {pha === "xong" ? "Đóng" : "Huỷ"}
          </button>
          {pha !== "xong" && (
            <button type="button" onClick={() => void batDau()} disabled={dangChay} className={cn(BTN_PRIMARY, NUT_CHAN)}>
              {dangChay && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
              {pha === "loi" && daChup > 0 ? "Tiếp tục" : `Chụp lại ${soVN(view.tong)} lead`}
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
