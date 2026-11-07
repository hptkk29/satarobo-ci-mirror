"use client";

/**
 * Màn thành công — CHỈ được dựng khi máy chủ trả `ok:true` (xem `HanhTrinhDisc`).
 * Chữ lấy NGUYÊN từ `thongBaoSauLuu`: một câu trung tính cho mọi SĐT, dòng email chỉ có khi có email.
 *
 * Mã nhận (`maNhan`): máy chủ chỉ giữ HASH nên đây là LẦN DUY NHẤT mã hiện ra. Màn này:
 *  - hiện mã định dạng ABCDE-FGHJK, nút chép, và nói thẳng "mất mã thì không xem lại được";
 *  - ghi mã vào máy này (`ghiMaNhanLocal`) để form nhận bài tự điền — mất cũng không sao;
 *  - `maNhan === null` (phát lại khi bài đã được nhận) ⇒ KHÔNG có ô mã, không dựng mã giả.
 * Mã KHÔNG được đưa vào URL, tiêu đề tab, analytics hay log.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ghiMaNhanLocal } from "@/lib/disc/nhan-ma-local";
import type { ThongBaoSauLuu } from "@/lib/disc/thong-bao";
import { PubAnh } from "@/components/public/pub-design/pub-anh";
import { Ic } from "@/components/public/disc/bieu-tuong";
import { NutXoaTrenMay } from "./xoa-tren-may";
import { dinhDangMaNhan } from "./ma-nhan";

export const DUONG_DAN_NHAN_KET_QUA = "/kich-hoat?disc=1";

type TrangThaiChep = "chua" | "daChep" | "khongChep";

export function ManThanhCong({
  thongBao,
  maNhan = null,
  onLamLai,
  taiKetQua,
}: {
  thongBao: ThongBaoSauLuu;
  /** Mã nhận thô (10 ký tự) hoặc null. Hiện MỘT lần. */
  maNhan?: string | null;
  onLamLai: () => void;
  /** Chỗ cắm nút tải/ xem kết quả khi route PDF có (chưa có thì để trống — không dựng nút giả). */
  taiKetQua?: React.ReactNode;
}) {
  const [chep, setChep] = useState<TrangThaiChep>("chua");
  const maHienThi = maNhan ? dinhDangMaNhan(maNhan) : null;
  const oMa = useRef<HTMLElement>(null);

  // Ghi vào máy này để form nhận bài tự điền. Lỗi localStorage đã được nuốt trong ghiMaNhanLocal.
  useEffect(() => {
    if (maNhan) ghiMaNhanLocal(maNhan);
  }, [maNhan]);

  const chepMa = async () => {
    if (!maHienThi) return;
    try {
      await navigator.clipboard.writeText(maHienThi);
      setChep("daChep");
    } catch {
      // Không có quyền clipboard / không an toàn: bôi đen mã để người dùng tự chép, và nói thật.
      try {
        const r = document.createRange();
        if (oMa.current) {
          r.selectNodeContents(oMa.current);
          const s = window.getSelection();
          s?.removeAllRanges();
          s?.addRange(r);
        }
      } catch {
        /* bỏ qua */
      }
      setChep("khongChep");
    }
  };

  return (
    <section aria-labelledby="disc-tc-t" data-testid="disc-thanh-cong" className="dj-card">
      <div className="dteam" aria-hidden="true">
        <PubAnh id="3d425f2a2c063a1916225676ca19f4f4" alt="" sizes="62px" />
        <PubAnh id="21be53cabd4ac017cdbde87433593cfb" alt="" sizes="62px" />
        <PubAnh id="2e4a9309e1a6bfcb633b68ee102428e9" alt="" sizes="62px" />
        <PubAnh id="7e643cba294434d8258e05d15f9c242c" alt="" sizes="62px" />
      </div>
      <h2 id="disc-tc-t" className="dok">
        <span className="okc">
          <Ic ten="tick" size={26} />
        </span>
        <span>
          Đã lưu <span className="grad">kết quả</span>
        </span>
      </h2>

      {maHienThi && (
        <div className="dsum" style={{ display: "grid", gap: "14px", borderColor: "var(--line2)" }} data-testid="disc-ma-nhan-khung">
          <p style={{ margin: "0", display: "flex", gap: "8px", alignItems: "center", fontWeight: "800", fontSize: "14px" }}>
            <Ic ten="chiaKhoa" size={18} /> Mã nhận kết quả của bạn
          </p>
          <p className="dcode">
            <code ref={oMa} data-testid="disc-ma-nhan">
              {maHienThi}
            </code>
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", alignItems: "center" }}>
            <button type="button" className="btn btn-line" onClick={chepMa} style={{ minHeight: "44px" }} data-testid="disc-ma-nhan-chep">
              <Ic ten="sao" size={16} />
              {chep === "daChep" ? "Đã chép mã" : "Chép mã"}
            </button>
            <span role="status" style={{ fontSize: "14px", color: "var(--muted)" }} data-testid="disc-ma-nhan-chep-tb">
              {chep === "daChep" && "Đã chép vào bộ nhớ tạm."}
              {chep === "khongChep" && "Trình duyệt không cho chép tự động. Mã đã được bôi đen, bạn hãy chép hoặc chụp màn hình."}
            </span>
          </div>
          <p className="dnote am" data-testid="disc-ma-nhan-canh-bao">
            <Ic ten="canhBao" />
            <span>
              <strong>Mã này chỉ hiện một lần.</strong> Chúng tôi không lưu mã dạng đọc được, nên nếu mất mã bạn sẽ <strong>không xem lại được</strong> và không nhận được kết quả vào tài khoản. Hãy chép hoặc chụp màn hình ngay. Bạn sẽ cần mã này, cùng mã xác minh gửi về số điện thoại, ở bước “Nhận kết quả vào tài khoản”.
            </span>
          </p>
        </div>
      )}

      <div style={{ display: "grid", gap: "10px" }}>
        <p style={{ margin: "0", lineHeight: "1.65" }} data-testid="disc-tb-chinh">
          {thongBao.chinh}
        </p>
        {thongBao.email && (
          <p style={{ margin: "0", display: "flex", gap: "8px", lineHeight: "1.65" }} data-testid="disc-tb-email">
            <span style={{ color: "var(--purT)", flexShrink: "0", marginTop: "3px" }}>
              <Ic ten="thu" />
            </span>
            <span>{thongBao.email}</span>
          </p>
        )}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
        {taiKetQua}
        <Link href={DUONG_DAN_NHAN_KET_QUA} className="btn btn-acc" style={{ minHeight: "48px" }} data-testid="disc-nhan-ket-qua">
          {maHienThi ? "Nhận kết quả vào tài khoản" : "Kích hoạt hoặc đăng nhập để xem lại"}
        </Link>
        <button type="button" className="btn btn-line" onClick={onLamLai} style={{ minHeight: "48px" }}>
          Làm bài cho gia đình khác
        </button>
      </div>
      <NutXoaTrenMay kieu="nhe" />
    </section>
  );
}
