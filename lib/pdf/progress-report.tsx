import React from "react";
import path from "path";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
} from "@react-pdf/renderer";
import { SATA_ROBO_PHONE } from "@/lib/locations";
import { formatDateVN } from "@/lib/format/date";

// Register Noto Sans (Vietnamese diacritics support) once at module load.
// The same TTF is registered for both Regular and Bold; @react-pdf synthesizes
// a stroked bold from the regular weight when no separate Bold TTF is found.
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
  page: {
    padding: 40,
    fontSize: 11,
    fontFamily: "NotoSans",
    color: "#1f2937",
  },
  header: { borderBottomWidth: 2, borderBottomColor: "#f97316", paddingBottom: 12, marginBottom: 20 },
  brandRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  brandName: { fontSize: 18, fontWeight: "bold", color: "#f97316" },
  brandMeta: { fontSize: 9, color: "#6b7280" },
  reportTitle: {
    fontSize: 20,
    fontWeight: "bold",
    textAlign: "center",
    marginTop: 16,
    marginBottom: 4,
  },
  reportMeta: { fontSize: 9, color: "#6b7280", textAlign: "center" },

  section: { marginBottom: 14 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "bold",
    backgroundColor: "#fef3c7",
    padding: 6,
    marginBottom: 8,
  },

  infoRow: { flexDirection: "row", marginBottom: 3 },
  infoLabel: { width: 110, color: "#6b7280" },
  infoValue: { flex: 1, fontWeight: "bold" },

  metricsGrid: { flexDirection: "row", gap: 6 },
  metricCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 4,
    padding: 8,
    alignItems: "center",
  },
  metricLabel: { fontSize: 9, color: "#6b7280", textAlign: "center" },
  metricValue: { fontSize: 16, fontWeight: "bold", marginVertical: 2 },
  metricSub: { fontSize: 8, color: "#9ca3af" },

  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
    paddingVertical: 4,
  },
  tableHeader: {
    backgroundColor: "#f3f4f6",
    fontWeight: "bold",
    fontSize: 9,
  },
  th1: { width: "55%", paddingHorizontal: 4 },
  th2: { width: "20%", paddingHorizontal: 4, textAlign: "center" },
  th3: { width: "25%", paddingHorizontal: 4, textAlign: "right" },
  cellMuted: { color: "#9ca3af" },

  empty: { fontSize: 10, color: "#9ca3af", fontStyle: "italic" },

  footer: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    textAlign: "center",
    fontSize: 8,
    color: "#9ca3af",
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    paddingTop: 6,
  },
});

export interface ProgressReportData {
  generatedAt: Date;
  student: {
    name: string;
    studentCode: string | null;
    dateOfBirth: Date | null;
    currentGrade: number | null;
    school: string | null;
    parentName: string;
    parentPhone: string;
  };
  class: {
    name: string;
    classCode: string | null;
    courseName: string;
    centerName: string;
    teacherName: string | null;
    schedule: string;
    startDate: Date | null;
  };
  progress: {
    totalSessions: number;
    attendedSessions: number;
    attendanceRate: number;
    totalLessons: number;
    coveredLessons: number;
    lessonCoverageRate: number;
    totalAssignments: number;
    submittedAssignments: number;
    averageScore: number | null;
  };
  recentAssignments: {
    title: string;
    submittedAt: Date | null;
    status: string;
    score: number | null;
    totalPoints: number;
  }[];
  recentExams: {
    title: string;
    submittedAt: Date | null;
    totalScore: number | null;
    passed: boolean | null;
  }[];
}

function fmt(d: Date | null): string {
  if (!d) return "—";
  return formatDateVN(d);
}

const ASSIGN_STATUS_LABEL: Record<string, string> = {
  NOT_SUBMITTED: "Chưa nộp",
  SUBMITTED: "Đã nộp",
  LATE: "Nộp muộn",
  GRADED: "Đã chấm",
};

export function ProgressReportPdf({ data }: { data: ProgressReportData }) {
  const { student, class: cls, progress } = data;
  const gradeSchoolLine =
    [
      student.currentGrade ? `Lớp ${student.currentGrade}` : null,
      student.school,
    ]
      .filter(Boolean)
      .join(" · ") || "—";

  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View style={s.brandRow}>
            <Text style={s.brandName}>SATA ROBO</Text>
            <Text style={s.brandMeta}>satarobo.vn · {SATA_ROBO_PHONE.hien}</Text>
          </View>
          <Text style={s.reportTitle}>BÁO CÁO TIẾN ĐỘ HỌC TẬP</Text>
          <Text style={s.reportMeta}>
            Xuất ngày: {fmt(data.generatedAt)} · Học viên: {student.name}
          </Text>
        </View>

        <View style={s.section}>
          <Text style={s.sectionTitle}>1. Thông tin học viên</Text>
          <View style={s.infoRow}>
            <Text style={s.infoLabel}>Họ và tên:</Text>
            <Text style={s.infoValue}>{student.name}</Text>
          </View>
          {student.studentCode && (
            <View style={s.infoRow}>
              <Text style={s.infoLabel}>Mã học viên:</Text>
              <Text style={s.infoValue}>{student.studentCode}</Text>
            </View>
          )}
          <View style={s.infoRow}>
            <Text style={s.infoLabel}>Ngày sinh:</Text>
            <Text style={s.infoValue}>{fmt(student.dateOfBirth)}</Text>
          </View>
          <View style={s.infoRow}>
            <Text style={s.infoLabel}>Lớp · Trường:</Text>
            <Text style={s.infoValue}>{gradeSchoolLine}</Text>
          </View>
          <View style={s.infoRow}>
            <Text style={s.infoLabel}>Phụ huynh:</Text>
            <Text style={s.infoValue}>
              {student.parentName} · {student.parentPhone}
            </Text>
          </View>
        </View>

        <View style={s.section}>
          <Text style={s.sectionTitle}>2. Thông tin lớp học</Text>
          <View style={s.infoRow}>
            <Text style={s.infoLabel}>Lớp:</Text>
            <Text style={s.infoValue}>
              {cls.name}
              {cls.classCode ? ` (${cls.classCode})` : ""}
            </Text>
          </View>
          <View style={s.infoRow}>
            <Text style={s.infoLabel}>Khoá học:</Text>
            <Text style={s.infoValue}>{cls.courseName}</Text>
          </View>
          <View style={s.infoRow}>
            <Text style={s.infoLabel}>Cơ sở:</Text>
            <Text style={s.infoValue}>{cls.centerName}</Text>
          </View>
          {cls.teacherName && (
            <View style={s.infoRow}>
              <Text style={s.infoLabel}>Giáo viên:</Text>
              <Text style={s.infoValue}>{cls.teacherName}</Text>
            </View>
          )}
          <View style={s.infoRow}>
            <Text style={s.infoLabel}>Lịch học:</Text>
            <Text style={s.infoValue}>{cls.schedule}</Text>
          </View>
          <View style={s.infoRow}>
            <Text style={s.infoLabel}>Khai giảng:</Text>
            <Text style={s.infoValue}>{fmt(cls.startDate)}</Text>
          </View>
        </View>

        <View style={s.section}>
          <Text style={s.sectionTitle}>3. Chỉ số tổng quan</Text>
          <View style={s.metricsGrid}>
            <View style={s.metricCard}>
              <Text style={s.metricLabel}>Điểm danh</Text>
              <Text style={s.metricValue}>{progress.attendanceRate}%</Text>
              <Text style={s.metricSub}>
                {progress.attendedSessions}/{progress.totalSessions} buổi
              </Text>
            </View>
            <View style={s.metricCard}>
              <Text style={s.metricLabel}>Bài học</Text>
              <Text style={s.metricValue}>{progress.lessonCoverageRate}%</Text>
              <Text style={s.metricSub}>
                {progress.coveredLessons}/{progress.totalLessons} bài
              </Text>
            </View>
            <View style={s.metricCard}>
              <Text style={s.metricLabel}>Bài tập</Text>
              <Text style={s.metricValue}>
                {progress.submittedAssignments}/{progress.totalAssignments}
              </Text>
              <Text style={s.metricSub}>đã nộp</Text>
            </View>
            <View style={s.metricCard}>
              <Text style={s.metricLabel}>Điểm TB</Text>
              <Text style={s.metricValue}>
                {progress.averageScore !== null ? progress.averageScore : "—"}
              </Text>
              <Text style={s.metricSub}>/ 10</Text>
            </View>
          </View>
        </View>

        {data.recentAssignments.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>4. Bài tập gần đây</Text>
            <View style={[s.tableRow, s.tableHeader]}>
              <Text style={s.th1}>Bài tập</Text>
              <Text style={s.th2}>Ngày nộp</Text>
              <Text style={s.th3}>Điểm</Text>
            </View>
            {data.recentAssignments.slice(0, 8).map((a, i) => (
              <View key={i} style={s.tableRow}>
                <Text style={s.th1}>{a.title}</Text>
                <Text style={s.th2}>{fmt(a.submittedAt)}</Text>
                <Text style={s.th3}>
                  {a.score !== null
                    ? `${a.score}/${a.totalPoints}`
                    : ASSIGN_STATUS_LABEL[a.status] ?? a.status}
                </Text>
              </View>
            ))}
          </View>
        )}

        {data.recentExams.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>5. Đề thi gần đây</Text>
            <View style={[s.tableRow, s.tableHeader]}>
              <Text style={s.th1}>Đề thi</Text>
              <Text style={s.th2}>Ngày làm</Text>
              <Text style={s.th3}>Kết quả</Text>
            </View>
            {data.recentExams.slice(0, 5).map((e, i) => (
              <View key={i} style={s.tableRow}>
                <Text style={s.th1}>{e.title}</Text>
                <Text style={s.th2}>{fmt(e.submittedAt)}</Text>
                <Text style={s.th3}>
                  {e.totalScore !== null ? e.totalScore : "—"}
                  {e.passed === true
                    ? " (Đạt)"
                    : e.passed === false
                      ? " (Chưa đạt)"
                      : ""}
                </Text>
              </View>
            ))}
          </View>
        )}

        <Text style={s.footer} fixed>
          Sata Robo — Công ty Cổ phần Công nghệ Giáo dục · satarobo.vn ·
          Hotline {SATA_ROBO_PHONE.hien}
        </Text>
      </Page>
    </Document>
  );
}
