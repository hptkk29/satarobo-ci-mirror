"use client";

// Bảng thống kê case trải nghiệm theo Sale — phần TƯƠNG TÁC.
//
// ── VÌ SAO BUNG RA TRONG BẢNG, KHÔNG PHẢI MODAL ──────────────────────────────────────
// Người dùng đang so sánh các Sale với nhau. Modal che mất đúng thứ họ đang so, và trên
// điện thoại thì nó chiếm cả màn. Dòng bung ra ngay dưới Sale vừa bấm giữ nguyên ngữ
// cảnh, cuộn được, và không có chuyện overlay bị cắt bởi `overflow` của bảng.
//
// ── CON SỐ VÀ DANH SÁCH DÙNG CHUNG MỘT VỊ TỪ ────────────────────────────────────────
// `caseCuaO` lọc từ CHÍNH mảng đã dựng nên con số (`lib/reports/trial-sale.ts`). Bấm vào
// số 7 thì thấy đúng 7 dòng — và đó là thứ ca [TKS-05] khoá lại.

import type { JSX } from "react";
import { useState } from "react";
import Link from "next/link";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import {
  caseCuaO,
  dongTong,
  gomTheoSale,
  nhanTyLe,
  NHAN_CHI_TIEU,
  type CaseTrial,
  type DongSale,
  type MaChiTieu,
} from "@/lib/reports/trial-sale";

/** Thứ tự cột — cũng là thứ tự khi xuất Excel. */
const COT: MaChiTieu[] = ["tong", "dangCho", "hoanThanh", "vang", "huy", "chot", "imLang"];

function ngayVN(s: string | null): string {
  if (!s) return "—";
  const [y, m, d] = s.split("-");
  return y && m && d ? `${d}/${m}/${y}` : s;
}

export function BangSale({
  cases,
  xuatDuoc,
}: {
  cases: CaseTrial[];
  /**
   * Cờ "được TẢI VỀ" — phân quyền ở Cấu hình vận hành → Quyền xuất dữ liệu.
   * Khác quyền XEM: người xem được trang vẫn thấy số trên màn, chỉ không lấy được tệp.
   */
  xuatDuoc: boolean;
}): JSX.Element {
  const dong = gomTheoSale(cases);
  const tong = dongTong(cases);
  // Ô đang mở: một cặp (Sale, chỉ tiêu). Chỉ MỘT ô mở tại một thời điểm — mở nhiều dòng
  // chi tiết cùng lúc là đẩy bảng dài ra và làm mất đúng cái so sánh người dùng đang làm.
  const [oMo, setOMo] = useState<{ saleId: string | null; ma: MaChiTieu } | null>(null);

  function bam(saleId: string | null, ma: MaChiTieu, so: number) {
    if (so === 0) return; // không mở một danh sách rỗng — nút phải nói thật
    setOMo((cu) => (cu && cu.saleId === saleId && cu.ma === ma ? null : { saleId, ma }));
  }

  function xuatExcel() {
    // Dựng CSV rồi để trình duyệt tải — KHÔNG kéo thêm thư viện: `xlsx` là dependency của
    // đường IMPORT ở server, nhét nó vào bundle client chỉ để xuất một bảng 9 cột là trả
    // giá bằng ngân sách hiệu năng của màn admin.
    const dau = ["Sale", ...COT.map((c) => NHAN_CHI_TIEU[c]), "Tỷ lệ thành công"];
    const than = [...dong, tong].map((d) => [
      d.saleName,
      ...COT.map((c) => String(d.so[c])),
      nhanTyLe(d.tyLe),
    ]);
    const o = (v: string) => `"${v.replace(/"/g, '""')}"`;
    // BOM để Excel bản tiếng Việt mở ra không vỡ dấu.
    const csv = "﻿" + [dau, ...than].map((h) => h.map(o).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `thong-ke-case-trial.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (dong.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center">
        <p className="text-sm font-medium text-foreground">
          Không có case trải nghiệm nào trong khoảng đã chọn
        </p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          Bộ lọc đang tính theo <strong>ngày tạo case</strong>. Nới khoảng ngày, hoặc đổi
          cơ sở — nếu vẫn trống thì kỳ này chưa ai xếp khách vào lớp trải nghiệm.
        </p>
        <Link
          href="/lop-trial"
          className="mt-4 inline-flex rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          Mở màn Lớp trải nghiệm
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end empty:hidden">
        {xuatDuoc && (
        <button
          type="button"
          onClick={xuatExcel}
          className="rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          Xuất Excel
        </button>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="whitespace-nowrap px-5 py-3.5 font-semibold">Sale</th>
                {COT.map((c) => (
                  <th key={c} className="whitespace-nowrap px-5 py-3.5 text-right font-semibold">
                    {NHAN_CHI_TIEU[c]}
                  </th>
                ))}
                <th className="whitespace-nowrap px-5 py-3.5 text-right font-semibold">
                  Tỷ lệ thành công
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {dong.map((d) => (
                <DongVaChiTiet
                  key={d.saleId ?? "(vo-danh)"}
                  d={d}
                  cases={cases}
                  oMo={oMo}
                  bam={bam}
                />
              ))}
              <tr className="border-t-2 border-border bg-muted font-semibold">
                <td className="whitespace-nowrap px-5 py-3.5 text-foreground">{tong.saleName}</td>
                {COT.map((c) => (
                  <td
                    key={c}
                    className="whitespace-nowrap px-5 py-3.5 text-right tabular-nums text-foreground"
                  >
                    {tong.so[c]}
                  </td>
                ))}
                <td className="whitespace-nowrap px-5 py-3.5 text-right tabular-nums text-foreground">
                  {nhanTyLe(tong.tyLe)}
                  <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                    {tong.so.chot}/{tong.so.hoanThanh}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        <strong>Tỷ lệ thành công</strong> = chốt ÷ hoàn thành (case huỷ và case đang chờ
        không tính vào mẫu số). <strong>Im lặng</strong> = học xong mà chưa chốt.{" "}
        <strong>Vắng</strong> = đã điểm danh và không có mặt buổi nào. Bấm vào bất kỳ con
        số nào để xem danh sách case.
      </p>
    </div>
  );
}

function DongVaChiTiet({
  d,
  cases,
  oMo,
  bam,
}: {
  d: DongSale;
  cases: CaseTrial[];
  oMo: { saleId: string | null; ma: MaChiTieu } | null;
  bam: (saleId: string | null, ma: MaChiTieu, so: number) => void;
}): JSX.Element {
  const dangMo = oMo && oMo.saleId === d.saleId ? oMo.ma : null;
  const chiTiet = dangMo ? caseCuaO(cases, d.saleId, dangMo) : [];

  return (
    <>
      <tr className="transition-colors hover:bg-muted">
        <td className="whitespace-nowrap px-5 py-3.5 font-medium text-foreground">{d.saleName}</td>
        {COT.map((c) => {
          const so = d.so[c];
          const mo = dangMo === c;
          return (
            <td key={c} className="whitespace-nowrap px-5 py-3.5 text-right tabular-nums">
              {so === 0 ? (
                // Số 0 KHÔNG bấm được: một nút mở ra danh sách rỗng là nút hứa suông.
                <span className="text-muted-foreground">0</span>
              ) : (
                <button
                  type="button"
                  onClick={() => bam(d.saleId, c, so)}
                  aria-expanded={mo}
                  className={`rounded px-1.5 py-0.5 tabular-nums transition-colors hover:bg-primary-soft hover:text-primary-ink ${
                    mo ? "bg-primary-soft font-semibold text-primary-ink" : "text-foreground"
                  }`}
                  title={`Xem ${so} case — ${NHAN_CHI_TIEU[c]}`}
                >
                  {so}
                </button>
              )}
            </td>
          );
        })}
        <td className="whitespace-nowrap px-5 py-3.5 text-right tabular-nums text-foreground">
          {nhanTyLe(d.tyLe)}
          {/* In cả phân số: không ai phải đoán mẫu số đang là gì. */}
          <span className="ml-1 text-[11px] text-muted-foreground">
            {d.so.chot}/{d.so.hoanThanh}
          </span>
        </td>
      </tr>

      {dangMo && (
        <tr>
          <td colSpan={COT.length + 2} className="bg-muted px-5 py-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {NHAN_CHI_TIEU[dangMo]} · {d.saleName} · {chiTiet.length} case
            </p>
            {/* Bảng chi tiết CÓ phân trang: một Sale một tháng có thể vài trăm case, đổ hết
                vào một dòng bung ra là đẩy bảng chính xuống ngoài màn hình. */}
            {/* 23/09 — thanh phân trang LUÔN hiện (kể cả vài case) và đứng NGOÀI vùng cuộn
                ngang (`cuonNgang`): bản trước bọc cả bảng lẫn thanh trong `overflow-x-auto`
                nên kéo ngang là thanh trôi mất, và ≤10 case thì thanh ẩn hẳn — chủ dự án
                đọc thành "chưa có phân trang". Viền bằng `ring` trên chính bảng: không có
                thẻ nào vừa cuộn vừa bo góc (cổng `bang-coverage`). */}
            <PhanTrangBang
              khoaGhiNho="tk-case-trial-chi-tiet"
              tenDonVi="case"
              cuonNgang
              luonHienThanh
              // 10 dòng/trang: bảng này nằm TRONG một dòng bung ra — dài quá là đẩy bảng
              // chính ra khỏi màn hình. Người dùng vẫn đổi được (ghi nhớ theo `khoaGhiNho`).
              soDongMacDinh={10}
            >
              <table className="w-full rounded-lg bg-card text-sm ring-1 ring-border">
                <thead className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="whitespace-nowrap px-4 py-2.5 font-semibold">Học viên</th>
                    <th className="whitespace-nowrap px-4 py-2.5 font-semibold">Phụ huynh</th>
                    <th className="whitespace-nowrap px-4 py-2.5 font-semibold">Lớp trải nghiệm</th>
                    <th className="whitespace-nowrap px-4 py-2.5 font-semibold">Ngày</th>
                    <th className="whitespace-nowrap px-4 py-2.5 font-semibold">Giáo viên</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {chiTiet.map((c) => (
                    <tr key={c.id} className="transition-colors hover:bg-muted">
                      <td className="whitespace-nowrap px-4 py-2.5 text-foreground">{c.tenCon}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">
                        {c.tenPhuHuynh ?? "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5">
                        {c.trialClassId ? (
                          <Link
                            href={`/lop-trial/${c.trialClassId}`}
                            className="text-primary transition-colors hover:underline"
                          >
                            {c.tenLop}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">{c.tenLop}</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">
                        {ngayVN(c.ngayLop)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">
                        {c.tenGiaoVien ?? "chưa xếp"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </PhanTrangBang>
          </td>
        </tr>
      )}
    </>
  );
}
