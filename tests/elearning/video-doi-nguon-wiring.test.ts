// @vitest-environment node
/**
 * ĐỔI NGUỒN BÀI VIDEO — canh DÂY NỐI mà test hành vi không với tới.
 *
 *  · hai đường lưu có thật sự đi qua giao dịch đổi nguồn (không còn `db.trnLesson.update` trần);
 *  · quyền xuất bản hỏi bằng `can()` thật, không phải hằng `true`;
 *  · thứ tự BÊN TRONG giao dịch: khoá bài → cổng (ném) → chụp → đặt lại → ghi nguồn; từ chối đứng TRƯỚC phép ghi đầu tiên;
 *  · đặt lại KHÔNG đụng `seq` và KHÔNG đụng trạng thái/chứng nhận của lượt ghi danh;
 *  · hai form soạn dùng đúng mã lỗi mà server trả.
 *
 * Neo vào BIỂU THỨC (đã bỏ chú thích), không neo vào chỗ đặt dòng.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const doc = (p: string) => readFileSync(join(ROOT, p), "utf8");

const chiMa = (src: string) =>
  src
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n");
const dem = (src: string, re: RegExp) => (src.match(re) ?? []).length;

const LESSON = chiMa(doc("lib/elearning/video-lesson.ts"));
const DOI = chiMa(doc("lib/elearning/video-doi-nguon.ts"));
const RULE = chiMa(doc("lib/elearning/video-doi-nguon-rule.ts"));
const FORM_YT = chiMa(doc("app/(elearning)/elearning/soan/_components/youtube-link-form.tsx"));
const FORM_TEP = chiMa(doc("app/(elearning)/elearning/soan/_components/video-uploader.tsx"));
const BAO_CAO = chiMa(doc("app/(elearning)/elearning/bao-cao/video/page.tsx"));

describe("[DN-W1] hai đường lưu đi qua giao dịch đổi nguồn", () => {
  it("cả hai handler gọi `ghiNguon(` và KHÔNG còn `db.trnLesson.update(` trần (đó là đường ghi nguồn không chụp, không đặt lại)", () => {
    expect(dem(LESSON, /await ghiNguon\(\{/g)).toBe(2);
    // Cấm MỌI đường ghi trần vào bài, không chỉ `.update(`: `updateMany(`/`upsert(`/SQL thô cũng ghi nguồn không chụp.
    expect(dem(LESSON, /\.trnLesson\.(update|updateMany|upsert|create|createMany|delete|deleteMany)\w*\(/g)).toBe(0);
    expect(dem(LESSON, /UPDATE\s+"TrnLesson"/gi)).toBe(0);
  });

  it("`ghiNguon` gọi `doiNguonBaiVideo` và hỏi quyền xuất bản bằng `can(actor, 'elearning:content:publish')` thật", () => {
    expect(dem(LESSON, /await doiNguonBaiVideo\(\{/g)).toBe(1);
    expect(LESSON).toMatch(/coQuyenXuatBan: can\(i\.actor, "elearning:content:publish"\),/);
  });

  it("🔴 xác nhận là CHUỖI KÝ từ đầu vào (`xacNhanToken`), không còn cờ boolean; tên người đổi đi cùng để audit trong giao dịch", () => {
    expect(dem(LESSON, /xacNhanToken: input\.xacNhanToken \?\? null,/g)).toBe(2);
    expect(dem(LESSON, /xacNhanTacDong/g)).toBe(0);
    expect(dem(LESSON, /actorName,\s*\n\s*xacNhanToken:/g)).toBe(2);
    expect(LESSON).toMatch(/actorName: i\.actorName,/);
    expect(LESSON).toMatch(/xacNhanToken: i\.xacNhanToken,/);
  });

  it("lỗi chính sách `LoiDoiNguon` thành `ActionError(e.ma, e.message)`; lỗi khác ném tiếp", () => {
    expect(LESSON).toMatch(/if \(e instanceof LoiDoiNguon\) throw new ActionError\(e\.ma, e\.message\);\s*throw e;/);
  });

  it("audit KHÔNG đọc mã YouTube: `auditDoiNguon` không nhắc `youtubeId`/`ma`", () => {
    const i = LESSON.indexOf("function auditDoiNguon");
    const j = LESSON.indexOf("export const luuBaiVideoSchema");
    // Đổi tên hàm ⇒ indexOf = -1 ⇒ lát cắt rỗng ⇒ `not.toMatch` luôn qua: đòi lát cắt có thật TRƯỚC khi khẳng định gì.
    expect(i).toBeGreaterThanOrEqual(0);
    expect(j).toBeGreaterThan(i);
    const than = LESSON.slice(i, j);
    expect(than.length).toBeGreaterThan(50);
    expect(than).not.toMatch(/youtubeId|\bma\b|videoKey|captionKey|audioKey/);
  });
});

describe("[DN-W2] thứ tự bên trong giao dịch đổi nguồn", () => {
  const vt = (s: string) => DOI.indexOf(s);

  it("MỘT giao dịch; khoá GHI dòng bài (`FOR UPDATE`) là câu ĐẦU TIÊN", () => {
    expect(dem(DOI, /db\.\$transaction\(/g)).toBeGreaterThanOrEqual(1);
    expect(dem(DOI, /FROM "TrnLesson" WHERE "id" = \$\{i\.lessonId\} AND "deletedAt" IS NULL FOR UPDATE/g)).toBe(1);
    expect(vt('FOR UPDATE')).toBeLessThan(vt('INSERT INTO "TrnLessonProgressRevision"'));
  });

  it("🔴 từ chối (`throw new LoiDoiNguon(qd.ma`) đứng TRƯỚC phép ghi đầu tiên — `return` không rollback, chỉ `throw` mới rollback", () => {
    const tuChoi = vt("throw new LoiDoiNguon(qd.ma");
    expect(tuChoi).toBeGreaterThan(0);
    expect(tuChoi).toBeLessThan(vt('INSERT INTO "TrnLessonProgressRevision"'));
    expect(tuChoi).toBeLessThan(vt('UPDATE "TrnLessonProgress" p SET'));
    expect(tuChoi).toBeLessThan(vt("data: { ...i.duLieu, mediaRevision: revMoi }"));
  });

  it("chụp → đặt lại → làm mới phần trăm → ghi nguồn + tăng phiên bản (phép ghi bài là CUỐI CÙNG)", () => {
    const a = vt('INSERT INTO "TrnLessonProgressRevision"');
    const b = vt('UPDATE "TrnLessonProgress" p SET');
    const c = vt("await lamMoiPhanTramKhoa(tx");
    const d = vt("data: { ...i.duLieu, mediaRevision: revMoi }");
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
    expect(c).toBeLessThan(d);
  });

  it("bản chụp chạy lại được: `ON CONFLICT (…) DO NOTHING` trên đúng khoá duy nhất (lượt, bài, phiên bản)", () => {
    expect(DOI).toMatch(/ON CONFLICT \("enrollmentId","lessonId","mediaRevision"\) DO NOTHING/);
  });

  it("chụp MỌI hàng ở phiên bản cũ (kể cả lượt đóng băng) — không lọc theo trạng thái ghi danh", () => {
    const i = vt('INSERT INTO "TrnLessonProgressRevision"');
    const j = vt("ON CONFLICT");
    const cau = DOI.slice(i, j);
    expect(cau).not.toMatch(/TrnEnrollment/);
    expect(cau).toMatch(/p\."mediaRevision" = \$\{revCu\}/);
  });

  it("đặt lại CHỈ lượt đang học và CHỈ hàng ở phiên bản cũ; KHÔNG đụng `seq`, `lastActivityAt`, và KHÔNG ghi bảng ghi danh bằng SQL", () => {
    const i = vt('UPDATE "TrnLessonProgress" p SET');
    const j = vt("RETURNING p.\"enrollmentId\"");
    const cau = DOI.slice(i, j);
    expect(cau).toMatch(/e\."status" IN \('NOT_STARTED','IN_PROGRESS','OVERDUE'\)/);
    expect(cau).toMatch(/p\."mediaRevision" = \$\{revCu\}/);
    expect(cau).not.toMatch(/"seq"|"lastActivityAt"|readSeconds|scrollMaxPct|attendance/);
    expect(dem(DOI, /UPDATE "TrnEnrollment"/g)).toBe(0);
  });

  it("làm mới phần trăm chỉ ghi `progressPercent` — không `status`, không `completedAt`, không `lastActivityAt`", () => {
    const i = DOI.indexOf("async function lamMoiPhanTramKhoa");
    const j = DOI.indexOf("// ═", i);
    const than = DOI.slice(i, j === -1 ? undefined : j);
    expect(dem(than, /data: \{ progressPercent: pct \}/g)).toBe(1);
    expect(than).not.toMatch(/data: \{[^}]*(status|completedAt|verifiedAt|lastActivityAt)/);
  });

  it("phục hồi: dry-run là MẶC ĐỊNH của kịch bản (không `apply` thì không ghi) và chỉ ghi hàng chưa có tiến độ mới", () => {
    expect(DOI).toMatch(/if \(!i\.apply \|\| ke\.khoiPhuc === 0\) return ke;/);
    expect(DOI).toMatch(/p\."coveredSec" = 0 AND p\."status" = 'NOT_STARTED'/);
  });
});

describe("[DN-W3] luật thuần và hai form dùng cùng mã lỗi", () => {
  it("mã từ chối của luật = mã mà hai form so (cả hai mã buộc XEM TRƯỚC LẠI)", () => {
    expect(RULE).toMatch(/ma: "CAN_XAC_NHAN_TAC_DONG"/);
    expect(RULE).toMatch(/ma: "CAN_QUYEN_XUAT_BAN"/);
    expect(RULE).toMatch(/"TAC_DONG_DA_DOI"/);
    expect(RULE).toMatch(/"CAN_LY_DO"/);
    for (const F of [FORM_YT, FORM_TEP]) {
      expect(F).toMatch(/const MA_XEM_TRUOC_LAI = new Set\(\["TAC_DONG_DA_DOI", "CAN_XAC_NHAN_TAC_DONG"\]\);/);
    }
  });

  it("🔴 hai form KHÔNG còn cờ boolean; chuỗi xác nhận chỉ lấy từ bản XEM TRƯỚC của server, gửi kèm LÝ DO, và bài đã có nguồn luôn xem trước trước khi lưu", () => {
    for (const F of [FORM_YT, FORM_TEP]) {
      expect(dem(F, /xacNhanTacDong/g)).toBe(0);
      expect(dem(F, /xemTruocDoiNguonAction\(\{/g)).toBe(1);
      expect(dem(F, /\.\.\.\(xacNhan\?\.token \? \{ xacNhanToken: xacNhan\.token \} : \{\}\)/g)).toBe(1);
      expect(dem(F, /reason: xacNhan\.lyDo/g)).toBe(1);
      expect(dem(F, /<HopXacNhanDoiNguon\b/g)).toBe(1);
      // hộp dựng MỚI mỗi lần xem trước: ô tick của lần trước không được mang sang số liệu mới; LÝ DO đã gõ thì GIỮ (`lyDoBanDau`)
      expect(dem(F, /key=\{lanXt\}/g)).toBe(1);
      expect(dem(F, /setLanXt\(\(n\) => n \+ 1\);/g)).toBe(1);
      expect(dem(F, /lyDoBanDau=\{lyDoDaGo\}/g)).toBe(1);
      expect(dem(F, /setLyDoDaGo\(lyDo\);/g)).toBe(1);
    }
    expect(FORM_YT).toMatch(/void luu\(\{ token: xt\.xacNhanToken, lyDo \}\);/);
    expect(FORM_TEP).toMatch(/void xacNhanDoi\(lyDo\);/);
    expect(FORM_TEP).toMatch(/luuThat\(canXacNhan\.dauVao, \{ token: canXacNhan\.xt\.xacNhanToken, lyDo \}\)/);
  });

  it("🔴 KHÔNG đọc state của kết xuất cũ để quyết 'hộp đang hiện' trong nhánh lỗi: dùng THAM SỐ `xacNhan` (closure cũ làm lỗi bị nuốt, form kẹt không có hộp để thoát)", () => {
    expect(dem(FORM_YT, /if \(xt\) \{/g)).toBe(0);
    expect(dem(FORM_TEP, /if \(canXacNhan\) \{/g)).toBe(0);
    expect(dem(FORM_YT, /if \(xacNhan\) \{/g)).toBe(1);
    expect(dem(FORM_TEP, /if \(xacNhan\) \{/g)).toBe(1);
  });

  it("xác nhận hết hạn / nội dung đã đổi (không phải 'tập người học đổi') ⇒ hộp mới có câu giải thích, không im lặng", () => {
    for (const F of [FORM_YT, FORM_TEP]) {
      expect(F).toMatch(/if \(r\.error\.code !== "TAC_DONG_DA_DOI"\) setLoiHop\(/);
      expect(F).toMatch(/đã hết hiệu lực/);
    }
  });

  it("báo cáo R2 nói thẳng lượt ở phiên bản cũ (`r2-ban-cu`) và tách số người xong theo phiên bản", () => {
    expect(BAO_CAO).toMatch(/data-testid="r2-ban-cu"/);
    expect(BAO_CAO).toMatch(/data-testid="r2-tom-tat-phien-ban"/);
    expect(BAO_CAO).toMatch(/!d\.laBanCu && d\.trangThai === "DONE"/);
    expect(BAO_CAO).toMatch(/d\.laBanCu && d\.trangThai === "DONE"/);
  });
});

describe("[DN-WCS] cách ly CƠ SỞ: lượt đọc KHOÁ qua scopedDb là cổng, đứng ngay sau 'bài không tồn tại'", () => {
  // `TrnLesson`/`TrnModule` không nằm trong SCOPED_MODELS và `can(publish)` không mang target ⇒ bỏ lượt đọc khoá là mở cửa cho
  // người soạn ở cơ sở này đổi nguồn (và đặt lại tiến độ) bài của khoá riêng cơ sở khác — không test hành vi nào đỏ nếu mock `db` rộng.
  const TRANG = chiMa(doc("app/(elearning)/elearning/soan/[lessonId]/page.tsx"));

  it("🔴 `chanPhamViKhoa` đọc khoá bằng `db.trnCourse.findFirst` (db là ScopedDb) và ném NOT_FOUND khi không thấy", () => {
    expect(dem(LESSON, /async function chanPhamViKhoa\(db: ScopedDb, courseId: string\)/g)).toBe(1);
    expect(dem(LESSON, /await db\.trnCourse\.findFirst\(\{\s*where: \{ id: courseId, deletedAt: null \},/g)).toBe(1);
    expect(LESSON).toMatch(/if \(!khoa\) throw new ActionError\("NOT_FOUND", "Không tìm thấy bài học"\);/);
  });

  it("🔴 CẢ HAI handler gọi `chanPhamViKhoa(db, cu.module.courseId)` NGAY SAU `if (!cu) throw NOT_FOUND` (trước cổng loại bài, trước mọi lời gọi ghi)", () => {
    expect(
      dem(
        LESSON,
        /if \(!cu\) throw new ActionError\("NOT_FOUND", "Không tìm thấy bài học"\);\s*(?:const phamVi = )?await chanPhamViKhoa\(db, cu\.module\.courseId\);/g,
      ),
    ).toBe(3);
    // đúng ba lời gọi — hai đường lưu + xem trước — không hơn (thêm lời gọi thứ tư là dấu hiệu sao chép sai chỗ)
    expect(dem(LESSON, /chanPhamViKhoa\(db,/g)).toBe(3);
    // phạm vi cơ sở của khoá đi vào audit của nhánh KHÔNG đổi nguồn (factory ghi) ở cả hai đường lưu
    expect(dem(LESSON, /const phamVi = await chanPhamViKhoa\(db, cu\.module\.courseId\);/g)).toBe(2);
    expect(dem(LESSON, /orgUnitId: phamVi,/g)).toBe(2);
  });

  it("cả hai đường lưu VÀ xem trước SELECT `module: { select: { courseId: true } }` (thiếu ⇒ `cu.module` undefined ⇒ cổng nổ TypeError hoặc bị bỏ)", () => {
    expect(dem(LESSON, /module: \{ select: \{ courseId: true \} \}/g)).toBe(3);
  });

  it("trang soạn bài không tin `scopedDb(...).trnLesson` là có lọc: đọc khoá và từ chối khi không thấy", () => {
    expect(TRANG).toMatch(
      /await db\.trnCourse\.findFirst\(\{\s*where: \{ id: lesson\.module\.courseId, deletedAt: null \},/,
    );
    expect(TRANG).toMatch(/if \(!lesson \|\| !khoaTrongPhamVi\) \{/);
  });
});

describe("[DN-W7] hardening trong giao dịch đổi nguồn: xác nhận ràng buộc, lý do, audit CÙNG giao dịch", () => {
  const vt = (x: string) => DOI.indexOf(x);

  it("🔴 tập người học tính lại SAU khoá bằng `docBoiCanhDoiNguon(tx, cu)` và là nguồn DUY NHẤT của dấu xác nhận (xem trước dùng cùng hàm)", () => {
    expect(dem(DOI, /await docBoiCanhDoiNguon\(tx, cu\)/g)).toBe(1);
    expect(dem(DOI, /await docBoiCanhDoiNguon\(db, cu\)/g)).toBe(1);
    expect(dem(DOI, /dau: bc\.dau/g)).toBe(2); // một ở kiểm trong giao dịch, một ở ký lúc xem trước
    expect(dem(DOI, /nguon: bamNguonMoi\(i\.moi\)/g)).toBe(2);
  });

  it("🔴 xác nhận được KIỂM LẠI trong giao dịch bằng `kiemXacNhan` (không còn cờ), và kết quả đi vào `daXacNhan` của luật", () => {
    expect(dem(DOI, /kiemXacNhan\(/g)).toBe(1);
    expect(DOI).toMatch(/daXacNhan: xn\.ok,/);
    expect(dem(DOI, /xacNhan:/g)).toBe(0);
    expect(dem(DOI, /i\.xacNhan\b/g)).toBe(0);
  });

  it("🔴 thứ tự cổng: bối cảnh → kiểm xác nhận → quyền → lý do → xác nhận/tập đã đổi → (rồi mới) chụp → đặt lại → ghi nguồn → audit → return", () => {
    const thuTu = [
      "await docBoiCanhDoiNguon(tx, cu)",
      "kiemXacNhan(",
      "quyetDinhDoiNguon({",
      'qd.ma === "CAN_QUYEN_XUAT_BAN"',
      "kiemLyDoDoiNguon(i.lyDo)",
      'xn.ly === "TAC_DONG_DA_DOI"',
      'INSERT INTO "TrnLessonProgressRevision"',
      'UPDATE "TrnLessonProgress" p SET',
      "data: { ...i.duLieu, mediaRevision: revMoi }",
      "await writeAudit({",
      "return { doiNguon: true",
    ].map((x) => [x, vt(x)] as const);
    for (const [x, v] of thuTu) expect(v, x).toBeGreaterThan(0);
    for (let k = 1; k < thuTu.length; k++) {
      expect(thuTu[k]![1], `${thuTu[k]![0]} phải đứng SAU ${thuTu[k - 1]![0]}`).toBeGreaterThan(thuTu[k - 1]![1]);
    }
  });

  it("lý do ghi vào bản chụp bất biến là bản ĐÃ CẮT và đã kiểm (`ld.lyDo`), không phải chuỗi thô của client", () => {
    expect(dem(DOI, /\$\{ld\.lyDo\}::text/g)).toBe(1);
    expect(dem(DOI, /\$\{i\.lyDo\}/g)).toBe(0);
  });

  it("🔴 audit ghi TRONG giao dịch (`tx`) và KHÔNG chứa mã YouTube, khoá tệp, chuỗi xác nhận", () => {
    // hai nơi ghi audit, cả hai TRONG giao dịch: đổi nguồn và phục hồi từ bản chụp (ghi đè tiến độ học không được mất vết)
    expect(dem(DOI, /await writeAudit\(\{\s*tx,/g)).toBe(2);
    const i = DOI.indexOf("await writeAudit({");
    const j = DOI.indexOf("orgUnitId: bc.orgUnitId ?? bc.centerId,", i);
    expect(i).toBeGreaterThan(0);
    expect(j).toBeGreaterThan(i);
    const khoi = DOI.slice(i, j);
    expect(khoi.length).toBeGreaterThan(300);
    expect(khoi).not.toMatch(/youtubeId|videoKey|captionKey|audioKey|xacNhanToken/);
    expect(khoi).toMatch(/reason: ld\.lyDo,/);
    // phạm vi cơ sở: khoá nhập bằng SQL thô có thể chỉ mang centerId (chưa ghi kép orgUnitId)
    expect(DOI).toMatch(/orgUnitId: bc\.orgUnitId \?\? bc\.centerId,/);
    expect(khoi).toMatch(/actor: \{ id: i\.actorUserId, name: i\.actorName \}/);
    expect(DOI).toMatch(/daGhiAudit: true \}/);
  });

  it("D7: luật đòi xác nhận cho khoá đã xuất bản KỂ CẢ chưa ai học", () => {
    expect(RULE).toMatch(/\(i\.khoaDaXuatBan \|\| coNguoiHoc\) && !i\.daXacNhan/);
    expect(RULE).toMatch(/\(i\.khoaDaXuatBan \|\| coNguoiHoc\) && !i\.coQuyenXuatBan/);
  });

  it("xem trước CHỈ ĐỌC: không `$transaction`, không `FOR UPDATE`, không ghi; chuỗi chỉ phát khi cần xác nhận VÀ có quyền xuất bản", () => {
    const i = DOI.indexOf("export async function xemTruocDoiNguon");
    const j = DOI.indexOf("export async function doiNguonBaiVideo");
    const than = DOI.slice(i, j);
    expect(i).toBeGreaterThan(0);
    expect(j).toBeGreaterThan(i);
    expect(than).not.toMatch(/\$transaction|FOR UPDATE|\.update\(|\.create\(|\$executeRaw|writeAudit/);
    expect(than).toMatch(/yeuCauXacNhan && i\.coQuyenXuatBan/);
  });
});

describe("[DN-W8] audit không bị ghi hai lần và không bị bỏ sót (factory + hai đường lưu)", () => {
  const FACTORY = chiMa(doc("lib/actions/factory.ts"));

  it("factory ghi audit SAU handler CHỈ khi handler chưa ghi (`daGhiAudit`), và truyền tên người thao tác cho handler", () => {
    expect(dem(FACTORY, /if \(!out\.daGhiAudit\) \{/g)).toBe(1);
    expect(FACTORY).toMatch(/actorName: meta\.actorName \}\)/);
  });

  it("hai đường lưu trả `daGhiAudit: kq.daGhiAudit`; xem trước trả `daGhiAudit: true` (chỉ đọc, không có gì để ghi sổ)", () => {
    expect(dem(LESSON, /daGhiAudit: kq\.daGhiAudit,/g)).toBe(2);
    expect(dem(LESSON, /daGhiAudit: true \}/g)).toBe(1);
  });

  it("xem trước đăng ký làm Server Action (form gọi được)", () => {
    expect(chiMa(doc("app/(elearning)/elearning/soan/_actions.ts"))).toMatch(
      /export const xemTruocDoiNguonAction = defineAction\(cauHinhXemTruocDoiNguon\);/,
    );
  });
});

describe("[DN-W9] media: quyền hỏi lại MỖI lượt, sau mọi cổng chữ ký và TRƯỚC khi chạm R2", () => {
  const ROUTE = chiMa(doc("app/api/elearning/media/[...khoa]/route.ts"));

  it("🔴 `docQuyenMedia` + `quyetDinhMedia` nằm giữa `khoaThuocBai` và lệnh R2 đầu tiên; từ chối trả đúng mã/trạng thái của luật", () => {
    expect(dem(ROUTE, /await docQuyenMedia\(session\.user\.id, ve\.ve\.lessonId\)/g)).toBe(1);
    expect(dem(ROUTE, /quyetDinhMedia\(\{/g)).toBe(1);
    expect(ROUTE).toMatch(/if \(!quyen\.ok\) return fail\(quyen\.code, quyen\.message, \{ status: quyen\.status \}\);/);
    const a = ROUTE.indexOf("khoaThuocBai(khoa, ve.ve.lessonId)");
    const b = ROUTE.indexOf("docQuyenMedia(");
    const c = ROUTE.indexOf("HeadObjectCommand({");
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  it("câu SQL quyền đọc ĐỦ bốn cột khoá tệp + phiên bản + ghi danh không thu hồi + khoá/bài chưa xoá", () => {
    const Q = chiMa(doc("lib/elearning/media-quyen.ts"));
    for (const cot of ['l."mediaRevision"', 'l."videoKey"', 'l."videoKey360"', 'l."captionKey"', 'l."audioKey"']) {
      expect(Q, cot).toContain(cot);
    }
    expect(Q).toMatch(/e\."status" <> 'REVOKED'/);
    expect(Q).toMatch(/c\."deletedAt" IS NULL/);
    expect(Q).toMatch(/l\."deletedAt" IS NULL/);
  });
});

describe("[DN-W10] nhịp dày đếm theo phiên: ghi trong giao dịch nhịp, đọc ở bộ quét", () => {
  const HB = chiMa(doc("lib/elearning/video-heartbeat.ts"));
  const SCAN = chiMa(doc("lib/elearning/watch-flag-scan.ts"));

  it("🔴 mỗi nhịp đã nhận +1: nhánh nối phiên `soNhip: { increment: 1 }`, nhánh mở phiên `soNhip: 1`", () => {
    expect(dem(HB, /soNhip: \{ increment: 1 \},/g)).toBe(1);
    expect(dem(HB, /soNhip: 1,/g)).toBe(1);
  });

  it("bộ quét CHỌN cột và ưu tiên số của phiên; đường lùi `seq` chỉ khi phiên cũ (soNhip = 0)", () => {
    expect(dem(SCAN, /soNhip: true,/g)).toBe(1);
    expect(SCAN).toMatch(/p\.soNhip > 0\s*\?\s*p\.soNhip/);
  });

  it("hàng bị đặt lại được điền lại `firstStartedAt` ở nhịp đầu của phiên bản mới (không để 'đang xem mà chưa từng bắt đầu')", () => {
    expect(HB).toMatch(/\.\.\.\(cu != null && cu\.firstStartedAt == null \? \{ firstStartedAt: now \} : \{\}\),/);
    expect(dem(HB, /firstStartedAt: true,/g)).toBe(1);
  });

  it("migration cột đếm chỉ THÊM CỘT (một câu ALTER ... ADD COLUMN IF NOT EXISTS ... NOT NULL DEFAULT 0), không DROP/UPDATE/đổi kiểu", () => {
    const M = chiMa(doc("prisma/migrations/20261113090000_video_phien_dem_nhip/migration.sql").replace(/^--.*$/gm, ""))
      .replace(/\s+/g, " ")
      .trim();
    expect(M).toBe('ALTER TABLE "TrnVideoSession" ADD COLUMN IF NOT EXISTS "soNhip" INTEGER NOT NULL DEFAULT 0;');
    expect(doc("prisma/schema.prisma")).toMatch(/soNhip\s+Int\s+@default\(0\)/);
  });
});

describe("[DN-W12] trang soạn: cờ cho UI đi từ SERVER xuống hai form (luật 11: prop cờ không ai truyền = lỗi câm)", () => {
  const TRANG = chiMa(doc("app/(elearning)/elearning/soan/[lessonId]/page.tsx"));

  it("🔴 cả hai form nhận `coQuyenXuatBan`, `khoaDaXuatBan`, `coNguoiHoc`; quyền xuất bản hỏi bằng can() thật đúng một lần", () => {
    expect(dem(TRANG, /coQuyenXuatBan=\{coQuyenXuatBan\}/g)).toBe(2);
    expect(dem(TRANG, /khoaDaXuatBan=\{khoaDaXuatBan\}/g)).toBe(2);
    expect(dem(TRANG, /coNguoiHoc=\{soNguoiDaHocHienTai > 0\}/g)).toBe(2);
    // cùng định nghĩa với server: hàng tiến độ ở PHIÊN BẢN HIỆN TẠI, đã xem (không NOT_STARTED)
    expect(TRANG).toMatch(
      /db\.trnLessonProgress\.count\(\{\s*where: \{ lessonId: lesson\.id, mediaRevision: lesson\.mediaRevision, status: \{ not: "NOT_STARTED" \} \},/,
    );
    expect(dem(TRANG, /const coQuyenXuatBan = can\(actor, "elearning:content:publish"\);/g)).toBe(1);
    expect(TRANG).toMatch(/coNguonHienCo=\{Boolean\(lesson\.videoKey\) \|\| Boolean\(lesson\.youtubeId\)\}/);
  });

  it("hai form KHÔNG có giá trị mặc định cho cờ quyền (prop bắt buộc ⇒ quên truyền là lỗi biên dịch)", () => {
    for (const F of [FORM_YT, FORM_TEP]) {
      expect(F).toMatch(/coQuyenXuatBan: boolean;/);
      expect(F).toMatch(/khoaDaXuatBan: boolean;/);
      expect(F).toMatch(/coNguoiHoc: boolean;/);
    }
  });
});
