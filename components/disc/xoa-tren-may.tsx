"use client";
/**
 * N13 — "Xoá dữ liệu DISC trên máy này". Máy dùng chung (tiệm net, máy trường) không được giữ tên + năm sinh của trẻ,
 * câu trả lời thô hay MÃ NHẬN của người dùng trước. Xoá MỌI khoá DISC (nháp trong sessionStorage, nháp v1 cũ + mã nhận trong localStorage), một nơi duy nhất.
 * Không đụng dữ liệu đã lưu trên máy chủ (muốn xoá phần đó dùng luồng "xoá theo yêu cầu").
 */
import { useState } from "react";
import { KHOA_BAN_NHAP, KHOA_BAN_NHAP_CU_V1 } from "./ban-nhap";
import { xoaMaNhanLocal } from "@/lib/disc/nhan-ma-local";
import { Ic } from "@/components/public/disc/bieu-tuong";

/** Trả true khi KHÔNG còn khoá DISC nào (kể cả khi localStorage không dùng được: không có gì để xoá). */
export function xoaDuLieuDiscTrenMay(): boolean {
  try {
    window.sessionStorage.removeItem(KHOA_BAN_NHAP);
  } catch {
    /* bỏ qua */
  }
  try {
    window.localStorage.removeItem(KHOA_BAN_NHAP_CU_V1);
  } catch {
    /* bỏ qua */
  }
  xoaMaNhanLocal();
  try {
    return (
      window.sessionStorage.getItem(KHOA_BAN_NHAP) === null &&
      window.localStorage.getItem(KHOA_BAN_NHAP_CU_V1) === null &&
      window.localStorage.getItem("sr.disc.maNhan") === null
    );
  } catch {
    return true;
  }
}

/**
 * Nút xoá — markup CHÉP từ artifact "Disc-LamBai": `kieu="aside"` (khung `.dj-hide-sm` ở cột trái, có dòng trạng thái), `kieu="di-dong"`
 * (`.dj-only-sm` ở cuối trang, chỉ hiện ≤ 900px — dùng chung hàm xoá nhưng KHÔNG mang data-testid để testid là duy nhất),
 * `kieu="nhe"` (`.linkbtn` trong thẻ "Đã lưu kết quả"). Mặc định "aside".
 */
export function NutXoaTrenMay({ onDaXoa, className, kieu = "aside" }: { onDaXoa?: () => void; className?: string; kieu?: "aside" | "di-dong" | "nhe" }) {
  const [tb, setTb] = useState<"" | "xong" | "loi">("");
  const xoa = () => {
    const ok = xoaDuLieuDiscTrenMay();
    setTb(ok ? "xong" : "loi");
    if (ok) onDaXoa?.();
  };
  const chu = tb === "xong" ? "Đã xoá bản nháp và mã nhận khỏi thiết bị này." : tb === "loi" ? "Không xoá được hết. Hãy xoá dữ liệu trang web trong cài đặt trình duyệt." : "";
  if (kieu === "di-dong") {
    return (
      <div className={"dj-only-sm" + (className ? " " + className : "")} style={{ marginTop: "18px" }}>
        <button type="button" className="btn btn-line" onClick={xoa} style={{ minHeight: "44px", fontSize: "14px" }}>
          <Ic ten="rac" size={15} />
          Xoá dữ liệu DISC trên máy này
        </button>
      </div>
    );
  }
  if (kieu === "nhe") {
    return (
      <div className={className} style={{ borderTop: "1px solid var(--line)", paddingTop: "16px" }}>
        <button type="button" className="linkbtn" onClick={xoa} style={{ color: "var(--muted)", fontSize: "14px", minHeight: "36px" }} data-testid="disc-xoa-tren-may">
          Xoá dữ liệu DISC trên máy này
        </button>
        <p role="status" className="dj-note" style={{ marginTop: chu ? "8px" : 0, display: chu ? undefined : "none" }} data-testid="disc-xoa-tren-may-tb">
          {chu}
        </p>
      </div>
    );
  }
  return (
    <div className={"dj-hide-sm" + (className ? " " + className : "")}>
      <button type="button" className="btn btn-line" onClick={xoa} style={{ minHeight: "44px", fontSize: "14px" }} data-testid="disc-xoa-tren-may">
        <Ic ten="rac" size={15} />
        Xoá dữ liệu DISC trên máy này
      </button>
      <p role="status" className="dj-note" style={{ marginTop: chu ? "8px" : 0, display: chu ? undefined : "none" }} data-testid="disc-xoa-tren-may-tb">
        {chu}
      </p>
    </div>
  );
}
