// [POS-UI-*] — LƯỚI GHIM MÃ NGUỒN cho các màn của tính năng thẻ POS. THUẦN.
//
// Mỗi ca khoá một LỜI HỨA của giao diện (luật 12: nút / câu chữ phải nói thật) hoặc một dây nối
// mà test hành vi không chạm tới (component client, trang RSC). Chú thích ghi mã TRƯỚC bản vá.
// Bóc chú thích TRƯỚC khi đếm (chú thích giải thích bản vá chứa đúng chuỗi đang tìm), và đếm
// SỐ LẦN khớp, không chỉ "có/không".
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function bocChuThich(v: string): string {
  return v
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((d) => d.replace(/(^|[^:"'`])\/\/[^\n]*$/, "$1"))
    .join("\n");
}

const doc = (tep: string) => bocChuThich(readFileSync(resolve(process.cwd(), tep), "utf8"));
const dem = (ma: string, re: RegExp) => [...ma.matchAll(new RegExp(re.source, "g"))].length;

const TRANG = doc("app/(admin)/admin/bien-dong-so-du/page.tsx");
const BANG = doc("app/(admin)/admin/bien-dong-so-du/_components/bank-txn-client.tsx");
const NHAP = doc("app/(admin)/admin/bien-dong-so-du/_components/nhap-file-pos.tsx");
const KHU = doc("app/(admin)/admin/bien-dong-so-du/_components/khu-the-pos.tsx");
const ACTION = doc("app/(admin)/admin/bien-dong-so-du/_pos-actions.ts");

describe("[POS-UI] lời hứa của màn thẻ POS", () => {
  it("[POS-UI-01] nút 'Gỡ gắn' chỉ vẽ khi MỌI phân bổ trỏ đơn trong tầm nhìn", () => {
    // Mã TRƯỚC bản vá: `i.status === "MATCHED" && canManage ? <GoGanGiaoDich …/>` — giao dịch
    // rót vào đơn cơ sở khác (orderId null) vẫn có nút, action trả "Không tìm thấy đơn hàng".
    expect(dem(BANG, /<GoGanGiaoDich\b/), "số chỗ vẽ nút gỡ gắn").toBe(1);
    expect(dem(BANG, /allocations\.every\(\(a\) => a\.orderId !== null\)/)).toBe(1);
    const dieuKien = BANG.match(/(\S[^\n]*)\?\s*\(?\s*<GoGanGiaoDich\b/)?.[1] ?? "";
    expect(dieuKien, "điều kiện vẽ nút phải là biến gỡ-được").toMatch(/\bgoDuoc\b/);
  });

  it("[POS-UI-02] nút Import file POS gác CẢ quyền LẪN phạm vi mọi cơ sở (đúng cổng của action)", () => {
    // Mã TRƯỚC bản vá: `{canImportPos && (… <NhapFilePos />)}` — action còn đòi
    // `nhapPosDuocMoiCoSo(actor)` ⇒ người không đủ phạm vi thấy nút, bấm Nhập thì bị từ chối.
    expect(dem(ACTION, /nhapPosDuocMoiCoSo\(actor\)/), "đối chứng: action hỏi phạm vi").toBe(2);
    expect(dem(TRANG, /nhapPosDuocMoiCoSo\(actor\)/)).toBe(1);
    const khoi = TRANG.match(/\{(\w+) && <NhapFilePos \/>\}/)?.[1] ?? TRANG.match(/\{(\w+) && \(\s*<NhapFilePos/)?.[1];
    expect(khoi, "NhapFilePos phải nằm trong khối gác riêng").toBe("nhapPosDuoc");
    expect(TRANG).toMatch(/const nhapPosDuoc = canImportPos && nhapPosDuocMoiCoSo\(actor\);/);
  });

  it("[POS-UI-03] panel import KHÔNG khẳng định dòng lỗi 'chưa ghi gì'", () => {
    // Mã TRƯỚC bản vá: "Dòng lỗi — chưa ghi gì, import lại sau khi xử lý" — dòng lỗi có thể đã
    // ghi tiền (lỗi ở câu ghi kết quả sau `thuTheoPhieuGop`).
    expect(NHAP).not.toMatch(/chưa ghi gì/);
    expect(NHAP).toMatch(/có thể đã ghi một phần/);
  });

  it("[POS-UI-04] lô vượt trần dừng Ở CLIENT trước khi gửi; không suy nguyên nhân từ message lỗi", () => {
    // Mã TRƯỚC bản vá: regex `/body exceeded|413/i` trên message — bản production của React
    // thay message bằng câu chung ⇒ nhánh không bao giờ khớp, rơi về "Mất kết nối… import lại".
    expect(NHAP).not.toMatch(/body exceeded/);
    expect(NHAP).not.toMatch(/Mất kết nối/);
    expect(dem(NHAP, /\bloVuotTran\b/)).toBeGreaterThanOrEqual(2); // import + gọi
    const iKiem = NHAP.search(/cacLo\.findIndex\(loVuotTran\)/);
    const iBatDau = NHAP.search(/batDauNhapPosAction\(\{/);
    expect(iKiem, "có kiểm trần").toBeGreaterThan(-1);
    expect(iKiem, "kiểm trần TRƯỚC khi mở lượt import").toBeLessThan(iBatDau);
  });

  it("[POS-UI-05] key của danh sách 'Tiền đã vào' là phân bổ, không phải (đơn, số tiền)", () => {
    // Mã TRƯỚC bản vá: key={`${d.orderId}-${d.amount}`} — phiếu gộp hai bé cùng học phí ⇒ trùng.
    expect(KHU).not.toMatch(/key=\{`\$\{d\.orderId\}-\$\{d\.amount\}`\}/);
    expect(dem(KHU, /key=\{d\.khoa\}/)).toBe(1);
    expect(dem(TRANG, /khoa: a\.paymentRequestId,/), "cả hai nhánh (trong / ngoài tầm nhìn)").toBe(2);
  });

  it("[POS-UI-06] nhapLoPosAction KHÔNG revalidatePath mỗi lô (client tự router.refresh cuối lượt)", () => {
    const than = ACTION.match(/export async function nhapLoPosAction[\s\S]*?\n\}\n/)?.[0] ?? "";
    expect(than, "tìm thấy thân action").not.toBe("");
    expect(dem(than, /\blamMoi\(\)/)).toBe(0);
    // Đối chứng: đóng cảnh báo vẫn làm mới.
    const dongCb = ACTION.match(/export async function dongCanhBaoHuyPosAction[\s\S]*?\n\}\n?/)?.[0] ?? "";
    expect(dem(dongCb, /\blamMoi\(\)/)).toBe(1);
    // 30/09 (nợ 4): trang làm mới MỘT lần ở `ketThucNhapPosAction`; màn chỉ tự `router.refresh()`
    // ở lối ra không tới được action đó (ketThuc hỏng / chưa mở được lượt).
    const ketThuc = ACTION.match(/export async function ketThucNhapPosAction[\s\S]*?\n\}\n?/)?.[0] ?? "";
    expect(dem(ketThuc, /\blamMoi\(\)/), "kết thúc lượt làm mới đúng một lần").toBe(1);
    expect(dem(NHAP, /ketThucNhapPosAction\(\{/), "màn báo kết thúc lượt").toBe(1);
    expect(dem(NHAP, /router\.refresh\(\)/)).toBeGreaterThanOrEqual(2);
  });

  it("[POS-UI-07] tab Máy POS: nút Thêm / Sửa / công tắc gác bằng ĐÚNG cổng phạm vi của action", () => {
    const TAB = doc("app/(admin)/admin/cau-hinh-van-hanh/_components/tab-may-pos.tsx");
    const BANG_MAY = doc("app/(admin)/admin/cau-hinh-van-hanh/_components/tab-may-pos-bang.tsx");
    const ACT_MAY = doc("app/(admin)/admin/cau-hinh-van-hanh/_may-pos-actions.ts");
    expect(dem(ACT_MAY, /if \(!nhapPosDuocMoiCoSo\(actor\)\) return/), "ba action hỏi phạm vi").toBe(3);
    expect(dem(TAB, /choSua=\{nhapPosDuocMoiCoSo\(actor\)\}/)).toBe(1);
    expect(BANG_MAY).toMatch(/const nutThem = choSua \?/);
    expect(dem(BANG_MAY, /\{choSua \? \(\s*<Switch\b/)).toBe(1);
    expect(dem(BANG_MAY, /\{choSua \? \(\s*<Button[^>]*?onClick=\{\(\) => datDangMo\(r\.id\)\}/)).toBe(1);
  });

  it("[POS-UI-09] khu cảnh báo phân biệt 'Hủy sau khi đã ghi nhận' với 'Hoàn một phần' (Q-G 30/09)", async () => {
    // Mã TRƯỚC bản vá: tiêu đề cứng `{fmt(canhBao.length)} giao dịch thẻ bị hủy sau khi đã ghi nhận`
    // (và "…sau khi tiền đã vào sổ" ở dải đầu trang) cho CẢ gốc bị chặn vì hoàn một phần — tiền
    // của loại đó CHƯA vào sổ, câu chữ nói sai.
    expect(KHU).not.toMatch(/\{fmt\(canhBao\.length\)\} giao dịch thẻ bị hủy/);
    expect(TRANG).not.toMatch(/\{fmt\(canhBaoPos\.length\)\} giao dịch thẻ bị hủy/);
    expect(dem(TRANG, /loai: loaiCanhBaoPos\(c\.matchReason\),/), "loại suy từ lý do, một chỗ").toBe(1);
    expect(dem(TRANG, /\{tieuDeCanhBaoPos\(canhBaoPos\)\}/)).toBe(1);
    expect(dem(KHU, /\{tieuDeCanhBaoPos\(canhBao\)\}/)).toBe(1);
    expect(dem(KHU, /\{NHAN_CANH_BAO\[c\.loai\]\}/), "nhãn loại trên từng dòng").toBe(1);
    const { tieuDeCanhBaoPos } = await import("./phan-loai-pos");
    expect(tieuDeCanhBaoPos([{ loai: "HUY_SAU_GHI_NHAN" }])).toBe("1 giao dịch thẻ bị hủy sau khi đã ghi nhận");
    expect(tieuDeCanhBaoPos([{ loai: "HOAN_MOT_PHAN" }, { loai: "HOAN_MOT_PHAN" }])).toBe(
      "2 giao dịch thẻ hoàn một phần — đã chặn gắn tay",
    );
    expect(tieuDeCanhBaoPos([{ loai: "HOAN_MOT_PHAN" }, { loai: "HUY_SAU_GHI_NHAN" }])).toBe(
      "1 giao dịch thẻ bị hủy sau khi đã ghi nhận · 1 giao dịch thẻ hoàn một phần — đã chặn gắn tay",
    );
  });

  it("[POS-UI-08] màn Cấu hình vận hành: dải 'chỉ có quyền xem' + câu 'phải ghi lý do' rẽ theo tab có ô cấu hình chung", () => {
    const CH = doc("app/(admin)/admin/cau-hinh-van-hanh/page.tsx");
    expect(dem(CH, /const coOCauHinhChung = coTabTheoQuyenSuaChung\(tabDuocXem\);/)).toBe(1);
    expect(dem(CH, /\{!canEditGlobal && !cheDoCoSo && coOCauHinhChung && \(/)).toBe(1);
    expect(dem(CH, /\{!canEditGlobal && !cheDoCoSo && \(/), "không còn điều kiện cũ").toBe(0);
    const iLyDo = CH.search(/phải ghi <strong>lý do<\/strong>/);
    const truocLyDo = CH.slice(Math.max(0, iLyDo - 400), iLyDo);
    expect(truocLyDo, "câu 'phải ghi lý do' nằm trong khối {coOCauHinhChung && …}").toMatch(/\{coOCauHinhChung && \(/);
  });
});
