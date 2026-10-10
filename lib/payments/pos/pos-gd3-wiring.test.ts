// [POS3-W1..W4] — LƯỚI GHIM MÃ NGUỒN cho GĐ3 POS (docs/pos-gd3-thiet-ke.md §9.5). THUẦN.
//
// Luật dạng "lời gọi này phải có ở ĐÚNG chỗ kia" — ca hành vi chạm DB nằm ở `tests/finance/pos-gd3.test.ts`
// (không chạy trong `test:unit`), nên dây nối phải có khoá chạy ở mọi lượt `test:unit`.
// Bóc chú thích TRƯỚC khi đếm (chú thích giải thích bản vá chứa đúng chuỗi đang tìm — luật 11), neo theo
// LỜI GỌI và khẳng định SỐ LẦN khớp. Mã TRƯỚC bản vá ghi tại từng ca.
import { describe, expect, it } from "vitest";
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

/** Đoạn mã từ `dau` tới mốc `cuoi` đầu tiên phía sau (mốc không có ⇒ chuỗi rỗng, ca đỏ). */
function doan(ma: string, dau: RegExp, cuoi: RegExp): string {
  const i = ma.search(dau);
  if (i < 0) return "";
  const j = ma.slice(i + 1).search(cuoi);
  return j < 0 ? "" : ma.slice(i, i + 1 + j);
}

const NHAP = doc("lib/payments/pos/nhap-lo-pos.ts");
const ACTION = doc("app/(admin)/admin/bien-dong-so-du/_pos-actions.ts");
const DOC_FILE = doc("lib/payments/pos/doc-file-pos.ts");

describe("[POS3-W] dây nối GĐ3", () => {
  it("[POS3-W1] lệch được SO ở đúng 2 chỗ; cột kết toán của dòng đã khoá đi qua cotKetToanCapNhat", () => {
    expect(dem(NHAP, /\blechDaGhiNhan\(/), "lời gọi lechDaGhiNhan").toBe(2);

    // (i) nhánh ĐÃ KHOÁ — so với dòng POS đã lưu, chỉ ở lượt đầu (lượt đệ quy [V3-41] không báo lại), và
    // chỉ khi giao dịch ĐÃ GHI NHẬN (MATCHED): giao dịch đã bỏ qua không có tiền trong sổ để gỡ / hoàn.
    // Mốc cuối = câu PHÂN LOẠI LẠI. Việc 3 (09/10/2026) chia nó thành "ngữ cảnh" + "bản gốc hay bản xác nhận" nên mốc là
    // `const p = maXacNhan === null ?` — lý lẽ của ca (nhánh đã khoá đứng TRƯỚC phép phân loại lại) không đổi.
    const khoa = doan(NHAP, /if \(cu && \(bt \? bt\.status !== "UNMATCHED" : cu\.matchStatus === "TU_KHOP"\)\)/, /const p = maXacNhan === null \?/);
    expect(khoa, "tìm thấy nhánh đã khoá").not.toBe("");
    expect(dem(khoa, /\blechDaGhiNhan\(/)).toBe(1);
    expect(khoa).toMatch(
      /if \(lanXetLai === 0 && bt\?\.status === "MATCHED"\) \{\s*baoLech\(nguon, lechDaGhiNhan\(\s*d\.maGiaoDich,\s*\{\s*soTien: cu\.soTien,\s*trangThai: cu\.trangThai\s*\}/,
    );

    // (ii) ca biên: giao dịch đã rời hàng chờ mà dòng POS chưa có — so với SỐ TRONG SỔ, không trạng thái.
    const bien = doan(NHAP, /if \(gd\.status !== "UNMATCHED"\) \{/, /\n {2}\}\n/);
    expect(bien, "tìm thấy ca biên").not.toBe("");
    expect(bien).toMatch(
      /if \(gd\.status === "MATCHED"\) \{\s*baoLech\(nguon, lechDaGhiNhan\(\s*d\.maGiaoDich,\s*\{\s*soTien: gd\.amount,\s*trangThai: null\s*\}/,
    );
    // `damBaoGiaoDich` trả SỐ TRONG SỔ trên MỌI đường trả (tạo · đọc lại P2002 · đã có · cập nhật · đọc
    // lại P2025) — thiếu một đường là `gd.amount` undefined ⇒ ca biên báo lệch giả / bỏ sót.
    const dam = doan(NHAP, /async function damBaoGiaoDich\(/, /\n\}\n/);
    expect(dam, "tìm thấy damBaoGiaoDich").not.toBe("");
    const chon = [...dam.matchAll(/select: \{[^}]*\}/g)].map((m) => m[0]);
    expect(chon.length).toBeGreaterThanOrEqual(5);
    for (const c of chon) expect(c, "select của damBaoGiaoDich").toMatch(/\bamount: true\b/);
    expect(dam).toMatch(/return \{ id: co\.id, status: co\.status, amount: co\.amount \}/);

    // Lượt NGOÀI file (`khopGiaoDichThe`) không thu lệch.
    expect(dem(NHAP, /ghiLech: null/)).toBe(1);

    // Cột kết toán: MỌI phép CẬP NHẬT dòng đã có đi qua MỘT hàm — ba nhánh chỉ ghi kết toán (đã khoá · vừa
    // gỡ gắn · dòng hủy đã kết luận) + hai vế cập nhật của `ghiDong` (dòng đã có được phân loại lại · vế
    // `update` của upsert). Rà đối kháng GĐ3 (#1/#5): bản đầu chỉ phủ ba nhánh — `ghiDong` ghi thẳng
    // `trangThaiHoanHuy: d.trangThaiHoanHuy` ⇒ file cũ (ô trống) xoá "Hủy toàn phần" của dòng chưa khoá.
    // (#2): hàm nhận CHỈ dòng của file — không đọc ảnh chụp `cu` (ô trống ⇒ khoá vắng mặt, không ghi lại cũ).
    expect(dem(NHAP, /\.\.\.cotKetToanCapNhat\(d\)/)).toBe(5);
    expect(dem(NHAP, /cotKetToanCapNhat\(cu\b/)).toBe(0);
    // Giá trị file ghi THẲNG chỉ ở MỘT chỗ — `cotKetToanTao`, dùng ĐÚNG MỘT lần, ở vế `create` (dòng mới).
    expect(dem(NHAP, /maHachToan: d\.maHachToan\b/)).toBe(1);
    expect(dem(NHAP, /phiGiaoDich: d\.phiGiaoDich\b/)).toBe(1);
    expect(dem(NHAP, /trangThaiHoanHuy: d\.trangThaiHoanHuy\b/)).toBe(1);
    expect(doan(NHAP, /function cotKetToanTao\(/, /\n\}\n/)).toMatch(/trangThaiHoanHuy: d\.trangThaiHoanHuy\b/);
    expect(doan(NHAP, /function cotGoc\(/, /\n\}\n/)).not.toMatch(/maHachToan|phiGiaoDich|trangThaiHoanHuy/);
    expect(dem(NHAP, /\.\.\.cotKetToanTao\(d\)/)).toBe(1);
    expect(NHAP).toMatch(/create: \{[^}]*\.\.\.cotKetToanTao\(d\)/);
  });

  it("[POS3-W5] rà đối kháng: tín hiệu hủy ĐÃ LƯU trên chính dòng là đơn điệu; 'Tự khớp' chỉ đếm khi CHÍNH lượt chia tiền", () => {
    // (#1/#5) Dòng CHƯA khoá được phân loại lại với tín hiệu hủy GỘP (file ∪ đã lưu). Mã TRƯỚC bản vá:
    // `phanLoaiDongPos(d, { thietBiDaGan: !!may, ...huy })` — chỉ file + tập hủy của lô.
    expect(dem(NHAP, /\bhuyDaKetLuanTrenDong\(/)).toBe(1);
    expect(doan(NHAP, /function gopHuyDaLuu\(/, /\n\}\n/)).toMatch(/huyDaKetLuanTrenDong\(cu\)/);
    expect(dem(NHAP, /\bgopHuyDaLuu\(huy, cu\)/)).toBe(1);
    // Gộp đứng NGAY trước phép phân loại lại, SAU cổng đã khoá (D7 của dòng đã khoá vẫn đọc file).
    // Việc 3 (09/10/2026): ngữ cảnh phân loại tách thành một biến để CẢ HAI lối (bản gốc · bản xác nhận mã) nhận CÙNG
    // tín hiệu hủy gộp — lý lẽ không đổi: `...huyGop` vào ngữ cảnh NGAY sau khi gộp, và không lối nào bỏ nó.
    expect(NHAP).toMatch(/const huyGop = gopHuyDaLuu\(huy, cu\);\s*const ctxPhanLoai = \{ thietBiDaGan: !!may, \.\.\.huyGop \};/);
    expect(dem(NHAP, /phanLoaiDongPos\(d, ctxPhanLoai\)/), "bản gốc nhận ngữ cảnh gộp").toBe(1);
    expect(dem(NHAP, /phanLoaiDongPosXacNhan\(d, ctxPhanLoai, maXacNhan\)/), "bản xác nhận nhận CÙNG ngữ cảnh gộp").toBe(1);
    const khoa = doan(NHAP, /if \(cu && \(bt \? bt\.status !== "UNMATCHED"/, /const huyGop = /);
    expect(khoa, "nhánh đã khoá đứng trước phép gộp").not.toBe("");
    expect(khoa).not.toMatch(/huyGop/);
    // Provider đọc CÙNG vị từ — hai đường không được hiểu "đã hủy" khác nhau. Gộp GĐ3 × GĐ4 (07/10/2026): thân
    // đọc của `tcb-file.ts` đã DỜI sang `provider/doc-du-lieu.ts` (dùng chung chế độ FILE + AGENT), `tcb-file.ts`
    // chỉ còn gọi nó ⇒ vị từ phải nằm ở đó, và không còn bản chép tay nào của vế "BO_QUA đã hủy".
    const DOC_DL = doc("lib/payments/pos/provider/doc-du-lieu.ts");
    expect(dem(DOC_DL, /\bhuyDaKetLuanTrenDong\(r\) === "TOAN_PHAN"/)).toBe(1);
    expect(dem(DOC_DL, /\bLY_DO_HUY_TOAN_PHAN\b/), "không còn bản chép tay của vị từ").toBe(0);
    const TCB = doc("lib/payments/pos/provider/tcb-file.ts");
    expect(dem(TCB, /return docKetQuaDaDongBo\(intent, now, \{ cheDo: "FILE" \}\);/)).toBe(1);

    // (#3) Mã TRƯỚC bản vá: `if (ketLuan.trangThai === "TU_KHOP") kq.tuKhop += 1;` — đếm cả giao dịch đã vào
    // sổ TRƯỚC lượt (ca biên, TRUNG, hoàn một phần sau khi MATCHED).
    expect(dem(NHAP, /kq\.tuKhop \+= 1/)).toBe(1);
    expect(NHAP).toMatch(/if \(ketLuan\.tien\?\.loai === "DA_CHIA"\) kq\.tuKhop \+= 1;/);
  });

  it("[POS3-W2] số đếm + soLoXong ghi trong MỘT updateMany có điều kiện soLoXong < lo; soDong sau khử trùng", () => {
    // Mã TRƯỚC bản vá: `db.posImportBatch.update({ where: { id }, data: { soDong: { increment:
    // input.dong.length }, … } })` không điều kiện ⇒ lô gửi lại (trả lời mất) cộng lần hai.
    expect(dem(NHAP, /\.posImportBatch\.update\(/)).toBe(0);
    expect(dem(NHAP, /\.posImportBatch\.updateMany\(/)).toBe(1);
    const cau = doan(NHAP, /\.posImportBatch\.updateMany\(/, /\}\);/);
    expect(cau).toMatch(/where:\s*\{\s*id:\s*input\.batchId,\s*soLoXong:\s*\{\s*lt:\s*input\.lo\s*\}\s*\}/);
    expect(cau).toMatch(/soLoXong:\s*input\.lo,/);
    expect(cau).toMatch(/soDong:\s*\{\s*increment:\s*dong\.length\s*\}/);
    expect(dem(NHAP, /input\.dong\.length/)).toBe(0);
    // `lo` là tham số BẮT BUỘC của lô FILE (luật 7 — tsc liệt kê chỗ gọi). Gộp GĐ3 × GĐ4 (07/10/2026): `nhapLoPos`
    // có HAI chữ ký — lô FILE (`DauVaoLoFile`, mang `lo`) ⇒ `KetQuaNhapLo`; lô AGENT không có lượt nào để đếm.
    expect(doan(NHAP, /type DauVaoLoFile = \{/, /\n\};/)).toMatch(/\n\s+lo: number;/);
    expect(dem(NHAP, /export function nhapLoPos\(input: DauVaoLoFile\): Promise<KetQuaNhapLo>;/)).toBe(1);
    // Rà đối kháng GĐ3 (#4): sau câu đếm, kết quả mang SỐ ĐẾM CỦA LƯỢT đọc lại từ DB (màn hiện số này).
    const sauDem = doan(NHAP, /\.posImportBatch\.updateMany\(/, /\n\}\n/);
    expect(sauDem).toMatch(/\.posImportBatch\.findUniqueOrThrow\(/);
    expect(sauDem).toMatch(/return \{\s*\.\.\.kq,\s*soDemLuot:/);
  });

  it("[POS3-W3] action: không còn danhDauLoXong; dòng parse bằng dongPosNhapSchema; audit lệch ở CẢ HAI action nhập", () => {
    expect(dem(ACTION, /\bdanhDauLoXong\b/)).toBe(0);
    expect(dem(ACTION, /data: \{ soLoXong/), "action không tự ghi soLoXong").toBe(0);
    // Neo vào LUẬT (mảng dòng của lô parse bằng schema nào), không vào chỗ xuống dòng của biểu thức.
    expect(dem(ACTION, /\bz\s*\.array\(\s*dongPosNhapSchema\s*\)/)).toBe(1);
    expect(dem(ACTION, /\bz\s*\.array\(\s*dongPosSchema\s*\)/)).toBe(0);
    expect(dem(ACTION, /\bdongPosSchema\b/), "action không còn dùng schema lỏng").toBe(0);
    expect(dem(ACTION, /action: "POS_IMPORT_LECH_DA_GHI_NHAN"/)).toBe(2);
    const batDau = ACTION.match(/export async function batDauNhapPosAction[\s\S]*?\n\}\n/)?.[0] ?? "";
    const nhapLo = ACTION.match(/export async function nhapLoPosAction[\s\S]*?\n\}\n/)?.[0] ?? "";
    for (const [ten, than] of [
      ["batDau", batDau],
      ["nhapLo", nhapLo],
    ] as const) {
      expect(than, ten).not.toBe("");
      expect(dem(than, /\bwriteAudit\(/), `${ten}: một lời ghi audit`).toBe(1);
      expect(dem(than, /action: "POS_IMPORT_LECH_DA_GHI_NHAN"/), ten).toBe(1);
      expect(dem(than, /entityType: "PosImportBatch"/), ten).toBe(1);
    }
    expect(batDau).toMatch(/nhapLoPos\(\{[^}]*\blo: 1,/);
    expect(nhapLo).toMatch(/nhapLoPos\(\{[^}]*\blo: parsed\.data\.lo,/);
  });

  it("[POS3-W4] tầng đọc file kiểm dòng bằng CÙNG hợp đồng với server (dongPosNhapSchema)", () => {
    expect(dem(DOC_FILE, /\bdongPosNhapSchema\.safeParse\(/)).toBe(1);
    expect(dem(DOC_FILE, /\bdongPosSchema\.safeParse\(/)).toBe(0);
  });
});
