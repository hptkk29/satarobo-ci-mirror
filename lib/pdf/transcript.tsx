import React from "react";
import path from "path";
import { Document, Page, Text, View, StyleSheet, Font } from "@react-pdf/renderer";
import type { StudentTranscript } from "@/lib/transcript/service";

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
  page: { padding: 36, fontFamily: "NotoSans", fontSize: 10, color: "#222" },
  brand: { fontSize: 16, fontWeight: "bold", color: "#7C3AED" },
  title: { fontSize: 14, fontWeight: "bold", marginTop: 4 },
  meta: { fontSize: 10, color: "#555", marginTop: 6 },
  section: { fontSize: 12, fontWeight: "bold", marginTop: 16, marginBottom: 6, color: "#F97316" },
  row: { flexDirection: "row", borderBottomWidth: 1, borderColor: "#eee", paddingVertical: 4 },
  hRow: { flexDirection: "row", backgroundColor: "#f5f3ff", paddingVertical: 4 },
  c1: { width: "30%" },
  c2: { width: "22%" },
  c3: { width: "16%", textAlign: "center" },
  c4: { width: "16%", textAlign: "center" },
  c5: { width: "16%", textAlign: "center" },
  bold: { fontWeight: "bold" },
  summaryBox: { flexDirection: "row", marginTop: 8, gap: 16 },
  stat: { fontSize: 10 },
});

export function TranscriptPdf({ t }: { t: StudentTranscript }) {
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <Text style={s.brand}>SATA ROBO</Text>
        <Text style={s.title}>HỌC BẠ HỌC VIÊN</Text>
        <Text style={s.meta}>
          {t.student.name}
          {t.student.studentCode ? ` · Mã: ${t.student.studentCode}` : ""}
          {t.student.currentGrade ? ` · Lớp: ${t.student.currentGrade}` : ""}
          {t.student.school ? ` · Trường: ${t.student.school}` : ""}
        </Text>

        <View style={s.summaryBox}>
          <Text style={s.stat}>Số lớp: {t.summary.totalClasses}</Text>
          <Text style={s.stat}>Khoá hoàn thành: {t.summary.completedCourses}</Text>
          <Text style={s.stat}>Chuyên cần: {t.summary.overallAttendanceRate}%</Text>
          <Text style={s.stat}>Điểm TB: {t.summary.overallAverageScore ?? "—"}</Text>
        </View>

        <Text style={s.section}>Quá trình học theo lớp</Text>
        <View style={s.hRow}>
          <Text style={[s.c1, s.bold]}>Lớp</Text>
          <Text style={[s.c2, s.bold]}>Khoá</Text>
          <Text style={[s.c3, s.bold]}>Chuyên cần</Text>
          <Text style={[s.c4, s.bold]}>Điểm TB</Text>
          <Text style={[s.c5, s.bold]}>Trạng thái</Text>
        </View>
        {t.classes.map((c) => (
          <View style={s.row} key={c.classId}>
            <Text style={s.c1}>{c.className}</Text>
            <Text style={s.c2}>{c.courseName}</Text>
            <Text style={s.c3}>
              {c.totalSessions === 0
                ? "Chưa diễn ra"
                : `${c.attendedSessions}/${c.totalSessions} (${c.attendanceRate}%)`}
            </Text>
            <Text style={s.c4}>{c.averageScore ?? "—"}</Text>
            <Text style={s.c5}>{c.status}</Text>
          </View>
        ))}

        {t.completions.length > 0 ? (
          <>
            <Text style={s.section}>Khoá đã hoàn thành</Text>
            {t.completions.map((c, i) => (
              <View style={s.row} key={i}>
                <Text style={s.c1}>{c.courseName}</Text>
                <Text style={s.c2}>{c.completedAt.toISOString().slice(0, 10)}</Text>
                <Text style={s.c3}>{c.finalGrade ?? "—"}</Text>
                <Text style={[s.c4, { width: "32%" }]}>{c.certificateCode}</Text>
              </View>
            ))}
          </>
        ) : null}

        {t.skills.length > 0 ? (
          <>
            <Text style={s.section}>Đánh giá năng lực</Text>
            {t.skills.map((sk, i) => (
              <View style={s.row} key={i}>
                <Text style={s.c1}>{sk.skill}</Text>
                <Text style={s.c2}>{sk.level}</Text>
                <Text style={s.c3}>{sk.assessedAt.toISOString().slice(0, 10)}</Text>
              </View>
            ))}
          </>
        ) : null}
      </Page>
    </Document>
  );
}
