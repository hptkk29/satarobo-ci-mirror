// lib/pdf/phieu-thu.tsx — PHIẾU THU, dựng theo ĐÚNG bố cục ba tờ hoá đơn thật ở
// `E:\websatarobo data\hoadon` (chủ dự án 15/09: *"điều chỉnh lại form hoá đơn giống 100%
// với các hoá đơn mẫu"*, chọn cách (b)).
//
// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ TỜ NÀY KHÔNG PHẢI HOÁ ĐƠN GTGT, VÀ CỐ Ý NÓI RA ĐIỀU ĐÓ
//
// Ba tờ mẫu do MISA meInvoice / VIN HOADON phát hành, mỗi tờ mang:
//   · **Mã CQT** — mã cơ quan thuế cấp khi tiếp nhận hoá đơn;
//   · **Ký hiệu + Số** đã đăng ký với thuế (1C26TSR-00000086 · 1C26MNV-13);
//   · **chữ ký số** của pháp nhân ("Signature Valid · Ký bởi… · Ký ngày…");
//   · **mã tra cứu** trên trang của nhà phát hành.
//
// Bốn thứ đó KHÔNG THỂ do hệ thống này tạo ra. Dựng một tờ giống hệt rồi điền số vào bốn ô
// ấy là làm ra giấy tờ thuế giả — nên bản in này:
//   · lấy ĐÚNG bố cục, đúng bộ ô, đúng cách cộng thuế của mẫu (kế toán đọc quen mắt);
//   · KHÔNG có Mã CQT, KHÔNG có ký hiệu/số hoá đơn, KHÔNG có ô chữ ký số, KHÔNG có mã
//     tra cứu;
//   · in rõ ở tiêu đề và ở chân trang rằng đây là phiếu thu nội bộ, không thay thế hoá đơn.
//
// Bộ số thì lấy từ tầng thuần đã đo sẵn từ ba tờ đó (`lib/finance/hoa-don/*`): pháp nhân,
// thuế suất theo loại đơn, quy ước giá đã-gồm/chưa-gồm thuế, khối người mua, số tiền bằng
// chữ. Nhờ vậy khi kế toán nạp sang MISA/VIN thì các con số khớp, không phải nhập lại.
// ─────────────────────────────────────────────────────────────────────────────
import React from "react";
import path from "path";
import { Document, Page, Text, View, StyleSheet, Font } from "@react-pdf/renderer";
import { formatVndPlain } from "@/lib/format/money";
import type { DongHoaDon, TongHoaDon } from "@/lib/finance/hoa-don/tinh-hoa-don";
import type { NguoiMuaHoaDon } from "@/lib/finance/hoa-don/nguoi-mua";
import type { PhapNhan } from "@/lib/finance/hoa-don/phap-nhan";

const FONT_REGULAR = path.join(process.cwd(), "public/fonts/NotoSans-Regular.ttf");
const FONT_BOLD = path.join(process.cwd(), "public/fonts/NotoSans-Bold.ttf");
Font.register({
  family: "NotoSans",
  fonts: [
    { src: FONT_REGULAR, fontWeight: "normal" },
    { src: FONT_BOLD, fontWeight: "bold" },
  ],
});

export type PhieuThuPdfData = {
  /**
   * Mã phiếu thu NỘI BỘ (RCP-…). KHÔNG phải số hoá đơn.
   *
   * `null` ⇒ BẢN CHỜ XÁC NHẬN (docs/ke-toan-hoa-don/PLAN.md §4 bước ②): kế toán tải ngay khi tiền
   * về, trước khi có số RCP. Bản chờ in dấu nền "CHỜ XÁC NHẬN · CHƯA CÓ SỐ" và để trống ô số.
   * Cố ý là `null` chứ không phải một cờ `banCho?: boolean`: quên truyền cờ là in ra một tờ không
   * dấu nền, không số — còn thiếu số thì TỰ có dấu nền (hỏng về phía an toàn), và không thể có
   * trạng thái mâu thuẫn "bản chờ mà có RCP".
   */
  maPhieu: string | null;
  /** dd/mm/yyyy — bản chính thức: ngày lập phiếu; bản chờ: ngày THU (lịch VN). */
  ngayLap: string;
  phapNhan: PhapNhan;
  nguoiMua: NguoiMuaHoaDon;
  /** Nhãn hình thức thanh toán đã tra từ danh mục (không in mã nội bộ). */
  hinhThucThanhToan: string;
  dong: DongHoaDon[];
  tong: TongHoaDon;
  soTienBangChu: string;
  /** Mã đơn hàng — để đối chiếu, in nhỏ. */
  maDon: string | null;
  nguoiThu: string | null;
};

/**
 * Nhãn DỰ PHÒNG cho `Payment.method`.
 *
 * ⚠️ BẮT BUỘC GIỮ. Tờ phiếu này ĐƯA TẬN TAY PHỤ HUYNH, nên in mã nội bộ là lỗi nhìn thấy
 * được ở ngoài công ty. Tôi đã thử bỏ bảng này và tin vào `methodLabel` tra từ DB — in ra
 * đúng chữ **"Hình thức thanh toán: auto"** trên phiếu RCP-CS2-26-0011, vì khoản ghi nhận
 * tự động mang `method = "auto"` và không có dòng nào trong danh mục phương thức.
 *
 * Danh mục phương thức nằm trong DB và mỗi cơ sở có mã riêng ("BANK_CS1"), nên bảng cứng
 * này KHÔNG thể biết hết — route vẫn phải truyền `hinhThucThanhToan` đã tra. Bảng chỉ đỡ
 * cho mã cũ đã ngừng dùng và cho nhãn do đường ghi tự động sinh.
 */
const NHAN_PHUONG_THUC: Record<string, string> = {
  CASH: "Tiền mặt",
  BANK_TRANSFER: "Chuyển khoản",
  VNPAY: "VNPAY",
  TINGEE: "Tingee",
  COD: "COD",
  auto: "Ghi nhận tự động",
  backfill: "Ghi nhận bù sổ",
  sepay: "Chuyển khoản (SePay)",
  payos: "Chuyển khoản (payOS)",
};

/** Nhãn hiển thị: nhãn tra từ DB thắng, rồi bảng dự phòng, cuối cùng mới tới chính mã. */
export function nhanHinhThuc(raw: string): string {
  const t = raw.trim();
  return NHAN_PHUONG_THUC[t] ?? t;
}

const vnd = (n: number) => formatVndPlain(n);
/** Đơn giá in đúng kiểu mẫu MISA: có phần lẻ ("1.851.851,85"). */
const donGia = (n: number) =>
  n.toLocaleString("vi-VN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const s = StyleSheet.create({
  page: { padding: 34, fontFamily: "NotoSans", fontSize: 9, color: "#111" },
  khung: { borderWidth: 1, borderColor: "#7aa7c7", padding: 14 },

  tieuDe: { fontSize: 15, fontWeight: "bold", textAlign: "center", color: "#1f4e79" },
  phuDe: { fontSize: 8.5, textAlign: "center", marginTop: 2, color: "#b45309" },
  ngay: { fontSize: 9, textAlign: "center", marginTop: 4 },
  soPhieu: { fontSize: 9, textAlign: "center", marginTop: 2 },

  vach: { borderBottomWidth: 0.7, borderBottomColor: "#9db8cc", marginVertical: 8 },
  dongKhai: { flexDirection: "row", marginTop: 2.5 },
  nhan: { width: "30%", color: "#333" },
  giaTri: { width: "70%", fontWeight: "bold" },
  tenBan: { fontSize: 10.5, fontWeight: "bold", color: "#1f4e79" },

  bang: { marginTop: 10, borderWidth: 0.7, borderColor: "#6b8fa8" },
  hang: { flexDirection: "row", borderBottomWidth: 0.7, borderBottomColor: "#9db8cc" },
  hangCuoi: { flexDirection: "row" },
  o: { padding: 4, borderRightWidth: 0.7, borderRightColor: "#9db8cc" },
  oCuoi: { padding: 4 },
  dauBang: { backgroundColor: "#eef4f9", fontWeight: "bold", textAlign: "center" },

  cStt: { width: "7%" },
  cTen: { width: "40%" },
  cDvi: { width: "11%" },
  cSl: { width: "8%" },
  cDonGia: { width: "17%" },
  cThanhTien: { width: "17%" },
  phai: { textAlign: "right" },
  giua: { textAlign: "center" },

  tongHang: { flexDirection: "row", borderTopWidth: 0.7, borderTopColor: "#9db8cc" },
  tongNhan: { width: "66%", padding: 4, textAlign: "right", borderRightWidth: 0.7, borderRightColor: "#9db8cc" },
  tongGiaTri: { width: "34%", padding: 4, textAlign: "right" },
  tongDam: { fontWeight: "bold", fontSize: 10 },

  bangChu: { marginTop: 8, borderWidth: 0.7, borderColor: "#9db8cc", padding: 5 },

  kyTen: { flexDirection: "row", marginTop: 24, justifyContent: "space-between" },
  cotKy: { width: "48%", alignItems: "center" },
  kyNhan: { fontWeight: "bold" },
  kyPhu: { fontSize: 8, color: "#555", marginTop: 2 },
  kyCho: { marginTop: 42, fontSize: 8.5, color: "#333" },

  chan: { marginTop: 14, fontSize: 7.5, color: "#7c2d12", textAlign: "center", lineHeight: 1.4 },

  // Dấu nền bản chờ — nằm TRÊN khung, xoay chéo, mờ; không che số liệu.
  dauNen: {
    position: "absolute",
    top: 360,
    left: 0,
    right: 0,
    textAlign: "center",
    fontSize: 30,
    fontWeight: "bold",
    color: "#b91c1c",
    opacity: 0.16,
    transform: "rotate(-28deg)",
  },
});

function Khai({ nhan, giaTri }: { nhan: string; giaTri: string }) {
  return (
    <View style={s.dongKhai}>
      <Text style={s.nhan}>{nhan}</Text>
      <Text style={s.giaTri}>{giaTri}</Text>
    </View>
  );
}

/** MỘT tờ phiếu thu (một `<Page>`). Bản chính thức và bản chờ dùng CHUNG bố cục này. */
export function PhieuThuTrang({ data }: { data: PhieuThuPdfData }) {
  const { phapNhan: pn, nguoiMua: nm, tong } = data;
  const banCho = data.maPhieu == null;
  // Số hàng trống để bảng cao bằng mẫu — mẫu MISA luôn chừa 5 dòng.
  const hangTrong = Math.max(0, 4 - data.dong.length);

  return (
    <Page size="A4" style={s.page}>
      {banCho ? <Text style={s.dauNen}>CHỜ XÁC NHẬN · CHƯA CÓ SỐ</Text> : null}
      <View style={s.khung}>
        <Text style={s.tieuDe}>PHIẾU THU</Text>
        {/* Dòng này KHÔNG được bỏ — xem chú thích đầu tệp. */}
        <Text style={s.phuDe}>
          Phiếu thu nội bộ — KHÔNG phải hoá đơn giá trị gia tăng
        </Text>
        <Text style={s.ngay}>
          {banCho ? "Ngày thu" : "Ngày lập"}: {data.ngayLap}
        </Text>
        <Text style={s.soPhieu}>
          Số phiếu: {data.maPhieu ?? "(cấp khi kế toán xác nhận)"}
          {data.maDon ? `   ·   Đơn hàng: ${data.maDon}` : ""}
        </Text>

        <View style={s.vach} />

        <Text style={s.tenBan}>Đơn vị thu: {pn.ten}</Text>
        <Khai nhan="Mã số thuế" giaTri={pn.maSoThue} />
        <Khai nhan="Địa chỉ" giaTri={pn.diaChi} />
        {pn.dienThoai ? <Khai nhan="Điện thoại" giaTri={pn.dienThoai} /> : null}
        {pn.website ? <Khai nhan="Website" giaTri={pn.website} /> : null}

        <View style={s.vach} />

        <Khai nhan="Họ tên người nộp tiền" giaTri={nm.hoTen} />
        {nm.tenDonVi ? <Khai nhan="Tên đơn vị" giaTri={nm.tenDonVi} /> : null}
        {nm.maSoThue ? <Khai nhan="Mã số thuế" giaTri={nm.maSoThue} /> : null}
        <Khai nhan="Địa chỉ" giaTri={nm.diaChi || "—"} />
        {nm.cccd ? <Khai nhan="CCCD / Hộ chiếu" giaTri={nm.cccd} /> : null}
        <Khai nhan="Hình thức thanh toán" giaTri={nhanHinhThuc(data.hinhThucThanhToan)} />

        {/* ── BẢNG NỘI DUNG THU ───────────────────────────────────────── */}
        <View style={s.bang}>
          <View style={s.hang}>
            <Text style={[s.o, s.cStt, s.dauBang]}>STT</Text>
            <Text style={[s.o, s.cTen, s.dauBang]}>Nội dung thu</Text>
            <Text style={[s.o, s.cDvi, s.dauBang]}>Đơn vị tính</Text>
            <Text style={[s.o, s.cSl, s.dauBang]}>Số lượng</Text>
            <Text style={[s.o, s.cDonGia, s.dauBang]}>Đơn giá</Text>
            <Text style={[s.oCuoi, s.cThanhTien, s.dauBang]}>Thành tiền</Text>
          </View>
          {data.dong.map((d, i) => (
            <View key={i} style={s.hang}>
              <Text style={[s.o, s.cStt, s.giua]}>{i + 1}</Text>
              <Text style={[s.o, s.cTen]}>{d.ten}</Text>
              <Text style={[s.o, s.cDvi, s.giua]}>{d.donViTinh}</Text>
              <Text style={[s.o, s.cSl, s.giua]}>{d.soLuong}</Text>
              <Text style={[s.o, s.cDonGia, s.phai]}>{donGia(d.donGia)}</Text>
              <Text style={[s.oCuoi, s.cThanhTien, s.phai]}>{vnd(d.thanhTien)}</Text>
            </View>
          ))}
          {Array.from({ length: hangTrong }, (_, i) => (
            <View key={`trong-${i}`} style={s.hang}>
              <Text style={[s.o, s.cStt]}> </Text>
              <Text style={[s.o, s.cTen]}> </Text>
              <Text style={[s.o, s.cDvi]}> </Text>
              <Text style={[s.o, s.cSl]}> </Text>
              <Text style={[s.o, s.cDonGia]}> </Text>
              <Text style={[s.oCuoi, s.cThanhTien]}> </Text>
            </View>
          ))}

          <View style={s.tongHang}>
            <Text style={s.tongNhan}>Cộng tiền hàng</Text>
            <Text style={s.tongGiaTri}>{vnd(tong.thanhTienTruocThue)}</Text>
          </View>
          {/* Tách theo TỪNG mức thuế suất — đúng khối "Tổng hợp" của mẫu MISA. */}
          {tong.theoThueSuat.map((n) => (
            <View key={n.thueSuat} style={s.tongHang}>
              <Text style={s.tongNhan}>Tiền thuế GTGT (thuế suất {n.thueSuat}%)</Text>
              <Text style={s.tongGiaTri}>{vnd(n.tienThue)}</Text>
            </View>
          ))}
          <View style={s.tongHang}>
            <Text style={[s.tongNhan, s.tongDam]}>Tổng cộng tiền thanh toán</Text>
            <Text style={[s.tongGiaTri, s.tongDam]}>{vnd(tong.congTienThanhToan)}</Text>
          </View>
        </View>

        <View style={s.bangChu}>
          <Text>
            Số tiền viết bằng chữ: <Text style={{ fontWeight: "bold" }}>{data.soTienBangChu}</Text>
          </Text>
        </View>

        <View style={s.kyTen}>
          <View style={s.cotKy}>
            <Text style={s.kyNhan}>Người nộp tiền</Text>
            <Text style={s.kyPhu}>(Ký, ghi rõ họ tên)</Text>
            <Text style={s.kyCho}>{nm.hoTen}</Text>
          </View>
          <View style={s.cotKy}>
            <Text style={s.kyNhan}>Người thu tiền</Text>
            <Text style={s.kyPhu}>(Ký, ghi rõ họ tên)</Text>
            <Text style={s.kyCho}>{data.nguoiThu ?? " "}</Text>
          </View>
        </View>

        {/* Chân trang NÓI THẬT về thứ tờ giấy này là. Mẫu thật có Mã CQT + chữ ký số +
            mã tra cứu ở đúng vị trí này; ta không có chúng nên phải nói ra, chứ không
            được để trống cho người đọc tự suy là hoá đơn. */}
        <Text style={s.chan}>
          Phiếu thu này do hệ thống Sata Robo lập để xác nhận đã nhận tiền. Đây KHÔNG phải
          hoá đơn giá trị gia tăng và không thay thế hoá đơn: hoá đơn GTGT do
          {pn.phanMem ? ` ${pn.phanMem}` : " nhà cung cấp hoá đơn điện tử"} phát hành
          riêng, có Mã cơ quan thuế và chữ ký số của pháp nhân.
        </Text>
      </View>
    </Page>
  );
}

/** Phiếu thu MỘT trang — chữ ký giữ nguyên cho route bản chính thức. */
export function PhieuThuPdf({ data }: { data: PhieuThuPdfData }) {
  return (
    <Document>
      <PhieuThuTrang data={data} />
    </Document>
  );
}

/** Nhiều tờ trong MỘT tệp — một lần thu phủ nhiều khoản (vd hai con) ⇒ mỗi khoản một trang. */
export function PhieuThuNhieuTrangPdf({ trang }: { trang: readonly PhieuThuPdfData[] }) {
  return (
    <Document>
      {trang.map((d, i) => (
        <PhieuThuTrang key={i} data={d} />
      ))}
    </Document>
  );
}
