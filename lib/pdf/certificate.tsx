import React from "react";
import path from "path";
import { Document, Page, Text, View, StyleSheet, Font } from "@react-pdf/renderer";

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
});

export type CertificateData = {
  studentName: string;
  studentCode: string | null;
  courseName: string;
  certificateCode: string;
  completedAt: string;
  finalGrade: string | null;
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
          <View style={s.footer}>
            <Text style={s.small}>Mã chứng chỉ: {d.certificateCode}</Text>
            <Text style={s.small}>Ngày cấp: {d.completedAt}</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}
