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
import fs from "fs";
import path from "path";
import { Document, Page, Text, View, StyleSheet, Font, Image } from "@react-pdf/renderer";
import { formatVndPlain } from "@/lib/format/money";
import type { DongHoaDon, TongHoaDon } from "@/lib/finance/hoa-don/tinh-hoa-don";
import type { NguoiMuaHoaDon } from "@/lib/finance/hoa-don/nguoi-mua";
import type { PhapNhan } from "@/lib/finance/hoa-don/phap-nhan";
import { dongHocVienNoiBo, type HocVienNoiBo } from "@/lib/finance/hoa-don/khoi-hoc-vien-noi-bo";

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
  /**
   * Thông tin HỌC VIÊN khai ở khối «Người mua trên hoá đơn» [01/11/2026] — CHỈ để kế toán nhập MISA, nên chỉ in trên
   * BẢN CHỜ (`maPhieu === null`). Tờ chính thức đưa tận tay phụ huynh KHÔNG bao giờ in khối này, dù có truyền vào:
   * điều kiện nằm ở chỗ vẽ chứ không chỉ ở nơi dựng dữ liệu. Tên học viên vốn đã nằm trong dòng nội dung thu ("HV …").
   */
  hocVien?: HocVienNoiBo | null;
  /** Phiếu đã bị vô hiệu (Receipt VOID) ⇒ dấu nền «ĐÃ HUỶ». Không truyền = còn hiệu lực. */
  daHuy?: boolean;
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
  // 12/11/2026 (chủ dự án): phiếu thu chỉ ghi «Chuyển khoản», KHÔNG ghi tên cổng/đối tác đối soát (SePay, payOS) — phụ huynh không cần biết.
  sepay: "Chuyển khoản",
  payos: "Chuyển khoản",
  // 29/09/2026 — khoản thu từ file giao dịch thẻ SmartPOS (`Payment.method = "card_pos"`).
  card_pos: "Quẹt thẻ (POS)",
};

/** Nhãn hiển thị: nhãn tra từ DB thắng, rồi bảng dự phòng, cuối cùng mới tới chính mã. */
export function nhanHinhThuc(raw: string): string {
  const t = raw.trim();
  return NHAN_PHUONG_THUC[t] ?? t;
}

const vnd = (n: number) => formatVndPlain(n);
/**
 * Đơn giá in SỐ NGUYÊN đồng [12/11/2026, brief phiếu thu 3 pháp nhân]. Bản cũ in kiểu MISA có phần lẻ ("925.925,93") khiến phụ huynh
 * tưởng hệ thống tính sai trên một tờ giấy chỉ xác nhận đã nhận tiền. Tổng thu là số gốc (phụ huynh chuyển đúng), còn
 * `tienThue = tổng − cộng tiền hàng` nên làm tròn ở cột đơn giá KHÔNG làm lệch tổng.
 */
const donGia = (n: number) => formatVndPlain(Math.round(n));

// Màu thương hiệu (brief phiếu thu 12/11/2026): tím #4E237F · cam #FE8F2D · cam đậm #C2570C · nền kem/tím nhạt.
const TIM = "#4E237F";
const CAM = "#FE8F2D";
const CAM_DAM = "#C2570C";
const MUC = "#1F1530";
const PHU = "#544765";
const KEM = "#FFF6EE";
const KEM2 = "#FFF1E4";
const TIM_NHAT = "#F6F1FB";

/**
 * Logo thương hiệu (ảnh thật, cùng tệp các phiếu khác dùng). Đọc một lần rồi giữ trong bộ nhớ.
 * Không đưa tên "pháp nhân mẹ"/"cơ sở" lên đầu phiếu (chủ dự án 12/11/2026): pháp nhân đã nằm ở dòng tên + MST ngay bên cạnh.
 */
const LOGO_RONG = 76;
const LOGO_CAO = Math.round((LOGO_RONG * 380) / 644);
let logoCache: { data: Buffer; format: "png" } | null = null;
function logoPhieu(): { data: Buffer; format: "png" } {
  if (!logoCache) {
    logoCache = { data: fs.readFileSync(path.join(process.cwd(), "public/brand/logo-satarobo.png")), format: "png" };
  }
  return logoCache;
}

const s = StyleSheet.create({
  page: { paddingTop: 20, paddingBottom: 12, paddingHorizontal: 26, fontFamily: "NotoSans", fontSize: 8, color: MUC, backgroundColor: "#FFFFFF" },
  dai: { position: "absolute", top: 0, left: 0, right: 0, height: 7, backgroundColor: CAM },

  dauTrang: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  logo: { width: LOGO_RONG, height: LOGO_CAO },
  donVi: { flex: 1 },
  tenDonVi: { fontSize: 9.5, fontWeight: "bold", color: TIM, lineHeight: 1.25 },
  meta: { fontSize: 7, color: PHU, marginTop: 2, lineHeight: 1.35 },

  tieuDe: { marginTop: 6, alignItems: "center" },
  tieuDeChu: { fontSize: 15, fontWeight: "bold", color: TIM, letterSpacing: 1 },
  gach: { marginTop: 2, width: 54, height: 2.5, backgroundColor: CAM },
  phuDe: { marginTop: 3, fontSize: 7.5, color: CAM_DAM, textAlign: "center" },
  dongSo: { marginTop: 3, fontSize: 8, color: PHU, textAlign: "center" },

  khoiKhai: { marginTop: 5, padding: 5, borderRadius: 5, backgroundColor: KEM },
  dongKhai: { flexDirection: "row", marginTop: 1.8 },
  nhan: { width: "34%", color: PHU },
  giaTri: { width: "66%", fontWeight: "bold" },

  bang: { marginTop: 5, borderWidth: 0.6, borderColor: "#D9CCE8", borderRadius: 3 },
  hang: { flexDirection: "row", borderBottomWidth: 0.6, borderBottomColor: "#E7DEF1" },
  hangDau: { flexDirection: "row", backgroundColor: TIM },
  o: { paddingVertical: 2.2, paddingHorizontal: 3, fontSize: 7.5 },
  oDau: { paddingVertical: 3, paddingHorizontal: 3, color: "#FFFFFF", fontWeight: "bold", textAlign: "center", fontSize: 7.5 },
  cStt: { width: "8%" },
  cTen: { width: "36%" },
  cDvi: { width: "11%" },
  cSl: { width: "9%" },
  cDonGia: { width: "17%" },
  cThanhTien: { width: "19%" },
  phai: { textAlign: "right" },
  giua: { textAlign: "center" },
  tongHang: { flexDirection: "row", borderBottomWidth: 0.6, borderBottomColor: "#E7DEF1" },
  tongNhan: { width: "81%", paddingVertical: 2, paddingHorizontal: 4, textAlign: "right", color: PHU },
  tongGiaTri: { width: "19%", paddingVertical: 2, paddingHorizontal: 3, textAlign: "right", fontWeight: "bold" },
  tongCong: { flexDirection: "row", backgroundColor: KEM2 },
  tongCongNhan: { width: "81%", paddingVertical: 4, paddingHorizontal: 4, textAlign: "right", fontWeight: "bold", color: CAM_DAM },
  tongCongGiaTri: { width: "19%", paddingVertical: 4, paddingHorizontal: 3, textAlign: "right", fontWeight: "bold", fontSize: 9, color: CAM_DAM },

  bangChu: { marginTop: 4, padding: 4, borderRadius: 4, backgroundColor: TIM_NHAT },

  kyTen: { flexDirection: "row", marginTop: 5, justifyContent: "space-between" },
  cotKy: { width: "47%", alignItems: "center" },
  kyNhan: { fontWeight: "bold", fontSize: 8 },
  kyPhu: { fontSize: 6.5, color: PHU, marginTop: 1 },
  kyCho: { marginTop: 18, fontSize: 8, fontWeight: "bold" },

  chan: { marginTop: 5, paddingTop: 4, borderTopWidth: 0.6, borderTopColor: "#E7DEF1", fontSize: 6.3, color: PHU, lineHeight: 1.4 },
  chanHeThong: { marginTop: 3, flexDirection: "row", justifyContent: "space-between", fontSize: 6.3, color: PHU },

  // Dấu nền theo trạng thái — xoay chéo, mờ, KHÔNG che số liệu.
  dauNen: { position: "absolute", top: 250, left: 0, right: 0, textAlign: "center", fontSize: 32, fontWeight: "bold", opacity: 0.13, transform: "rotate(-28deg)" },
});

function Khai({ nhan, giaTri }: { nhan: string; giaTri: string }) {
  return (
    <View style={s.dongKhai} wrap={false}>
      <Text style={s.nhan}>{nhan}</Text>
      <Text style={s.giaTri}>{giaTri}</Text>
    </View>
  );
}

/**
 * Dấu nền theo trạng thái phiếu [brief 12/11/2026]: chưa có số (kế toán chưa xác nhận) = «CHỜ XÁC NHẬN»; đã có số = «ĐÃ THU»;
 * phiếu bị vô hiệu = «ĐÃ HUỶ». Chọn ở MỘT hàm để các nơi vẽ không tự suy.
 */
export function dauNenPhieu(d: Pick<PhieuThuPdfData, "maPhieu" | "daHuy">): { chu: string; mau: string } {
  if (d.daHuy) return { chu: "ĐÃ HUỶ", mau: "#B42318" };
  if (d.maPhieu == null) return { chu: "CHỜ XÁC NHẬN", mau: "#B42318" };
  return { chu: "ĐÃ THU", mau: "#1D7A46" };
}

/** MỘT tờ phiếu thu A5 (một `<Page>`). Bản chính thức và bản chờ dùng CHUNG bố cục này. */
export function PhieuThuTrang({ data }: { data: PhieuThuPdfData }) {
  const { phapNhan: pn, nguoiMua: nm, tong } = data;
  const banCho = data.maPhieu == null;
  const dauNen = dauNenPhieu(data);
  // Đủ hàng trống để bảng không quá lép khi chỉ có 1 dòng, nhưng KHÔNG tràn sang trang 2 khi có tới 5 dòng.
  const hangTrong = Math.max(0, 1 - data.dong.length);

  return (
    <Page size="A5" style={s.page}>
      <View style={s.dai} fixed />
      <Text style={[s.dauNen, { color: dauNen.mau }]}>{dauNen.chu}</Text>

      {/* ── Đầu phiếu: logo + pháp nhân ĐÃ THU TIỀN (theo cơ sở thu, không phải cơ sở của lớp) ── */}
      <View style={s.dauTrang}>
        <Image src={logoPhieu()} style={s.logo} />
        <View style={s.donVi}>
          <Text style={s.tenDonVi}>{pn.ten}</Text>
          <Text style={s.meta}>
            MST {pn.maSoThue} · {pn.diaChi}
          </Text>
          <Text style={s.meta}>
            {[pn.dienThoai ? `Hotline ${pn.dienThoai}` : null, pn.email ?? null, "satarobo.vn"].filter(Boolean).join(" · ")}
          </Text>
        </View>
      </View>

      <View style={s.tieuDe}>
        <Text style={s.tieuDeChu}>PHIẾU THU</Text>
        <View style={s.gach} />
        {/* Dòng này KHÔNG được bỏ — xem chú thích đầu tệp. */}
        <Text style={s.phuDe}>Phiếu thu nội bộ — KHÔNG phải hoá đơn giá trị gia tăng</Text>
        <Text style={s.dongSo}>
          Số phiếu {data.maPhieu ?? "(cấp khi kế toán xác nhận)"} · {banCho ? "Ngày thu" : "Ngày lập"} {data.ngayLap}
          {data.maDon ? ` · Đơn hàng ${data.maDon}` : ""}
        </Text>
      </View>

      {/* ── Người nộp tiền. KHÔNG in CCCD/Hộ chiếu ở bất kỳ bản nào [brief 12/11/2026]. ── */}
      <View style={s.khoiKhai}>
        <Khai nhan="Họ tên người nộp tiền" giaTri={nm.hoTen} />
        {nm.tenDonVi ? <Khai nhan="Tên đơn vị" giaTri={nm.tenDonVi} /> : null}
        {nm.maSoThue ? <Khai nhan="Mã số thuế" giaTri={nm.maSoThue} /> : null}
        <Khai nhan="Địa chỉ" giaTri={nm.diaChi || "—"} />
        {dongHocVienNoiBo(data).map((d) => (
          <Khai key={d.nhan} nhan={d.nhan} giaTri={d.giaTri} />
        ))}
        <Khai nhan="Hình thức thanh toán" giaTri={nhanHinhThuc(data.hinhThucThanhToan)} />
      </View>

      {/* ── Bảng nội dung thu ── */}
      <View style={s.bang}>
        <View style={s.hangDau}>
          <Text style={[s.oDau, s.cStt]}>STT</Text>
          <Text style={[s.oDau, s.cTen]}>Nội dung thu</Text>
          <Text style={[s.oDau, s.cDvi]}>ĐVT</Text>
          <Text style={[s.oDau, s.cSl]}>SL</Text>
          <Text style={[s.oDau, s.cDonGia]}>Đơn giá</Text>
          <Text style={[s.oDau, s.cThanhTien]}>Thành tiền</Text>
        </View>
        {data.dong.map((d, i) => (
          <View key={i} style={s.hang} wrap={false}>
            <Text style={[s.o, s.cStt, s.giua]}>{i + 1}</Text>
            <Text style={[s.o, s.cTen]}>{d.ten}</Text>
            <Text style={[s.o, s.cDvi, s.giua]}>{d.donViTinh}</Text>
            <Text style={[s.o, s.cSl, s.giua]}>{d.soLuong}</Text>
            <Text style={[s.o, s.cDonGia, s.phai]}>{donGia(d.donGia)}</Text>
            <Text style={[s.o, s.cThanhTien, s.phai]}>{vnd(d.thanhTien)}</Text>
          </View>
        ))}
        {Array.from({ length: hangTrong }, (_, i) => (
          <View key={`trong-${i}`} style={s.hang}>
            <Text style={[s.o, s.cStt]}> </Text>
            <Text style={[s.o, s.cTen]}> </Text>
            <Text style={[s.o, s.cDvi]}> </Text>
            <Text style={[s.o, s.cSl]}> </Text>
            <Text style={[s.o, s.cDonGia]}> </Text>
            <Text style={[s.o, s.cThanhTien]}> </Text>
          </View>
        ))}
        <View style={s.tongHang}>
          <Text style={s.tongNhan}>Cộng tiền hàng</Text>
          <Text style={s.tongGiaTri}>{vnd(tong.thanhTienTruocThue)} đ</Text>
        </View>
        {/* Tách theo TỪNG mức thuế suất; tiền thuế là SỐ NỘI SUY NGƯỢC từ tổng thu (không nhân thuế rồi cộng lên). */}
        {tong.theoThueSuat.map((n) => (
          <View key={n.thueSuat} style={s.tongHang}>
            <Text style={s.tongNhan}>Tiền thuế GTGT (thuế suất {n.thueSuat}%)</Text>
            <Text style={s.tongGiaTri}>{vnd(n.tienThue)} đ</Text>
          </View>
        ))}
        <View style={s.tongCong}>
          <Text style={s.tongCongNhan}>TỔNG CỘNG TIỀN THANH TOÁN</Text>
          <Text style={s.tongCongGiaTri}>{vnd(tong.congTienThanhToan)} đ</Text>
        </View>
      </View>

      <View style={s.bangChu} wrap={false}>
        <Text>
          Số tiền bằng chữ: <Text style={{ fontWeight: "bold" }}>{data.soTienBangChu}</Text>
        </Text>
      </View>

      {/* ── Chữ ký — ĐÚNG HAI ô (không có «Người lập phiếu») ── */}
      <View style={s.kyTen} wrap={false}>
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

      {/* Chân trang NÓI THẬT về thứ tờ giấy này là, và nêu ĐÚNG tên pháp nhân đã thu tiền. */}
      <View wrap={false}>
        <Text style={s.chan}>
          Phiếu thu do {pn.ten} lập để xác nhận đã nhận tiền. Đây KHÔNG phải hoá đơn giá trị gia tăng và không thay thế hoá
          đơn.
        </Text>
        <View style={s.chanHeThong}>
          <Text>Mã phiếu {data.maPhieu ?? "—"}</Text>
          <Text>{pn.dienThoai ? `Hỗ trợ ${pn.dienThoai}` : "satarobo.vn"}</Text>
        </View>
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
