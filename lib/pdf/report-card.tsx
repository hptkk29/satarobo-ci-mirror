import React from "react";
import path from "path";
import { Document, Page, Text, View, StyleSheet, Font } from "@react-pdf/renderer";
import { reportCardPeriodDisplay, type PublishedReportCardView } from "@/lib/lms/report-card";
import { SKILL_LABEL, LEVEL_LABEL as SKILL_LEVEL_LABEL } from "@/lib/lms/skills";
import type { RoboticsSkill, SkillLevel } from "@prisma/client";

const FONT_REGULAR = path.join(process.cwd(), "public/fonts/NotoSans-Regular.ttf");
const FONT_BOLD = path.join(process.cwd(), "public/fonts/NotoSans-Bold.ttf");
Font.register({
  family: "NotoSans",
  fonts: [
    { src: FONT_REGULAR, fontWeight: "normal" },
    { src: FONT_BOLD, fontWeight: "bold" },
  ],
});

const LEVEL_LABEL: Record<number, string> = { 1: "Cần cố gắng", 2: "Đạt", 3: "Khá", 4: "Tốt" };

const s = StyleSheet.create({
  page: { padding: 36, fontFamily: "NotoSans", fontSize: 10, color: "#222" },
  brand: { fontSize: 16, fontWeight: "bold", color: "#7C3AED" },
  title: { fontSize: 14, fontWeight: "bold", marginTop: 4 },
  meta: { fontSize: 10, color: "#555", marginTop: 6 },
  section: { fontSize: 12, fontWeight: "bold", marginTop: 16, marginBottom: 6, color: "#F97316" },
  row: { flexDirection: "row", borderBottomWidth: 1, borderColor: "#eee", paddingVertical: 4 },
  hRow: { flexDirection: "row", backgroundColor: "#f5f3ff", paddingVertical: 4 },
  cL: { width: "55%" },
  cR: { width: "45%" },
  summaryBox: { flexDirection: "row", marginTop: 8, gap: 16, flexWrap: "wrap" },
  stat: { fontSize: 10 },
  bold: { fontWeight: "bold" },
  para: { marginTop: 4, lineHeight: 1.4 },
});

export function ReportCardPdf({ card }: { card: PublishedReportCardView }) {
  const att = card.metrics.attendance;
  const assignments = card.metrics.assignments;
  const skills = card.metrics.skills;
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <Text style={s.brand}>SATA ROBO</Text>
        <Text style={s.title}>HỌC BẠ HỌC VIÊN</Text>
        <Text style={s.meta}>
          {card.student.name}
          {card.student.studentCode ? ` · Mã: ${card.student.studentCode}` : ""}
          {` · ${card.course.name} · ${card.className}`}
          {card.publishedAt ? ` · Phát hành: ${card.publishedAt.slice(0, 10)}` : ""}
        </Text>

        <View style={s.summaryBox}>
          <Text style={s.stat}>
            Chuyên cần: {att.attended}/{att.total} ({att.rate}%)
          </Text>
          <Text style={s.stat}>Đã học bù: {att.madeUp}</Text>
          <Text style={s.stat}>
            Bài kiểm tra: {card.metrics.exams.passed}/{card.metrics.exams.count}
          </Text>
          <Text style={s.stat}>Điểm TB KT: {card.metrics.exams.averageScore ?? "—"}</Text>
          {assignments ? (
            <>
              <Text style={s.stat}>
                Bài tập: {assignments.submitted}/{assignments.total}
              </Text>
              <Text style={s.stat}>Điểm TB bài tập: {assignments.averageScore ?? "—"}</Text>
            </>
          ) : null}
        </View>

        {skills && skills.length > 0 ? (
          <>
            <Text style={s.section}>Kỹ năng robot</Text>
            <View style={s.hRow}>
              <Text style={[s.cL, s.bold]}>Kỹ năng</Text>
              <Text style={[s.cR, s.bold]}>Mức</Text>
            </View>
            {skills.map((sk) => (
              <View style={s.row} key={sk.skill}>
                <Text style={s.cL}>{SKILL_LABEL[sk.skill as RoboticsSkill] ?? sk.skill}</Text>
                <Text style={s.cR}>{SKILL_LEVEL_LABEL[sk.level as SkillLevel] ?? sk.level}</Text>
              </View>
            ))}
          </>
        ) : null}

        {card.scores.length > 0 ? (
          <>
            <Text style={s.section}>Đánh giá năng lực</Text>
            <View style={s.hRow}>
              <Text style={[s.cL, s.bold]}>Tiêu chí</Text>
              <Text style={[s.cR, s.bold]}>Mức</Text>
            </View>
            {card.scores.map((sc) => (
              <View style={s.row} key={sc.criterionId}>
                <Text style={s.cL}>{sc.name}</Text>
                <Text style={s.cR}>
                  {sc.level} · {LEVEL_LABEL[sc.level] ?? ""}
                  {sc.note ? ` (${sc.note})` : ""}
                </Text>
              </View>
            ))}
          </>
        ) : null}

        {card.periodComments.length > 0 ? (
          <>
            <Text style={s.section}>Nhận xét theo giai đoạn</Text>
            {card.periodComments.map((p, i) => (
              <Text style={s.para} key={i}>
                {/* A1: PDF tải về không được in mã SESSION_5/SESSION_12 — map ra nhãn VN. */}
                <Text style={s.bold}>{reportCardPeriodDisplay(p.period)}: </Text>
                {p.comment}
              </Text>
            ))}
          </>
        ) : null}

        {card.completionStatus ? (
          <>
            <Text style={s.section}>Kết quả</Text>
            <Text style={s.para}>{card.completionStatus}</Text>
          </>
        ) : null}

        {card.finalComment ? (
          <>
            <Text style={s.section}>Nhận xét tổng kết</Text>
            <Text style={s.para}>{card.finalComment}</Text>
          </>
        ) : null}
      </Page>
    </Document>
  );
}
