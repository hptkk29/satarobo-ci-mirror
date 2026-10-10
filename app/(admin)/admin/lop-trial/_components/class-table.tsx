// app/(admin)/admin/lop-trial/_components/class-table.tsx — GĐ2.
//
// Bảng danh sách lớp trải nghiệm. SERVER Component: không state, không handler —
// phần tương tác duy nhất (huỷ lớp) nằm trong client component con.
//
// 23/09/2026 — cột theo chủ dự án: Lớp (tên "CS1-Lớp trial 23/09/2026" — ngày nằm SẴN
// trong tên nên không còn cột ngày riêng) · Khung giờ · Sale có case trial · Học viên ·
// Buổi kế tiếp · Số case · Trạng thái (hết ngày lớp ⇒ "Đã đóng", xem
// `lib/trial/trang-thai-lop.ts`).

import Link from "next/link";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { NHAN_TRANG_THAI_LOP, type TrangThaiLop } from "@/lib/trial/trang-thai-lop";
import type { ClassRow } from "../_lib/types";
import { CancelClassButton } from "./cancel-class-button";

const BADGE: Record<TrangThaiLop, string> = {
  DANG_MO: "bg-state-success-soft text-state-success-ink",
  DA_DONG: "bg-muted text-muted-foreground",
  DA_HUY: "bg-state-danger-soft text-state-danger-ink",
};

/**
 * "YYYY-MM-DD" → "dd/MM/yyyy".
 *
 * ⚠️ Tự tách chuỗi, KHÔNG `new Date(s)`: chuỗi ngày trần được JS hiểu là UTC-midnight
 * rồi in ra theo múi giờ máy, nên máy ở múi âm sẽ lùi một ngày. Ở đây không có gì để
 * quy đổi — chuỗi vốn đã là ngày theo lịch VN mà server tính sẵn.
 */
function ngayVN(s: string): string {
  const [y, m, d] = s.split("-");
  return y && m && d ? `${d}/${m}/${y}` : s;
}

/** Hai tên đầu + "và N người nữa"; `title` giữ đủ danh sách. */
function DanhSachTen({ ten, donVi }: { ten: string[]; donVi: string }): React.JSX.Element {
  return (
    <>
      <span className="text-foreground" title={ten.join(", ")}>
        {ten.slice(0, 2).join(", ")}
      </span>
      {ten.length > 2 && (
        <span className="text-muted-foreground" title={ten.join(", ")}>
          {" "}
          và {ten.length - 2} {donVi} nữa
        </span>
      )}
    </>
  );
}

export function ClassTable({
  rows,
  canHuyLop,
}: {
  rows: ClassRow[];
  /** Có `trials:create-class` — cùng khoá cửa huỷ lớp hỏi. Sale KHÔNG có (QĐ-C6). */
  canHuyLop: boolean;
  // React 19 đã bỏ namespace JSX toàn cục khỏi @types/react ⇒ `JSX.Element` trần
  // không còn phân giải được, phải đi qua `React.JSX`.
}): React.JSX.Element {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      {/*
        23/09 — cuộn ngang do CHÍNH PhanTrangBang lo (`cuonNgang`): vùng cuộn của nó có
        `relative`, nên `<span className="sr-only">` ở cột thao tác không thoát ra kéo cả
        trang trượt ngang ở 375px (đo được: 753px), và thanh phân trang đứng ngoài vùng cuộn.
      */}
      <PhanTrangBang khoaGhiNho="lop-trial-danh-sach" tenDonVi="lớp" cuonNgang>
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="whitespace-nowrap px-4 py-3 font-semibold">Lớp</th>
                <th className="whitespace-nowrap px-4 py-3 font-semibold">Khung giờ</th>
                <th className="whitespace-nowrap px-4 py-3 font-semibold">Sale có case trial</th>
                <th className="whitespace-nowrap px-4 py-3 font-semibold">Học viên</th>
                <th className="whitespace-nowrap px-4 py-3 font-semibold">Buổi kế tiếp</th>
                <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">Số case</th>
                <th className="whitespace-nowrap px-4 py-3 font-semibold">Trạng thái</th>
                <th className="whitespace-nowrap px-4 py-3 font-semibold">
                  <span className="sr-only">Thao tác</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                    Không có lớp trải nghiệm nào trong bộ lọc này.
                  </td>
                </tr>
              )}
              {rows.map((r) => {
                // Huỷ lớp chỉ bày khi lớp CÒN MỞ — lớp đã qua ngày hay đã huỷ thì không còn
                // gì để huỷ (cổng thật vẫn ở server: `cancelLopTrialClassAction`).
                const conMo = r.trangThai === "DANG_MO";
                return (
                  <tr key={r.id} className="hover:bg-muted">
                    <td className="whitespace-nowrap px-4 py-3">
                      <Link
                        href={`/lop-trial/${r.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {r.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">{r.code}</div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums">
                      {r.khungGio ? (
                        <span className="text-foreground">{r.khungGio}</span>
                      ) : (
                        <span
                          className="text-muted-foreground"
                          title="Lớp tạo trước 22/09/2026 — khi đó lớp là slot dùng lại nhiều lần, không gắn ngày và khung giờ. Vẫn xếp học viên bình thường."
                        >
                          — lớp cũ
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {r.saleCase.length > 0 ? (
                        <DanhSachTen ten={r.saleCase} donVi="Sale" />
                      ) : r.sale ? (
                        <>
                          {/* Lớp cũ: case không lưu người mở — tên suy từ Sale phụ trách lead
                              của các con trong lớp. Nói ra, đừng để người đọc tưởng đó là
                              người mở case (luật 12). */}
                          <span className="text-foreground">{r.sale.ten}</span>
                          {r.sale.soSaleKhac > 0 && (
                            <span className="text-muted-foreground"> +{r.sale.soSaleKhac}</span>
                          )}
                          {r.sale.suyTuLead && (
                            <div
                              className="text-xs text-muted-foreground"
                              title="Case của lớp này không lưu người mở — tên suy từ Sale phụ trách lead của các con trong lớp."
                            >
                              theo lead
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="text-muted-foreground">Chưa có case</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {r.hocVien.length === 0 ? (
                        <span className="text-muted-foreground">Chưa có</span>
                      ) : (
                        <DanhSachTen ten={r.hocVien} donVi="con" />
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums">
                      {r.caseKeTiep ? (
                        <>
                          <div className="text-foreground">{r.caseKeTiep.gio}</div>
                          <div className="text-xs text-muted-foreground">
                            {ngayVN(r.caseKeTiep.ngay)}
                          </div>
                        </>
                      ) : (
                        <span className="text-muted-foreground">Không còn case</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-foreground">
                      {r.soCase}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span
                        className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${BADGE[r.trangThai]}`}
                      >
                        {NHAN_TRANG_THAI_LOP[r.trangThai]}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {canHuyLop && conMo ? (
                        <CancelClassButton trialClassId={r.id} className="text-xs" />
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
      </PhanTrangBang>
    </div>
  );
}
