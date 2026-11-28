// @vitest-environment node
/**
 * [CNB-*] Ranh giới ba miền của CHỨNG NHẬN và hiện trạng "không có phiên bản khuôn" (D-45, P8/QtMauCN).
 *
 * Khuôn `CertificatePdf` dùng chung cho ba đường: nhân viên nội bộ (`TrnCertificate`), học viên OFFLINE (`CourseCompletion`) và bản xem thử (người giả). Học viên ONLINE
 * (`OnlCertificate`) có PDF + phôi RIÊNG (`lib/elearning-online/cn-pdf.tsx`, lưới `[CNM-W1]`). Lưới này khoá: (1) mỗi đường chỉ đọc bảng CỦA MIỀN MÌNH; (2) thêm một nơi dựng PDF chứng nhận mới là quyết định có chủ đích (lưới đỏ để người làm
 * đọc `CHUNG-NHAN-MAU-QUYET-DINH.md`); (3) ghim HIỆN TRẠNG "chưa có cột phiên bản khuôn" — lưới này CỐ Ý đỏ khi migration phiên bản được duyệt và áp dụng: lúc đó gỡ ghim + cập nhật
 * tài liệu quyết định, không sửa cho xanh.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const GOC = process.cwd();
const doc = (p: string) => readFileSync(join(GOC, p), "utf8");
const chiMa = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

const NOI_BO = "app/api/elearning/chung-nhan/route.ts";
const OFFLINE = "app/api/admin/reports/certificate/route.ts";
const XEM_THU = "app/api/elearning/chung-nhan/mau-xem/route.ts";

function moiTep(dir: string, ra: string[] = []): string[] {
  for (const t of readdirSync(join(GOC, dir))) {
    if (t === "node_modules" || t === ".next" || t.startsWith(".")) continue;
    const p = `${dir}/${t}`;
    if (statSync(join(GOC, p)).isDirectory()) moiTep(p, ra);
    else if (/\.(ts|tsx)$/.test(t) && !/\.test\.tsx?$/.test(t)) ra.push(p);
  }
  return ra;
}

describe("[CNB-01] mỗi đường dựng PDF chỉ đọc bảng của MIỀN MÌNH", () => {
  it("🔴 đường NHÂN VIÊN đọc `trnCertificate`, KHÔNG đọc bảng offline hay online", () => {
    const m = chiMa(doc(NOI_BO));
    expect(m).toContain("trnCertificate");
    expect(m).not.toMatch(/courseCompletion|onlCertificate|elearning-online|\bCourseCompletion\b/);
  });
  it("🔴 đường OFFLINE đọc `courseCompletion`, KHÔNG đọc `Trn*` hay `Onl*`", () => {
    const m = chiMa(doc(OFFLINE));
    expect(m).toContain("courseCompletion");
    expect(m).not.toMatch(/trnCertificate|onlCertificate|elearning-online/);
  });
  it("🔴 bản XEM THỬ không đọc bảng chứng nhận nào (chỉ người giả), và QR trỏ địa chỉ không tồn tại", () => {
    const m = chiMa(doc(XEM_THU));
    expect(m).not.toMatch(/trnCertificate|courseCompletion|onlCertificate|scopedDb|\bdb\./);
    expect(m).toContain("example.invalid");
  });
});

describe("[CNB-02] thêm một nơi dựng PDF chứng nhận là QUYẾT ĐỊNH CÓ CHỦ ĐÍCH", () => {
  it("🔴 chỉ ba route dựng PDF bằng `CertificatePdf` (mã chạy, không tính chú thích); PDF của OnlCertificate dựng bằng khuôn RIÊNG `cn-pdf.tsx`, không qua `CertificatePdf`", () => {
    const dung = [...moiTep("app"), ...moiTep("lib")].filter((f) => f !== "lib/pdf/certificate.tsx" && /\bCertificatePdf\b/.test(chiMa(doc(f))));
    expect(dung.sort()).toEqual([OFFLINE, XEM_THU, NOI_BO].sort());
  });
});

describe("[CNB-03] HIỆN TRẠNG: Nội bộ chưa có phiên bản khuôn trên chứng nhận (ghim); Online đã có từ V10.0 (Q2)", () => {
  const model = (ten: string) => {
    const m = doc("prisma/schema.prisma").match(new RegExp(`\\nmodel ${ten} \\{([\\s\\S]*?)\\n\\}`));
    expect(m, `không thấy model ${ten}`).not.toBeNull();
    return m![1]!;
  };
  it("🔴 TrnCertificate (NỘI BỘ) vẫn KHÔNG có cột phiên bản/mã khuôn — khoảng hở của Nội bộ chưa được đóng ở đây (không phải việc của hệ Online)", () => {
    expect(model("TrnCertificate"), "TrnCertificate").not.toMatch(/\b(templateVersion|templateCode|khuonVersion|templateId)\b/);
  });
  it("🔴 [V10.0 · Q2] hệ ONLINE đã ĐÓNG khoảng hở: OnlCertificate mang mẫu đã dùng + bản chụp dựng lại; mẫu là bảng riêng BẤT BIẾN (trigger) — đối chứng dương cho ca Nội bộ ở trên", () => {
    expect(model("OnlCertificate")).toMatch(/\btemplateId\b/);
    expect(model("OnlCertificate")).toMatch(/\brenderSnapshotJson\b/);
    expect(doc("prisma/schema.prisma")).toContain("model OnlCertificateTemplate {");
    expect(doc("prisma/migrations/20261204110000_onl_mau_chung_nhan/migration.sql")).toMatch(/onl_cert_template_bat_bien/);
  });
  it("và đường tải KHÔNG đọc phiên bản khuôn nào: luôn dựng bằng `CertificatePdf` trần", () => {
    const m = chiMa(doc(NOI_BO));
    expect(m).toMatch(/createElement\(CertificatePdf,\s*\{\s*d\s*\}\)/);
    expect(m).not.toMatch(/templateVersion|templateCode/);
  });
});

describe("[CNB-04] BA hệ chứng nhận ĐỘC LẬP + rủi ro xoá cứng học viên (đo 21/11/2026)", () => {
  const schema = () => doc("prisma/schema.prisma");
  const quanHe = (ten: string, truong: string) => {
    const m = schema().match(new RegExp(`\\nmodel ${ten} \\{([\\s\\S]*?)\\n\\}`));
    expect(m, `không thấy model ${ten}`).not.toBeNull();
    const dong = m![1]!.split("\n").find((l) => new RegExp(`^\\s*${truong}\\s`).test(l));
    expect(dong, `${ten}.${truong}`).toBeTruthy();
    return dong!;
  };
  it("🔴 đường GHI của Offline (`lib/completion/service.ts`) chỉ chạm bảng Offline: không đọc/ghi `trnCertificate`/`onlCertificate`/phôi Online và không dựng PDF", () => {
    const m = chiMa(doc("lib/completion/service.ts"));
    expect(m).toMatch(/courseCompletion/); // đối chứng dương: tệp đúng là đường ghi Offline
    expect(m).not.toMatch(/trnCertificate|onlCertificate|onlCertificateTemplate|CertificatePdf/);
  });
  it("🔴 Online & Nội bộ: khoá ngoại của chứng nhận đều RESTRICT (xoá học viên/khoá/lượt ghi danh KHÔNG kéo theo xoá chứng nhận)", () => {
    for (const t of ["student", "course", "entitlement"]) expect(quanHe("OnlCertificate", t)).toMatch(/onDelete:\s*Restrict/);
    expect(quanHe("TrnCertificate", "enrollment")).toMatch(/onDelete:\s*Restrict/);
  });
  it("🔴 GHIM HIỆN TRẠNG RỦI RO Offline: `CourseCompletion → Student` là CASCADE — xoá CỨNG một học viên xoá luôn chứng chỉ Offline (khác hai hệ kia). Ghim để ai đổi thành RESTRICT/SET NULL phải cập nhật tài liệu bàn giao Offline; KHÔNG sửa cho xanh", () => {
    expect(quanHe("CourseCompletion", "student")).toMatch(/onDelete:\s*Cascade/);
  });
  it("đo đường xoá cứng học viên trong mã chạy thật (loại script/seed/test): KHÔNG có ⇒ rủi ro hiện chỉ có ở script dọn dẹp thủ công / SQL tay", () => {
    const ung = [...moiTep("app"), ...moiTep("lib")].filter((f) => /\b(db|tx|prisma|sdb)\.student\.(delete|deleteMany)\(/.test(chiMa(doc(f))));
    expect(ung).toEqual([]);
  });
});
