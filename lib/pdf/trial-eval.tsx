// lib/pdf/trial-eval.tsx — PHIẾU ĐÁNH GIÁ & ĐỊNH HƯỚNG PHÁT TRIỂN NĂNG LỰC (buổi trải nghiệm).
//
// Bám đúng bản thiết kế giấy trung tâm đang phát cho phụ huynh: nền kem, header logo +
// gạch cam, hộp tiêu đề, lưới thông tin 2×2, bảng tiêu chí có cột nhóm màu cam, hộp
// định hướng, khối ký tên. Nội dung lấy nguyên từ rubric 8.0 (lib/trial/rubric.ts) —
// mỗi tiêu chí in đủ 3 mức, mức được chọn tô cam như phiếu tick tay.
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
import { RUBRIC, RUBRIC_MAX, fmtScore } from "@/lib/trial/rubric";
import { BRAND, BRAND_TAGLINE, logoSrc } from "@/lib/pdf/brand";

const s = StyleSheet.create({
  page: {
    padding: 30,
    fontFamily: "NotoSans",
    fontSize: 9.5,
    color: BRAND.text,
    backgroundColor: BRAND.cream,
  },

  header: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 3,
    borderBottomColor: BRAND.orange,
    paddingBottom: 8,
    marginBottom: 10,
  },
  logo: { width: 82 },
  tagline: {
    flex: 1,
    textAlign: "center",
    fontSize: 8,
    fontWeight: "bold",
    color: BRAND.orange,
    letterSpacing: 0.6,
  },

  titleBox: {
    backgroundColor: BRAND.box,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginBottom: 8,
    alignItems: "center",
  },
  titleText: {
    fontSize: 12.5,
    fontWeight: "bold",
    color: BRAND.purple,
    textTransform: "uppercase",
    textAlign: "center",
  },
  titleSub: { fontSize: 8.5, color: "#555555", marginTop: 2 },

  infoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  infoCell: {
    width: "48.7%",
    borderWidth: 1,
    borderColor: BRAND.line,
    backgroundColor: "#FFFFFF",
    borderRadius: 5,
    paddingVertical: 5,
    paddingHorizontal: 9,
  },
  infoLabel: {
    fontSize: 7,
    color: BRAND.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  infoValue: { fontSize: 10, fontWeight: "bold", color: BRAND.textStrong },

  scoreBand: {
    position: "relative",
    borderRadius: 8,
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 9,
    paddingHorizontal: 14,
  },
  scoreLabel: { fontSize: 8, color: "#E9DFF6", letterSpacing: 0.6, textTransform: "uppercase" },
  scoreValue: { fontSize: 18, fontWeight: "bold", color: "#FFFFFF", marginTop: 2 },
  pill: {
    backgroundColor: BRAND.orange,
    borderRadius: 30,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  pillText: { fontSize: 10, fontWeight: "bold", color: "#FFFFFF" },

  // Dau muc co SO: hai muc lon cua phieu phai trong cung mot he, va so thu tu phai la
  // mot vat the chu khong phai ky tu lan vao tieu de.
  secHead: { flexDirection: "row", alignItems: "center", marginTop: 9, marginBottom: 4 },
  secNum: {
    width: 15,
    height: 15,
    borderRadius: 7.5,
    backgroundColor: BRAND.purple,
    color: "#FFFFFF",
    fontSize: 8.5,
    fontWeight: "bold",
    textAlign: "center",
    paddingTop: 2.6,
    marginRight: 6,
  },
  secTitle: {
    flex: 1,
    fontSize: 10.5,
    fontWeight: "bold",
    color: BRAND.purple,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  secRule: { height: 2, backgroundColor: BRAND.lineSoft, marginBottom: 6 },

  evalGrid: {
    borderWidth: 1,
    borderColor: BRAND.line,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#FFFFFF",
  },
  // Hang tieu de bang: noi thang hai cot la gi. Khong co no thi cot trai trong nhu mot
  // nhan trang tri chu khong phai "nhom nang luc".
  evalHeadRow: {
    flexDirection: "row",
    backgroundColor: BRAND.box,
    borderBottomWidth: 1,
    borderBottomColor: BRAND.line,
  },
  evalHeadLeft: {
    width: "24%",
    paddingVertical: 4,
    paddingHorizontal: 9,
    borderRightWidth: 1,
    borderRightColor: BRAND.line,
  },
  evalHeadRight: { width: "76%", paddingVertical: 4, paddingHorizontal: 9 },
  evalHeadText: {
    fontSize: 6.8,
    fontWeight: "bold",
    color: BRAND.purple,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },

  evalRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: BRAND.lineSoft },
  evalRowLast: { borderBottomWidth: 0 },
  evalGroupCell: {
    width: "24%",
    backgroundColor: BRAND.cell,
    borderRightWidth: 1,
    borderRightColor: BRAND.lineSoft,
    borderLeftWidth: 3,
    borderLeftColor: BRAND.orange,
    paddingVertical: 8,
    paddingHorizontal: 8,
    justifyContent: "center",
  },
  evalGroupNum: {
    fontSize: 6.5,
    color: BRAND.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  evalGroupText: { fontSize: 9.5, fontWeight: "bold", color: BRAND.purple, lineHeight: 1.25 },
  evalGroupPts: { fontSize: 7, color: BRAND.orange, fontWeight: "bold", marginTop: 3 },
  evalContent: { width: "76%", paddingVertical: 6, paddingHorizontal: 9 },

  crit: { marginBottom: 6 },
  critLast: { marginBottom: 0 },
  critHead: { flexDirection: "row", alignItems: "center", marginBottom: 3 },
  critLabel: { flex: 1, fontSize: 9, fontWeight: "bold", color: BRAND.textStrong },
  // Diem nam trong VIEN, khong phai chu roi: sau dong diem xep thanh mot cot thang o
  // mep phai, mat quet mot luot la thay em manh/yeu o dau.
  critPill: {
    backgroundColor: BRAND.box,
    borderRadius: 8,
    paddingVertical: 1.5,
    paddingHorizontal: 6,
  },
  critPillText: { fontSize: 8, fontWeight: "bold", color: BRAND.orange },

  optRow: { flexDirection: "row", gap: 5 },
  // Muc DUOC CHON la mot the co nen + vien cam; muc khong chon de tran. Ban truoc chi
  // khac nhau o mot cham tron 8px va chu dam - in den trang la gan nhu khong phan biet
  // duoc, ma phieu nay phu huynh hay photo lai.
  opt: {
    flexDirection: "row",
    width: "31.8%",
    borderRadius: 4,
    borderWidth: 1,
    paddingVertical: 3,
    paddingHorizontal: 4,
  },
  optOn: { borderColor: BRAND.orange, backgroundColor: BRAND.box },
  optOff: { borderColor: BRAND.lineSoft, backgroundColor: "#FFFFFF" },
  circle: { width: 7, height: 7, borderRadius: 3.5, borderWidth: 1.2, marginRight: 4, marginTop: 1 },
  optBody: { flex: 1 },
  optText: { fontSize: 7.6, lineHeight: 1.25 },
  critDesc: { fontSize: 7, color: BRAND.textMuted, marginTop: 1.5, lineHeight: 1.2 },

  // Muc 2: hai khoi con, moi khoi mot thanh mau ben trai. Ban truoc la mot hop trang
  // voi hai nhan cung mau - doc thanh mot khoi dai, khong thay dau la nhan xet dau la
  // viec can lam tiep.
  recWrap: { flexDirection: "column", gap: 6 },
  recCard: {
    borderWidth: 1,
    borderColor: BRAND.line,
    backgroundColor: "#FFFFFF",
    borderRadius: 8,
    borderLeftWidth: 3,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  recCardComment: { borderLeftColor: BRAND.purple },
  recCardPath: { borderLeftColor: BRAND.orange },
  recLabel: {
    fontSize: 7,
    fontWeight: "bold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 3,
  },
  recPara: { fontSize: 9.5, lineHeight: 1.45, color: BRAND.text },
  bulletRow: { flexDirection: "row", marginTop: 3, alignItems: "flex-start" },
  // Dau dau dong la hinh vuong nho, khong phai ky tu "bullet": ky tu do le thuoc font
  // va da co tien le roi mat khi @react-pdf doi bo chu.
  bulletDot: {
    width: 3.5,
    height: 3.5,
    backgroundColor: BRAND.orange,
    marginTop: 4.5,
    marginRight: 6,
  },
  bulletText: { flex: 1, fontSize: 9.5, lineHeight: 1.45, color: BRAND.text },

  foot: {
    marginTop: 10,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: BRAND.lineSoft,
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "baseline",
  },
  footLabel: { fontSize: 8.5, color: BRAND.textMuted },
  footName: { fontSize: 10, fontWeight: "bold", color: BRAND.purple, marginLeft: 5 },
});

export interface TrialEvalPdfData {
  studentName: string;
  // `courseName` / `trialClassName` ĐÃ GỠ 27/08 — phiếu không in hai ô đó nữa. Giữ lại
  // trong kiểu này là mời người sau truyền vào rồi tưởng nó hiện lên.
  scores: Record<string, number>;
  totalScore: number;
  rank: string;
  generalComment: string | null;
  orientation: string | null;
  evaluatedByName: string | null;
  /** "dd/mm/yyyy". */
  dateLabel: string;
}

/** Nền chuyển sắc tím — @react-pdf không hiểu CSS linear-gradient, phải vẽ bằng Svg. */
function GradientBg() {
  return (
    <Svg
      style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      <Defs>
        <LinearGradient id="trialBand" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={BRAND.purple} />
          <Stop offset="1" stopColor={BRAND.purpleLight} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100" height="100" fill="url(#trialBand)" />
    </Svg>
  );
}

/** Đầu mục có số thứ tự — dùng chung cho cả hai mục lớn để chúng cùng một hệ. */
function SectionHead({ num, title }: { num: number; title: string }) {
  return (
    <View>
      <View style={s.secHead}>
        <Text style={s.secNum}>{num}</Text>
        <Text style={s.secTitle}>{title}</Text>
      </View>
      <View style={s.secRule} />
    </View>
  );
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.infoCell}>
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={s.infoValue}>{value}</Text>
    </View>
  );
}

/** Tách "Định hướng" (nhiều dòng, có thể đã có "•" sẵn) thành các gạch đầu dòng. */
function bulletLines(raw: string): string[] {
  return raw
    .split("\n")
    .map((l) => l.trim().replace(/^[•\-*]\s*/, ""))
    .filter(Boolean);
}

export function TrialEvalPdf({ data }: { data: TrialEvalPdfData }) {
  const orientationLines = data.orientation ? bulletLines(data.orientation) : [];

  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <Image src={logoSrc()} style={s.logo} />
          <Text style={s.tagline}>{BRAND_TAGLINE}</Text>
        </View>

        <View style={s.titleBox}>
          <Text style={s.titleText}>Phiếu đánh giá &amp; định hướng phát triển năng lực</Text>
          <Text style={s.titleSub}>Kết quả buổi học trải nghiệm</Text>
        </View>

        {/* 27/08 — chủ dự án chốt bỏ "Khoá học quan tâm" và "Lớp trải nghiệm";
            phiếu chỉ còn TÊN học sinh và NGÀY đánh giá. */}
        <View style={s.infoGrid}>
          <InfoCell label="Họ và tên học sinh" value={data.studentName} />
          <InfoCell label="Ngày đánh giá" value={data.dateLabel} />
        </View>

        <View style={s.scoreBand}>
          <GradientBg />
          <View>
            <Text style={s.scoreLabel}>Tổng điểm đánh giá</Text>
            <Text style={s.scoreValue}>
              {fmtScore(data.totalScore)} / {RUBRIC_MAX}.0
            </Text>
          </View>
          <View style={s.pill}>
            <Text style={s.pillText}>Xếp loại: {data.rank}</Text>
          </View>
        </View>

        <SectionHead num={1} title="Đánh giá năng lực chi tiết" />
        <View style={s.evalGrid}>
          <View style={s.evalHeadRow}>
            <View style={s.evalHeadLeft}>
              <Text style={s.evalHeadText}>Nhóm năng lực</Text>
            </View>
            <View style={s.evalHeadRight}>
              <Text style={s.evalHeadText}>Tiêu chí · mức đạt được</Text>
            </View>
          </View>
          {RUBRIC.map((sec, secIdx) => (
            <View
              key={sec.num}
              style={secIdx === RUBRIC.length - 1 ? [s.evalRow, s.evalRowLast] : s.evalRow}
              wrap={false}
            >
              <View style={s.evalGroupCell}>
                <Text style={s.evalGroupNum}>Nhóm {sec.num}</Text>
                <Text style={s.evalGroupText}>{sec.title}</Text>
                {/* Điểm CỘNG CỦA NHÓM: người đọc muốn biết em mạnh ở mảng nào, mà
                    cộng nhẩm hai dòng lẻ 0.5 trên giấy thì không ai làm. */}
                <Text style={s.evalGroupPts}>
                  {fmtScore(
                    sec.criteria.reduce((t, c) => t + (data.scores[c.id] ?? 0), 0),
                  )}
                  {" / "}
                  {fmtScore(sec.criteria.reduce((t, c) => t + (c.levels[0]?.points ?? 0), 0))}
                  {" đ"}
                </Text>
              </View>
              <View style={s.evalContent}>
                {sec.criteria.map((c, critIdx) => {
                  const pts = data.scores[c.id] ?? 0;
                  const picked =
                    c.levels.find((l) => l.points === pts) ?? c.levels[c.levels.length - 1];
                  return (
                    <View
                      key={c.id}
                      style={critIdx === sec.criteria.length - 1 ? [s.crit, s.critLast] : s.crit}
                    >
                      <View style={s.critHead}>
                        <Text style={s.critLabel}>{c.label}</Text>
                        <View style={s.critPill}>
                          <Text style={s.critPillText}>
                            {fmtScore(pts)}/{fmtScore(c.levels[0]?.points ?? 0)} đ
                          </Text>
                        </View>
                      </View>
                      <View style={s.optRow}>
                        {c.levels.map((l) => {
                          const on = l === picked;
                          return (
                            <View key={l.title} style={[s.opt, on ? s.optOn : s.optOff]}>
                              <View
                                style={[
                                  s.circle,
                                  {
                                    borderColor: on ? BRAND.orange : BRAND.purple,
                                    backgroundColor: on ? BRAND.orange : "#FFFFFF",
                                  },
                                ]}
                              />
                              {/* Mô tả nằm TRONG ô mức được chọn — để riêng một dòng
                                  full-width thì nó luôn nằm dưới cột 1, gây hiểu nhầm
                                  là đang mô tả mức đầu tiên. */}
                              <View style={s.optBody}>
                                <Text
                                  style={[
                                    s.optText,
                                    on
                                      ? { color: BRAND.textStrong, fontWeight: "bold" }
                                      : { color: BRAND.textMuted },
                                  ]}
                                >
                                  {l.title}
                                </Text>
                                {on && l.desc ? <Text style={s.critDesc}>{l.desc}</Text> : null}
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          ))}
        </View>

        <SectionHead num={2} title="Nhận xét &amp; lộ trình đề xuất từ trung tâm" />
        <View style={s.recWrap}>
          {data.generalComment ? (
            <View style={[s.recCard, s.recCardComment]} wrap={false}>
              <Text style={[s.recLabel, { color: BRAND.purple }]}>Nhận xét chung</Text>
              <Text style={s.recPara}>{data.generalComment}</Text>
            </View>
          ) : null}
          {orientationLines.length > 0 ? (
            <View style={[s.recCard, s.recCardPath]} wrap={false}>
              <Text style={[s.recLabel, { color: BRAND.orange }]}>
                Lộ trình đề xuất
              </Text>
              {orientationLines.map((line, i) => (
                <View key={i} style={s.bulletRow}>
                  <View style={s.bulletDot} />
                  <Text style={s.bulletText}>{line}</Text>
                </View>
              ))}
            </View>
          ) : null}
          {!data.generalComment && orientationLines.length === 0 ? (
            <View style={[s.recCard, s.recCardComment]}>
              <Text style={s.recPara}>Chưa có nhận xét.</Text>
            </View>
          ) : null}
        </View>

        <View style={s.foot}>
          <Text style={s.footLabel}>Giáo viên đánh giá:</Text>
          <Text style={s.footName}>{data.evaluatedByName ?? "—"}</Text>
        </View>
      </Page>
    </Document>
  );
}
