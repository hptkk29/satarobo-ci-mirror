"use client";

// app/(admin)/admin/cau-hinh-van-hanh/chuyen-hoa-hong/_components/chuyen-hoa-hong-man.tsx — MÀN «Chuyển sang hoa hồng mới» (hướng D+H, đợt UAT cutover).
//
// Năm khối, theo thứ tự người vận hành đi: Mốc hiện tại · Mốc đề xuất · Tác động (xem trước) · Vấn đề chặn · Xác nhận (+ lịch sử).
// KHÔNG tự xét điều kiện nào: «đủ điều kiện hay chưa» là `xem.sanSang` do server tính bằng CHÍNH cổng mà nút xác nhận sẽ đi qua (`danhGiaDatMoc` → `quyetDinhDatMoc`).
// Client KHÔNG ghi mốc: nó gửi lại ĐÚNG những gì đã xem (`cuDaXem`, `dauVan`, cửa sổ) và server tính lại, so, rồi mới ghi.
// Đổi bất kỳ ô nào sau khi xem ⇒ kết quả xem trước bị XOÁ (không để nút xác nhận đứng cạnh một con số của tháng khác).
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CircleAlert, CircleCheck, Loader2, TriangleAlert } from "lucide-react";

import { BTN_DANGER_OUTLINE, BTN_OUTLINE, BTN_PRIMARY, LOI_O, NHAN_O, O_NHAP, TEXTAREA } from "@/components/admin/nguon-hoa-hong/classes";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { StatusPill } from "@/components/admin/ui/status-pill";
import type { DongLichSu, NhomTheoMa, TacDongUi, XemTruoc } from "@/lib/hoa-hong/cutover-hanh-dong";
import { LY_DO_TOI_THIEU } from "@/lib/hoa-hong/kieu";
import { nhanThangKy } from "@/lib/hoa-hong/ky-man-hinh";
import { nhanMaSoBong } from "@/lib/hoa-hong/so-bong-nhan";
import { dinhDangDong } from "@/lib/hoa-hong/vi-sao";
import { cn } from "@/lib/utils";

import { xacNhanCutoverAction, xemTruocCutoverAction } from "../_actions";

export type PropsMan = {
  mocHienTai: string | null;
  engineBat: boolean;
  /** `settings:edit` — ĐÚNG khoá mà `xacNhanCutoverAction` kiểm. */
  suaDuoc: boolean;
  cuaSoMacDinh: { tuNgay: string; denNgay: string };
  /** "YYYY-MM-DD" hôm nay giờ VN — chặn ô ngày chọn tương lai. */
  homNay: string;
  /** Tháng gợi ý: tháng liền sau tháng hiện tại (mốc phải ở tương lai). */
  thangGoiY: string;
  thangToiThieu: string;
  lichSu: DongLichSu[];
};

const dem = (n: number): string => n.toLocaleString("vi-VN");
const ngayDMY = (s: string): string => s.split("-").reverse().join("/");
const luc = (iso: string): string => new Date(iso).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "short" });

const NHAN_HANH_DONG: Record<string, string> = { DAT_LAN_DAU: "Đặt mốc lần đầu", DOI_SOM: "Dời mốc sớm hơn", DOI_MUON: "Dời mốc muộn hơn", GO: "Gỡ mốc", CREATE: "Đặt mốc", UPDATE: "Đổi mốc", DELETE: "Gỡ mốc" };

function Khoi({ tieuDe, moTa, children }: { tieuDe: string; moTa?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-label={tieuDe} className="border-t border-border pt-6 first:border-t-0 first:pt-0">
      <h2 className="text-base font-bold tracking-tight text-foreground">{tieuDe}</h2>
      {moTa && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{moTa}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** Vỏ bảng: bo góc + viền, vùng cuộn ngang là div CON. */
function VoBang({ children, ten }: { children: React.ReactNode; ten: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="overflow-x-auto" role="region" aria-label={ten} tabIndex={0}>
        {children}
      </div>
    </div>
  );
}

const Th = ({ children, so }: { children: React.ReactNode; so?: boolean }) => (
  <th scope="col" className={cn(adminTh, so && "text-right")}>
    {children}
  </th>
);
const Td = ({ children, so, className, title }: { children: React.ReactNode; so?: boolean; className?: string; title?: string }) => (
  <td title={title} className={cn(adminTd, so && "text-right tabular-nums", className)}>
    {children}
  </td>
);

function BangTheoMa({ ten, nhom, coCanCu }: { ten: string; nhom: NhomTheoMa[]; coCanCu: boolean }) {
  return (
    <VoBang ten={ten}>
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            <Th>Lý do</Th>
            <Th so>Dòng</Th>
            <Th so>Engine cũ</Th>
            <Th so>Engine mới</Th>
            <Th so>Chênh</Th>
            {coCanCu && <Th>Căn cứ</Th>}
          </tr>
        </thead>
        <tbody>
          {nhom.map((n) => (
            <tr key={n.ma} className={adminTr}>
              <Td title={n.ma} className="max-w-[34ch] truncate">
                {nhanMaSoBong(n.ma)}
              </Td>
              <Td so>{dem(n.soDong)}</Td>
              <Td so>{dinhDangDong(n.cu)}</Td>
              <Td so>{dinhDangDong(n.moi)}</Td>
              <Td so className={n.chenh === 0 ? "" : n.chenh < 0 ? "text-state-danger-ink" : "text-state-success-ink"}>
                {dinhDangDong(n.chenh)}
              </Td>
              {coCanCu && (
                <Td title={n.trichDan ?? undefined} className="text-muted-foreground">
                  {n.canCuNgan ?? "—"}
                </Td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </VoBang>
  );
}

function KhoiTacDong({ t }: { t: TacDongUi }) {
  const co = t.unexpected.soDong > 0;
  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-3xl text-sm text-muted-foreground">
        So <b className="font-semibold text-foreground">từng khoản thu</b> từ {ngayDMY(t.cuaSo.tuNgay)} đến {ngayDMY(t.cuaSo.denNgay)} giữa hai engine, theo khoá khoản × vai × người (không so tổng). Dữ liệu là của ngày {ngayDMY(t.asOf)}; chính sách
        lấy bộ có hiệu lực tại đầu kỳ mốc.
      </p>

      <dl className="grid max-w-3xl grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        {[
          ["Khoản thu trong cửa sổ", dem(t.khoan.tong)],
          ["So được", dem(t.khoan.tinhDuoc)],
          ["Chưa tính được", dem(t.khoan.chuaTinh)],
          ["Ngoài phạm vi", dem(t.khoan.ngoaiPhamVi)],
        ].map(([nhan, so]) => (
          <div key={nhan} className="min-w-0">
            <dt className="truncate text-muted-foreground">{nhan}</dt>
            <dd className="text-lg font-semibold tabular-nums text-foreground">{so}</dd>
          </div>
        ))}
      </dl>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-foreground">
          Hai engine khớp nhau: {dem(t.match.soDong)} dòng · {dinhDangDong(t.match.moi)}
        </h3>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-foreground">Chênh lệch có chủ đích (EXPECTED): {dem(t.expected.soDong)} dòng</h3>
        {t.expected.theoMa.length === 0 ? (
          <p className="text-sm text-muted-foreground">Không có. Mọi chính sách theo nguồn còn ở trạng thái nháp nên hai engine đang trả giống nhau.</p>
        ) : (
          <BangTheoMa ten="Chênh lệch có chủ đích" nhom={t.expected.theoMa} coCanCu />
        )}
      </div>

      <div>
        <h3 className={cn("mb-2 text-sm font-semibold", co ? "text-state-danger-ink" : "text-foreground")}>Chênh lệch ngoài dự kiến (UNEXPECTED): {dem(t.unexpected.soDong)} dòng</h3>
        {t.unexpected.theoMa.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-state-success-ink">
            <CircleCheck aria-hidden className="h-4 w-4" />
            Không có dòng nào lệch ngoài danh sách chấp nhận.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <BangTheoMa ten="Chênh lệch ngoài dự kiến theo mã" nhom={t.unexpected.theoMa} coCanCu={false} />
            <VoBang ten="Các dòng lệch lớn nhất">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <Th>Khoản</Th>
                    <Th>Ngày thu</Th>
                    <Th>Vai</Th>
                    <Th so>Cũ</Th>
                    <Th so>Mới</Th>
                    <Th so>Chênh</Th>
                    <Th>Gợi ý nguyên nhân</Th>
                  </tr>
                </thead>
                <tbody>
                  {t.topUnexpected.map((d, i) => (
                    <tr key={`${d.paymentId}-${d.roleCode}-${d.nguoi}-${i}`} className={adminTr}>
                      <Td title={d.paymentId} className="max-w-[16ch] truncate font-mono text-xs">
                        {d.paymentId}
                      </Td>
                      <Td>{ngayDMY(d.ngayThu)}</Td>
                      <Td>{d.roleCode}</Td>
                      <Td so>{dinhDangDong(d.cu)}</Td>
                      <Td so>{dinhDangDong(d.moi)}</Td>
                      <Td so className="text-state-danger-ink">
                        {dinhDangDong(d.chenh)}
                      </Td>
                      <Td title={d.lyDo} className="max-w-[36ch] truncate text-muted-foreground">
                        {d.ma ? nhanMaSoBong(d.ma) : "—"}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </VoBang>
            {t.unexpected.soDong > t.topUnexpected.length && (
              <p className="text-sm text-muted-foreground">Hiện {dem(t.topUnexpected.length)} dòng lệch lớn nhất trong {dem(t.unexpected.soDong)} dòng; phần còn lại nằm trong bảng theo mã ở trên.</p>
            )}
          </div>
        )}
      </div>

      {t.chuaTinh.soKhoan > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-foreground">
            Khoản chưa tính được: {dem(t.chuaTinh.soKhoan)} khoản · thu {dinhDangDong(t.chuaTinh.soTienThu)}
          </h3>
          <VoBang ten="Khoản chưa tính được theo mã">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <Th>Vì sao</Th>
                  <Th>Mức</Th>
                  <Th so>Khoản</Th>
                  <Th so>Tiền thu</Th>
                </tr>
              </thead>
              <tbody>
                {t.chuaTinh.theoMa.map((c) => (
                  <tr key={c.ma} className={adminTr}>
                    <Td title={c.ma} className="max-w-[40ch] truncate">
                      {c.nhan}
                    </Td>
                    <Td>
                      <StatusPill tone={c.mucDo === "HARD" ? "danger" : "warning"}>{c.mucDo === "HARD" ? "Cứng" : "Mềm"}</StatusPill>
                    </Td>
                    <Td so>{dem(c.soKhoan)}</Td>
                    <Td so>{dinhDangDong(c.soTienThu)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </VoBang>
        </div>
      )}

      {(t.holdLichSuMua.lanMuaTruocChuaChot.soKhoan > 0 || t.holdLichSuMua.thuTuMuaChuaKiem.soKhoan > 0) && (
        <div className="max-w-3xl text-sm text-muted-foreground" data-testid="hold-lich-su-mua">
          <h3 className="mb-1 text-sm font-semibold text-foreground">Trong số khoản chưa tính được: giữ vì lịch sử mua chưa chốt (không phải lỗi dữ liệu)</h3>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <span className="font-medium text-foreground">Hold nghiệp vụ được chấp nhận</span> — lần mua trước chưa thu đồng nào và chưa huỷ: {dem(t.holdLichSuMua.lanMuaTruocChuaChot.soKhoan)} khoản · thu{" "}
              {dinhDangDong(t.holdLichSuMua.lanMuaTruocChuaChot.soTienThu)}. Tự nhả khi đơn trước được thu hoặc huỷ; không cần sửa dữ liệu nếu đơn ấy là đơn dev / bỏ quên.
            </li>
            <li>
              <span className="font-medium text-foreground">Cần người có thẩm quyền quyết</span> — đơn ghi bù / nhập giao dịch cũ mà thứ tự mua không kiểm chứng được: {dem(t.holdLichSuMua.thuTuMuaChuaKiem.soKhoan)} khoản · thu{" "}
              {dinhDangDong(t.holdLichSuMua.thuTuMuaChuaKiem.soTienThu)}. Không tự nhả (hệ thống không tin ngày do người nhập khai); hiện chưa có nút quyết tay — việc vận hành.
            </li>
          </ul>
          <p className="mt-1 text-xs">Cả hai vẫn nằm trong tổng hàng chờ dự kiến ở trên, nên vẫn tính vào điều kiện «không còn hàng chờ» của kiểm tra trước — màn này chỉ phân loại để hiển thị.</p>
        </div>
      )}

      <div className="max-w-3xl text-sm text-muted-foreground">
        <h3 className="mb-1 text-sm font-semibold text-foreground">Nằm ngoài phép so này (không giấu)</h3>
        <ul className="list-disc space-y-0.5 pl-5">
          <li>
            Khoản hoàn tiền: {dem(t.ngoai.khoanHoan.soKhoan)} khoản · {dinhDangDong(t.ngoai.khoanHoan.soTien)} (đã có đường đảo riêng, <code className="font-mono text-xs">LEGACY_REVERSAL</code>).
          </li>
          <li>
            Giáo viên dạy Trial: {dem(t.ngoai.trialTeacher.soDong)} dòng · {dinhDangDong(t.ngoai.trialTeacher.soTien)} ở engine mới — phía cũ ghi lúc chuyển đổi nên không so theo khoản được.
          </li>
          <li>Chuyển tiền nội bộ: {dem(t.ngoai.khoanChuyenNoiBo)} khoản.</li>
          <li>
            Không phải học phí: {dem(t.ngoai.khoanKhongPhaiHocPhi.soKhoan)} khoản · thu {dinhDangDong(t.ngoai.khoanKhongPhaiHocPhi.soTien)} (đã tính vào bảng chênh ở trên).
          </li>
        </ul>
      </div>

      <p className="max-w-3xl text-xs text-muted-foreground">
        Chính sách đã dùng: {t.chinhSach.length === 0 ? "không có chính sách nào hiệu lực" : t.chinhSach.map((c) => `${c.policyCode} v${c.version}`).join(" · ")} · luật phân loại so bóng {t.phienBanLuat} · bộ phân loại học viên
        mới / tái tục {t.boLuatPhanLoai} · dấu vân <span className="font-mono">{t.dauVanSoBong.slice(0, 12)}</span>
      </p>
    </div>
  );
}

function KhoiChan({ xem, suaDuoc }: { xem: XemTruoc; suaDuoc: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      {xem.chan.length === 0 ? (
        <p role="status" className="flex items-start gap-2 text-sm text-state-success-ink">
          <CircleCheck aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Không còn vấn đề chặn.
            {xem.canPrecheck ? " Bốn điều kiện bằng chứng đều đạt." : " Hành động này không đòi so bóng — chỉ cần các cổng nghiệp vụ của mốc."}
            {!suaDuoc && " Bạn chỉ có quyền xem; người giữ quyền sửa cấu hình hệ thống sẽ xác nhận."}
          </span>
        </p>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Vấn đề chặn">
          {xem.chan.map((c) => (
            <li key={c.ma} className="rounded-xl border border-border bg-state-danger-soft px-4 py-3 text-sm">
              <p className="flex flex-wrap items-center gap-2">
                <StatusPill tone="danger">{c.ma}</StatusPill>
                <span className="font-semibold text-foreground">{c.lyDo}</span>
              </p>
              <p className="mt-1.5 text-foreground">
                <b className="font-semibold">Ai sửa:</b> {c.aiSua}
              </p>
              <p className="text-foreground">
                <b className="font-semibold">Sửa ở đâu:</b> {c.noiSua}
              </p>
            </li>
          ))}
        </ul>
      )}
      {xem.canhBao.length > 0 && (
        <ul className="flex flex-col gap-1.5" aria-label="Cảnh báo không chặn">
          {xem.canhBao.map((c) => (
            <li key={c} className="flex items-start gap-2 text-sm text-state-warning-ink">
              <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
              {c}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BangLichSu({ ds }: { ds: DongLichSu[] }) {
  if (ds.length === 0) {
    return <p className="text-sm text-muted-foreground">Chưa có lần đặt mốc nào. Mỗi lần đặt, dời hoặc gỡ sẽ được ghi lại ở đây: ai, lúc nào, mốc cũ → mới, lý do và bằng chứng đã xem.</p>;
  }
  return (
    <VoBang ten="Lịch sử đặt mốc">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            <Th>Lúc</Th>
            <Th>Người</Th>
            <Th>Hành động</Th>
            <Th>Mốc</Th>
            <Th>Bằng chứng đã xem</Th>
            <Th>Lý do</Th>
          </tr>
        </thead>
        <tbody>
          {ds.map((d) => (
            <tr key={d.id} className={adminTr}>
              <Td>{luc(d.luc)}</Td>
              <Td className="max-w-[22ch] truncate" title={d.nguoi}>
                {d.nguoi}
              </Td>
              <Td>{NHAN_HANH_DONG[d.hanhDong] ?? d.hanhDong}</Td>
              <Td>
                {d.cu ? nhanThangKy(d.cu) : "chưa đặt"} → {d.moi ? nhanThangKy(d.moi) : "gỡ"}
              </Td>
              <Td className="text-muted-foreground">
                {d.bangChung
                  ? `Invalid ${d.bangChung.invalidAttribution ?? "?"} · hàng chờ ${d.bangChung.holdNghiemTrongDuKien ?? "?"} · chênh lạ ${d.bangChung.unexpectedDelta ?? "?"}${d.soExpected !== null ? ` · có chủ đích ${d.soExpected}` : ""}`
                  : "không đòi bằng chứng"}
              </Td>
              <Td className="max-w-[40ch] truncate" title={d.lyDo}>
                {d.lyDo}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </VoBang>
  );
}

export function ChuyenHoaHongMan(p: PropsMan) {
  const router = useRouter();
  const [dang, batDau] = useTransition();
  const [kieu, setKieu] = useState<"DAT" | "GO">("DAT");
  const [thang, setThang] = useState(p.thangGoiY);
  const [tuNgay, setTuNgay] = useState(p.cuaSoMacDinh.tuNgay);
  const [denNgay, setDenNgay] = useState(p.cuaSoMacDinh.denNgay);
  const [xem, setXem] = useState<XemTruoc | null>(null);
  const [loi, setLoi] = useState<string | null>(null);
  const [lyDo, setLyDo] = useState("");
  const [viec, setViec] = useState<"XEM" | "GHI" | null>(null);

  const thangHopLe = kieu === "GO" || /^\d{4}-(0[1-9]|1[0-2])$/.test(thang);
  const cuaSoHopLe = tuNgay !== "" && denNgay !== "" && tuNgay <= denNgay && denNgay <= p.homNay;
  const lyDoDu = lyDo.trim().length >= LY_DO_TOI_THIEU;

  /** Đổi bất kỳ ô nào ⇒ kết quả xem trước không còn đúng với ô nữa. */
  const xoaXem = () => {
    setXem(null);
    setLoi(null);
  };

  function xemTruoc(k: "DAT" | "GO") {
    setKieu(k);
    setLoi(null);
    setViec("XEM");
    batDau(async () => {
      const r = await xemTruocCutoverAction({ moi: k === "GO" ? null : thang, tuNgay, denNgay });
      setViec(null);
      if (r.ok) setXem(r.xem);
      else {
        setXem(null);
        setLoi(r.loi);
      }
    });
  }

  function xacNhan() {
    if (!xem) return;
    setLoi(null);
    setViec("GHI");
    batDau(async () => {
      const r = await xacNhanCutoverAction({ moi: xem.moi, lyDo, tuNgay: xem.cuaSo.tuNgay, denNgay: xem.cuaSo.denNgay, cuDaXem: xem.cu, dauVanDaXem: xem.dauVan });
      setViec(null);
      if (r.ok) {
        toast.success(r.thongBao);
        setXem(null);
        setLyDo("");
        router.refresh();
      } else {
        setLoi(r.loi);
        // Số liệu / mốc đã đổi ⇒ kết quả đang hiện không còn đáng tin: xoá để buộc xem lại (không để nút xác nhận đứng cạnh con số cũ).
        if (r.ma === "MOC_DA_DOI" || r.ma === "SO_LIEU_DA_DOI") setXem(null);
      }
    });
  }

  const nhanNutXacNhan = xem?.moi === null ? "Gỡ mốc" : xem?.hanhDong === "DOI_SOM" || xem?.hanhDong === "DOI_MUON" ? "Dời mốc" : "Đặt mốc";

  return (
    <div className="flex flex-col gap-6">
      {/* ── 1 · Mốc hiện tại ─────────────────────────────────────────────────────────────── */}
      <Khoi tieuDe="Mốc hiện tại">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {p.mocHienTai === null ? (
            <p className="text-sm text-foreground">
              <b className="font-semibold">Chưa đặt mốc.</b> Hoa hồng vẫn chốt ở sổ cũ; engine mới không ghi kỳ nào.
            </p>
          ) : (
            <p className="text-sm text-foreground">
              <b className="font-semibold">Từ kỳ {nhanThangKy(p.mocHienTai)}</b> hoa hồng tính theo sổ mới. Các kỳ trước chỉ đọc — hệ thống không tính lại chúng bằng engine mới.
            </p>
          )}
          <StatusPill tone={p.engineBat ? "success" : "muted"}>Engine mới: {p.engineBat ? "đang bật" : "đang tắt"}</StatusPill>
        </div>
        {!p.engineBat && p.mocHienTai !== null && (
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">Mốc đã đặt nhưng engine còn tắt: bật «Hoa hồng theo kỳ mới» ở tab Hoa hồng của Cấu hình vận hành khi sẵn sàng (runbook 05 §7.5 bước 4).</p>
        )}
      </Khoi>

      {/* ── 2 · Mốc đề xuất ──────────────────────────────────────────────────────────────── */}
      <Khoi
        tieuDe="Mốc đề xuất"
        moTa="Chọn tháng sẽ là kỳ đầu tiên của sổ mới (phải sau tháng hiện tại) và cửa sổ khoản thu để so hai engine. Xem trước không ghi gì."
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (thangHopLe && cuaSoHopLe && !dang) xemTruoc("DAT");
          }}
        >
          <div className="grid max-w-3xl gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="cutover-thang" className={NHAN_O}>
                Kỳ đầu tiên của sổ mới
              </label>
              <input
                id="cutover-thang"
                type="month"
                className={O_NHAP}
                value={thang}
                min={p.thangToiThieu}
                aria-invalid={!thangHopLe || undefined}
                disabled={dang}
                onChange={(e) => {
                  setThang(e.target.value);
                  setKieu("DAT");
                  xoaXem();
                }}
              />
              {!thangHopLe && <p className={LOI_O}>Chọn một tháng.</p>}
            </div>
            <div>
              <label htmlFor="cutover-tu" className={NHAN_O}>
                So từ ngày
              </label>
              <input
                id="cutover-tu"
                type="date"
                className={O_NHAP}
                value={tuNgay}
                max={p.homNay}
                disabled={dang}
                onChange={(e) => {
                  setTuNgay(e.target.value);
                  xoaXem();
                }}
              />
            </div>
            <div>
              <label htmlFor="cutover-den" className={NHAN_O}>
                đến ngày
              </label>
              <input
                id="cutover-den"
                type="date"
                className={O_NHAP}
                value={denNgay}
                max={p.homNay}
                aria-invalid={!cuaSoHopLe || undefined}
                disabled={dang}
                onChange={(e) => {
                  setDenNgay(e.target.value);
                  xoaXem();
                }}
              />
              {!cuaSoHopLe && <p className={LOI_O}>Cửa sổ phải đi từ trước đến sau và không ở tương lai.</p>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className={BTN_PRIMARY} disabled={dang || !thangHopLe || !cuaSoHopLe}>
              {viec === "XEM" && kieu === "DAT" ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : null}
              {viec === "XEM" && kieu === "DAT" ? "Đang so hai engine…" : "Xem trước tác động"}
            </button>
            {p.mocHienTai !== null && (
              <button type="button" className={BTN_OUTLINE} disabled={dang || !cuaSoHopLe} onClick={() => xemTruoc("GO")}>
                {viec === "XEM" && kieu === "GO" ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : null}
                Xem trước việc gỡ mốc
              </button>
            )}
          </div>
        </form>
        {loi && !xem && (
          <p role="alert" className="mt-4 flex max-w-3xl items-start gap-2 rounded-xl border border-border bg-state-danger-soft px-3 py-2.5 text-sm text-state-danger-ink">
            <CircleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{loi}</span>
          </p>
        )}
      </Khoi>

      {/* ── 3 · Tác động · 4 · Vấn đề chặn · 5 · Xác nhận ─────────────────────────────────────── */}
      {xem === null ? (
        <p className="border-t border-border pt-6 text-sm text-muted-foreground">
          Chưa xem trước. Bấm «Xem trước tác động» để so hai engine trên khoản thu của cửa sổ đã chọn; tác động, vấn đề chặn và nút xác nhận hiện ở đây.
        </p>
      ) : (
        <>
          <Khoi
            tieuDe={xem.moi === null ? "Tác động của việc gỡ mốc" : `Tác động của mốc ${nhanThangKy(xem.moi)}`}
            moTa={
              xem.hanhDong === null
                ? "Mốc đề xuất không đổi gì so với mốc hiện tại."
                : xem.canPrecheck
                  ? undefined
                  : "Hành động này rút lại phần đã giao cho engine mới nên không cần so bóng; cổng «không có dòng sổ mới trong vùng bị nhả» vẫn áp dụng."
            }
          >
            {xem.tacDong ? <KhoiTacDong t={xem.tacDong} /> : <p className="text-sm text-muted-foreground">Không có số liệu so bóng cho hành động này.</p>}
          </Khoi>

          <Khoi tieuDe="Vấn đề chặn" moTa="Mọi điều kiện còn thiếu, kèm người sửa và nơi sửa. Nút xác nhận chỉ bật khi danh sách này trống.">
            <KhoiChan xem={xem} suaDuoc={p.suaDuoc} />
          </Khoi>

          <Khoi tieuDe="Xác nhận">
            {p.suaDuoc ? (
              <div className="flex max-w-3xl flex-col gap-3">
                <div>
                  <label htmlFor="cutover-ly-do" className={NHAN_O}>
                    Lý do (ít nhất {LY_DO_TOI_THIEU} ký tự, ghi vào nhật ký)
                  </label>
                  <textarea
                    id="cutover-ly-do"
                    className={TEXTAREA}
                    value={lyDo}
                    disabled={dang}
                    placeholder="vd: BGĐ duyệt chuyển sổ hoa hồng mới từ kỳ 12/2026, biên bản ngày …"
                    aria-invalid={lyDo.length > 0 && !lyDoDu ? true : undefined}
                    onChange={(e) => setLyDo(e.target.value)}
                  />
                  {lyDo.length > 0 && !lyDoDu && <p className={LOI_O}>Lý do cần ít nhất {LY_DO_TOI_THIEU} ký tự.</p>}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button type="button" className={xem.moi === null ? BTN_DANGER_OUTLINE : BTN_PRIMARY} disabled={dang || !xem.sanSang || !lyDoDu} onClick={xacNhan}>
                    {viec === "GHI" ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : null}
                    {viec === "GHI" ? "Đang ghi…" : nhanNutXacNhan}
                  </button>
                  {!xem.sanSang && <span className="text-sm text-muted-foreground">Còn {xem.chan.length} vấn đề chặn ở trên.</span>}
                  {xem.sanSang && !lyDoDu && <span className="text-sm text-muted-foreground">Nhập lý do để bật nút.</span>}
                </div>
                <p className="text-xs text-muted-foreground">
                  Server tính lại toàn bộ bằng chứng khi bạn xác nhận. Nếu mốc hoặc số liệu đã đổi từ lúc bạn xem (dấu vân {xem.dauVan.slice(0, 12)}), việc ghi bị từ chối và bạn phải xem lại.
                </p>
                {loi && (
                  <p role="alert" className="flex items-start gap-2 rounded-xl border border-border bg-state-danger-soft px-3 py-2.5 text-sm text-state-danger-ink">
                    <CircleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{loi}</span>
                  </p>
                )}
              </div>
            ) : (
              <p className="max-w-3xl text-sm text-muted-foreground">
                Bạn có quyền xem nhưng không có quyền đặt mốc (<code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">settings:edit</code>). Chuyển bản xem trước này cho Quản trị tối cao để xác nhận.
              </p>
            )}
          </Khoi>
        </>
      )}

      {/* ── Lịch sử ──────────────────────────────────────────────────────────────────────── */}
      <Khoi tieuDe="Lịch sử đặt mốc" moTa="20 lần gần nhất. Lấy từ nhật ký hệ thống của riêng khoá này.">
        <BangLichSu ds={p.lichSu} />
      </Khoi>
    </div>
  );
}
