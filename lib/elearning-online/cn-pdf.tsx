import path from "node:path";
import { createElement } from "react";
import { Document, Font, Image, Page, Text, View, renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { TRANG_A4_NGANG, TRUONG_CN, chonCoChu, sha256Hex, type CnSnapshot } from "./cn-mau";

/**
 * E-LEARNING ONLINE — BỘ DỰNG PDF CHỨNG NHẬN (V10.0, Q2). Độc lập: KHÔNG import `lib/pdf/certificate` (Offline) hay `lib/elearning/*` (Nội bộ) — ghim ở `cn-mau.test.ts` [CNM-W1].
 * Chỉ chung tài sản thương hiệu: phông Noto Sans (đăng ký riêng tên "OnlCN").
 * Dựng ĐÚNG từ `CnSnapshot` + byte phôi; phôi phải khớp mã băm đã chụp lúc cấp — sai ⇒ ném lỗi (không bao giờ vẽ nhầm phôi cho chứng nhận cũ).
 */

let daDangKyPhong = false;
function dangKyPhong() {
  if (daDangKyPhong) return;
  Font.register({
    family: "OnlCN",
    fonts: [
      { src: path.join(process.cwd(), "public/fonts/NotoSans-Regular.ttf"), fontWeight: "normal" },
      { src: path.join(process.cwd(), "public/fonts/NotoSans-Bold.ttf"), fontWeight: "bold" },
    ],
  });
  daDangKyPhong = true;
}

/** Bỏ thẻ tập con phông ngẫu nhiên (6 chữ) để KIỂM NỘI DUNG thô (vd. có nhúng ảnh nền). KHÔNG dùng để khẳng định hai bản dựng giống hệt nhau — thứ tự đánh số đối tượng của react-pdf chạy đua, nên byte không ổn định; so ĐẦU VÀO dựng (`CnSnapshot` + mã băm phôi). */
export const chuanHoaDeSoSanh = (b: Uint8Array): string => Buffer.from(b).toString("latin1").replace(/\/[A-Z]{6}\+/g, "/XXXXXX+");

export class PhoiKhongKhop extends Error {
  constructor() {
    super("Phôi không khớp mã băm đã chụp lúc cấp — từ chối dựng chứng nhận");
  }
}

const { w: W, h: H } = TRANG_A4_NGANG;

export type TuyChonPdf = { daThuHoi?: boolean; /** Cố định ngày tạo để cùng đầu vào ⇒ cùng byte. */ ngayTao: Date };

export async function dungPdfChungNhan(snap: CnSnapshot, nen: Uint8Array | null, opt: TuyChonPdf): Promise<Uint8Array> {
  dangKyPhong();
  if (snap.background) {
    if (!nen || sha256Hex(nen) !== snap.background.sha256) throw new PhoiKhongKhop();
  }
  const trang = [
    nen && snap.background ? createElement(Image, { key: "nen", src: { data: Buffer.from(nen), format: snap.background.mime === "image/png" ? "png" : "jpg" }, style: { position: "absolute", left: 0, top: 0, width: W, height: H } }) : null,
    !snap.background ? createElement(KhuonMacDinh, { key: "khuon" }) : null,
    ...TRUONG_CN.map((t) => {
      const k = snap.fields[t];
      const c = chonCoChu(snap.texts[t], k);
      return createElement(
        View,
        { key: t, style: { position: "absolute", left: (k.x / 100) * W, top: (k.y / 100) * H, width: (k.w / 100) * W, height: (k.h / 100) * H, justifyContent: "center" } },
        createElement(Text, { style: { fontFamily: "OnlCN", fontWeight: k.bold ? "bold" : "normal", fontSize: c.sizePt, color: k.color, textAlign: k.align, lineHeight: 1.25 } }, snap.texts[t]),
      );
    }),
    opt.daThuHoi ? createElement(Text, { key: "thu-hoi", style: { position: "absolute", left: 0, top: H * 0.4, width: W, textAlign: "center", fontFamily: "OnlCN", fontWeight: "bold", fontSize: 70, color: "#BF321D", opacity: 0.22, transform: "rotate(-18deg)" } }, "ĐÃ THU HỒI") : null,
  ];
  const doc = createElement(
    Document,
    { title: "Giấy chứng nhận hoàn thành khoá học", creator: "Sata Robo", producer: "Sata Robo", creationDate: opt.ngayTao, modificationDate: opt.ngayTao } as DocumentProps,
    createElement(Page, { size: [W, H], style: { position: "relative" } }, ...trang),
  );
  const buf = await renderToBuffer(doc as React.ReactElement<DocumentProps>);
  return new Uint8Array(buf);
}

/** Khuôn mặc định (chứng nhận cấp trước V10.0 hoặc khoá chưa có phôi): viền kép thương hiệu + tiêu đề — không ảnh nền. */
function KhuonMacDinh() {
  return createElement(
    View,
    { style: { position: "absolute", left: 0, top: 0, width: W, height: H } },
    createElement(View, { style: { position: "absolute", left: 18, top: 18, width: W - 36, height: H - 36, borderWidth: 3, borderColor: "#5B2A86" } }),
    createElement(View, { style: { position: "absolute", left: 26, top: 26, width: W - 52, height: H - 52, borderWidth: 1, borderColor: "#FE8F2D" } }),
    createElement(Text, { style: { position: "absolute", left: 0, top: H * 0.14, width: W, textAlign: "center", fontFamily: "OnlCN", fontWeight: "bold", fontSize: 30, color: "#5B2A86" } }, "GIẤY CHỨNG NHẬN"),
    createElement(Text, { style: { position: "absolute", left: 0, top: H * 0.26, width: W, textAlign: "center", fontFamily: "OnlCN", fontSize: 14, color: "#544B40" } }, "Sata Robo trân trọng chứng nhận"),
  );
}
