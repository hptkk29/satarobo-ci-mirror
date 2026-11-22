"use client";

/**
 * Màn làm bài của trang DISC CÔNG KHAI — CHÉP từ artifact "Disc-LamBai" (`section.dj-card` > `.dq-meta` · `.dq-line` · `.dq` · `.dopts` · `.dj-act`).
 *
 * Cùng hợp đồng với `components/disc/man-lam-bai.tsx` (bản đó vẫn dùng ở cổng phụ huynh — không đổi): cùng props, cùng `data-testid`,
 * cùng ô radio THẬT (nhãn `.dopt` bọc `<input type="radio">`, nằm trong `fieldset`) nên bàn phím / trình đọc màn hình / e2e chạy như cũ.
 * Thang trả lời do BỘ ĐỀ quyết định. Không chứa nội dung câu hỏi hay luật chấm điểm nào.
 */
import { useEffect, useRef } from "react";
import type { BoDeDisc } from "@/lib/disc/engine";
import { THANG_MAC_DINH, type MucThang } from "@/components/disc/man-lam-bai";
import { Ic } from "./bieu-tuong";

export function ManLamBaiCongKhai({
  boDe,
  tenNguoi,
  traLoi,
  cau,
  onTraLoi,
  onCau,
  onXong,
  onQuayLai,
  thang: thangNgoai,
  loi,
}: {
  boDe: BoDeDisc;
  /** Tên người đang được đánh giá (ba/mẹ hoặc bé) — chỉ để hiển thị. */
  tenNguoi: string;
  traLoi: Readonly<Record<string, number>>;
  cau: number;
  onTraLoi: (idCau: string, gia: number) => void;
  onCau: (viTri: number) => void;
  onXong: () => void;
  onQuayLai: () => void;
  thang?: readonly MucThang[];
  loi?: string | null;
}) {
  // Thang của BỘ ĐỀ (engine quyết định) thắng thang mặc định: bộ Tiểu học chỉ có 3 mức, gửi 4/5 là server từ chối cả bài.
  const thang: readonly MucThang[] = thangNgoai ?? boDe.thang ?? THANG_MAC_DINH;
  const tong = boDe.cauHoi.length;
  const viTri = Math.min(Math.max(cau, 0), Math.max(tong - 1, 0));
  const c = boDe.cauHoi[viTri];
  const tieuDe = useRef<HTMLHeadingElement>(null);
  const lanDau = useRef(true);

  // Sang câu mới thì đưa tiêu đề vào tầm đọc của trình đọc màn hình (không cuộn trang).
  useEffect(() => {
    if (lanDau.current) {
      lanDau.current = false;
      return;
    }
    tieuDe.current?.focus({ preventScroll: true });
  }, [viTri]);

  if (!c) {
    return (
      <div role="alert" className="dj-card">
        Bộ câu hỏi này chưa có câu nào. Vui lòng quay lại và thử lại sau.
      </div>
    );
  }

  const daChon = traLoi[c.id];
  const laCauCuoi = viTri === tong - 1;
  const thieuCau = boDe.cauHoi.filter((q) => traLoi[q.id] === undefined).length;
  const phanTram = tong > 0 ? Math.round(((viTri + 1) / tong) * 100) : 0;

  return (
    <section aria-labelledby="disc-cau-tieu-de" data-testid="disc-lam-bai" className="dj-card">
      <div className="dq-meta">
        <span className="dq-who">
          <i aria-hidden="true"></i>
          {boDe.nguoiLonTraLoiHo ? `Ba/mẹ trả lời hộ cho ${tenNguoi}` : `Bài của ${tenNguoi}`}
        </span>
        <span className="dq-n" aria-live="polite">
          Câu {viTri + 1} / {tong}
        </span>
      </div>
      <div className="dq-line" aria-hidden="true">
        <i style={{ width: `${phanTram}%` }}></i>
      </div>
      {boDe.nguoiLonTraLoiHo && (
        <p className="dnote vi" data-testid="disc-nguoi-lon-tra-loi-ho">
          <Ic ten="thongTin" />
          <span>
            Bé còn nhỏ nên <strong>người lớn quan sát và trả lời hộ</strong>. Hãy chọn theo những gì bạn thường thấy ở bé, không theo điều bạn mong bé như thế.
          </span>
        </p>
      )}
      <div style={{ display: "grid", gap: "6px" }}>
        {boDe.cauDan ? (
          <p className="dq-dan" data-testid="disc-cau-dan">
            {boDe.cauDan}
          </p>
        ) : null}
        <h2 id="disc-cau-tieu-de" ref={tieuDe} tabIndex={-1} className="dq" style={{ outline: "none" }}>
          {c.noiDung}
        </h2>
      </div>
      <fieldset style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
        <legend style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap" }}>Mức độ đúng với {boDe.nguoiLonTraLoiHo ? "bé" : "bạn"}</legend>
        <div className={"dopts n" + thang.length}>
          {thang.map((m) => {
            const chon = daChon === m.gia;
            return (
              <label key={m.gia} className={"dopt" + (chon ? " on" : "")}>
                <input
                  type="radio"
                  name={`cau-${c.id}`}
                  value={m.gia}
                  checked={chon}
                  onChange={() => onTraLoi(c.id, m.gia)}
                  style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
                />
                <span className="nb" aria-hidden="true">
                  {m.gia}
                </span>
                {m.mat ? (
                  <span className="mat" aria-hidden="true">
                    {m.mat}
                  </span>
                ) : null}
                <span>{m.nhan}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
      {loi && (
        <p role="alert" className="dnote re">
          <Ic ten="canhBao" />
          <span>{loi}</span>
        </p>
      )}
      <div className="dj-act">
        <button type="button" className="btn btn-line" onClick={viTri === 0 ? onQuayLai : () => onCau(viTri - 1)} style={{ minHeight: "48px" }} data-testid="disc-cau-truoc">
          <Ic ten="trai" />
          {viTri === 0 ? "Quay lại hồ sơ" : "Câu trước"}
        </button>{" "}
        {!laCauCuoi && (
          <button type="button" className="btn btn-acc" disabled={daChon === undefined} onClick={() => onCau(viTri + 1)} style={{ minHeight: "48px" }} data-testid="disc-cau-tiep">
            Câu tiếp
            <Ic ten="phai" />
          </button>
        )}{" "}
        {laCauCuoi && (
          <button
            type="button"
            className="btn btn-acc"
            disabled={thieuCau > 0}
            onClick={onXong}
            style={{ minHeight: "48px" }}
            data-testid="disc-cau-xong"
            aria-describedby={thieuCau > 0 ? "disc-con-thieu" : undefined}
          >
            Hoàn thành phần này
            <Ic ten="phai" />
          </button>
        )}
      </div>
      {laCauCuoi && thieuCau > 0 && (
        <p id="disc-con-thieu" className="dj-note" style={{ margin: "-6px 0 0" }}>
          Còn {thieuCau} câu chưa trả lời. Dùng “Câu trước” để quay lại những câu còn trống.
        </p>
      )}
    </section>
  );
}
