// lib/bao-luu/mau-don-docx.ts — điền "Đơn đăng ký bảo lưu khóa học" vào CHÍNH tệp .docx mẫu của công ty.
//
// Không dựng lại văn bản đơn: tệp mẫu (Phụ lục 02) giữ nguyên chữ, phông, lề, logo, bảng chữ ký; hàm này chỉ chèn giá trị
// vào các ô chấm chấm và đổi ☐ → ☒. Mọi chữ pháp lý do công ty sửa trong tệp mẫu.
//
// Ô điền của mẫu có dạng: [chữ nhãn] [chạy chứa ĐÚNG MỘT ký tự tab, tab có đường dẫn chấm]. Giá trị chèn NGAY TRƯỚC tab đó,
// nên đường chấm chấm vẫn chạy tiếp sau giá trị (như người điền tay).
//
// FAIL LOUDLY: nhãn không có, có HAI lần, hoặc sau nhãn không phải chạy-tab thì NÉM — không bao giờ xuất file thiếu một ô
// lặng lẽ. Mẫu bị công ty đổi chữ nhãn ⇒ test đỏ + route trả lỗi rõ, thay vì giấy in ra thiếu thông tin.
import { readFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import {
  MAU_DON,
  NHAN_O_TREN_DON,
  THU_TU_Y_DO,
  TIEU_DE_DANH_SACH_KHOA,
  coDanhSachKhoa,
  type DonBaoLuu,
  type MaMauDon,
} from "@/lib/bao-luu/mau-don";

export class LoiMauDon extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoiMauDon";
  }
}

const THU_MUC_MAU = path.join("lib", "bao-luu", "mau-don");
const RE_T = /<w:t(\s[^>]*)?>([^<]*)<\/w:t>/g;
/** XML 1.0 cấm ký tự điều khiển trừ tab/xuống dòng: một ký tự lạ trong tên phụ huynh làm Word từ chối mở cả file. */
const boKyTuDieuKhien = (s: string) =>
  Array.from(s)
    .filter((c) => {
      const n = c.charCodeAt(0);
      return n >= 32 || n === 9 || n === 10 || n === 13;
    })
    .join("");

const giaiMa = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const maHoa = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Chữ của mọi `<w:t>` theo thứ tự tài liệu, đã giải mã thực thể XML. Dùng cho test đối chiếu bản in. */
export function chuTrongXml(xml: string): string[] {
  return [...xml.matchAll(RE_T)].map((m) => giaiMa(m[2] ?? ""));
}

/** Chữ của thân + đầu trang + chân trang của một tệp .docx (đọc thẳng zip). */
export async function chuTrongDocx(docx: Buffer): Promise<{ than: string[]; dauTrang: string[]; chanTrang: string[] }> {
  const zip = await JSZip.loadAsync(docx);
  const doc = async (ten: string) => {
    const f = zip.file(ten);
    return f ? chuTrongXml(await f.async("string")) : [];
  };
  return { than: await doc("word/document.xml"), dauTrang: await doc("word/header1.xml"), chanTrang: await doc("word/footer1.xml") };
}

/** Một dòng: gọn về một dòng, bỏ ký tự điều khiển (tab/xuống dòng trong giá trị sẽ phá đường chấm). */
const motDong = (s: string) => boKyTuDieuKhien(s).replace(/\s+/g, " ").trim();

type Muc = { batDau: number; ketThuc: number; thuocTinh: string; chu: string; moi: string | null };

type ONhap = { nhan: string; giaTri: (d: DonBaoLuu) => string };

/** Các ô chấm chấm của mẫu: chữ nhãn đúng như trong .docx → giá trị lấy từ đơn. */
export const O_NHAP: readonly ONhap[] = [
  { nhan: "Họ và tên: ", giaTri: (d) => d.phuHuynh.hoTen },
  { nhan: "Quan hệ với học viên: ", giaTri: (d) => d.phuHuynh.quanHe },
  { nhan: "Số điện thoại / Zalo: ", giaTri: (d) => d.phuHuynh.dienThoai },
  { nhan: "Email: ", giaTri: (d) => d.phuHuynh.email },
  { nhan: "Họ và tên học viên: ", giaTri: (d) => d.hocVien.hoTen },
  { nhan: "Ngày sinh: ", giaTri: (d) => d.hocVien.ngaySinh },
  { nhan: "Mã học viên: ", giaTri: (d) => d.hocVien.ma },
  { nhan: "Khóa học: ", giaTri: (d) => d.hocVien.khoa },
  { nhan: "Lớp đang học: ", giaTri: (d) => d.hocVien.lop },
  { nhan: "Giáo viên phụ trách: ", giaTri: (d) => d.hocVien.giaoVien },
  { nhan: "Lý do khác: ", giaTri: (d) => d.lyDoKhac },
  { nhan: "Bảo lưu từ ngày: ", giaTri: (d) => d.thoiGian.baoLuuTu },
  { nhan: "Dự kiến học lại (nếu có): ", giaTri: (d) => d.thoiGian.hocLaiDuKien },
  { nhan: "Học viên đã nghỉ từ ngày (nếu bảo lưu lùi, tối đa 02 buổi): ", giaTri: (d) => d.thoiGian.nghiTuNgay },
];

/** Chữ của ô tích trên mẫu giấy: `☐ <nhãn>`. */
const nhanOTich = (ly: (typeof THU_TU_Y_DO)[number]) => `☐ ${NHAN_O_TREN_DON[ly]}`;

function timDuyNhat(muc: Muc[], mau: string, nhan: string): number {
  const khop: number[] = [];
  muc.forEach((m, i) => {
    if (m.chu.includes(mau)) khop.push(i);
  });
  if (khop.length !== 1) {
    throw new LoiMauDon(`Mẫu đơn ${nhan}: nhãn "${mau.trim()}" ${khop.length === 0 ? "không có" : `xuất hiện ${khop.length} lần (phải đúng 1)`} trong tệp .docx.`);
  }
  return khop[0]!;
}

/**
 * Điền một đơn vào XML thân tài liệu. Hàm thuần (chuỗi vào, chuỗi ra) để test không cần zip.
 * Mọi đoạn KHÔNG được điền giữ nguyên từng byte.
 */
export function dienXmlDon(xml: string, don: DonBaoLuu, nhan: string): string {
  const muc: Muc[] = [...xml.matchAll(RE_T)].map((m) => ({
    batDau: m.index!,
    ketThuc: m.index! + m[0].length,
    thuocTinh: m[1] ?? "",
    chu: giaiMa(m[2] ?? ""),
    moi: null,
  }));

  for (const o of O_NHAP) {
    const i = timDuyNhat(muc, o.nhan, nhan);
    const tab = muc[i + 1];
    // Sau nhãn phải là chạy-tab nằm TRONG CÙNG đoạn văn: nếu không, chèn vào là chèn sai chỗ.
    if (!tab || tab.chu !== "\t" || xml.slice(muc[i]!.ketThuc, tab.batDau).includes("</w:p>")) {
      throw new LoiMauDon(`Mẫu đơn ${nhan}: sau nhãn "${o.nhan.trim()}" không phải ô chấm chấm — mẫu đã đổi cấu trúc.`);
    }
    const v = motDong(o.giaTri(don));
    if (v) tab.moi = `${v}\t`;
  }

  // Ô tích: ☐ → ☒ đúng ô đã chọn. Có chữ ở "Lý do khác" thì ô đó cũng tích (chữ không đứng cạnh ô trống).
  const chon = new Set(don.lyDo);
  if (motDong(don.lyDoKhac)) chon.add("OTHER");
  for (const ly of THU_TU_Y_DO) {
    const nhanO = nhanOTich(ly);
    const i = timDuyNhat(muc, nhanO, nhan);
    if (chon.has(ly)) muc[i]!.moi = (muc[i]!.moi ?? muc[i]!.chu).replace("☐", "☒");
  }

  let ra = "";
  let con = 0;
  for (const m of muc) {
    ra += xml.slice(con, m.batDau);
    if (m.moi === null) {
      ra += xml.slice(m.batDau, m.ketThuc);
    } else {
      const tt = /xml:space=/.test(m.thuocTinh) ? m.thuocTinh : `${m.thuocTinh} xml:space="preserve"`;
      ra += `<w:t${tt}>${maHoa(m.moi)}</w:t>`;
    }
    con = m.ketThuc;
  }
  ra += xml.slice(con);
  const them = coDanhSachKhoa(don) ? chenDanhSachKhoa(ra, don.danhSachKhoa.map(motDong).filter(Boolean), nhan) : ra;
  return giuKhoiKyCungTrang(them, nhan);
}

/**
 * In danh sách khoá ngay dưới mục II (sau đoạn "Lớp đang học … Giáo viên phụ trách", đoạn cuối của mục), khi có ô chỉ ghi
 * "Xem danh sách khoá bên dưới". Đoạn mới mượn phông + cỡ chữ của chính chạy chứa nhãn "Lớp đang học: " nên khớp mẫu;
 * tiêu đề in đậm. Không có điểm neo / chạy chữ ⇒ NÉM (mẫu đổi cấu trúc), không chèn đại vào chỗ khác.
 */
function chenDanhSachKhoa(xml: string, dong: readonly string[], nhan: string): string {
  const moc = xml.indexOf("Lớp đang học: ");
  const dauChay = moc < 0 ? -1 : xml.lastIndexOf("<w:r>", moc);
  const rPr = dauChay < 0 ? undefined : /<w:rPr>[\s\S]*?<\/w:rPr>/.exec(xml.slice(dauChay, moc))?.[0];
  const hetDoan = moc < 0 ? -1 : xml.indexOf("</w:p>", moc);
  if (!rPr || hetDoan < 0) throw new LoiMauDon(`Mẫu đơn ${nhan}: không tìm được chỗ chèn danh sách khoá dưới mục II.`);
  // Khối danh sách in cỡ 9pt (mẫu 12pt; chủ dự án chốt tối thiểu 9pt): mẫu gốc đầy đúng một trang, thêm vài dòng 12pt là tràn.
  const rPrNho = rPr.replace(/<w:sz w:val="\d+"\/>/, '<w:sz w:val="18"/>').replace(/<w:szCs w:val="\d+"\/>/, '<w:szCs w:val="18"/>');
  // Thứ tự phần tử trong <w:rPr> theo lược đồ: rFonts → b/bCs → … → sz/szCs. Đậm phải đứng ngay sau rFonts.
  const rPrDam = rPrNho.replace(/(<w:rFonts[^>]*\/>)/, "$1<w:b/><w:bCs/>");
  const doan = (chu: string, dam: boolean) =>
    `<w:p><w:pPr><w:spacing w:after="0" w:before="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r>${dam ? rPrDam : rPrNho}<w:t xml:space="preserve">${maHoa(chu)}</w:t></w:r></w:p>`;
  const khoi = doan(TIEU_DE_DANH_SACH_KHOA, true) + dong.map((d, k) => doan(`${k + 1}. ${d}`, false)).join("");
  const diem = hetDoan + "</w:p>".length;
  return nenKhoangCach(xml.slice(0, diem) + khoi + xml.slice(diem));
}

/**
 * Mẫu gốc đầy đúng MỘT trang (đo bằng Word: thêm một dòng là sang trang hai). Khi có danh sách khoá thì lấy chỗ bằng cách bỏ các khoảng
 * "trước đoạn" nhỏ (< 10pt: quanh tiêu đề mục I–V và các dòng ô) — CHỈ khi có danh sách. **Chỗ ký GIỮ NGUYÊN 32pt** như mẫu gốc
 * (chủ dự án chốt 14/10/2026: không nén ô ký). Không đủ một trang thì sang trang hai: khối ký giữ liền một trang
 * (`giuKhoiKyCungTrang`) và chân trang có "Trang x/y" (`themSoTrang`).
 */
function nenKhoangCach(xml: string): string {
  return xml.replace(/w:before="(\d+)"/g, (m, v: string) => {
    const n = Number(v);
    return n > 0 && n < 200 ? 'w:before="0"' : m;
  });
}

/**
 * Khối ký trọn MỘT trang: từ mục V ("Cam kết của phụ huynh": lời cam kết) qua dòng ngày tháng, bảng chữ ký (họ tên) đến hết
 * "Phần dành cho Trung tâm" — mọi đoạn trừ đoạn cuối mang `keepNext` + `keepLines`, hàng bảng chữ ký mang `cantSplit`. Word không tách
 * ngang chuỗi này: nếu không vừa trang một thì CẢ khối sang trang hai, không để lời cam kết ở trang này mà chữ ký ở trang kia (tờ ký mà
 * thiếu chữ ký/cam kết cùng trang thì không còn là một văn bản ký). Áp cho MỌI đơn (không chỉ đơn có danh sách): tràn trang còn có thể do
 * giá trị gõ tay dài ở ô khác. Đơn vừa một trang thì thuộc tính này không đổi gì khi in.
 */
function giuKhoiKyCungTrang(xml: string, nhan: string): string {
  const moc = xml.indexOf("V. CAM KẾT CỦA PHỤ HUYNH");
  const dau = moc < 0 ? -1 : xml.lastIndexOf("<w:p>", moc);
  const cuoiThan = xml.lastIndexOf("</w:p>");
  const dauDoanCuoi = cuoiThan < 0 ? -1 : xml.lastIndexOf("<w:p>", cuoiThan);
  if (dau < 0 || dauDoanCuoi <= dau) throw new LoiMauDon(`Mẫu đơn ${nhan}: không tìm được khối ký (mục V) để giữ liền một trang.`);
  const giua = xml
    .slice(dau, dauDoanCuoi)
    .replace(/<w:p><w:pPr>/g, "<w:p><w:pPr><w:keepNext/><w:keepLines/>")
    .replace(/<w:tr>/g, "<w:tr><w:trPr><w:cantSplit/></w:trPr>");
  const cuoi = xml.slice(dauDoanCuoi).replace("<w:p><w:pPr>", "<w:p><w:pPr><w:keepLines/>");
  return xml.slice(0, dau) + giua + cuoi;
}

/**
 * Chân trang: thêm "Trang x/y" sát lề phải CÙNG dòng với "Mã tài liệu…" (không thêm dòng ⇒ không đổi chỗ của thân; đo bằng Word).
 * Trường PAGE/NUMPAGES do Word tự cập nhật khi mở/in. Chân trang đổi cấu trúc ⇒ NÉM.
 */
export function themSoTrang(xml: string, nhan: string): string {
  const m = /<w:p><w:pPr><w:pStyle w:val="Footer"\/><\/w:pPr>(<w:r>(<w:rPr>[\s\S]*?<\/w:rPr>)[\s\S]*?<\/w:r>)<\/w:p>/.exec(xml);
  if (!m) throw new LoiMauDon(`Mẫu đơn ${nhan}: chân trang đổi cấu trúc nên chưa thêm được "Trang x/y".`);
  const [dongCu, chayCu, rPr] = [m[0], m[1]!, m[2]!];
  const chu = (t: string) => `<w:r>${rPr}<w:t xml:space="preserve">${t}</w:t></w:r>`;
  // Trường dạng đầy đủ (begin/instr/separate/kết quả/end), MỖI chạy mang rPr: `fldSimple` làm Word cập nhật số trang bằng cỡ chữ mặc định (12pt)
  // thay vì 10pt của chân trang (đo trên PDF Word 14/10/2026).
  const truong = (lenh: string) =>
    `<w:r>${rPr}<w:fldChar w:fldCharType="begin"/></w:r><w:r>${rPr}<w:instrText xml:space="preserve"> ${lenh} </w:instrText></w:r>` +
    `<w:r>${rPr}<w:fldChar w:fldCharType="separate"/></w:r><w:r>${rPr}<w:t>1</w:t></w:r><w:r>${rPr}<w:fldChar w:fldCharType="end"/></w:r>`;
  const moi =
    `<w:p><w:pPr><w:pStyle w:val="Footer"/><w:tabs><w:tab w:val="right" w:pos="9354"/></w:tabs></w:pPr>${chayCu}` +
    `<w:r>${rPr}<w:tab/></w:r>${chu("Trang ")}${truong("PAGE")}${chu("/")}${truong("NUMPAGES")}</w:p>`;
  return xml.replace(dongCu, moi);
}

/** Điền đơn vào tệp .docx mẫu (buffer) → buffer .docx mới. */
export async function dienDonDocx(mau: Buffer, don: DonBaoLuu, nhan: string): Promise<Buffer> {
  const zip = await JSZip.loadAsync(mau);
  const f = zip.file("word/document.xml");
  if (!f) throw new LoiMauDon(`Mẫu đơn ${nhan}: tệp .docx không có word/document.xml.`);
  zip.file("word/document.xml", dienXmlDon(await f.async("string"), don, nhan));
  const ch = zip.file("word/footer1.xml");
  if (!ch) throw new LoiMauDon(`Mẫu đơn ${nhan}: tệp .docx không có word/footer1.xml.`);
  zip.file("word/footer1.xml", themSoTrang(await ch.async("string"), nhan));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

/** Đọc tệp mẫu của một cơ sở từ `lib/bao-luu/mau-don/`. Tệp phải được `outputFileTracingIncludes` mang vào image (next.config.ts). */
export async function taiMauDocx(ma: MaMauDon): Promise<Buffer> {
  return readFile(path.join(process.cwd(), THU_MUC_MAU, MAU_DON[ma].tep));
}
