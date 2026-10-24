import React from "react";
import path from "path";
import { Document, Page, Text, View, Image, StyleSheet, Font } from "@react-pdf/renderer";

const FONT_REGULAR = path.join(process.cwd(), "public/fonts/NotoSans-Regular.ttf");
const FONT_BOLD = path.join(process.cwd(), "public/fonts/NotoSans-Bold.ttf");
Font.register({
  family: "NotoSans",
  fonts: [
    { src: FONT_REGULAR, fontWeight: "normal" },
    { src: FONT_BOLD, fontWeight: "bold" },
  ],
});

const s = StyleSheet.create({
  page: { padding: 50, fontFamily: "NotoSans", fontSize: 12, color: "#222" },
  border: { borderWidth: 3, borderColor: "#F97316", borderRadius: 8, padding: 36, height: "100%", justifyContent: "center" },
  brand: { fontSize: 22, fontWeight: "bold", color: "#7C3AED", textAlign: "center" },
  title: { fontSize: 28, fontWeight: "bold", textAlign: "center", marginTop: 18, color: "#111" },
  sub: { fontSize: 12, textAlign: "center", marginTop: 6, color: "#666" },
  name: { fontSize: 26, fontWeight: "bold", textAlign: "center", marginTop: 24, color: "#F97316" },
  line: { fontSize: 13, textAlign: "center", marginTop: 10 },
  footer: { flexDirection: "row", justifyContent: "space-between", marginTop: 48 },
  small: { fontSize: 10, color: "#888" },
  qrBox: { alignItems: "center" },
  qr: { width: 72, height: 72 },
  qrText: { fontSize: 7, color: "#888", marginTop: 3 },
});

export type CertificateData = {
  studentName: string;
  studentCode: string | null;
  courseName: string;
  certificateCode: string;
  completedAt: string;
  finalGrade: string | null;

  // ── EL-16: đào tạo NỘI BỘ. Tất cả TUỲ CHỌN, nên bản chứng nhận học viên (đường
  // `app/api/admin/reports/certificate`) không đổi một pixel nào.
  //
  // Vì sao thêm vào đây chứ không tách khuôn thứ hai: hai bản in cùng là "chứng nhận
  // hoàn thành khoá" của cùng một công ty. Tách ra là để chúng trôi khỏi nhau — vài
  // tháng sau đổi logo ở một bên, và không ai biết còn bên kia.

  /** Ảnh QR dạng data URL (PNG base64) — trỏ tới trang xác minh công khai. */
  qrDataUrl?: string | null;
  /** Địa chỉ trang xác minh, in bằng chữ NGAY DƯỚI mã QR. */
  verifyUrl?: string | null;
  /** Câu hạn hiệu lực, đã dựng sẵn ở server. */
  validityLine?: string | null;
};

export function CertificatePdf({ d }: { d: CertificateData }) {
  return (
    <Document>
      <Page size="A4" orientation="landscape" style={s.page}>
        <View style={s.border}>
          <Text style={s.brand}>SATA ROBO</Text>
          <Text style={s.title}>CHỨNG NHẬN HOÀN THÀNH KHOÁ HỌC</Text>
          <Text style={s.sub}>Chứng nhận học viên đã hoàn thành chương trình</Text>
          <Text style={s.name}>{d.studentName}</Text>
          {d.studentCode ? <Text style={s.sub}>Mã học viên: {d.studentCode}</Text> : null}
          <Text style={s.line}>đã hoàn thành khoá học</Text>
          <Text style={[s.line, { fontWeight: "bold", fontSize: 16 }]}>{d.courseName}</Text>
          {d.finalGrade ? <Text style={s.line}>Xếp loại: {d.finalGrade}</Text> : null}
          {d.validityLine ? <Text style={s.line}>{d.validityLine}</Text> : null}
          <View style={s.footer}>
            <Text style={s.small}>Mã chứng chỉ: {d.certificateCode}</Text>
            {d.qrDataUrl ? (
              <View style={s.qrBox}>
                <Image src={d.qrDataUrl} style={s.qr} />
                {/*
                  ⚠️ In địa chỉ bằng CHỮ ngay dưới mã QR, không chỉ để mỗi QR.
                  Bản chứng nhận này còn giá trị nhiều năm; máy quét hỏng, ảnh in mờ,
                  hoặc người cầm tờ giấy đơn giản là không muốn quét — họ vẫn phải gõ
                  tay vào trình duyệt được. Một mã QR không kèm chữ là một chứng từ
                  chỉ đọc được bằng máy.
                */}
                {d.verifyUrl ? <Text style={s.qrText}>{d.verifyUrl}</Text> : null}
              </View>
            ) : null}
            <Text style={s.small}>Ngày cấp: {d.completedAt}</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}
