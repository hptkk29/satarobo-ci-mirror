// lib/pdf/session-eval.tsx — HỒ SƠ HỌC TẬP / báo cáo buổi học của một học viên.
//
// Bám đúng bản thiết kế giấy trung tâm đang phát cho phụ huynh: header logo trái +
// "HỒ SƠ HỌC TẬP" phải, băng tím chuyển sắc có thẻ dự án màu cam, hộp nhận xét xám,
// và bảng năng lực có hàng tiêu đề tím + cột nhóm gộp dòng (rowspan). Nội dung lấy
// nguyên từ lib/lms/session-eval-rubric.ts (4 mục nhận xét + 9 tiêu chí × 4 nhóm).
import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
  Svg,
  Defs,
  LinearGradient,
  Stop,
  Rect,
} from "@react-pdf/renderer";
import {
  evalNotesProse,
  EVAL_NOTE_FIELDS,
  evalLevelText,
  groupedEvalCriteria,
  type EvalNoteKey,
  type EvalNotes,
} from "@/lib/lms/session-eval-rubric";
import { BRAND, BRAND_TAGLINE, logoSrc } from "@/lib/pdf/brand";

const s = StyleSheet.create({
  page: {
    padding: 30,
    fontFamily: "NotoSans",
    fontSize: 9.5,
    color: BRAND.text,
    backgroundColor: "#FFFFFF",
  },

  header: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    borderBottomWidth: 3,
    borderBottomColor: BRAND.orange,
    paddingBottom: 10,
    marginBottom: 12,
  },
  logo: { width: 78, marginBottom: 5 },
  tagline: { fontSize: 7.5, fontWeight: "bold", color: BRAND.orange, letterSpacing: 0.5 },
  headRight: { alignItems: "flex-end" },
  portfolioTitle: {
    fontSize: 19,
    fontWeight: "bold",
    color: BRAND.textStrong,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  portfolioSub: { fontSize: 9, color: "#555555", marginTop: 3 },

  banner: {
    position: "relative",
    borderRadius: 10,
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 13,
    paddingHorizontal: 16,
    marginBottom: 4,
  },
  bannerLeft: { flex: 1, paddingRight: 14 },
  bannerName: { fontSize: 16, fontWeight: "bold", color: "#FFFFFF" },
  bannerLine: { fontSize: 9, color: "#E9DFF6", marginTop: 4 },
  pill: {
    backgroundColor: BRAND.orange,
    borderRadius: 30,
    paddingVertical: 8,
    paddingHorizontal: 16,
    maxWidth: 190,
  },
  pillText: { fontSize: 9.5, fontWeight: "bold", color: "#FFFFFF", textAlign: "center" },

  sectionTitle: {
    borderLeftWidth: 4,
    borderLeftColor: BRAND.orange,
    paddingLeft: 10,
    marginTop: 13,
    marginBottom: 8,
  },
  sectionTitleText: {
    fontSize: 12,
    fontWeight: "bold",
    color: BRAND.purple,
    textTransform: "uppercase",
  },

  notesBox: {
    backgroundColor: BRAND.gray,
    borderWidth: 1,
    borderColor: BRAND.line,
    borderRadius: 8,
    padding: 11,
  },
  notesHeading: { fontSize: 9.5, fontWeight: "bold", color: BRAND.purple, marginBottom: 6 },
  bulletRow: { flexDirection: "row", marginBottom: 4 },
  bulletDot: { width: 11, fontSize: 9.5, color: BRAND.orange },
  bulletBody: { flex: 1 },
  noteLabel: { fontSize: 9.5, fontWeight: "bold", color: BRAND.textStrong },
  noteText: { fontSize: 9.5, lineHeight: 1.4 },
  proposal: { marginTop: 5, paddingTop: 6, borderTopWidth: 1, borderTopColor: BRAND.line },

  table: {
    borderWidth: 1,
    borderColor: BRAND.line,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#FFFFFF",
  },
  tHead: { flexDirection: "row", backgroundColor: BRAND.purple },
  tHeadCell: { color: "#FFFFFF", fontWeight: "bold", fontSize: 9, paddingVertical: 7, paddingHorizontal: 9 },
  groupRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: BRAND.lineSoft },
  groupRowLast: { borderBottomWidth: 0 },
  groupCell: {
    width: "17%",
    backgroundColor: BRAND.cell,
    borderRightWidth: 1,
    borderRightColor: BRAND.lineSoft,
    paddingVertical: 8,
    paddingHorizontal: 9,
  },
  groupText: { fontSize: 9, fontWeight: "bold", color: BRAND.orange },
  groupBody: { width: "83%" },
  critRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: BRAND.lineSoft },
  critRowLast: { borderBottomWidth: 0 },
  critName: {
    width: "31%",
    fontSize: 8.8,
    fontWeight: "bold",
    color: "#444444",
    paddingVertical: 6.5,
    paddingHorizontal: 9,
    borderRightWidth: 1,
    borderRightColor: BRAND.lineSoft,
  },
  critLevel: { width: "69%", fontSize: 8.5, lineHeight: 1.4, paddingVertical: 6.5, paddingHorizontal: 9 },

  foot: { marginTop: 10, textAlign: "right", fontSize: 8.5, color: BRAND.textMuted },
  footName: { fontWeight: "bold", color: BRAND.purple },
});

export interface SessionEvalPdfData {
  studentName: string;
  courseName: string;
  className: string;
  sessionTopic: string;
  /** "dd/mm/yyyy". */
  dateLabel: string;
  projectName: string | null;
  notes: EvalNotes;
  ratings: Record<string, number>;
  evaluatedByName: string | null;
  /**
   * Nhận xét văn xuôi KHÔNG chia 4 mục — phiếu lưu qua đường `saveSessionFeedback`
   * (/teacher/nhan-xet và editor ở /admin/sessions/[id]) chỉ có `comment` + sao.
   * Đó vẫn là phiếu thật, phụ huynh vẫn đọc được trên portal; trước 19/08 xuất PDF
   * thì 404 vì route đòi phải có notes/rubric. Dùng làm nội dung dự phòng khi 4 mục rỗng.
   */
  comment?: string | null;
}

const GROUPS = groupedEvalCriteria();
/** "Đề xuất" đứng riêng cuối hộp nhận xét (như bản thiết kế), 3 mục còn lại là gạch đầu dòng. */
const PROPOSAL_KEY: EvalNoteKey = "proposal";
const PROPOSAL_FIELD = EVAL_NOTE_FIELDS.find((f) => f.key === PROPOSAL_KEY);

/** Nền chuyển sắc tím — @react-pdf không hiểu CSS linear-gradient, phải vẽ bằng Svg. */
function GradientBg() {
  return (
    <Svg
      style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      <Defs>
        <LinearGradient id="sessionBanner" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={BRAND.purple} />
          <Stop offset="1" stopColor={BRAND.purpleLight} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100" height="100" fill="url(#sessionBanner)" />
    </Svg>
  );
}

export function SessionEvalPdf({ data }: { data: SessionEvalPdfData }) {
  // 21/08 — phiếu MỚI có một đoạn "Đánh giá chung"; phiếu CŨ vẫn là 4 mục (3 gạch đầu
  // dòng + "Đề xuất" đứng riêng, đúng bản thiết kế gốc). Giữ CẢ HAI nhánh: hàng nghìn
  // phiếu cũ trên prod vẫn phải in ra đúng như trước.
  const prose = evalNotesProse(data.notes);
  const legacyRows = prose?.kind === "legacy" ? prose.rows : [];
  const bullets = legacyRows.filter((r) => r.key !== PROPOSAL_KEY);
  const proposal = legacyRows.find((r) => r.key === PROPOSAL_KEY)?.text ?? "";
  const overall = prose?.kind === "overall" ? prose.text : "";
  const hasNotes = bullets.length > 0 || proposal.length > 0;
  const legacyComment = (data.comment ?? "").trim();

  return (
    // `title` ghi vào /Title của PDF. Không có nó, Chrome lấy đoạn cuối URL làm tiêu
    // đề tab — với route này đoạn cuối là `studentId` nên tab hiện id thô kiểu
    // "uat-hv-CS1-29" (QA vòng 1, NV-004).
    <Document
      title={`Phiếu nhận xét — ${data.studentName} — ${data.sessionTopic}`}
    >
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View>
            <Image src={logoSrc()} style={s.logo} />
            <Text style={s.tagline}>{BRAND_TAGLINE}</Text>
          </View>
          <View style={s.headRight}>
            <Text style={s.portfolioTitle}>Hồ sơ học tập</Text>
            <Text style={s.portfolioSub}>Báo cáo buổi học</Text>
          </View>
        </View>

        <View style={s.banner}>
          <GradientBg />
          <View style={s.bannerLeft}>
            <Text style={s.bannerName}>{data.studentName}</Text>
            <Text style={s.bannerLine}>
              Khóa học: {data.courseName} · Lớp: {data.className}
            </Text>
            <Text style={s.bannerLine}>Buổi học: {data.sessionTopic}</Text>
            <Text style={s.bannerLine}>Ngày học: {data.dateLabel}</Text>
          </View>
          {data.projectName ? (
            <View style={s.pill}>
              <Text style={s.pillText}>{data.projectName}</Text>
            </View>
          ) : null}
        </View>

        <View style={s.sectionTitle}>
          <Text style={s.sectionTitleText}>1. Nhận xét của giáo viên</Text>
        </View>
        <View style={s.notesBox}>
          {overall ? (
            <View>
              <Text style={s.notesHeading}>Đánh giá tổng quan quá trình học tập:</Text>
              <Text style={s.noteText}>{overall}</Text>
            </View>
          ) : hasNotes ? (
            <View>
              <Text style={s.notesHeading}>Đánh giá tổng quan quá trình học tập:</Text>
              {bullets.map((f) => (
                <View key={f.key} style={s.bulletRow}>
                  <Text style={s.bulletDot}>•</Text>
                  <View style={s.bulletBody}>
                    <Text style={s.noteText}>
                      <Text style={s.noteLabel}>{f.label}: </Text>
                      {f.text}
                    </Text>
                  </View>
                </View>
              ))}
              {proposal ? (
                <View style={bullets.length > 0 ? s.proposal : undefined}>
                  <Text style={s.noteText}>
                    <Text style={s.noteLabel}>{PROPOSAL_FIELD?.label ?? "Đề xuất"}: </Text>
                    {proposal}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : legacyComment ? (
            <View>
              <Text style={s.notesHeading}>Đánh giá tổng quan quá trình học tập:</Text>
              <Text style={s.noteText}>{legacyComment}</Text>
            </View>
          ) : (
            <Text style={s.noteText}>—</Text>
          )}
        </View>

        <View style={s.sectionTitle}>
          <Text style={s.sectionTitleText}>2. Đánh giá chi tiết năng lực</Text>
        </View>
        <View style={s.table}>
          <View style={s.tHead} fixed>
            <Text style={[s.tHeadCell, { width: "17%" }]}>Nhóm tiêu chí</Text>
            <Text style={[s.tHeadCell, { width: "26%" }]}>Tiêu chí</Text>
            <Text style={[s.tHeadCell, { width: "57%" }]}>Mức độ đánh giá</Text>
          </View>
          {GROUPS.map(([group, items], gIdx) => (
            <View
              key={group}
              style={gIdx === GROUPS.length - 1 ? [s.groupRow, s.groupRowLast] : s.groupRow}
              wrap={false}
            >
              <View style={s.groupCell}>
                <Text style={s.groupText}>{group}</Text>
              </View>
              <View style={s.groupBody}>
                {items.map((c, i) => (
                  <View
                    key={c.id}
                    style={i === items.length - 1 ? [s.critRow, s.critRowLast] : s.critRow}
                  >
                    <Text style={s.critName}>{c.name}</Text>
                    <Text style={s.critLevel}>{evalLevelText(c.id, data.ratings[c.id] ?? 3)}</Text>
                  </View>
                ))}
              </View>
            </View>
          ))}
        </View>

        <Text style={s.foot}>
          Người nhận xét: <Text style={s.footName}>{data.evaluatedByName ?? "—"}</Text>
        </Text>
      </Page>
    </Document>
  );
}
