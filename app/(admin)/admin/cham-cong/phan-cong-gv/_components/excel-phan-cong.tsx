"use client";
// Ngăn "Excel" của màn Phân công giáo viên: tải file mẫu · nhập (xem trước → xác nhận) · xuất 4 dạng.
// Mỗi khối chỉ hiện khi trang đã xác nhận người xem LÀM ĐƯỢC việc đó (luật 12 — không vẽ nút chắc chắn bị từ chối): cờ do trang truyền.
// Nhập không ghi gì cho tới khi bấm "Xác nhận ghi"; xác nhận gửi lại ĐÚNG tệp đã xem cùng dấu sha256, server xét lại từ đầu.
import { useRef, useState, useTransition } from "react";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { BTN_OUTLINE, BTN_PRIMARY, FIELD } from "@/components/admin/cham-cong/classes";
import { cn } from "@/lib/utils";
import type { KetQuaDong } from "@/lib/parttime/nhap-phan-cong";
import { xacNhanNhapAction, xemTruocNhapAction, type XemTruocNhap } from "../_actions-nhap";

type Props = {
  coSo: string;
  tu: string;
  den: string;
  mauDuoc: boolean;
  nhapDuoc: boolean;
  /** Cơ sở người xem xuất được (`hr_attendance:view`) — rỗng ⇒ không có khối xuất. */
  coSoXuat: { id: string; label: string }[];
  giaoVien: { userId: string; ten: string }[];
};

const NHAN_KQ: Record<KetQuaDong["ketQua"], string> = { THEM: "Thêm", HUY: "Huỷ", KHONG_DOI: "Không đổi", CAN_DUYET: "Cần duyệt", LOI: "Lỗi" };
const MAU_KQ: Record<KetQuaDong["ketQua"], string> = {
  THEM: "bg-state-success-soft text-state-success-ink",
  HUY: "bg-state-warning-soft text-state-warning-ink",
  KHONG_DOI: "bg-muted text-muted-foreground",
  CAN_DUYET: "bg-state-info-soft text-state-info-ink",
  LOI: "bg-state-danger-soft text-state-danger-ink",
};

export function ExcelPhanCong(p: Props) {
  const [mo, setMo] = useState(false);
  const [xem, setXem] = useState<XemTruocNhap | null>(null);
  const [dang, start] = useTransition();
  const tep = useRef<HTMLInputElement>(null);
  const [xuat, setXuat] = useState({ coSo: [p.coSo], tu: p.tu, den: p.den, gv: "", trangThai: "" });

  const guiTep = (fn: typeof xemTruocNhapAction | typeof xacNhanNhapAction, dauTep?: string) => {
    const f = tep.current?.files?.[0];
    if (!f) {
      toast.error("Chưa chọn file .xlsx");
      return null;
    }
    const fd = new FormData();
    fd.set("file", f);
    if (dauTep) fd.set("dauTep", dauTep);
    return fn(fd);
  };

  const xemTruoc = () =>
    start(async () => {
      const r = await guiTep(xemTruocNhapAction);
      if (!r) return;
      if (r.ok) setXem(r.data as XemTruocNhap);
      else toast.error(r.error);
    });
  const xacNhan = () =>
    start(async () => {
      if (!xem) return;
      const r = await guiTep(xacNhanNhapAction, xem.dauTep);
      if (!r) return;
      if (!r.ok) return void toast.error(r.error);
      const d = r.data as { ghi: { ok: boolean }[] };
      const loi = d.ghi.filter((x) => !x.ok).length;
      if (loi) toast.warning(`Đã ghi ${d.ghi.length - loi} dòng · ${loi} dòng bị dịch vụ từ chối — xem trước lại để biết lý do.`);
      else toast.success(d.ghi.length ? `Đã ghi ${d.ghi.length} dòng.` : "Không có dòng nào cần ghi.");
      setXem(null);
      if (tep.current) tep.current.value = "";
    });

  const hrefMau = `/api/admin/cham-cong/phan-cong-gv/mau?${new URLSearchParams({ coSo: p.coSo, tu: p.tu, den: p.den })}`;
  const qx = new URLSearchParams({ coSo: xuat.coSo.join(","), tu: xuat.tu, den: xuat.den });
  if (xuat.gv) qx.set("gv", xuat.gv);
  if (xuat.trangThai) qx.set("trangThai", xuat.trangThai);
  const hrefXuat = `/api/admin/cham-cong/phan-cong-gv/xuat?${qx}`;
  const ghiDuoc = xem ? xem.tongHop.them + xem.tongHop.capNhat : 0;

  if (!p.mauDuoc && !p.nhapDuoc && p.coSoXuat.length === 0) return null;
  return (
    <>
      <button type="button" className={BTN_OUTLINE} onClick={() => setMo(true)}>
        <FileSpreadsheet className="h-4 w-4" aria-hidden />
        Excel
      </button>
      <Sheet open={mo} onOpenChange={setMo}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>Excel — phân công giáo viên</SheetTitle>
            <SheetDescription>Nhập chỉ giao/huỷ trực và gắn trợ giảng vào buổi có thật. Lớp, học bù, Trial, Rank và tiền không nhập qua Excel.</SheetDescription>
          </SheetHeader>

          <div className="space-y-6 px-4 pb-6">
            {p.mauDuoc && (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">1 · Tải file mẫu</h3>
                <p className="text-sm text-muted-foreground">Có hướng dẫn, dropdown, ví dụ và danh sách giáo viên + mã buổi của tuần đang xem. Sheet nhập để trống.</p>
                <a href={hrefMau} className={BTN_OUTLINE} download>
                  <Download className="h-4 w-4" aria-hidden />
                  Tải file mẫu Excel
                </a>
              </section>
            )}

            {p.nhapDuoc && (
              <section className="space-y-3">
                <h3 className="text-sm font-semibold">2 · Nhập</h3>
                <div className="flex flex-wrap items-center gap-2">
                  <input ref={tep} type="file" accept=".xlsx" className={cn(FIELD, "max-w-full")} onChange={() => setXem(null)} aria-label="Chọn file nhập phân công" />
                  <button type="button" className={BTN_OUTLINE} disabled={dang} onClick={xemTruoc}>
                    <Upload className="h-4 w-4" aria-hidden />
                    {dang && !xem ? "Đang đọc…" : "Xem trước"}
                  </button>
                </div>
                {xem && (
                  <div className="space-y-3">
                    <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                      {(
                        [
                          ["Tổng dòng", xem.tongHop.tong],
                          ["Hợp lệ", xem.tongHop.hopLe],
                          ["Lỗi", xem.tongHop.loi],
                          ["Cảnh báo", xem.tongHop.canhBao],
                          ["Thêm mới", xem.tongHop.them],
                          ["Cập nhật (huỷ)", xem.tongHop.capNhat],
                          ["Không đổi", xem.tongHop.khongDoi],
                          ["Cần duyệt", xem.tongHop.canDuyet],
                        ] as const
                      ).map(([k, v]) => (
                        <div key={k} className="rounded-md border border-border px-3 py-2">
                          <dt className="text-xs text-muted-foreground">{k}</dt>
                          <dd className="text-base font-semibold tabular-nums">{v}</dd>
                        </div>
                      ))}
                    </dl>
                    <div className="overflow-hidden rounded-md border border-border">
                      <div className="max-h-80 overflow-auto">
                        <table className="w-full min-w-[520px] text-sm">
                          <thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground">
                            <tr>
                              <th className="px-2 py-1.5 font-medium">Dòng</th>
                              <th className="px-2 py-1.5 font-medium">ImportKey</th>
                              <th className="px-2 py-1.5 font-medium">Kết quả</th>
                              <th className="px-2 py-1.5 font-medium">Chi tiết</th>
                            </tr>
                          </thead>
                          <tbody>
                            {xem.dong.map((d) => (
                              <tr key={d.soDong} className="border-t border-border align-top">
                                <td className="px-2 py-1.5 tabular-nums">{d.soDong}</td>
                                <td className="px-2 py-1.5 font-mono text-xs">{d.importKey || "—"}</td>
                                <td className="px-2 py-1.5">
                                  <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", MAU_KQ[d.ketQua])}>{NHAN_KQ[d.ketQua]}</span>
                                </td>
                                <td className="px-2 py-1.5">
                                  {d.thongDiep}
                                  {d.ma && <span className="ml-1 font-mono text-xs text-muted-foreground">[{d.ma}]</span>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" className={BTN_PRIMARY} disabled={dang || ghiDuoc === 0} onClick={xacNhan}>
                        {dang ? "Đang ghi…" : `Xác nhận ghi ${ghiDuoc} dòng`}
                      </button>
                      <span className="text-xs text-muted-foreground">Dòng lỗi / không đổi / cần duyệt không ghi gì. Chạy lại cùng tệp không tạo trùng.</span>
                    </div>
                  </div>
                )}
              </section>
            )}

            {p.coSoXuat.length > 0 && (
              <section className="space-y-3">
                <h3 className="text-sm font-semibold">3 · Xuất</h3>
                <p className="text-sm text-muted-foreground">Một tệp bốn sheet: A lưới tuần · B chi tiết phân công · C đối soát kế hoạch/thực tế · D thu nhập dự kiến (chưa phải số chi).</p>
                {p.coSoXuat.length > 1 && (
                  <fieldset className="flex flex-wrap gap-3 text-sm">
                    <legend className="mb-1 text-xs text-muted-foreground">Cơ sở</legend>
                    {p.coSoXuat.map((c) => (
                      <label key={c.id} className="inline-flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={xuat.coSo.includes(c.id)}
                          onChange={(e) => setXuat((x) => ({ ...x, coSo: e.target.checked ? [...x.coSo, c.id] : x.coSo.filter((y) => y !== c.id) }))}
                        />
                        {c.label}
                      </label>
                    ))}
                  </fieldset>
                )}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <label className="text-xs text-muted-foreground">
                    Từ ngày
                    <input type="date" className={cn(FIELD, "mt-1 block w-full")} value={xuat.tu} onChange={(e) => setXuat((x) => ({ ...x, tu: e.target.value }))} />
                  </label>
                  <label className="text-xs text-muted-foreground">
                    Đến ngày (tối đa 62 ngày)
                    <input type="date" className={cn(FIELD, "mt-1 block w-full")} value={xuat.den} onChange={(e) => setXuat((x) => ({ ...x, den: e.target.value }))} />
                  </label>
                  <label className="text-xs text-muted-foreground">
                    Giáo viên
                    <select className={cn(FIELD, "mt-1 block w-full")} value={xuat.gv} onChange={(e) => setXuat((x) => ({ ...x, gv: e.target.value }))}>
                      <option value="">Tất cả</option>
                      {p.giaoVien.map((g) => (
                        <option key={g.userId} value={g.userId}>
                          {g.ten}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs text-muted-foreground">
                    Trạng thái đối soát
                    <select className={cn(FIELD, "mt-1 block w-full")} value={xuat.trangThai} onChange={(e) => setXuat((x) => ({ ...x, trangThai: e.target.value }))}>
                      <option value="">Tất cả</option>
                      <option value="CHUA_XAC_NHAN">Chưa xác nhận</option>
                      <option value="KHOP">Khớp</option>
                      <option value="LECH">Lệch</option>
                      <option value="CHINH_SACH_CU">Chính sách cũ</option>
                    </select>
                  </label>
                </div>
                {xuat.coSo.length > 0 && xuat.tu && xuat.den && xuat.den >= xuat.tu ? (
                  <a href={hrefXuat} className={BTN_OUTLINE} download>
                    <Download className="h-4 w-4" aria-hidden />
                    Xuất Excel
                  </a>
                ) : (
                  <p className="text-sm text-state-warning-ink">Chọn ít nhất một cơ sở và khoảng ngày hợp lệ.</p>
                )}
              </section>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
