"use client";

// Khu "Chính sách hoá đơn" (S7, Invoice Hub) — gộp vào trang Cấu hình SẴN CÓ (không màn mới, không tab mới). Danh sách phiên bản của pháp nhân đang xem
// (riêng cơ sở + dùng chung) → chi tiết một phiên bản (nội dung, căn cứ, MÔ PHỎNG trước/sau, hành động, lịch sử) → panel soạn bản mới.
//
// ⚠️ Luật 12 (affordance nói thật): nút Gửi duyệt / Duyệt / Từ chối / Kết thúc chỉ VẼ khi người xem làm được — cờ do server tính bằng CÙNG vị từ với dịch vụ
//    (`hanhDongChinhSachChoPhep`). Người không có quyền duyệt thấy LỜI GIẢI THÍCH vì sao không có nút Duyệt, không phải khoảng trống. (Luật «người khác duyệt» ĐÃ BỎ 02/11/2026.)
// ⚠️ Mô phỏng + băm do SERVER tính (`dungMoPhong`); client chỉ trình bày và gửi lại CHUỖI BĂM của bảng đang hiện. Server tính lại và so — duyệt chỉ nhận
//    khi hai băm khớp. Ô "Tôi đã xem bảng mô phỏng" là thao tác của người, không phải bằng chứng; bằng chứng là băm.
// ⚠️ Trạng thái giữ qua URL: `?chinhSach=<id>` (phiên bản đang mở) và `?soan=rieng|chung|tu:<id>` (panel soạn). Reload / Back / chia sẻ link giữ nguyên.

import { useId, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InfoTip } from "@/components/admin/ui/help-hint";
import { StatusPill } from "@/components/admin/ui/status-pill";
import { huongDan } from "@/lib/finance/hoa-don/huong-dan";
import {
  NHAN_CHE_DO,
  NHAN_TRANG_THAI,
  QR_TTL_GIO_MAC_DINH,
  lyDoDuDai,
  qrTtlGioHieuLuc,
  toiThieuLyDo,
  type NoiDungChinhSach,
  type TrangThaiChinhSach,
} from "@/lib/finance/hoa-don/chinh-sach-phien-ban";
import type { KetQuaMoPhongChinhSach } from "@/lib/finance/hoa-don/chinh-sach-mo-phong";
import type { HanhDongChinhSach } from "@/lib/finance/hoa-don/quyen";
import { CHU_PILL } from "../../_components/mau-pill";
import { duyetChinhSachAction, guiDuyetChinhSachAction, hetHieuLucChinhSachAction, tuChoiChinhSachAction } from "../_chinh-sach-actions";
import { ChinhSachForm } from "./chinh-sach-form";
import { MoPhongBang } from "./mo-phong-bang";
import { NHAN_DO_TIN_CAY, NHAN_KIEU_GIA, NHAN_CACH_SO_BUOI, NHAN_MUC_NGUOI_MUA, NHAN_THOI_DIEM_LAP, NHAN_TRANG_THAI_PILL, ddmmyyyy, gioVN, nhanLoaiKhoan, nhanMucThue, nhapMoi, nhapTuNoiDung } from "./chinh-sach-nhap";

export type MoPhongHienThi = { ok: true; ketQua: KetQuaMoPhongChinhSach; hash: string } | { ok: false; loi: string[] };
export type LichSuHienThi = { id: string; hanhDong: string; luc: string; nguoi: string; lyDo: string | null };
export type BanHienThi = {
  id: string;
  phienBan: number;
  centerId: string | null;
  trangThai: TrangThaiChinhSach;
  hieuLucTu: string;
  hieuLucDen: string | null;
  tenNguoiTao: string;
  tenNguoiDuyet: string | null;
  lyDo: string | null;
  /** `null` khi nội dung trong DB không phân tích được (sửa tay) — hiện lỗi, không hiện bảng. */
  noiDung: NoiDungChinhSach | null;
  loiNoiDung: string[];
  /** Chỉ có cho bản NHAP / CHO_DUYET. */
  moPhong: MoPhongHienThi | null;
  hanhDong: HanhDongChinhSach;
  lichSu: LichSuHienThi[];
};

const NHAN_HANH_DONG: Record<string, string> = {
  TAO_CHINH_SACH_HOA_DON: "Soạn bản nháp",
  GUI_DUYET_CHINH_SACH_HOA_DON: "Gửi duyệt",
  DUYET_CHINH_SACH_HOA_DON: "Duyệt",
  TU_CHOI_CHINH_SACH_HOA_DON: "Từ chối",
  KET_THUC_CHINH_SACH_HOA_DON: "Kết thúc hiệu lực",
};

export function ChinhSachHoaDon({
  centerId,
  tenCoSo,
  phapNhan,
  ban,
  coTheSoanRieng,
  coTheSoanChung,
}: {
  centerId: string;
  tenCoSo: string;
  phapNhan: { ma: string; ten: string; maSoThue: string };
  ban: BanHienThi[];
  coTheSoanRieng: boolean;
  coTheSoanChung: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const dangMo = sp.get("chinhSach");
  const soan = sp.get("soan");

  const datUrl = (p: Record<string, string | null>) => {
    const q = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(p)) {
      if (v === null) q.delete(k);
      else q.set(k, v);
    }
    const qs = q.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const banMo = ban.find((b) => b.id === dangMo) ?? null;
  const tuBan = soan?.startsWith("tu:") ? (ban.find((b) => b.id === soan.slice(3)) ?? null) : null;
  const chungKhiSoan = soan === "chung" || (tuBan !== null && tuBan.centerId === null);
  const dangSoan = soan === "rieng" || soan === "chung" || tuBan !== null;
  // Chỉ mở panel soạn khi người xem được phép ở phạm vi đó (URL do người dùng gõ không mở được cái họ không làm được).
  const duocSoan = chungKhiSoan ? coTheSoanChung : coTheSoanRieng;

  return (
    <section aria-labelledby="cs-tieu-de" className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 id="cs-tieu-de" className="flex items-center gap-1 text-base font-semibold">
            Bước 4 · Chính sách hoá đơn
            <InfoTip label="Xem hướng dẫn về chính sách hoá đơn">{huongDan("chinh-sach-hoa-don")}</InfoTip>
          </h2>
          <p className="text-sm text-muted-foreground">
            Pháp nhân <span className="font-medium text-foreground">{phapNhan.ten}</span> · MST {phapNhan.maSoThue} — đang xem{" "}
            <span className="font-medium text-foreground">{tenCoSo}</span>. Bản <b>riêng cơ sở</b> thắng bản <b>dùng chung</b> cùng loại khoản. Mỗi bản chỉ có hiệu lực sau khi được{" "}
            <b>duyệt</b>
            <InfoTip label="Xem hướng dẫn về việc duyệt" className="ml-1">
              {huongDan("duyet-hai-nguoi")}
            </InfoTip>
            .
          </p>
        </div>
        <div className="flex flex-wrap gap-2 sm:shrink-0">
          {coTheSoanRieng ? (
            <Button type="button" size="sm" disabled={dangSoan} onClick={() => datUrl({ soan: "rieng", chinhSach: null })}>
              Soạn bản riêng cho cơ sở này
            </Button>
          ) : null}
          {coTheSoanChung ? (
            <Button type="button" size="sm" variant="outline" disabled={dangSoan} onClick={() => datUrl({ soan: "chung", chinhSach: null })}>
              Soạn bản dùng chung
            </Button>
          ) : null}
        </div>
      </div>

      {!coTheSoanRieng && !coTheSoanChung ? <p className="text-xs text-muted-foreground">Bạn chỉ xem được khu này; soạn bản mới cần quyền kế toán của cơ sở (bản dùng chung: kế toán Hội sở).</p> : null}

      {dangSoan && duocSoan ? (
        <ChinhSachForm
          key={soan ?? "x"}
          centerId={centerId}
          phapNhanMa={phapNhan.ma}
          tenPhapNhan={phapNhan.ten}
          tenCoSo={tenCoSo}
          ban={tuBan?.noiDung ? nhapTuNoiDung(tuBan.noiDung, chungKhiSoan) : nhapMoi(chungKhiSoan)}
          onHuy={() => datUrl({ soan: null })}
          onXong={(idMoi) => {
            datUrl({ soan: null, chinhSach: idMoi });
            router.refresh();
          }}
        />
      ) : null}

      {ban.length === 0 ? (
        <div className="flex flex-col gap-3 rounded-xl border border-dashed border-border bg-card px-4 py-6 text-sm">
          <p className="text-base font-semibold text-foreground">Pháp nhân này chưa có chính sách nào</p>
          <p className="text-muted-foreground">
            Cho tới khi có một bản được duyệt, hoá đơn tự động của Hub chưa có quy tắc để chạy (cách lập hoá đơn hiện nay không đổi). Hệ thống KHÔNG tự đặt mức thuế — bạn khai theo hoá đơn công ty đã xuất.
          </p>
          <p className="text-muted-foreground">{huongDan("soan-cs-tong-quan")}</p>
          {coTheSoanRieng && !dangSoan ? (
            <div>
              <Button type="button" size="sm" onClick={() => datUrl({ soan: "rieng", chinhSach: null })}>
                Bắt đầu soạn chính sách đầu tiên
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[40rem] text-sm">
            <caption className="sr-only">Các phiên bản chính sách hoá đơn</caption>
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Phiên bản
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Phạm vi
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Hiệu lực
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Trạng thái
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Người soạn
                </th>
                <th scope="col" className="px-3 py-2">
                  <span className="sr-only">Mở</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {ban.map((b) => (
                <tr key={b.id} className={`border-t border-border ${b.id === dangMo ? "bg-primary-soft/40" : ""}`}>
                  <td className="px-3 py-2 font-medium tabular-nums">v{b.phienBan}</td>
                  <td className="px-3 py-2">{b.centerId === null ? "Dùng chung" : "Riêng cơ sở"}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {ddmmyyyy(b.hieuLucTu)} → {b.hieuLucDen ? ddmmyyyy(b.hieuLucDen) : "không giới hạn"}
                  </td>
                  <td className="px-3 py-2">
                    <StatusPill tone={NHAN_TRANG_THAI_PILL[b.trangThai]} className={CHU_PILL[NHAN_TRANG_THAI_PILL[b.trangThai]]}>
                      {NHAN_TRANG_THAI[b.trangThai]}
                    </StatusPill>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{b.tenNguoiTao}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-expanded={b.id === dangMo}
                      aria-label={`${b.id === dangMo ? "Đóng" : "Xem"} phiên bản ${b.phienBan}${b.centerId === null ? " dùng chung" : ""}`}
                      onClick={() => datUrl({ chinhSach: b.id === dangMo ? null : b.id, soan: null })}
                    >
                      {b.id === dangMo ? "Đóng" : "Xem"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dangMo && !banMo ? <p role="alert" className="text-sm text-state-danger-ink">Không tìm thấy phiên bản này trong phạm vi bạn xem (có thể đã bị đổi hoặc không thuộc cơ sở này).</p> : null}

      {banMo ? (
        <ChiTietBan
          key={banMo.id}
          ban={banMo}
          tenPhapNhan={phapNhan.ten}
          coTheSoanTu={banMo.centerId === null ? coTheSoanChung : coTheSoanRieng}
          onSoanTu={() => datUrl({ soan: `tu:${banMo.id}`, chinhSach: null })}
          onDong={() => datUrl({ chinhSach: null })}
        />
      ) : null}
    </section>
  );
}

// ── CHI TIẾT MỘT PHIÊN BẢN ────────────────────────────────────────────────

function ChiTietBan({
  ban,
  tenPhapNhan,
  coTheSoanTu,
  onSoanTu,
  onDong,
}: {
  ban: BanHienThi;
  tenPhapNhan: string;
  coTheSoanTu: boolean;
  onSoanTu: () => void;
  onDong: () => void;
}) {
  const id = useId();
  const router = useRouter();
  const [lyDo, setLyDo] = useState("");
  const [daXem, setDaXem] = useState(false);
  const [ngayKetThuc, setNgayKetThuc] = useState("");
  const [loi, setLoi] = useState<string | null>(null);
  const [dang, batDau] = useTransition();
  const h = ban.hanhDong;
  const coHanhDong = h.guiDuyet || h.apDungNgay || h.duyet || h.tuChoi || h.ketThuc;
  const lyDoOk = lyDoDuDai(lyDo);
  const nd = ban.noiDung;

  function chay(viec: () => Promise<{ ok: true } | { ok: false; error: string }>, thanhCong: string) {
    setLoi(null);
    batDau(async () => {
      const r = await viec();
      if (!r.ok) return setLoi(r.error);
      toast.success(thanhCong);
      setLyDo("");
      setDaXem(false);
      router.refresh();
    });
  }

  const mp = ban.moPhong;
  const hashMoPhong = mp && mp.ok ? mp.hash : null;

  /**
   * «Gửi duyệt và áp dụng ngay»: HAI bước máy chủ riêng (gửi duyệt rồi duyệt) — mỗi bước vẫn qua đủ cổng của nó (quyền, lý do, băm mô phỏng khớp, không chồng/hở
   * hiệu lực). Bước hai hỏng thì bản dừng ở «Chờ duyệt» và màn nói rõ; KHÔNG cuộn lại bước một (đó là trạng thái thật, người dùng bấm Duyệt sau).
   */
  function apDungNgay() {
    setLoi(null);
    batDau(async () => {
      const r1 = await guiDuyetChinhSachAction({ id: ban.id, lyDo });
      if (!r1.ok) return setLoi(r1.error);
      const r2 = await duyetChinhSachAction({ id: ban.id, lyDo, hashMoPhong });
      if (!r2.ok) {
        setLoi(`Đã gửi duyệt nhưng CHƯA áp dụng được: ${r2.error} Bản đang ở trạng thái «Chờ duyệt» — mở lại bản này, xem mô phỏng rồi bấm Duyệt.`);
        router.refresh();
        return;
      }
      toast.success("Đã áp dụng — phiên bản có hiệu lực");
      setLyDo("");
      setDaXem(false);
      router.refresh();
    });
  }

  return (
    <article aria-label={`Chi tiết phiên bản ${ban.phienBan}`} className="flex flex-col gap-5 rounded-xl border border-border bg-card p-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-2 text-base font-semibold">
            Phiên bản {ban.phienBan} · {ban.centerId === null ? `dùng chung toàn ${tenPhapNhan}` : "riêng cơ sở"}
            <StatusPill tone={NHAN_TRANG_THAI_PILL[ban.trangThai]} className={CHU_PILL[NHAN_TRANG_THAI_PILL[ban.trangThai]]}>
              {NHAN_TRANG_THAI[ban.trangThai]}
            </StatusPill>
          </h3>
          <p className="text-sm tabular-nums text-muted-foreground">
            Hiệu lực {ddmmyyyy(ban.hieuLucTu)} → {ban.hieuLucDen ? ddmmyyyy(ban.hieuLucDen) : "không giới hạn"} · soạn bởi {ban.tenNguoiTao}
            {ban.tenNguoiDuyet ? ` · ${ban.trangThai === "TU_CHOI" ? "từ chối" : "duyệt"} bởi ${ban.tenNguoiDuyet}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {coTheSoanTu && nd ? (
            <Button type="button" variant="outline" size="sm" onClick={onSoanTu}>
              Soạn bản mới từ bản này
            </Button>
          ) : null}
          <Button type="button" variant="ghost" size="sm" onClick={onDong}>
            Đóng
          </Button>
        </div>
      </header>

      {ban.trangThai === "HIEU_LUC" || ban.trangThai === "HET_HIEU_LUC" ? (
        <p className="text-xs text-muted-foreground">Bản đã có hiệu lực không sửa được. Muốn đổi: “Soạn bản mới từ bản này”, kết thúc bản cũ vào ngày liền trước, rồi duyệt bản mới.</p>
      ) : null}

      {nd === null ? (
        <p role="alert" className="text-sm text-state-danger-ink">
          Nội dung của phiên bản này không đọc được: {ban.loiNoiDung.join("; ")}. Báo quản trị — không dùng bản này.
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-x-4 gap-y-3 text-sm">
            <Muc ten="Thời điểm lập hoá đơn">{NHAN_THOI_DIEM_LAP[nd.thoiDiemLap]}</Muc>
            <Muc ten="Chế độ tối đa" tip={huongDan("che-do-toi-da")}>
              {NHAN_CHE_DO[nd.cheDoToiDa]}
            </Muc>
            <Muc ten="Mức thông tin người mua">{NHAN_MUC_NGUOI_MUA[nd.nguoiMua.buyerInfoLevel]}</Muc>
            <Muc ten="Hiệu lực mã QR người mua" tip={huongDan("qr-thong-tin-hoa-don", qrTtlGioHieuLuc(nd))}>
              {qrTtlGioHieuLuc(nd)} giờ{nd.nguoiMua.qrTtlGio === null ? ` (mặc định ${QR_TTL_GIO_MAC_DINH} giờ)` : ""}
            </Muc>
            <Muc ten="Làm tròn">Nửa lên</Muc>
          </dl>

          <section aria-label="Ánh xạ thuế" className="flex flex-col gap-2">
            <h4 className="flex items-center gap-1 text-sm font-semibold">
              Ánh xạ thuế theo loại khoản
              <InfoTip label="Xem hướng dẫn về thuế">{huongDan("thue")}</InfoTip>
            </h4>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[32rem] text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">Loại khoản</th>
                    <th scope="col" className="px-3 py-2 font-medium">Mức thuế</th>
                    <th scope="col" className="px-3 py-2 font-medium">Cách ghi giá</th>
                    <th scope="col" className="px-3 py-2 font-medium">Đơn vị</th>
                    <th scope="col" className="px-3 py-2 font-medium">Số buổi</th>
                  </tr>
                </thead>
                <tbody>
                  {nd.anhXaThue.map((d) => (
                    <tr key={d.loaiKhoan} className="border-t border-border">
                      <td className="px-3 py-2 font-medium">{nhanLoaiKhoan(d.loaiKhoan)}{nhanLoaiKhoan(d.loaiKhoan) !== d.loaiKhoan ? <span className="ml-1 text-xs font-normal text-muted-foreground">({d.loaiKhoan})</span> : null}</td>
                      <td className="px-3 py-2 tabular-nums">{nhanMucThue(d.mucThue)}</td>
                      <td className="px-3 py-2">{NHAN_KIEU_GIA[d.kieuGia]}</td>
                      <td className="px-3 py-2">{d.donViTinh} / {d.donViTinhBuoi}</td>
                      <td className="px-3 py-2 text-muted-foreground">{NHAN_CACH_SO_BUOI[d.cachThuSoBuoi]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section aria-label="Căn cứ" className="flex flex-col gap-2">
            <h4 className="text-sm font-semibold">Căn cứ</h4>
            {nd.legalBasisRef.length === 0 ? (
              <p className="text-sm text-muted-foreground">Chưa ghi căn cứ nào.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border rounded-lg border border-border text-sm">
                {nd.legalBasisRef.map((r, i) => (
                  <li key={i} className="flex flex-col gap-0.5 px-3 py-2">
                    <span className="font-medium">
                      {r.vanBan}
                      {r.dieu ? ` · Điều ${r.dieu}` : ""}
                      {r.khoan ? ` · Khoản ${r.khoan}` : ""}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Độ tin cậy của nguồn: {NHAN_DO_TIN_CAY[r.doTinCay]} ·{" "}
                      {r.canKeToanXacNhan ? (r.daKyDuyetBoi ? `Người soạn khai đã được ${r.daKyDuyetBoi} ký duyệt ngày ${ddmmyyyy(r.daKyDuyetLuc)} — hệ thống chưa xác minh chữ ký này` : "Cần kế toán xác nhận — chưa ai ký, chỉ được chạy thử") : "Không đòi xác nhận riêng"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {mp ? (
        mp.ok ? (
          <MoPhongBang ketQua={mp.ketQua} />
        ) : (
          <p role="alert" className="text-sm text-state-danger-ink">
            Không dựng được mô phỏng: {mp.loi.join("; ")}
          </p>
        )
      ) : null}

      {coHanhDong ? (
        <section aria-label="Hành động" className="flex flex-col gap-3 border-t border-border pt-4">
          <div>
            <Label htmlFor={`${id}-ld`}>Lý do (ít nhất {toiThieuLyDo} ký tự, ghi vào lịch sử)</Label>
            <Input id={`${id}-ld`} className="mt-1.5" value={lyDo} maxLength={500} disabled={dang} onChange={(e) => setLyDo(e.target.value)} />
          </div>
          {(h.duyet || h.apDungNgay) && !mp ? <p className="text-sm text-state-warning-ink">Chưa có bảng mô phỏng cho phiên bản này nên chưa duyệt được — tải lại trang; nếu vẫn vậy, báo quản trị.</p> : null}
          {h.duyet || h.apDungNgay ? (
            <div className="flex items-center gap-2">
              <input id={`${id}-xem`} type="checkbox" className="size-4 accent-primary pointer-coarse:size-5" checked={daXem} disabled={dang || !hashMoPhong} onChange={(e) => setDaXem(e.target.checked)} />
              <Label htmlFor={`${id}-xem`}>Tôi đã xem bảng mô phỏng ở trên</Label>
            </div>
          ) : null}
          {h.ketThuc ? (
            <div className="max-w-xs">
              <Label htmlFor={`${id}-kt`}>Kết thúc hiệu lực vào hết ngày</Label>
              <Input id={`${id}-kt`} type="date" className="mt-1.5" value={ngayKetThuc} disabled={dang} onChange={(e) => setNgayKetThuc(e.target.value)} />
            </div>
          ) : null}
          {loi ? (
            <p role="alert" className="text-sm text-state-danger-ink">
              {loi}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {h.apDungNgay ? (
              <Button type="button" disabled={dang || !lyDoOk || !daXem || !hashMoPhong} onClick={apDungNgay}>
                {dang ? "Đang áp dụng…" : "Gửi duyệt và áp dụng ngay"}
              </Button>
            ) : null}
            {h.guiDuyet ? (
              <Button type="button" variant={h.apDungNgay ? "outline" : "default"} disabled={dang || !lyDoOk} onClick={() => chay(() => guiDuyetChinhSachAction({ id: ban.id, lyDo }), "Đã gửi duyệt")}>
                {dang ? "Đang gửi…" : h.apDungNgay ? "Chỉ gửi duyệt (duyệt sau)" : "Gửi duyệt"}
              </Button>
            ) : null}
            {h.duyet ? (
              <Button type="button" disabled={dang || !lyDoOk || !daXem || !hashMoPhong} onClick={() => chay(() => duyetChinhSachAction({ id: ban.id, lyDo, hashMoPhong }), "Đã duyệt — phiên bản có hiệu lực")}>
                {dang ? "Đang duyệt…" : "Duyệt"}
              </Button>
            ) : null}
            {h.tuChoi ? (
              <Button type="button" variant="outline" disabled={dang || !lyDoOk} onClick={() => chay(() => tuChoiChinhSachAction({ id: ban.id, lyDo }), "Đã từ chối")}>
                Từ chối
              </Button>
            ) : null}
            {h.ketThuc ? (
              <Button type="button" variant="outline" disabled={dang || !lyDoOk || ngayKetThuc === ""} onClick={() => chay(() => hetHieuLucChinhSachAction({ id: ban.id, lyDo, ngayKetThuc }), "Đã kết thúc hiệu lực")}>
                Kết thúc hiệu lực
              </Button>
            ) : null}
          </div>
        </section>
      ) : h.lyDoKhongDuyet ? (
        <p className="border-t border-border pt-4 text-sm text-muted-foreground" role="status">
          {h.lyDoKhongDuyet}
        </p>
      ) : null}

      <section aria-label="Lịch sử phiên bản" className="flex flex-col gap-2">
        <h4 className="text-sm font-semibold">Lịch sử</h4>
        {ban.lichSu.length === 0 ? (
          <p className="text-sm text-muted-foreground">Chưa có thay đổi nào được ghi.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border text-sm">
            {ban.lichSu.map((l) => (
              <li key={l.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2">
                <span className="font-medium">{NHAN_HANH_DONG[l.hanhDong] ?? l.hanhDong}</span>
                <span className="tabular-nums text-muted-foreground">{gioVN(l.luc)}</span>
                <span className="text-muted-foreground">{l.nguoi}</span>
                {l.lyDo ? <span className="w-full text-muted-foreground">Lý do: {l.lyDo}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}

function Muc({ ten, tip, children }: { ten: string; tip?: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1 text-xs text-muted-foreground">
        {ten}
        {tip ? <InfoTip label={`Xem hướng dẫn: ${ten}`}>{tip}</InfoTip> : null}
      </dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}
