// components/admin/nguon-hoa-hong/khoi-nguon-lead.tsx — khối "Nguồn" trên chi tiết lead (06 §5.6).
//
// Sáu mục: Nguồn · Người giới thiệu · Cách xác định · Ngày ghi công · Còn hạn tới · Đường vào (cũ) — qua `ThongTinNguon`, CÙNG mảnh
// mà phần "Hiện tại" của Sheet dùng. Nút "Đổi nguồn" VẼ THEO QUYỀN (luật 12): chỉ khi `du.quyen.ok` — kết quả của `quyenDoiNguon`,
// cùng hàm mà cổng máy chủ gọi. Không đủ quyền thì KHÔNG vẽ nút (không nút xám bấm được); một dòng chữ nêu khoá còn thiếu.
//
// Dữ liệu `du` đến từ `docChoGanNguon` (đọc QUA Lead đã scope), nơi gọi đã gác `sources:view` ∧ cờ `nguon.enabled`.
// KHÔNG hiện hoa hồng của bất kỳ ai ở khối này (PRD §56) — "Hoa hồng dự kiến của bạn" là mảnh khác (PR8+, cần engine).
//
// Server Component: chỉ nút "Đổi nguồn" (và Sheet của nó) là client.
import Link from "next/link";
import { PencilLine, UserPlus } from "lucide-react";
import type { ChoGanNguon, NguonHienTai } from "@/lib/nguon/doc-gan-nguon";
import { NHAN_NGUON_NGUNG } from "@/lib/nguon/nhan-hien-thi";
import { BoSungSaleSheet } from "./bo-sung-sale-sheet";
import { BTN_OUTLINE } from "./classes";
import { GanNguonSheet } from "./gan-nguon-sheet";
import { ThongTinNguon } from "./thong-tin-nguon";

export function KhoiNguonLead({ du, coTheMoLead }: { du: ChoGanNguon; coTheMoLead: boolean }) {
  const nguon = du.nguon;
  return (
    <section aria-labelledby="khoi-nguon-tieu-de" className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="khoi-nguon-tieu-de" className="text-sm font-semibold text-foreground">
          Nguồn
        </h2>
        {nguon && du.quyen.ok && (
          <GanNguonSheet
            leadId={du.leadId}
            tenLead={du.tenLead}
            coTheMoLead={coTheMoLead}
            triggerAriaLabel="Đổi nguồn của lead này"
            triggerClassName={BTN_OUTLINE}
          >
            <PencilLine aria-hidden className="h-4 w-4" />
            Đổi nguồn
          </GanNguonSheet>
        )}
      </div>

      {nguon ? (
        <ThongTinNguon nguon={nguon} duongVao={du.duongVao} />
      ) : (
        <p className="text-sm text-muted-foreground">
          Lead này chưa có quy nguồn (tạo trước khi bật quản lý nguồn) — đang chờ đợt chuyển dữ liệu nguồn cũ. Đường vào cũ:{" "}
          <b className="text-foreground">{du.duongVao?.trim() || "—"}</b>
        </p>
      )}

      {nguon && du.boSungSale.kieu !== "KHONG_CAN" && <ThieuSalePhuHuynh du={du} nguon={nguon} />}

      {nguon && !du.quyen.ok && (
        <p className="mt-3 text-xs text-muted-foreground">
          Không đổi được nguồn lead này. Quyền cần có:{" "}
          {du.quyen.thieu.map((k, i) => (
            <span key={k}>
              {i > 0 && " và "}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">{k}</code>
            </span>
          ))}
          .
        </p>
      )}
    </section>
  );
}

/**
 * Lead do phụ huynh giới thiệu mà chưa có Sale phụ trách phụ huynh (hold `THIEU_SALE_PHU_HUYNH`). Bốn trạng thái của `du.boSungSale`, MỘT hàng chữ:
 * có nút ⇔ máy chủ sẽ nhận (`DUOC`); còn lại nói thẳng vì sao chưa làm được và ai làm được — không nút xám bấm được (luật 12).
 */
function ThieuSalePhuHuynh({ du, nguon }: { du: ChoGanNguon; nguon: NguonHienTai }) {
  const b = du.boSungSale;
  if (b.kieu === "KHONG_CAN") return null;
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg bg-state-warning-soft px-3 py-2.5 text-sm text-state-warning-ink">
      <p className="min-w-0 flex-1 basis-64">
        <b>Chưa xác định Sale phụ trách phụ huynh giới thiệu.</b>{" "}
        {b.kieu === "DUOC" && "Hoa hồng theo vai này (nếu có chính sách) đang chờ ở tab «Sổ hoa hồng» cho tới khi bổ sung xong."}
        {b.kieu === "THIEU_QUYEN" && "Bổ sung cần quyền đổi nguồn — khoá còn thiếu ghi ngay bên dưới."}
        {b.kieu === "NGUON_NGUNG" && (
          <>
            Nguồn «{b.tenNguon}» {NHAN_NGUON_NGUNG[b.lyDo]} nên chưa bổ sung được.{" "}
            {b.coTheMoLai ? (
              <>
                <Link href={`/nguon-hoa-hong/nguon/${b.maNguon}`} className="font-semibold text-foreground underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-ring">
                  Mở nguồn để bật lại
                </Link>
                , rồi quay lại đây.
              </>
            ) : (
              <>
                Nhờ người có quyền <code className="rounded bg-card px-1.5 py-0.5 font-mono text-[11px] text-foreground">sources:manage</code> mở lại nguồn này, rồi quay lại đây.
              </>
            )}
          </>
        )}
      </p>
      {b.kieu === "DUOC" && (
        <BoSungSaleSheet
          leadId={du.leadId}
          tenLead={du.tenLead}
          tenPhuHuynh={nguon.nguoi?.ten ?? null}
          soKhoanThu={du.thucThu?.soKhoan ?? null}
          capNhatLuc={nguon.capNhatLuc}
          triggerAriaLabel="Bổ sung Sale phụ trách phụ huynh của lead này"
          triggerClassName={BTN_OUTLINE}
        >
          <UserPlus aria-hidden className="h-4 w-4" />
          Bổ sung Sale phụ trách
        </BoSungSaleSheet>
      )}
    </div>
  );
}
