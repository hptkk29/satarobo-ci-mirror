// lib/finance/hoa-don/doi-chieu-xml.ts — đọc XML hoá đơn điện tử (chuẩn TT 78/2021) và ĐỐI CHIẾU với số liệu kế toán
// nhập tay. THUẦN (client + server dùng chung — client báo sớm, server chặn thật).
//
// Vì sao (PR3): kế toán tải PDF + XML do phần mềm phát hành xuất ra, rồi GÕ TAY số / ký hiệu / ngày. Gõ lệch một chữ
// số là hoá đơn lưu trong hệ thống mang số khác tờ thật. XML mang đúng các số ấy ⇒ đối chiếu trước khi lưu.
//
// Luật:
//   · Chỉ so thứ XML CÓ. Thiếu thẻ ⇒ bỏ qua trường đó (không đoán). Không đọc được thẻ nào ⇒ "KHONG_DOC_DUOC"
//     (cảnh báo, không chặn): phần mềm khác có thể xuất cấu trúc lạ — không để chuyện đó chặn cả quy trình.
//   · Ký hiệu trên tờ = KHMSHDon + KHHDon (vd "1" + "C26MAI" = "1C26MAI"). XML thiếu KHMSHDon thì so phần đuôi.
//   · Số: bỏ số 0 đứng đầu (MISA in 00000127). Ngày: yyyy-mm-dd. Tiền: làm tròn đồng.
//   · Đọc bằng quét thẻ, KHÔNG dựng cây DOM / không nạp thực thể ngoài: XML do người dùng đưa lên, không tin.

export type XmlHoaDon = {
  kyHieu: string | null;
  soHoaDon: string | null;
  /** yyyy-mm-dd */
  ngayLap: string | null;
  mstNguoiBan: string | null;
  tongThanhToan: number | null;
};

const TRAN_KY_TU = 3_000_000;

function thanXml(text: string): string {
  // Bỏ khối CDATA / chú thích / DOCTYPE trước khi quét thẻ — chặn thẻ giả nằm trong chú thích.
  return text
    .slice(0, TRAN_KY_TU)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!DOCTYPE[\s\S]*?>/gi, "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, x: string) => x.replace(/[<>&]/g, ""));
}

function giaTri(xml: string, tag: string): string | null {
  const m = new RegExp(`<(?:[\\w.-]+:)?${tag}(?:\\s[^>]*)?>\\s*([^<]*?)\\s*</(?:[\\w.-]+:)?${tag}>`).exec(xml);
  const v = m?.[1]?.trim();
  return v ? v : null;
}

function khoi(xml: string, tag: string): string | null {
  const m = new RegExp(`<(?:[\\w.-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${tag}>`).exec(xml);
  return m ? m[1]! : null;
}

function ngayChuan(v: string | null): string | null {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function tienChuan(v: string | null): number | null {
  if (!v) return null;
  const n = Number(v.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** `null` = không thấy dấu hiệu hoá đơn nào (không phải XML hoá đơn, hoặc cấu trúc lạ). */
export function docXmlHoaDon(text: string): XmlHoaDon | null {
  const xml = thanXml(text);
  const mau = giaTri(xml, "KHMSHDon");
  const kh = giaTri(xml, "KHHDon");
  const so = giaTri(xml, "SHDon");
  const nguoiBan = khoi(xml, "NBan");
  const r: XmlHoaDon = {
    kyHieu: kh ? `${mau ?? ""}${kh}`.toUpperCase() : null,
    soHoaDon: so && /^\d+$/.test(so) ? so.replace(/^0+/, "") || "0" : null,
    ngayLap: ngayChuan(giaTri(xml, "NLap")),
    mstNguoiBan: nguoiBan ? (giaTri(nguoiBan, "MST") ?? null)?.replace(/[\s-]/g, "") ?? null : null,
    tongThanhToan: tienChuan(giaTri(xml, "TgTTTBSo")),
  };
  return Object.values(r).every((x) => x === null) ? null : r;
}

export type SoLieuNhap = {
  kyHieu: string | null;
  soHoaDon: string | null;
  /** yyyy-mm-dd */
  ngayPhatHanh: string | null;
  /** MST pháp nhân dự kiến phát hành (chưa có ⇒ null ⇒ bỏ qua) */
  mstNguoiBan: string | null;
  /** số tiền lần thu (đồng) */
  tongTien: number | null;
};

export type KetQuaDoiChieu =
  | { loai: "KHONG_DOC_DUOC" }
  | { loai: "KHOP"; daSo: string[] }
  | { loai: "LECH"; lech: string[]; daSo: string[] };

const so = (s: string | null) => (s ?? "").replace(/^0+/, "") || (s ? "0" : "");
const dong = (n: number) => `${n.toLocaleString("vi-VN")}đ`;

/** Đối chiếu XML với số liệu nhập. Chỉ so trường CẢ HAI bên đều có. */
export function doiChieuXml(xmlText: string, nhap: SoLieuNhap): KetQuaDoiChieu {
  const x = docXmlHoaDon(xmlText);
  if (!x) return { loai: "KHONG_DOC_DUOC" };
  const lech: string[] = [];
  const daSo: string[] = [];

  if (x.soHoaDon != null && nhap.soHoaDon) {
    daSo.push("số hoá đơn");
    if (so(x.soHoaDon) !== so(nhap.soHoaDon)) lech.push(`Số hoá đơn: XML ghi ${x.soHoaDon}, đang nhập ${so(nhap.soHoaDon)}`);
  }
  if (x.kyHieu && nhap.kyHieu) {
    daSo.push("ký hiệu");
    const a = x.kyHieu;
    const b = nhap.kyHieu.trim().toUpperCase();
    // XML thiếu KHMSHDon (chỉ có "C26MAI") ⇒ so phần đuôi.
    if (a !== b && !b.endsWith(a)) lech.push(`Ký hiệu: XML ghi ${a}, đang nhập ${b}`);
  }
  if (x.ngayLap && nhap.ngayPhatHanh) {
    daSo.push("ngày lập");
    if (x.ngayLap !== nhap.ngayPhatHanh) lech.push(`Ngày phát hành: XML ghi ${x.ngayLap}, đang nhập ${nhap.ngayPhatHanh}`);
  }
  if (x.mstNguoiBan && nhap.mstNguoiBan) {
    daSo.push("MST người bán");
    if (x.mstNguoiBan !== nhap.mstNguoiBan.replace(/[\s-]/g, "")) {
      lech.push(`Pháp nhân bán: XML ghi MST ${x.mstNguoiBan}, hệ thống dự kiến MST ${nhap.mstNguoiBan} (kiểm cấu hình ký hiệu của cơ sở)`);
    }
  }
  if (x.tongThanhToan != null && nhap.tongTien != null) {
    daSo.push("số tiền");
    if (x.tongThanhToan !== nhap.tongTien) lech.push(`Số tiền: XML ghi ${dong(x.tongThanhToan)}, lần thu là ${dong(nhap.tongTien)}`);
  }

  if (daSo.length === 0) return { loai: "KHONG_DOC_DUOC" };
  return lech.length > 0 ? { loai: "LECH", lech, daSo } : { loai: "KHOP", daSo };
}
