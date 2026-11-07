#!/usr/bin/env node
/**
 * Harness CẤY LỖI cho ba cổng PII của DISC: lib/disc/ho-so.ts · thong-bao.ts · luu.ts (CLAUDE.md luật 14).
 *
 * AN TOÀN: KHÔNG bao giờ ghi vào lib/disc. Nó copy tệp nguồn + test vào `tests/disc/_cay-tam/`
 * (bản sao), cấy lỗi vào BẢN SAO, chạy vitest, rồi xoá thư mục. Đầu và cuối đều băm SHA-256 tệp gốc
 * và DỪNG (exit 3) nếu khác nhau.
 *
 * Quy trình mỗi lỗi: cấy → chạy → đòi ≥1 ca ĐỎ THẬT (đọc JSON của vitest, không tin mã thoát) → ghi TẬP CA ĐỎ.
 * Lỗi cấy mà KHÔNG ca nào đỏ = "SỐNG SÓT" = lưới chưa canh luật đó (exit 1).
 * Bản cấy làm tệp không biên dịch được KHÔNG tính là "giết" (ghi "LỖI BIÊN DỊCH" — phép cấy hỏng).
 *
 * Dùng:  node tests/disc/cay-loi/cay-loi.mjs [--chi=H,T,L] [--ra=<đường dẫn json>]
 * Không DB, không mạng. Mỗi lỗi ~3–6 giây (một lần khởi động vitest).
 */
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const GOC = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const TAM = join(GOC, "tests", "disc", "_cay-tam");
const CFG = "tests/disc/vitest.cay.config.ts";

/** Tệp sản phẩm (cấy vào bản sao) và các test sẽ canh chúng. */
const SAN_PHAM = ["ho-so.ts", "thong-bao.ts", "luu.ts", "engine.ts", "chinh-sach.ts", "phone-key.ts", "nhan.ts"];
const TEST_CO_SAN = ["ho-so.test.ts", "thong-bao.test.ts", "luu.test.ts"];
const TEST_CUA_QA = "tests/disc/luat-cot-loi.test.ts";

const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const GOC_FILES = [...SAN_PHAM.map((t) => join(GOC, "lib/disc", t)), ...TEST_CO_SAN.map((t) => join(GOC, "lib/disc", t)), join(GOC, TEST_CUA_QA)];
const bamGoc = () => Object.fromEntries(GOC_FILES.map((p) => [p, sha(p)]));

/**
 * { id, tep, tim, thay, lan? }  — `tim` phải xuất hiện ĐÚNG số lần mong đợi trong tệp; `lan` = lần khớp thứ mấy bị thay (1 = đầu).
 */
const LOI = [
  // ── ho-so.ts ──
  { id: "H1", tep: "ho-so.ts", tim: "if (ph.data.namSinh < rph.min || ph.data.namSinh > rph.max) {", thay: "if (ph.data.namSinh > rph.max) {", mo_ta: "bỏ biên dưới năm sinh PH" },
  { id: "H2", tep: "ho-so.ts", tim: "if (hs.data.namSinh < rhs.min || hs.data.namSinh > rhs.max) {", thay: "if (hs.data.namSinh < rhs.min) {", mo_ta: "bỏ biên trên năm sinh HS" },
  { id: "H3", tep: "ho-so.ts", tim: "ph.data.namSinh > hs.data.namSinh - 12", thay: "ph.data.namSinh > hs.data.namSinh - 1", mo_ta: "PH chỉ cần hơn con 1 năm" },
  { id: "H4", tep: "ho-so.ts", tim: "return namNay - hs.namSinh < 8;", thay: "return namNay - hs.namSinh < 7;", mo_ta: "ngưỡng 8 tuổi → 7" },
  { id: "H5", tep: "ho-so.ts", tim: "if (Number(hs.bacHoc) <= 2) return true;", thay: "if (Number(hs.bacHoc) <= 1) return true;", mo_ta: "lớp 2 không còn người lớn quan sát" },
  { id: "H6", tep: "ho-so.ts", tim: 'if (hs.bacHoc === "MN") return true;', thay: "if (false) return true;", mo_ta: "mầm non không còn người lớn quan sát" },
  { id: "H7", tep: "ho-so.ts", tim: "- hs.data.namSinh) > 1) {", thay: "- hs.data.namSinh) > 2) {", mo_ta: "cảnh báo lệch lớp chỉ khi lệch >2" },
  { id: "H8", tep: "ho-so.ts", tim: 'if (input.hocSinh == null) thieu.push("HOC_SINH");', thay: "/* bỏ */", mo_ta: "không còn báo thiếu học sinh" },
  { id: "H9", tep: "ho-so.ts", tim: "const TEN = z.string().trim().min(2,", thay: "const TEN = z.string().min(2,", mo_ta: "bỏ trim khi kiểm tên" },
  { id: "H10", tep: "ho-so.ts", tim: "namNay - (5 + Number(bac))", thay: "namNay - (6 + Number(bac))", mo_ta: "sai năm sinh dự kiến theo lớp" },
  { id: "H11", tep: "ho-so.ts", tim: "max: namNay - 16 }", thay: "max: namNay - 18 }", mo_ta: "biên trên năm sinh PH 16 → 18" },
  // ── thong-bao.ts ──
  { id: "T1", tep: "thong-bao.ts", tim: "quocGia.slice(-3)", thay: "quocGia.slice(-4)", mo_ta: "lộ 4 số cuối SĐT" },
  { id: "T2", tep: "thong-bao.ts", tim: "if (quocGia.length < 9)", thay: "if (quocGia.length < 8)", mo_ta: "biên độ dài SĐT" },
  { id: "T3", tep: "thong-bao.ts", tim: 'd.startsWith("84") ? "0" + d.slice(2) : d', thay: "d", mo_ta: "không chuẩn hoá 84→0 khi che" },
  { id: "T4", tep: "thong-bao.ts", tim: "`${u[0]}***@${h}`", thay: "`${u}***@${h}`", mo_ta: "lộ nguyên phần trước @" },
  { id: "T5", tep: "thong-bao.ts", tim: 'if (tt === "NONE" || !email) return', thay: 'if (tt === "NONE") return', mo_ta: "email rỗng + trạng thái có email ⇒ nổ" },
  { id: "T6", tep: "thong-bao.ts", tim: "Chúng tôi sẽ gửi thông tin kết quả đến", thay: "Chúng tôi đã gửi thông tin kết quả đến", mo_ta: "QUEUED nói 'đã gửi' (nói dối)" },
  { id: "T7", tep: "thong-bao.ts", tim: "đến ${che}. Bạn vui lòng kiểm tra hộp thư (bao gồm", thay: "đến ${email}. Bạn vui lòng kiểm tra hộp thư (bao gồm", mo_ta: "SENT in email đầy đủ" },
  { id: "T8", tep: "thong-bao.ts", tim: 'if (!u || !h) return "***";', thay: 'if (!u) return "***";', mo_ta: "email thiếu miền không che hết" },
  { id: "T9", tep: "thong-bao.ts", tim: "chưa gửi được email tới", thay: "đã gửi email tới", mo_ta: "FAILED nói 'đã gửi' (nói dối)" },
  { id: "T10", tep: "thong-bao.ts", tim: "https://satarobo.vn/kich-hoat", thay: "https://satarobo.vn/", mo_ta: "câu chính mất đường kích hoạt" },
  // ── luu.ts ──
  { id: "L1", tep: "luu.ts", tim: "ban.phoneKey === phoneKey &&", thay: "true &&", mo_ta: "phát lại: khoá trùng + SĐT khác vẫn xoay token (chiếm khoá người khác)" },
  { id: "L2", tep: "luu.ts", tim: "tokenHash: bam(tokenTho),", thay: "tokenHash: tokenTho,", mo_ta: "lưu plaintext token" },
  { id: "L3", tep: "luu.ts", tim: 'email ? "VERIFICATION_REQUIRED" : "NONE"', thay: 'email ? "QUEUED" : "NONE"', mo_ta: "email chưa xác minh bị xếp hàng gửi" },
  { id: "L4", tep: "luu.ts", tim: "xuLyHoSo: z.literal(true)", thay: "xuLyHoSo: z.boolean()", mo_ta: "đồng ý xử lý hồ sơ không còn bắt buộc" },
  { id: "L5", tep: "luu.ts", tim: "if (!ket.taoMoi) {", thay: "if (false) {", mo_ta: "phát lại tạo lead/CRM lần nữa" },
  { id: "L6", tep: "luu.ts", tim: "if (email && !z.string().email().safeParse(email).success) {", thay: "if (false) {", mo_ta: "không kiểm định dạng email" },
  { id: "L7", tep: "luu.ts", tim: "NGAY_GIU_BAI_CHUA_NHAN * 86_400_000", thay: "NGAY_GIU_BAI_CHUA_NHAN * 3_600_000", mo_ta: "hạn giữ bài tính nhầm đơn vị" },
  { id: "L8", tep: "luu.ts", tim: "HAN_TOKEN_TAI_PHUT * 60_000", thay: "HAN_TOKEN_TAI_PHUT * 600_000", mo_ta: "hạn token dài gấp 10" },
  { id: "L9", tep: "luu.ts", tim: "bacHoc: null, nguoiLonQuanSat: false,", thay: "bacHoc: null, nguoiLonQuanSat: true,", mo_ta: "PARENT bị coi là người-lớn-quan-sát" },
  { id: "L10", tep: "luu.ts", tim: "tiepThi: d.dongY.tiepThi,", thay: "tiepThi: true,", lan: 1, mo_ta: "ghi đồng ý tiếp thị = true bất kể ô tích (store)" },
  { id: "L11", tep: "luu.ts", tim: "tiepThi: d.dongY.tiepThi,", thay: "tiepThi: true,", lan: 2, mo_ta: "CRM nhận tiếp thị = true bất kể ô tích" },
  { id: "L12", tep: "luu.ts", tim: "claimCodeHash: bamMaNhan(maNhan, khoa),", thay: "claimCodeHash: maNhan,", mo_ta: "store nhận mã nhận plaintext" },
  { id: "L13", tep: "luu.ts", tim: "} else if (d.ketQua && (deps.choPhepTinDiemClient ?? (() => choPhepTinDiemClient()))()) {", thay: "} else if (d.ketQua) {", mo_ta: "tin điểm client không cần cổng" },
  { id: "L14", tep: "luu.ts", tim: 'if (env.NODE_ENV === "production") return false;', thay: "/* bỏ */", mo_ta: "cổng tin-điểm-client mở được ở production" },
  { id: "L15", tep: "luu.ts", tim: "if (!bo || bo.ma !== b.maBoDe) return", thay: "if (!bo) return", mo_ta: "tin mã bộ đề client khai" },
  { id: "L16", tep: "luu.ts", tim: "  if (engine) {", thay: "  if (engine && !d.ketQua) {", mo_ta: "có engine nhưng vẫn ưu tiên điểm client" },
  { id: "L17", tep: "luu.ts", tim: "/* ghi nhận ở lớp gọi (không kèm dữ liệu cá nhân) */", thay: 'throw new Error("crm");', mo_ta: "lỗi CRM làm hỏng việc lưu" },
  { id: "L18", tep: "luu.ts", tim: 'ban.claimStatus === "PENDING_CLAIM" &&', thay: "true &&", mo_ta: "phát lại: bài đã nhận/thu hồi/hết hạn vẫn được xoay token" },
  { id: "L19", tep: "luu.ts", tim: "ban.deletedAt === null &&", thay: "true &&", mo_ta: "phát lại: bài đã xoá vẫn được xoay token" },
  { id: "L20", tep: "luu.ts", tim: "const namNay = namHienTaiVN(now);", thay: "const namNay = new Date().getFullYear();", mo_ta: "năm hồ sơ đọc đồng hồ thật" },
  { id: "L21", tep: "luu.ts", tim: "if (s.length !== DO_DAI_MA_NHAN) return null;", thay: "/* bỏ */", mo_ta: "mã nhận không kiểm độ dài" },
  { id: "L22", tep: "nhan.ts", tim: "if (p.phien && p.phien.phoneKey !== sdtChuan) {", thay: "if (false) {", mo_ta: "nhận bài: phiên của tài khoản khác số vẫn đi tiếp" },
  { id: "L23", tep: "chinh-sach.ts", tim: "export const TOI_DA_LAN_THU_MA = 5;", thay: "export const TOI_DA_LAN_THU_MA = 5000;", mo_ta: "trần đoán mã nhận 5 → 5000" },
  { id: "L24", tep: "luu.ts", tim: "BANG_MA_NHAN[b[i]! & 31]", thay: "BANG_MA_NHAN[b[i]! & 63]", mo_ta: "sinh mã nhận lệch bảng" },
  // ── vòng 2 (luu.ts / phone-key.ts / nhan.ts / chinh-sach.ts) ──
  { id: "L25", tep: "luu.ts", tim: "ban.payloadHash === payloadHash", thay: "true", mo_ta: "phát lại: khác nội dung (payloadHash) vẫn xoay token" },
  { id: "L26", tep: "luu.ts", tim: "ban.retainUntil.getTime() > now.getTime() &&", thay: "true &&", mo_ta: "phát lại: bài hết hạn giữ vẫn được xoay token" },
  { id: "L27", tep: "luu.ts", tim: 'bai: nguonDiem === "SERVER" ? d.bai : null,', thay: "bai: null,", mo_ta: "payloadHash không phủ câu trả lời thô (đổi đáp án vẫn là replay hợp lệ)" },
  { id: "L28", tep: "luu.ts", tim: "const phoneKey = phoneKeyTuSdtChuan(sdtChuan, khoa);", thay: "const phoneKey = sdtChuan;", mo_ta: "SĐT thô vào store (phoneKey không băm)" },
  { id: "L29", tep: "phone-key.ts", tim: 'return createHmac("sha256", khoa).update(`disc-phone-v1:${sdtChuan}`).digest("hex");', thay: "return sdtChuan;", mo_ta: "phoneKeyTuSdtChuan trả SĐT thô" },
  { id: "L30", tep: "luu.ts", tim: "if (daCo.theoCap >= TOI_DA_BAI_MOI_THEO_CAP)", thay: "if (daCo.theoCap > TOI_DA_BAI_MOI_THEO_CAP)", mo_ta: "trần theo cặp SĐT+IP lệch 1 (cho thêm 1 bài)" },
  { id: "L31", tep: "luu.ts", tim: "now.getTime() - CUA_SO_DEM_BAI_THEO_SDT_MS", thay: "now.getTime() + CUA_SO_DEM_BAI_THEO_SDT_MS", mo_ta: "cửa sổ đếm bài lật dấu (đếm tương lai)" },
  { id: "L32", tep: "luu.ts", tim: "const daCo = await deps.store.demTheoPhone(phoneKey, ipKey, tu, d.idempotencyKey);", thay: "const daCo = { theoCap: 0, theoPhone: 0 };", mo_ta: "bỏ hẳn cả hai trần đếm" },
  { id: "L33", tep: "luu.ts", tim: "  } catch {\n    return { ok: false, loi: \"LUU_THAT_BAI\" };\n  }\n\n  let ket;", thay: "  } catch {\n    /* nuốt lỗi đếm */\n  }\n\n  let ket;", mo_ta: "lỗi đếm ⇒ lưu mù (fail-open)" },
  { id: "L34", tep: "luu.ts", tim: "if (laProductionThat(env)) return false;", thay: "/* bỏ */", mo_ta: "cổng tin-điểm-client không nhìn VERCEL_ENV=production" },
  { id: "L35", tep: "luu.ts", tim: "if (!xoay) return { ok: false, loi: \"LUU_THAT_BAI\" };", thay: "/* bỏ */", mo_ta: "xoay token thất bại (đua) vẫn trả token mới" },
  { id: "L36", tep: "luu.ts", tim: "if (!replayHopLe(ket.ban, phoneKey, payloadHash, now)) return", thay: "if (false) return", mo_ta: "bỏ cổng replay hợp lệ" },
  { id: "L37", tep: "luu.ts", tim: "if (daCo.theoCap >= TOI_DA_BAI_MOI_THEO_CAP) return { ok: false, loi: \"QUA_NHIEU_YEU_CAU\" };", thay: "if (daCo.theoCap >= TOI_DA_BAI_MOI_THEO_CAP) return { ok: false, loi: \"LUU_THAT_BAI\" };", mo_ta: "vượt trần cặp trả sai mã lỗi" },
  { id: "L38", tep: "chinh-sach.ts", tim: "export const TOI_DA_BAI_MOI_THEO_CAP = 5;", thay: "export const TOI_DA_BAI_MOI_THEO_CAP = 500;", mo_ta: "trần bài theo cặp 5 → 500" },
  { id: "L39", tep: "luu.ts", tim: "if (daCo.theoPhone >= TOI_DA_BAI_MOI_THEO_SDT_TRAN_CUNG) return { ok: false, loi: \"LUU_THAT_BAI\" };", thay: "/* bỏ */", mo_ta: "N6: bỏ trần cứng theo SĐT" },
  { id: "L40", tep: "luu.ts", tim: "if (daCo.theoPhone >= TOI_DA_BAI_MOI_THEO_SDT_TRAN_CUNG) return { ok: false, loi: \"LUU_THAT_BAI\" };", thay: "if (daCo.theoPhone >= TOI_DA_BAI_MOI_THEO_SDT_TRAN_CUNG) return { ok: false, loi: \"QUA_NHIEU_YEU_CAU\" };", mo_ta: "N6: trần cứng trả mã riêng (oracle SĐT bị dùng nhiều)" },
  { id: "E1", tep: "luu.ts", tim: 'if (r.ok || r.loi === "DA_GUI") return "DA_XEP_HANG";', thay: 'return "DA_XEP_HANG";', mo_ta: "xếp thư lỗi vẫn nói 'sẽ gửi liên kết' (nói dối)" },
  { id: "E2", tep: "luu.ts", tim: '} catch {\n    return "CHUA_GUI_DUOC";', thay: '} catch {\n    return "DA_XEP_HANG";', mo_ta: "guiEmail ném ⇒ vẫn nói 'sẽ gửi'" },
  { id: "E3", tep: "luu.ts", tim: "if (email) {\n    const kq = await xepLinkXacMinh(deps, ket.ban.id, now);", thay: "if (true) {\n    const kq = await xepLinkXacMinh(deps, ket.ban.id, now);", mo_ta: "xếp thư xác minh cả khi KHÔNG có email" },
  { id: "E4", tep: "luu.ts", tim: ": thongBaoSauLuu({ email, trangThaiEmail, linkXacMinh: kq });", thay: ': thongBaoSauLuu({ email, trangThaiEmail, linkXacMinh: "DA_XEP_HANG" });', mo_ta: "phát lại: lời nói bỏ qua kết quả xếp thư thật" },
  { id: "E5", tep: "luu.ts", tim: "const kq = await xepLinkXacMinh(deps, ket.ban.id, now);\n      thongBaoReplay", thay: "const kq = \"DA_XEP_HANG\" as const;\n      thongBaoReplay", mo_ta: "phát lại không thử xếp thư lại (lần đầu lỗi thì kẹt mãi)" },
  { id: "N1", tep: "nhan.ts", tim: "if (!ma || namSinhCon === null) return KHONG_NHAN_DUOC;", thay: "if (!ma) return KHONG_NHAN_DUOC;", mo_ta: "nhận bài: năm sinh con sai dạng vẫn đi tiếp" },
  { id: "N2", tep: "nhan.ts", tim: "    namSinhCon,\n    now: deps.now,", thay: "    namSinhCon: 0,\n    now: deps.now,", mo_ta: "nhận bài: không chuyển năm sinh con xuống store" },
  { id: "N3", tep: "nhan.ts", tim: "toiDaLanThu: TOI_DA_LAN_THU_NHAN,", thay: "toiDaLanThu: 100000,", mo_ta: "nhận bài: trần thử mã+năm sinh thành vô hạn" },
  { id: "N4", tep: "nhan.ts", tim: "if (!thu) return KHONG_NHAN_DUOC;", thay: "/* bỏ */", mo_ta: "nhận bài: thách đố trượt vẫn đi tiếp" },
  { id: "N5", tep: "nhan.ts", tim: "phoneKey: khoaSdt,\n    maHash", thay: "phoneKey: sdtChuan,\n    maHash", mo_ta: "nhận bài: SĐT thô vào store thách đố" },
  { id: "N6", tep: "nhan.ts", tim: "const maHash = bamMaNhan(ma, (deps.khoaBam ?? getSigningSecret)());", thay: "const maHash = ma;", mo_ta: "nhận bài: mã nhận plaintext vào store" },
  { id: "N7", tep: "nhan.ts", tim: "if (tk && tk.trangThai === \"ACTIVE\") {", thay: "if (false) {", mo_ta: "nhận bài: số đã có tài khoản vẫn tạo/ghi đè" },
  { id: "N8", tep: "nhan.ts", tim: "if (!daGan) {", thay: "if (false) {", mo_ta: "nhận bài: gắn thua đua vẫn báo thành công" },
  { id: "N9", tep: "nhan.ts", tim: "const v = await deps.otp.xacMinh(sdtChuan, p.otp.trim());\n  if (!v.ok)", thay: "const v = { ok: true } as { ok: true };\n  if (!v.ok)", mo_ta: "nhận bài: bỏ xác minh OTP" },
];

function dem(chuoi, con) {
  let n = 0;
  for (let i = chuoi.indexOf(con); i !== -1; i = chuoi.indexOf(con, i + con.length)) n++;
  return n;
}
function thayLanThu(chuoi, tim, thay, lan) {
  let i = -1;
  for (let k = 0; k < lan; k++) i = chuoi.indexOf(tim, i + 1);
  return chuoi.slice(0, i) + thay + chuoi.slice(i + tim.length);
}

function dungBanSao(banGoc) {
  rmSync(TAM, { recursive: true, force: true });
  mkdirSync(TAM, { recursive: true });
  for (const t of [...SAN_PHAM, ...TEST_CO_SAN]) cpSync(join(GOC, "lib/disc", t), join(TAM, t));
  // Test của QA trỏ ../../lib/disc/<x> ⇒ viết lại thành ./<x> để chạy trên BẢN SAO.
  const q = readFileSync(join(GOC, TEST_CUA_QA), "utf8").replace(/(["'])(?:\.\.\/)+lib\/disc\//g, "$1./");
  writeFileSync(join(TAM, "luat-cot-loi.test.ts"), q);
  void banGoc;
}

function chay(tenRa) {
  const ra = join(TAM, `${tenRa}.json`);
  const r = spawnSync("pnpm", ["exec", "vitest", "run", "-c", CFG, "--reporter=json", `--outputFile=${ra}`], {
    cwd: GOC,
    encoding: "utf8",
    shell: true,
    timeout: 180_000,
  });
  if (!existsSync(ra)) return { loi: `vitest không ghi JSON (mã ${r.status}): ${(r.stderr || r.stdout || "").slice(-400)}` };
  const j = JSON.parse(readFileSync(ra, "utf8"));
  const do_ = [];
  let tong = 0;
  let bienDich = false;
  for (const f of j.testResults) {
    const tenTep = f.name.replace(/\\/g, "/").split("/").pop();
    if (f.status === "failed" && f.assertionResults.length === 0) bienDich = true;
    for (const a of f.assertionResults) {
      tong++;
      if (a.status === "failed") do_.push(`${tenTep} › ${a.fullName}`);
    }
  }
  return { tong, do: do_, bienDich };
}

/* ───────── Chế độ --day-noi: cấy lỗi vào DÂY NỐI cờ (header/drawer/nút nổi/layout/trang) ───────── */
const DAY_NOI_TEP = [
  "app/(public)/layout.tsx",
  "app/(public)/disc/page.tsx",
  "components/public/header.tsx",
  "components/sections/mobile-nav-drawer.tsx",
  "components/public/floating-cta.tsx",
];
const DAY_NOI = [
  { id: "W1", tep: "app/(public)/layout.tsx", tim: "<Header discEnabled={isDiscEnabled()} />", thay: "<Header />", mo_ta: "layout quên truyền cờ cho Header" },
  { id: "W2", tep: "app/(public)/layout.tsx", tim: "<FloatingCta discEnabled={isDiscEnabled()} />", thay: "<FloatingCta />", mo_ta: "layout quên truyền cờ cho FloatingCta" },
  { id: "W3", tep: "components/public/header.tsx", tim: "navLinks.map(", thay: "NAV_LINKS.map(", mo_ta: "Header render mảng gốc (mất mục DISC)" },
  { id: "W4", tep: "components/public/header.tsx", tim: "<MobileNavDrawer discEnabled={discEnabled} />", thay: "<MobileNavDrawer />", mo_ta: "Header quên truyền cờ cho drawer" },
  { id: "W5", tep: "components/sections/mobile-nav-drawer.tsx", tim: "navItems.map(", thay: "NAV_ITEMS.map(", mo_ta: "Drawer render mảng gốc (mất mục DISC)" },
  { id: "W6", tep: "components/sections/mobile-nav-drawer.tsx", tim: "discEnabled = false", thay: "discEnabled = true", mo_ta: "Drawer mặc định BẬT" },
  { id: "W7", tep: "components/public/floating-cta.tsx", tim: "discEnabled = false", thay: "discEnabled = true", mo_ta: "Nút nổi mặc định BẬT" },
  { id: "W8", tep: "components/public/floating-cta.tsx", tim: ', "/disc"];', thay: "];", mo_ta: "nút nổi không ẩn ở /disc" },
  { id: "W9", tep: "app/(public)/disc/page.tsx", tim: "if (!isDiscEnabled()) notFound();", thay: "", mo_ta: "trang /disc không còn cổng cờ" },
  { id: "W10", tep: "components/public/header.tsx", tim: "chenMucDisc(NAV_LINKS, discEnabled)", thay: "chenMucDisc(NAV_LINKS, true)", mo_ta: "Header bỏ qua cờ khi chèn mục" },
  { id: "W11", tep: "components/public/floating-cta.tsx", tim: "{discEnabled && (", thay: "{(", lan: 1, mo_ta: "nút nổi desktop hiện bất kể cờ" },
  { id: "W12", tep: "components/public/floating-cta.tsx", tim: "{DISC_NAV.label}", thay: "Khám phá DISC", lan: 1, mo_ta: "chép tay nhãn nút nổi (hai nguồn)" },
  { id: "W13", tep: "app/(public)/disc/page.tsx", tim: 'export const dynamic = "force-dynamic";', thay: "", mo_ta: "trang /disc không còn động (cờ bị bake lúc dựng)" },
  { id: "W14", tep: "components/sections/mobile-nav-drawer.tsx", tim: "chenMucDisc(NAV_ITEMS, discEnabled)", thay: "[...NAV_ITEMS]", mo_ta: "Drawer không chèn mục DISC" },
];

function chayDayNoi() {
  const goc = join(tmpdir(), "disc-qa-day-noi");
  const truoc = Object.fromEntries(DAY_NOI_TEP.map((t) => [t, sha(join(GOC, t))]));
  const kq = [];
  rmSync(goc, { recursive: true, force: true });
  try {
    for (const t of DAY_NOI_TEP) {
      mkdirSync(dirname(join(goc, t)), { recursive: true });
      cpSync(join(GOC, t), join(goc, t));
    }
    const lenh = (ten) => {
      const ra = join(goc, ten + ".json");
      const r = spawnSync("pnpm", ["exec", "vitest", "run", "-c", "tests/disc/vitest.config.ts", "tests/disc/luoi-day-noi-co.test.ts", "tests/disc/cong-co-off.test.ts", "--reporter=json", "--outputFile=" + ra], { cwd: GOC, encoding: "utf8", shell: true, timeout: 180_000, env: { ...process.env, DISC_QA_ROOT: goc } });
      if (!existsSync(ra)) return { loi: "không có JSON: " + (r.stderr || "").slice(-300) };
      const j = JSON.parse(readFileSync(ra, "utf8"));
      const do_ = [];
      let tong = 0;
      for (const f of j.testResults) for (const a of f.assertionResults) { tong++; if (a.status === "failed") do_.push(a.fullName); }
      return { tong, do: do_ };
    };
    const nen = lenh("nen");
    if (nen.loi || nen.do.length) { console.error("BASELINE dây nối ĐỎ:", nen.loi ?? nen.do.slice(0, 4)); process.exitCode = 4; return; }
    console.log("BASELINE dây nối: " + nen.tong + " ca, 0 đỏ (trên bản sao 5 tệp)");
    for (const l of DAY_NOI) {
      const goc0 = readFileSync(join(GOC, l.tep), "utf8");
      const lan = l.lan ?? 1;
      if (dem(goc0, l.tim) < lan) { kq.push({ id: l.id, trangThai: "KHONG_KHOP", mo_ta: l.mo_ta }); console.log(l.id + " KHONG_KHOP " + l.mo_ta); continue; }
      writeFileSync(join(goc, l.tep), thayLanThu(goc0, l.tim, l.thay, lan));
      const r = lenh("loi-" + l.id);
      writeFileSync(join(goc, l.tep), goc0);
      const tt = r.loi ? "LOI_CHAY" : r.do.length ? "GIET" : "SONG_SOT";
      kq.push({ id: l.id, trangThai: tt, soCaDo: r.do?.length, caDo: r.do, mo_ta: l.mo_ta });
      console.log(l.id.padEnd(4) + " " + tt.padEnd(9) + " " + String(r.do?.length ?? "?").padStart(2) + " ca đỏ — " + l.mo_ta + (r.do?.length ? "  [" + r.do[0].slice(0, 70) + "]" : ""));
    }
  } finally {
    rmSync(goc, { recursive: true, force: true });
    const sau = Object.fromEntries(DAY_NOI_TEP.map((t) => [t, sha(join(GOC, t))]));
    const lech = DAY_NOI_TEP.filter((t) => truoc[t] !== sau[t]);
    if (lech.length) { console.error("⛔ TỆP GỐC ĐỔI TRONG LÚC CHẠY (agent khác sửa; harness chỉ ghi bản sao):", lech); process.exitCode = 3; }
  }
  const song = kq.filter((k) => k.trangThai !== "GIET");
  console.log("\nTỔNG dây nối: " + kq.length + " lỗi — GIẾT " + (kq.length - song.length) + " — KHÁC " + song.length);
  for (const x of song) console.log("  " + x.id + " " + x.trangThai + ": " + x.mo_ta);
  if (song.length && !process.exitCode) process.exitCode = 1;
}

function main() {
  if (process.argv.includes("--day-noi")) return chayDayNoi();
  const loc = (process.argv.find((a) => a.startsWith("--chi=")) ?? "").slice(6).split(",").filter(Boolean);
  const duongRa = (process.argv.find((a) => a.startsWith("--ra=")) ?? "").slice(5);
  const truoc = bamGoc();
  const danhSach = LOI.filter((l) => !loc.length || loc.some((p) => l.id.startsWith(p)));
  const kq = [];
  try {
    dungBanSao();
    const nen = chay("nen");
    if (nen.loi) throw new Error(nen.loi);
    if (nen.bienDich || nen.do.length) {
      console.error("BASELINE ĐỎ — dừng (cấy lỗi trên nền đỏ không chứng minh được gì):", nen.do.slice(0, 5));
      process.exitCode = 4;
      return;
    }
    console.log(`BASELINE: ${nen.tong} ca, 0 đỏ (bản sao tạm của lib/disc + test QA)`);
    for (const l of danhSach) {
      const dich = join(TAM, l.tep);
      const goc = readFileSync(join(GOC, "lib/disc", l.tep), "utf8");
      const lan = l.lan ?? 1;
      const soKhop = dem(goc, l.tim);
      if (soKhop < lan) {
        kq.push({ id: l.id, mo_ta: l.mo_ta, trangThai: "KHONG_KHOP", ghiChu: `mẫu cấy xuất hiện ${soKhop} lần (cần ≥${lan}) — mã đã đổi, cập nhật harness` });
        continue;
      }
      const moi = thayLanThu(goc, l.tim, l.thay, lan);
      if (moi === goc) {
        kq.push({ id: l.id, mo_ta: l.mo_ta, trangThai: "KHONG_DOI" });
        continue;
      }
      writeFileSync(dich, moi);
      const r = chay(`loi-${l.id}`);
      writeFileSync(dich, goc); // khôi phục bản sao ngay
      if (r.loi) {
        kq.push({ id: l.id, mo_ta: l.mo_ta, trangThai: "LOI_CHAY", ghiChu: r.loi });
        continue;
      }
      const trangThai = r.bienDich ? "LOI_BIEN_DICH" : r.do.length ? "GIET" : "SONG_SOT";
      const theoTep = {};
      for (const t of r.do) theoTep[t.split(" › ")[0]] = (theoTep[t.split(" › ")[0]] ?? 0) + 1;
      kq.push({ id: l.id, mo_ta: l.mo_ta, trangThai, soCaDo: r.do.length, theoTep, caDo: r.do });
      console.log(`${l.id.padEnd(4)} ${trangThai.padEnd(13)} ${String(r.do.length).padStart(3)} ca đỏ ${JSON.stringify(theoTep)}  — ${l.mo_ta}`);
    }
  } finally {
    rmSync(TAM, { recursive: true, force: true });
    const sau = bamGoc();
    const lech = Object.keys(truoc).filter((p) => truoc[p] !== sau[p]);
    if (lech.length) {
      console.error("⛔ TỆP GỐC ĐÃ ĐỔI TRONG LÚC CHẠY (có thể do agent khác đang sửa, KHÔNG phải harness — harness chỉ ghi vào bản sao):", lech);
      process.exitCode = 3;
    }
  }
  const song = kq.filter((k) => k.trangThai !== "GIET");
  if (duongRa) writeFileSync(duongRa, JSON.stringify(kq, null, 2));
  console.log(`\nTỔNG: ${kq.length} lỗi cấy — GIẾT ${kq.length - song.length} — KHÁC ${song.length}`);
  for (const s of song) console.log(`  ${s.id} ${s.trangThai}: ${s.mo_ta} ${s.ghiChu ?? ""}`);
  if (song.length && !process.exitCode) process.exitCode = 1;
}

main();
