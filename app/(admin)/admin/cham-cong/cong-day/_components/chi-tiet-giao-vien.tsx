"use client";

// Chi tiết công dạy của MỘT giáo viên trong tháng — gom theo ngày, mỗi ngày một dòng tổng, cuối bảng
// tổng tháng. Mọi con số (công từng dòng, tổng ngày, tổng tháng) đã tính ở server bằng đúng hàm của
// bảng tổng hợp (`lib/cham-cong/cong-day-chi-tiet.ts`) — ở đây chỉ ĐỊNH DẠNG.
//
// Dòng ở cơ sở ngoài phạm vi người xem đến đây đã bị che sẵn (không tên lớp, phòng, người) — client
// không nhận được dữ liệu đó, không phải chỉ không vẽ ra.
import { Fragment, useState, type ReactNode } from "react";
import Link from "next/link";
import { adminTd, adminTh } from "@/components/admin/ui/table";
import { PILL } from "@/components/admin/cham-cong/classes";
import { cn } from "@/lib/utils";
import type { DongHienThi, NgayChiTiet, TongLat } from "@/lib/cham-cong/cong-day-chi-tiet";

const NHAN_NHOM: Record<DongHienThi["nhom"], string> = {
  LOP_CHINH: "Lớp chính",
  DAY_THAY: "Dạy thay",
  HOC_BU: "Học bù",
  KHAC: "Loại khác",
};
const NHAN_NGUON: Record<DongHienThi["nguon"], string> = {
  CLASS: "Buổi lớp",
  TRIAL: "Buổi học thử",
  MAKEUP: "Case học bù",
};
const NHAN_VAI: Record<DongHienThi["vai"], string> = {
  MAIN: "Dạy chính",
  SUBSTITUTE: "Dạy thay",
  ASSISTANT: "Trợ giảng",
};
const NHAN_TRANG_THAI: Record<string, string> = {
  COMPLETED: "Đã hoàn thành",
  NO_SHOW: "Học viên vắng (GV có mặt)",
};
const NHAN_LY_DO: Record<NonNullable<DongHienThi["lyDo"]>, string> = {
  KHONG_KHOP_LOAI: "Danh mục không có dòng nào cho loại buổi này — thiếu cấu hình",
  LOAI_DANG_TAT: "Loại này đang tắt “Đang dùng” — cố ý không tính",
  THIEU_GIO: "Loại tính theo giờ nhưng buổi không suy được giờ",
  KHONG_CONG_VAO_KY: "Loại đang tắt “Cộng vào kỳ” — chỉ theo dõi",
};
const NHAN_CANH_BAO: Record<DongHienThi["canhBao"][number], string> = {
  KHONG_KHOP_LOAI: "Không khớp loại công",
  THIEU_GIO: "Thiếu giờ",
  THAY_NHUNG_CONG_VE_GV_CHINH: "Có người dạy thay nhưng công về GV chính",
  KHONG_CO_GV_CHINH: "Lớp chưa có GV chính",
};

function so(n: number): string {
  return (Math.round(n * 100) / 100).toString().replace(".", ",");
}
function ngay(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}/${y}`;
}
function thu(ymd: string): string {
  const w = new Date(`${ymd}T00:00:00Z`).getUTCDay();
  return w === 0 ? "CN" : `T${w + 1}`;
}
function phut(n: number | null): string {
  return n == null ? "—" : `${n.toLocaleString("vi-VN")} phút`;
}
function tongLabel(t: TongLat): string {
  return `${t.buoi} buổi · ${t.phut.toLocaleString("vi-VN")} phút · ${so(t.cong)} công`;
}

export function ChiTietGiaoVienTable({
  ngays,
  tong,
  tenNguoi,
  tenCoSo,
}: {
  ngays: NgayChiTiet[];
  tong: TongLat;
  /** userId → tên, cho GV chính / GV thay / người đứng lớp. */
  tenNguoi: Record<string, string>;
  /** centerId → nhãn cơ sở. */
  tenCoSo: Record<string, string>;
}) {
  const [mo, setMo] = useState<string | null>(null);
  const ten = (id: string | null) => (id ? (tenNguoi[id] ?? "(người ngoài phạm vi)") : "—");

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full min-w-[980px] text-sm">
        <thead className="border-b border-border bg-muted/40">
          <tr>
            <th scope="col" className={adminTh}>Giờ</th>
            <th scope="col" className={adminTh}>Lớp</th>
            <th scope="col" className={adminTh}>Cơ sở · Phòng</th>
            <th scope="col" className={adminTh}>Loại công</th>
            <th scope="col" className={adminTh}>Trạng thái buổi</th>
            <th scope="col" className={cn(adminTh, "text-right")}>Thời lượng</th>
            <th scope="col" className={cn(adminTh, "text-right")}>Hệ số</th>
            <th scope="col" className={cn(adminTh, "text-right")}>Công</th>
            <th scope="col" className={adminTh}>Tính công</th>
            <th scope="col" className={adminTh}>
              <span className="sr-only">Chi tiết</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {ngays.map((n) => (
            <Fragment key={n.ymd}>
              <tr className="border-b border-border bg-muted/20">
                <td colSpan={10} className="px-3 py-1.5 text-xs font-semibold text-foreground">
                  {thu(n.ymd)} {ngay(n.ymd)}
                </td>
              </tr>
              {n.dongs.map((d) => {
                const dangMo = mo === d.key;
                return (
                  <Fragment key={d.key}>
                    <tr className={cn("border-b border-border/60", d.canhBao.length > 0 && "bg-state-warning-soft/30")}>
                      <td className={cn(adminTd, "whitespace-nowrap tabular-nums")}>
                        {d.gioBatDau && d.gioKetThuc ? `${d.gioBatDau}–${d.gioKetThuc}` : "—"}
                        {d.gioThuc && <span className="ml-1 text-[10px] text-muted-foreground">(giờ thực)</span>}
                      </td>
                      <td className={adminTd}>
                        {d.biChe ? (
                          <span className="text-muted-foreground italic">Lớp ở cơ sở khác</span>
                        ) : (
                          <span className="inline-block max-w-[14rem] truncate align-middle" title={d.tenLop ?? undefined}>
                            {d.tenLop ?? (d.nguon === "TRIAL" ? "Buổi học thử" : "—")}
                          </span>
                        )}
                      </td>
                      <td className={cn(adminTd, "whitespace-nowrap")}>
                        {d.centerId ? (tenCoSo[d.centerId] ?? "Cơ sở khác") : "—"}
                        {d.phong && <span className="text-muted-foreground"> · {d.phong}</span>}
                      </td>
                      <td className={adminTd}>
                        <span className="text-foreground">{d.loaiTen ?? "—"}</span>
                        <span className="ml-1 text-[11px] text-muted-foreground">{NHAN_NHOM[d.nhom]}</span>
                      </td>
                      <td className={cn(adminTd, "whitespace-nowrap")}>{NHAN_TRANG_THAI[d.trangThaiBuoi] ?? d.trangThaiBuoi}</td>
                      <td className={cn(adminTd, "text-right tabular-nums whitespace-nowrap")}>{phut(d.phut)}</td>
                      <td className={cn(adminTd, "text-right tabular-nums")}>
                        {d.heSo == null ? "—" : `${so(d.heSo)}${d.coSo === "PER_HOUR" ? "/giờ" : "/buổi"}`}
                      </td>
                      <td className={cn(adminTd, "text-right font-medium tabular-nums")}>{so(d.cong)}</td>
                      <td className={adminTd}>
                        {d.tinhVaoKy ? (
                          <span className={cn(PILL, "bg-state-success-soft text-state-success-ink")}>Có</span>
                        ) : (
                          <span className={cn(PILL, "bg-muted text-muted-foreground")} title={d.lyDo ? NHAN_LY_DO[d.lyDo] : undefined}>
                            Không
                          </span>
                        )}
                        {d.canhBao.length > 0 && (
                          <span className={cn(PILL, "ml-1 bg-state-warning-soft text-state-warning-ink")}>Cần kiểm tra</span>
                        )}
                      </td>
                      <td className={cn(adminTd, "text-right")}>
                        <button
                          type="button"
                          onClick={() => setMo(dangMo ? null : d.key)}
                          aria-expanded={dangMo}
                          className="rounded px-2 py-0.5 text-xs text-primary hover:bg-muted hover:underline"
                        >
                          {dangMo ? "Đóng" : "Chi tiết"}
                        </button>
                      </td>
                    </tr>
                    {dangMo && (
                      <tr className="border-b border-border bg-muted/10">
                        <td colSpan={10} className="px-4 py-3">
                          <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2 lg:grid-cols-3">
                            <ChiTietO nhan="Nguồn" giaTri={`${NHAN_NGUON[d.nguon]} · ${NHAN_VAI[d.vai]}`} />
                            <ChiTietO nhan="Mã buổi" giaTri={<span className="font-mono">{d.buoiId}</span>} />
                            {!d.biChe && (
                              <>
                                <ChiTietO nhan="GV chính của lớp" giaTri={ten(d.gvChinhId)} />
                                <ChiTietO nhan="GV dạy thay (đã ghi)" giaTri={ten(d.gvThayId)} />
                                <ChiTietO nhan="Người đứng lớp thực tế (đã ghi)" giaTri={ten(d.nguoiDayThucId)} />
                              </>
                            )}
                            <ChiTietO
                              nhan="Cách tính"
                              giaTri={
                                d.loaiCode
                                  ? `${d.loaiTen} (${d.loaiCode}) — ${d.coSo === "PER_HOUR" ? "theo giờ" : "theo buổi"} × ${so(d.heSo ?? 0)}`
                                  : d.lyDo
                                    ? NHAN_LY_DO[d.lyDo]
                                    : "—"
                              }
                            />
                            <ChiTietO nhan="Cộng vào kỳ công" giaTri={d.tinhVaoKy ? "Có" : `Không — ${d.lyDo ? NHAN_LY_DO[d.lyDo] : ""}`} />
                            <ChiTietO
                              nhan="Giờ dùng để tính"
                              giaTri={d.gioThuc ? "Giờ thực tế đã ghi trên buổi" : d.nguon === "CLASS" ? "Giờ của lớp" : "Giờ khai trên buổi / case"}
                            />
                            {d.canhBao.length > 0 && (
                              <ChiTietO nhan="Cần kiểm tra" giaTri={d.canhBao.map((c) => NHAN_CANH_BAO[c]).join(" · ")} />
                            )}
                            {!d.biChe && d.nguon === "CLASS" && d.lopId && (
                              <ChiTietO nhan="Liên kết" giaTri={<Link href={`/classes/${d.lopId}`} className="text-primary hover:underline">Mở lớp</Link>} />
                            )}
                            {!d.biChe && d.nguon === "MAKEUP" && (
                              <ChiTietO nhan="Liên kết" giaTri={<Link href={`/hoc-bu/case/${d.buoiId}`} className="text-primary hover:underline">Mở case học bù</Link>} />
                            )}
                          </dl>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              <tr className="border-b border-border">
                <td colSpan={10} className="px-3 py-1 text-right text-[11px] text-muted-foreground tabular-nums">
                  Tổng ngày: {tongLabel(n.tong)}
                </td>
              </tr>
            </Fragment>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-muted/40">
            <td colSpan={10} className="px-3 py-2 text-right text-sm font-semibold tabular-nums">
              Tổng tháng: {tongLabel(tong)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function ChiTietO({ nhan, giaTri }: { nhan: string; giaTri: ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-muted-foreground">{nhan}:</dt>
      <dd className="text-foreground">{giaTri}</dd>
    </div>
  );
}
