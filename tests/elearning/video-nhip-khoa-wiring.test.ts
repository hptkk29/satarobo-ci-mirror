// @vitest-environment node
/**
 * NHỊP XEM VIDEO — canh DÂY NỐI của cổng thời gian thật, khoá tư vấn và bàn giao `seq`.
 *
 * Mỗi mục là một chỗ mà test hành vi KHÔNG với tới:
 *  · khoá tư vấn: mock `db` không có khoá, nên test đơn vị không chứng minh được nó KHÓA (chỉ test Postgres thật
 *    `[VNX-N5]` làm được, và nó chỉ đỏ khi cuộc đua thật xảy ra) — lưới này canh việc lời gọi CÓ MẶT và đứng đúng chỗ;
 *  · trang học quên `select seq` hoặc quên truyền xuống ⇒ bộ đếm về 0 ⇒ k nhịp đầu mỗi lần tải lại bị bỏ, không lỗi nào báo;
 *  · ngân sách tính theo `tocDo` do CLIENT khai ⇒ cổng thời gian vô hiệu với người gian lận mà mọi ca hành vi vẫn xanh;
 *  · cuộn khoá chạy TRONG giao dịch ⇒ nó đọc tiến độ qua kết nối khác và không thấy dòng chưa commit.
 *
 * Neo vào BIỂU THỨC (đã bỏ chú thích), không neo vào chỗ đặt dòng.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const doc = (p: string) => readFileSync(join(ROOT, p), "utf8");

/**
 * Bỏ chú thích khối và chú thích dòng. Chuẩn hoá CRLF TRƯỚC: ở cây làm việc Windows `.` không khớp `\r`, nên
 * chú thích cuối dòng sẽ KHÔNG bị bỏ và lưới đếm nhầm chính chú thích giải thích bản vá.
 */
const chiMa = (src: string) =>
  src
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n");

const dem = (src: string, re: RegExp) => (src.match(re) ?? []).length;

const HEARTBEAT = chiMa(doc("lib/elearning/video-heartbeat.ts"));
const TRANG_HOC = chiMa(doc("app/(elearning)/elearning/hoc/[enrollmentId]/[lessonId]/page.tsx"));
const TRINH_PHAT = chiMa(doc("app/(elearning)/elearning/hoc/_components/video-player.tsx"));
const BITMAP = chiMa(doc("lib/elearning/segment-bitmap.ts"));

describe("[VNX-W1] khoá tư vấn theo (người, bài) bao trọn chuỗi ĐỌC-RỒI-GHI", () => {
  it("đúng MỘT lời gọi pg_advisory_xact_lock, qua $executeRaw (không $queryRaw — kiểu `void` không giải mã được)", () => {
    expect(dem(HEARTBEAT, /pg_advisory_xact_lock\(/g)).toBe(1);
    expect(dem(HEARTBEAT, /tx\.\$executeRaw`SELECT pg_advisory_xact_lock\(/g)).toBe(1);
    // Có ĐÚNG MỘT `$queryRaw`: câu `FOR SHARE` đọc phiên bản nội dung của bài (kiểu `Int`, giải mã được). Xem [VNX-W4].
    expect(dem(HEARTBEAT, /\$queryRaw/g)).toBe(1);
  });

  it("khoá mang cả người VÀ bài (khoá chỉ theo lượt học để hai lượt của một người chia hai ngân sách)", () => {
    expect(HEARTBEAT).toMatch(/hashtextextended\(\$\{`\$\{actor\.userId\}:\$\{lesson\.id\}`\}, 0\)/);
  });

  it("khoá đứng TRƯỚC lần đọc tiến độ đầu tiên trong giao dịch (khoá sau khi đọc là đọc số cũ)", () => {
    const khoa = HEARTBEAT.indexOf("pg_advisory_xact_lock(");
    const docDau = HEARTBEAT.indexOf("tx.trnLessonProgress.findUnique(");
    expect(khoa).toBeGreaterThan(0);
    expect(docDau).toBeGreaterThan(khoa);
  });

  it("MỌI chạm vào tiến độ, phiên và ngân sách đi qua `tx` — không còn `db.trnLessonProgress`/`db.trnVideoSession`/`db.trnVideoBudget` ngoài giao dịch", () => {
    expect(dem(HEARTBEAT, /\bdb\.trnLessonProgress\b/g)).toBe(0);
    expect(dem(HEARTBEAT, /\bdb\.trnVideoSession\b/g)).toBe(0);
    expect(dem(HEARTBEAT, /\bdb\.trnVideoBudget\b/g)).toBe(0);
  });

  it("giao dịch khai hạn riêng (mặc định 5 giây không đủ cho nhịp phải xếp hàng sau khoá)", () => {
    expect(HEARTBEAT).toMatch(/timeout: 15_000, maxWait: 10_000/);
  });

  it("cuộn khoá chạy SAU commit và chỉ khi VỪA xong bài", () => {
    expect(dem(HEARTBEAT, /cuonKhoaSauKhiXongBai\(/g)).toBe(1);
    expect(HEARTBEAT).toMatch(/if \(kq\.vuaXongBai\) \{\s*await cuonKhoaSauKhiXongBai\(enrollment\.id, now\);/);
    // …và nằm SAU lời gọi giao dịch (chỉ số của lời gọi lớn hơn chỉ số của `$transaction(`).
    expect(HEARTBEAT.indexOf("cuonKhoaSauKhiXongBai(")).toBeGreaterThan(HEARTBEAT.indexOf("db.$transaction("));
  });
});

describe("[VNX-W2] cổng thời gian thật đấu dây đúng nguồn", () => {
  it("ngân sách tính từ mốc đã lưu đọc TRONG khoá + mốc phát vé; điểm nhận chọn bằng khopNganSach (số giây ĐOẠN MỚI ≤ ngân sách)", () => {
    expect(dem(HEARTBEAT, /nganGiay\(\{/g)).toBe(1);
    expect(dem(HEARTBEAT, /khopNganSach\(\{/g)).toBe(1);
    expect(dem(HEARTBEAT, /tx\.trnVideoBudget\.findUnique\(/g)).toBe(1);
    // Đọc ngân sách đứng SAU khoá và TRƯỚC lúc gộp bitmap.
    const khoa = HEARTBEAT.indexOf("pg_advisory_xact_lock(");
    const doc1 = HEARTBEAT.indexOf("tx.trnVideoBudget.findUnique(");
    const gop = HEARTBEAT.indexOf("gopNhipXem({");
    expect(khoa).toBeLessThan(doc1);
    expect(doc1).toBeLessThan(gop);
  });

  it("gopNhipXem chỉ chạy BÊN TRONG khopNganSach (không còn lời gọi trần bỏ qua phép khớp)", () => {
    expect(dem(HEARTBEAT, /gopNhipXem\(\{/g)).toBe(1);
    const khop = HEARTBEAT.indexOf("khopNganSach({");
    const gop = HEARTBEAT.indexOf("gopNhipXem({");
    expect(khop).toBeGreaterThan(0);
    expect(gop).toBeGreaterThan(khop);
    // Trần mỗi nhịp là hằng 25; ngân sách đo bằng số giây ĐOẠN MỚI trong khopNganSach, KHÔNG kẹp độ dài khoảng khai
    // (kẹp theo độ dài làm nhịp đi lại khoảng đã ghi — ví dụ nhịp mang câu trả lời — bị coi như tiêu ngân sách).
    expect(HEARTBEAT).toMatch(/tranDeltaGiay: TRAN_DELTA_GIAY,/);
    expect(HEARTBEAT).toMatch(/tranNhip: TRAN_DELTA_GIAY,/);
    expect(dem(HEARTBEAT, /tranNhipTheoNgan/g)).toBe(0);
  });

  it("mốc phát vé lấy từ CHÍNH vé đã ký (`thoiDiemPhatVe`), không từ thân yêu cầu", () => {
    expect(HEARTBEAT).toMatch(/const phatVeMs = thoiDiemPhatVe\(ve\.ve!, now\.getTime\(\)\);/);
    expect(HEARTBEAT).toMatch(/nganGiay\(\{ now, tat: hangNganSach\?\.tat \?\? null, phatVeMs, tocDoToiDa \}\)/);
  });

  it("tốc độ tối đa lấy từ LƯỢT GIAO (hoặc mặc định hợp đồng), KHÔNG từ `tocDo` do client khai", () => {
    expect(HEARTBEAT).toMatch(/const tocDoToiDa = enrollment\.assignment\?\.maxPlaybackRate \?\? TOC_DO_TOI_DA;/);
    const i = HEARTBEAT.indexOf("nganGiay({");
    const goi = HEARTBEAT.slice(i, i + 90);
    expect(goi).toMatch(/\btocDoToiDa\b/);
    expect(goi).not.toMatch(/input\.tocDo/);
    const j = HEARTBEAT.indexOf("tatSauKhiGhi({");
    expect(HEARTBEAT.slice(j, j + 90)).not.toMatch(/input\.tocDo/);
  });

  it("ngân sách bị TIÊU bằng số giây ĐÃ GHI (giayMoi), và chỉ khi có ghi gì — nhịp không ghi gì không đẩy mốc", () => {
    expect(HEARTBEAT).toMatch(/if \(themWatch > 0\) \{\s*const tatMoi = tatSauKhiGhi\(\{ base: ns\.base, giayMoi: themWatch, tocDoToiDa \}\);/);
    expect(dem(HEARTBEAT, /tx\.trnVideoBudget\.upsert\(/g)).toBe(1);
  });

  it("phiên xem (thống kê) GIỮ cửa sổ 5 phút và KHÔNG tham gia phép tính ngân sách", () => {
    expect(dem(HEARTBEAT, /const CUA_SO_PHIEN_PHUT = 5;/g)).toBe(1);
    expect(dem(HEARTBEAT, /CUA_SO_PHIEN_PHUT \* 60 \* 1000/g)).toBe(1);
    expect(dem(HEARTBEAT, /NGHI_TOI_DA_GIAY|phienConSong/g)).toBe(0);
    const i = HEARTBEAT.indexOf("nganGiay({");
    expect(HEARTBEAT.slice(i, i + 90)).not.toMatch(/phien/);
  });

  it("cờ biCatThoiGian được trả về khi thời gian là thứ cắt, và meta.denNhan báo phần đã nhận", () => {
    expect(HEARTBEAT).toMatch(/const biCatThoiGian = haVeNgan;/);
    expect(dem(HEARTBEAT, /biCatThoiGian: true/g)).toBe(1);
    expect(dem(HEARTBEAT, /denNhan: denHieuLuc/g)).toBe(1);
  });

  it("trần mỗi nhịp = 25 và hết ngân sách (trần ≤ 0) không rơi vào ngoại lệ đoạn đuôi", () => {
    expect(dem(BITMAP, /export const TRAN_DELTA_GIAY = 25;/g)).toBe(1);
    expect(dem(BITMAP, /tran <= 0/g)).toBe(2);
  });
});

describe("[VNX-W3] bàn giao `seq` từ trang học tới trình phát", () => {
  it("trang học đọc `seq` của tiến độ (select) VÀ truyền cho trình phát qua seqKhoiDau", () => {
    expect(TRANG_HOC).toMatch(/select: \{ coveredSec: true, maxPositionSec: true, seq: true, mediaRevision: true \}/);
    expect(dem(TRANG_HOC, /seqBanDau=\{seqKhoiDau\(tienDo\?\.seq\)\}/g)).toBe(1);
  });

  it("trình phát khởi tạo bộ đếm từ seqBanDau (không `useRef(0)` trần)", () => {
    expect(dem(TRINH_PHAT, /useRef\(seqKhoiDau\(props\.seqBanDau\)\)/g)).toBe(1);
    expect(dem(TRINH_PHAT, /const seq = useRef\(0\)/g)).toBe(0);
  });

  it("trình phát đồng bộ bộ đếm sau phản hồi và KHÔNG nhích mốc khi BO_QUA", () => {
    expect(dem(TRINH_PHAT, /seqSauPhanHoi\(seq\.current, json\.data\.meta\?\.seq\)/g)).toBe(1);
    expect(dem(TRINH_PHAT, /json\.data\.status !== "BO_QUA"/g)).toBe(1);
    expect(TRINH_PHAT).toMatch(/if \(daNhan && !json\.data\.thachThuc\) \{/);
  });

  it("trình phát đặt mốc nhịp sau tại `meta.denNhan` khi server giữ lại một phần (phần chưa nhận được xin lại, không mất)", () => {
    expect(dem(TRINH_PHAT, /json\.data\.meta\?\.denNhan/g)).toBe(1);
    expect(TRINH_PHAT).toMatch(/batDau\.current = moc;/);
    // Mốc không còn gán thẳng `den` ở nhánh chấp nhận thường.
    expect(dem(TRINH_PHAT, /batDau\.current = den;/g)).toBe(0);
  });

  it("ẩn tab ⇒ gửi nốt khoảng đã xem (qua ref tới bản guiNhip mới nhất)", () => {
    expect(dem(TRINH_PHAT, /void guiNhipRef\.current\(\);/g)).toBe(1);
  });
});

describe("[VNX-W4] phiên bản nội dung — vé mang `rev`, đọc lại trong khoá chia sẻ, lượt đóng băng", () => {
  const TICKET = chiMa(doc("lib/elearning/media-ticket.ts"));

  it("trang học ký vé với `rev` của CHÍNH dòng bài vừa đọc, và select `mediaRevision` ở cả bài lẫn tiến độ", () => {
    expect(dem(TRANG_HOC, /kyVeMedia\(\{ lessonId: lesson\.id, userId: session\.user\.id, rev: lesson\.mediaRevision \}\)/g)).toBe(1);
    expect(dem(TRANG_HOC, /mediaRevision: true/g)).toBe(2);
    expect(TRANG_HOC).toMatch(/khongGhi=\{khongGhi\}/);
    expect(TRANG_HOC).toMatch(/const khongGhi = tienDo != null && tienDo\.mediaRevision < lesson\.mediaRevision;/);
  });

  it("nhịp xem đọc LẠI phiên bản bằng `FOR SHARE` ngay sau khoá tư vấn và TRƯỚC lần đọc tiến độ đầu tiên", () => {
    expect(dem(HEARTBEAT, /FROM "TrnLesson" WHERE "id" = \$\{lesson\.id\} FOR SHARE/g)).toBe(1);
    const khoa = HEARTBEAT.indexOf("pg_advisory_xact_lock(");
    const chiaSe = HEARTBEAT.indexOf("FOR SHARE");
    const docTienDo = HEARTBEAT.indexOf("tx.trnLessonProgress.findUnique(");
    expect(khoa).toBeLessThan(chiaSe);
    expect(chiaSe).toBeLessThan(docTienDo);
  });

  it("so phiên bản của VÉ với phiên bản đọc trong khoá, và từ chối bằng NOI_DUNG_DA_DOI", () => {
    expect(HEARTBEAT).toMatch(/const revCuaVeNay = revCuaVe\(ve\.ve!\);/);
    expect(HEARTBEAT).toMatch(/if \(revCuaVeNay !== revHienTai\) return ra\(loi\("NOI_DUNG_DA_DOI"\)\);/);
  });

  it("lượt đóng băng (tiến độ ở phiên bản cũ) trả KHONG_GHI TRƯỚC mọi phép ghi; hàng mới mang phiên bản hiện tại", () => {
    expect(HEARTBEAT).toMatch(/if \(cu && cu\.mediaRevision < revHienTai\) \{/);
    expect(dem(HEARTBEAT, /status: "KHONG_GHI"/g)).toBe(1);
    const dongBang = HEARTBEAT.indexOf('status: "KHONG_GHI"');
    const upsert = HEARTBEAT.indexOf("tx.trnLessonProgress.upsert(");
    expect(dongBang).toBeGreaterThan(0);
    expect(dongBang).toBeLessThan(upsert);
    expect(HEARTBEAT).toMatch(/mediaRevision: revHienTai,/);
  });

  it("vé: `rev` ký trong thân, và `revCuaVe` coi vé cũ / rev hỏng là 1", () => {
    expect(TICKET).toMatch(/\.\.\.\(input\.rev !== undefined \? \{ rev: input\.rev \} : \{\}\),/);
    expect(TICKET).toMatch(/Number\.isInteger\(ve\.rev\) && ve\.rev >= 1 \? ve\.rev : 1/);
  });

  it("cron dọn bitmap của BẢN CHỤP theo `supersededAt` (tầng 2), không đụng cột tầng 1", () => {
    const CRON = chiMa(doc("lib/elearning/cron-dem.ts"));
    expect(CRON).toMatch(/db\.trnLessonProgressRevision\.updateMany\(\{\s*where: \{ supersededAt: \{ lt: moc\.bitmapLastActivityTruoc \}, segmentBitmap: \{ not: null \} \},\s*data: \{ segmentBitmap: null, bitmapPurgedAt: now \},/);
  });
});
