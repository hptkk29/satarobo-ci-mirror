"use client";

// Nút XỬ LÝ cho một giao dịch còn nằm trong hàng chờ đối soát (UNMATCHED).
//
// Ba việc người dùng thực sự làm khi nhìn một dòng tiền lạ:
//   1. "Tiền này của đơn nào" → tìm đơn, rồi CHIA cho từng con.
//   2. "Tiền này không phải học phí" → BỎ QUA, kèm lý do (chỉ kế toán).
//   3. "Gắn nhầm rồi" → GỠ (chỉ kế toán) — nút đó nằm ở dòng đã MATCHED, không ở đây.
// Cố ý KHÔNG có nút "xoá" — tiền đã về tài khoản thì sổ phải giữ dòng đó mãi, chỉ đổi nhãn.
//
// ⚠️ PHIÊN B — bước 2 là bước MỚI và là toàn bộ điểm của lượt này. Trước đây bấm vào một đơn
// là rót thẳng toàn bộ số tiền vào phiếu mở sớm nhất rồi để waterfall tự tràn. Với đơn một con
// thì đúng; với đơn nhiều con thì đó là đoán — và đoán sai thì bé A hết nợ trong khi bé B vẫn
// bị gọi điện đòi tiền. Nay người bấm phải NÓI RÕ đợt nào bao nhiêu.
//
// ⚠️ KHÔNG có ô "số tiền tự do". Mọi ô nhập đều gắn với một đợt cụ thể, và tổng phải đúng bằng
// số tiền giao dịch. Đó là bất biến B2 (*Σ phân bổ ∈ {0, số tiền giao dịch}*) hiện ra thành
// hình dạng của cái form: không có chỗ để gõ một khoản không thuộc đợt nào.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  timDonDeGan,
  boQuaGiaoDich,
  ganGiaoDichVaoDon,
  type DonUngVien,
} from "../_actions";
import {
  taiChiTietDonDeGan,
  ganGiaoDichTheoConAction,
  taoDotChoConTaiChoAction,
  type ChiTietDonDeGan,
} from "../_gan-theo-con";

const fmt = (n: number) => new Intl.NumberFormat("vi-VN").format(n);

/** Bỏ mọi thứ không phải chữ số — ô tiền cho gõ "1.200.000" hay "1 200 000" đều được. */
const doSo = (s: string) => {
  const chi = s.replace(/[^\d]/g, "");
  return chi === "" ? 0 : Number(chi);
};

export function XuLyGiaoDich({
  bankTransactionId,
  amount,
  /** Nội dung CK — dùng làm từ khoá tìm sẵn, đỡ phải gõ lại. */
  goiY,
  /** `payments:manage` — chỉ kế toán. Quyết định nút "Không phải học phí" có hiện không. */
  laKeToan = false,
}: {
  bankTransactionId: string;
  amount: number;
  goiY: string | null;
  laKeToan?: boolean;
}) {
  const router = useRouter();
  const [mo, setMo] = useState<"gan" | "boqua" | null>(null);
  const [tuKhoa, setTuKhoa] = useState("");
  const [ketQuaTim, setKetQuaTim] = useState<DonUngVien[] | null>(null);
  const [chiTiet, setChiTiet] = useState<ChiTietDonDeGan | null>(null);
  const [nhap, setNhap] = useState<Record<string, string>>({});
  const [moTaoDot, setMoTaoDot] = useState<string | null>(null);
  const [lyDo, setLyDo] = useState("");
  const [dangChay, batDau] = useTransition();

  function timKiem(q: string) {
    if (q.trim().length < 2) {
      setKetQuaTim(null);
      return;
    }
    batDau(async () => {
      setKetQuaTim(await timDonDeGan(q));
    });
  }

  function chonDon(don: DonUngVien) {
    batDau(async () => {
      const ct = await taiChiTietDonDeGan(don.id);
      if ("error" in ct) {
        toast.error(ct.error);
        return;
      }
      setChiTiet(ct);
      setNhap({});
    });
  }

  function taiLaiChiTiet(orderId: string) {
    batDau(async () => {
      const ct = await taiChiTietDonDeGan(orderId);
      if (!("error" in ct)) setChiTiet(ct);
    });
  }

  function chia() {
    if (!chiTiet) return;
    const dong = Object.entries(nhap)
      .map(([paymentRequestId, v]) => ({ paymentRequestId, soTien: doSo(v) }))
      .filter((d) => d.soTien > 0);
    batDau(async () => {
      const res = await ganGiaoDichTheoConAction({
        bankTransactionId,
        orderId: chiTiet.orderId,
        dong,
      });
      if (res.ok) {
        toast.success(res.message);
        setMo(null);
        setChiTiet(null);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  /**
   * Nhánh CỜ TẮT: rót toàn bộ vào phiếu mở sớm nhất, y như trước PHIÊN B.
   *
   * ⚠️ Không phải "phiên bản rút gọn" của màn chia — nó là ĐƯỜNG GHI KHÁC
   * (`allocateToOrder` + waterfall + side-effect sau commit). Giữ nguyên để cờ tắt thì prod
   * không đổi một hành vi nào.
   */
  function ganToanDon() {
    if (!chiTiet) return;
    batDau(async () => {
      const res = await ganGiaoDichVaoDon(bankTransactionId, chiTiet.orderId);
      if (res.ok) {
        toast.success(res.message);
        setMo(null);
        setChiTiet(null);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  function boQua() {
    batDau(async () => {
      const res = await boQuaGiaoDich(bankTransactionId, lyDo);
      if (res.ok) {
        toast.success(res.message);
        setMo(null);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  // ── Trạng thái nghỉ ─────────────────────────────────────────────────────────
  if (!mo) {
    return (
      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={() => {
            setMo("gan");
            // Nội dung CK là manh mối sẵn có tốt nhất — đổ vào ô tìm và tìm luôn.
            const seed = (goiY ?? "").trim();
            setTuKhoa(seed);
            if (seed) timKiem(seed);
          }}
          className="rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-white transition-colors duration-150 hover:opacity-90"
        >
          Gắn vào đơn
        </button>
        {laKeToan && (
          <button
            type="button"
            onClick={() => setMo("boqua")}
            className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted"
          >
            Không phải học phí
          </button>
        )}
      </div>
    );
  }

  // ── Bỏ qua ──────────────────────────────────────────────────────────────────
  if (mo === "boqua") {
    return (
      <div className="w-[260px] space-y-2 rounded-md border border-border bg-card p-2">
        <label className="block text-xs font-semibold text-foreground">
          Lý do bỏ qua <span className="text-state-danger-ink">*</span>
        </label>
        <textarea
          value={lyDo}
          onChange={(e) => setLyDo(e.target.value)}
          rows={2}
          placeholder="vd: tiền nhà, hoàn ứng, khách chuyển nhầm…"
          className="w-full rounded border border-border px-2 py-1 text-xs focus:border-primary focus:outline-none"
        />
        <p className="text-[11px] leading-snug text-muted-foreground">
          Giao dịch ra khỏi hàng chờ nhưng vẫn nằm nguyên trong sổ. Lý do bắt buộc để sau này
          còn tra lại được.
        </p>
        <div className="flex gap-1.5">
          <button
            type="button"
            disabled={dangChay || !lyDo.trim()}
            onClick={boQua}
            className="rounded bg-state-warning-ink px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50"
          >
            {dangChay ? "Đang lưu…" : "Xác nhận bỏ qua"}
          </button>
          <button
            type="button"
            onClick={() => setMo(null)}
            className="rounded border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted"
          >
            Huỷ
          </button>
        </div>
      </div>
    );
  }

  // ── Đã chọn đơn, CỜ TẮT → luồng CŨ: rót toàn đơn ────────────────────────────
  if (chiTiet && !chiTiet.kieuMoi) {
    return (
      <div className="w-[min(92vw,340px)] space-y-2 rounded-md border border-border bg-card p-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate font-mono text-xs font-semibold text-foreground">
              {chiTiet.code}
            </div>
            <div className="text-[11px] text-muted-foreground">Rót {fmt(amount)}đ vào đơn này</div>
          </div>
          <button
            type="button"
            onClick={() => setChiTiet(null)}
            className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
          >
            ← Đổi đơn
          </button>
        </div>
        <p className="rounded bg-muted px-2 py-1 text-[11px] leading-snug text-muted-foreground">
          Cơ sở của đơn này chưa bật thu học phí linh hoạt, nên tiền rót vào phiếu thu mở sớm
          nhất rồi tràn dần sang các đợt sau. Muốn chia đích danh cho từng con thì bật công tắc
          cho cơ sở đó trước.
        </p>
        <div className="flex gap-1.5">
          <button
            type="button"
            disabled={dangChay}
            onClick={ganToanDon}
            className="rounded bg-primary px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50"
          >
            {dangChay ? "Đang rót…" : "Rót vào đơn"}
          </button>
          <button
            type="button"
            onClick={() => {
              setMo(null);
              setChiTiet(null);
            }}
            className="rounded border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted"
          >
            Huỷ
          </button>
        </div>
      </div>
    );
  }

  // ── Đã chọn đơn → CHIA THEO CON ─────────────────────────────────────────────
  if (chiTiet) {
    const daNhap = Object.values(nhap).reduce((s, v) => s + doSo(v), 0);
    const lech = daNhap - amount;
    const dung = lech === 0 && daNhap > 0;

    return (
      <div className="w-[min(92vw,420px)] space-y-2 rounded-md border border-border bg-card p-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate font-mono text-xs font-semibold text-foreground">
              {chiTiet.code}
            </div>
            <div className="text-[11px] text-muted-foreground">
              Chia {fmt(amount)}đ cho từng con
            </div>
          </div>
          <button
            type="button"
            onClick={() => setChiTiet(null)}
            className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
          >
            ← Đổi đơn
          </button>
        </div>

        {/* Thước đo luôn hiện: người nhập không phải tự cộng nhẩm để biết còn thiếu bao nhiêu. */}
        <div
          className={`flex items-baseline justify-between rounded px-2 py-1 text-xs ${
            dung
              ? "bg-state-success-bg text-state-success-ink"
              : "bg-state-warning-bg text-state-warning-ink"
          }`}
        >
          <span className="font-medium">
            {dung ? "Khớp đủ" : lech > 0 ? "Đang thừa" : "Còn thiếu"}
          </span>
          <span className="tabular-nums font-semibold">
            {fmt(daNhap)}đ / {fmt(amount)}đ
            {lech !== 0 && <> · {lech > 0 ? "+" : "−"}{fmt(Math.abs(lech))}đ</>}
          </span>
        </div>

        {chiTiet.chuaGanCon > 0 && (
          <p className="rounded bg-muted px-2 py-1 text-[11px] leading-snug text-muted-foreground">
            Đơn này còn {fmt(chiTiet.chuaGanCon)}đ đã thu nhưng chưa gắn cho bé nào.
          </p>
        )}

        <div className="max-h-[46vh] space-y-2 overflow-y-auto">
          {chiTiet.con.map((c) => (
            <div key={c.orderItemId} className="rounded border border-border p-2">
              <div className="flex items-baseline justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold text-foreground">{c.ten}</div>
                  {c.khoa && (
                    <div className="truncate text-[11px] text-muted-foreground">{c.khoa}</div>
                  )}
                </div>
                <div className="shrink-0 text-right text-[11px] text-muted-foreground">
                  còn nợ{" "}
                  <b className="tabular-nums text-foreground">{fmt(c.conNo)}đ</b>
                </div>
              </div>

              {c.dot.length === 0 ? (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Bé này chưa có đợt nào đang mở.
                </p>
              ) : (
                <ul className="mt-1.5 space-y-1">
                  {c.dot.map((d) => (
                    <li key={d.paymentRequestId} className="flex items-center gap-2">
                      <span className="w-14 shrink-0 text-[11px] text-muted-foreground">
                        Đợt {d.installmentNo}
                      </span>
                      <span className="w-24 shrink-0 tabular-nums text-[11px] text-muted-foreground">
                        ≤ {fmt(d.conLai)}đ
                      </span>
                      <input
                        inputMode="numeric"
                        value={nhap[d.paymentRequestId] ?? ""}
                        onChange={(e) =>
                          setNhap((cu) => ({ ...cu, [d.paymentRequestId]: e.target.value }))
                        }
                        placeholder="0"
                        className="min-w-0 flex-1 rounded border border-border px-2 py-1 text-right text-xs tabular-nums focus:border-primary focus:outline-none"
                      />
                      <button
                        type="button"
                        // Lối tắt cho ca thường gặp nhất: khách chuyển đúng số của đợt.
                        onClick={() =>
                          setNhap((cu) => ({
                            ...cu,
                            [d.paymentRequestId]: String(Math.min(d.conLai, amount)),
                          }))
                        }
                        className="shrink-0 rounded border border-border px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-muted"
                      >
                        đủ
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {moTaoDot === c.orderItemId ? (
                <FormTaoDotTaiCho
                  orderId={chiTiet.orderId}
                  orderItemId={c.orderItemId}
                  goiYSoTien={Math.max(0, Math.min(c.conNo, amount))}
                  dangChay={dangChay}
                  onXong={() => {
                    setMoTaoDot(null);
                    taiLaiChiTiet(chiTiet.orderId);
                  }}
                  onHuy={() => setMoTaoDot(null)}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setMoTaoDot(c.orderItemId)}
                  className="mt-1.5 text-[11px] font-medium text-primary hover:underline"
                >
                  + Tạo đợt cho {c.ten}…
                </button>
              )}
            </div>
          ))}

          {chiTiet.dotChungChuaChiaCon.length > 0 && (
            <div className="rounded border border-dashed border-border p-2">
              <div className="text-xs font-semibold text-foreground">Đợt chung (chưa chia con)</div>
              <p className="text-[11px] leading-snug text-muted-foreground">
                Đợt của luồng cũ — thu cho cả đơn, không thuộc bé nào.
              </p>
              <ul className="mt-1.5 space-y-1">
                {chiTiet.dotChungChuaChiaCon.map((d) => (
                  <li key={d.paymentRequestId} className="flex items-center gap-2">
                    <span className="w-14 shrink-0 text-[11px] text-muted-foreground">
                      Đợt {d.installmentNo}
                    </span>
                    <span className="w-24 shrink-0 tabular-nums text-[11px] text-muted-foreground">
                      ≤ {fmt(d.conLai)}đ
                    </span>
                    <input
                      inputMode="numeric"
                      value={nhap[d.paymentRequestId] ?? ""}
                      onChange={(e) =>
                        setNhap((cu) => ({ ...cu, [d.paymentRequestId]: e.target.value }))
                      }
                      placeholder="0"
                      className="min-w-0 flex-1 rounded border border-border px-2 py-1 text-right text-xs tabular-nums focus:border-primary focus:outline-none"
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="flex gap-1.5">
          <button
            type="button"
            disabled={dangChay || !dung}
            onClick={chia}
            className="rounded bg-primary px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50"
          >
            {dangChay ? "Đang ghi…" : "Ghi phân bổ"}
          </button>
          <button
            type="button"
            onClick={() => {
              setMo(null);
              setChiTiet(null);
            }}
            className="rounded border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted"
          >
            Huỷ
          </button>
        </div>
        {!dung && (
          <p className="text-[11px] leading-snug text-muted-foreground">
            Tổng phải đúng bằng số tiền giao dịch — chia hết, hoặc không chia gì.
          </p>
        )}
      </div>
    );
  }

  // ── Tìm đơn ─────────────────────────────────────────────────────────────────
  return (
    <div className="w-[min(92vw,340px)] space-y-2 rounded-md border border-border bg-card p-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-foreground">
          Gắn {fmt(amount)}đ vào đơn nào?
        </span>
        <button
          type="button"
          onClick={() => setMo(null)}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Đóng
        </button>
      </div>

      <input
        value={tuKhoa}
        onChange={(e) => {
          setTuKhoa(e.target.value);
          timKiem(e.target.value);
        }}
        placeholder="Mã đơn / SĐT phụ huynh / tên con…"
        className="w-full rounded border border-border px-2 py-1 text-xs focus:border-primary focus:outline-none"
      />

      {dangChay && <p className="text-[11px] text-muted-foreground">Đang tìm…</p>}

      {!dangChay && ketQuaTim !== null && ketQuaTim.length === 0 && (
        <p className="text-[11px] leading-snug text-muted-foreground">
          Không có đơn nào đang chờ thu khớp từ khoá này. Thử SĐT phụ huynh, hoặc tên con.
        </p>
      )}

      {ketQuaTim && ketQuaTim.length > 0 && (
        <ul className="max-h-56 space-y-1 overflow-y-auto">
          {ketQuaTim.map((d) => {
            // Số tiền không phải khoá đối khớp, nhưng lệch nhiều thì đáng để người bấm nhìn
            // thấy trước khi bấm — đây là lớp phòng vệ cuối bằng mắt người.
            const khop = d.conThieu === amount;
            return (
              <li key={d.id}>
                <button
                  type="button"
                  disabled={dangChay}
                  onClick={() => chonDon(d)}
                  className="w-full rounded border border-border px-2 py-1.5 text-left text-xs transition-colors duration-150 hover:border-primary hover:bg-muted disabled:opacity-50"
                >
                  <span className="font-mono font-semibold text-foreground">{d.code}</span>
                  {d.studentName && <span className="text-foreground"> · {d.studentName}</span>}
                  {d.customerPhone && (
                    <span className="text-muted-foreground"> · {d.customerPhone}</span>
                  )}
                  <div className="mt-0.5 text-muted-foreground">
                    {d.courseName && <span>{d.courseName} · </span>}
                    còn thiếu{" "}
                    <b
                      className={`tabular-nums ${khop ? "text-state-success-ink" : "text-state-warning-ink"}`}
                    >
                      {fmt(d.conThieu)}đ
                    </b>
                    {khop ? " (khớp đúng số tiền)" : " (lệch số tiền — kiểm lại)"}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Tạo một đợt cho con ngay trong màn gắn — xem lý do ở `taoDotChoConTaiChoAction`. */
function FormTaoDotTaiCho({
  orderId,
  orderItemId,
  goiYSoTien,
  dangChay,
  onXong,
  onHuy,
}: {
  orderId: string;
  orderItemId: string;
  goiYSoTien: number;
  dangChay: boolean;
  onXong: () => void;
  onHuy: () => void;
}) {
  const [soTien, setSoTien] = useState(goiYSoTien > 0 ? String(goiYSoTien) : "");
  const [han, setHan] = useState("");
  const [dangGui, batDau] = useTransition();

  function tao() {
    batDau(async () => {
      const res = await taoDotChoConTaiChoAction({
        orderId,
        orderItemId,
        soTien: doSo(soTien),
        dueDate: han || null,
      });
      if (res.ok) {
        toast.success(res.message);
        onXong();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <div className="mt-1.5 space-y-1.5 rounded border border-border bg-muted/40 p-1.5">
      <div className="flex gap-1.5">
        <input
          inputMode="numeric"
          value={soTien}
          onChange={(e) => setSoTien(e.target.value)}
          placeholder="Số tiền"
          className="min-w-0 flex-1 rounded border border-border px-2 py-1 text-right text-xs tabular-nums focus:border-primary focus:outline-none"
        />
        <input
          type="date"
          value={han}
          onChange={(e) => setHan(e.target.value)}
          className="w-[7.5rem] shrink-0 rounded border border-border px-1.5 py-1 text-xs focus:border-primary focus:outline-none"
        />
      </div>
      <div className="flex gap-1.5">
        <button
          type="button"
          disabled={dangGui || dangChay || doSo(soTien) <= 0}
          onClick={tao}
          className="rounded bg-primary px-2 py-0.5 text-[11px] font-semibold text-white disabled:opacity-50"
        >
          {dangGui ? "Đang tạo…" : "Tạo đợt"}
        </button>
        <button
          type="button"
          onClick={onHuy}
          className="rounded border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted"
        >
          Huỷ
        </button>
      </div>
    </div>
  );
}
