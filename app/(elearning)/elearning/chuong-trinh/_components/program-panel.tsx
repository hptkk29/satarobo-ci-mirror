"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  taoPhieuNhuCauAction,
  duyetPhieuNhuCauAction,
  taoChuongTrinhAction,
  taoKhoaAction,
} from "../_actions";

/**
 * EL-08 — khối thao tác của màn chương trình.
 *
 * ⚠️ Ba việc trên một màn là CÓ CHỦ ĐÍCH, không phải nhồi nhét: đề nghị → lập
 * chương trình → tạo khoá là một mạch, và cổng nghiệm thu đo bằng ĐỒNG HỒ (≤60
 * phút cho trọn một khoá). Bắt người soạn nhảy qua ba trang riêng cho ba bước
 * liền nhau là tự bỏ thời gian vào chỗ không tạo ra gì.
 *
 * ⚠️ Sáu nhóm thẻ đều là trường BẮT BUỘC. Cho phép bỏ trống rồi "điền sau" nghe
 * tử tế, nhưng chương trình thiếu thẻ thì không lọt vào bộ lọc nào, và nó biến
 * mất khỏi ma trận đào tạo mà không ai để ý.
 */

type Muc = { id: string; nhan: string };

const CHUC_NANG = [
  ["SALE", "Kinh doanh"],
  ["TEACHING", "Giảng dạy"],
  ["MARKETING", "Marketing"],
  ["HR", "Nhân sự"],
  ["ACCOUNTING", "Kế toán"],
  ["OPERATION", "Vận hành"],
  ["COMPANY_WIDE", "Toàn công ty"],
] as const;

const BAC = ["L1", "L2", "L3", "L4"] as const;

const TINH_CHAT = [
  ["MANDATORY", "Bắt buộc"],
  ["MANDATORY_COMPLIANCE", "Bắt buộc (tuân thủ)"],
  ["RECOMMENDED", "Khuyến nghị"],
  ["OPTIONAL", "Tự chọn"],
] as const;

const HINH_THUC = [
  ["ELEARNING", "Trực tuyến"],
  ["OFFLINE", "Trực tiếp"],
  ["BLENDED", "Kết hợp"],
  ["OJT", "Kèm tại chỗ"],
  ["COACHING", "Kèm 1:1"],
  ["WEBINAR", "Hội thảo trực tuyến"],
] as const;

const BAO_MAT = [
  ["PUBLIC", "Công khai"],
  ["INTERNAL", "Nội bộ"],
  ["RESTRICTED", "Hạn chế"],
  ["CONFIDENTIAL", "Mật"],
] as const;

export function ProgramPanel(props: {
  quanLy: boolean;
  phieuDaDuyet: Muc[];
  chuongTrinh: Muc[];
}) {
  const [dangChay, chuyen] = useTransition();
  const [mo, setMo] = useState<"PHIEU" | "CHUONG_TRINH" | "KHOA" | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Nut onClick={() => setMo(mo === "PHIEU" ? null : "PHIEU")}>
          Đề nghị đào tạo
        </Nut>
        {props.quanLy && (
          <>
            <Nut onClick={() => setMo(mo === "CHUONG_TRINH" ? null : "CHUONG_TRINH")}>
              Lập chương trình
            </Nut>
            <Nut onClick={() => setMo(mo === "KHOA" ? null : "KHOA")}>Tạo khoá</Nut>
          </>
        )}
      </div>

      {mo === "PHIEU" && <FormPhieu dangChay={dangChay} chuyen={chuyen} />}
      {mo === "CHUONG_TRINH" && (
        <FormChuongTrinh
          dangChay={dangChay}
          chuyen={chuyen}
          phieuDaDuyet={props.phieuDaDuyet}
        />
      )}
      {mo === "KHOA" && (
        <FormKhoa dangChay={dangChay} chuyen={chuyen} chuongTrinh={props.chuongTrinh} />
      )}

      {props.quanLy && <DuyetPhieu dangChay={dangChay} chuyen={chuyen} />}
    </div>
  );
}

type ChayProps = { dangChay: boolean; chuyen: (fn: () => void) => void };

function FormPhieu({ dangChay, chuyen }: ChayProps) {
  const [f, setF] = useState({
    title: "",
    targetGroupText: "",
    reason: "",
    expectedOutcome: "",
    proposedQuarter: `${new Date().getFullYear()}-Q1`,
  });

  const gui = () =>
    chuyen(async () => {
      const r = await taoPhieuNhuCauAction(f);
      if (r.ok) {
        toast.success(`Đã gửi phiếu ${(r.data as { code: string }).code}`);
        setF({ ...f, title: "", reason: "", expectedOutcome: "" });
      } else toast.error(r.error.message);
    });

  return (
    <Khung tieuDe="Phiếu nhu cầu đào tạo">
      <O nhan="Nhu cầu là gì" giaTri={f.title} doi={(v) => setF({ ...f, title: v })} />
      <O
        nhan="Đối tượng cần đào tạo"
        giaTri={f.targetGroupText}
        doi={(v) => setF({ ...f, targetGroupText: v })}
        ghiChu="Mô tả bằng lời — chưa cần luật lọc."
      />
      <O
        nhan="Lý do"
        giaTri={f.reason}
        doi={(v) => setF({ ...f, reason: v })}
        nhieuDong
      />
      <O
        nhan="Kết quả mong đợi"
        giaTri={f.expectedOutcome}
        doi={(v) => setF({ ...f, expectedOutcome: v })}
        nhieuDong
      />
      <O
        nhan="Quý dự kiến"
        giaTri={f.proposedQuarter}
        doi={(v) => setF({ ...f, proposedQuarter: v })}
        ghiChu="Dạng 2026-Q3."
      />
      <Nut chinh onClick={gui} disabled={dangChay}>
        {dangChay ? "Đang gửi…" : "Gửi phiếu"}
      </Nut>
    </Khung>
  );
}

function DuyetPhieu({ dangChay, chuyen }: ChayProps) {
  const [id, setId] = useState("");
  const [lyDo, setLyDo] = useState("");

  const duyet = () =>
    chuyen(async () => {
      const r = await duyetPhieuNhuCauAction({ needId: id.trim() }, { reason: lyDo.trim() });
      if (r.ok) {
        toast.success("Đã duyệt phiếu");
        setId("");
        setLyDo("");
      } else toast.error(r.error.message);
    });

  return (
    <Khung tieuDe="Duyệt phiếu nhu cầu">
      <O nhan="Mã phiếu (id)" giaTri={id} doi={setId} />
      <O
        nhan="Lý do duyệt"
        giaTri={lyDo}
        doi={setLyDo}
        ghiChu="Bắt buộc — người đọc sau cần biết vì sao phiếu này được duyệt."
      />
      <Nut chinh onClick={duyet} disabled={dangChay || !id.trim() || !lyDo.trim()}>
        Duyệt
      </Nut>
    </Khung>
  );
}

function FormChuongTrinh({
  dangChay,
  chuyen,
  phieuDaDuyet,
}: ChayProps & { phieuDaDuyet: Muc[] }) {
  const [f, setF] = useState({
    title: "",
    objectives: ["", "", ""],
    primaryFunctionTag: "COMPANY_WIDE",
    functionTags: ["COMPANY_WIDE"] as string[],
    levelTags: ["L1"] as string[],
    stageTag: "IN_SERVICE",
    durationTag: "S",
    natureTag: "RECOMMENDED",
    formatTag: "ELEARNING",
    securityTag: "INTERNAL",
    needId: "",
    needExemptReason: "",
    contentOwnerUserId: "",
    validityMonths: "",
  });

  const gui = () =>
    chuyen(async () => {
      const r = await taoChuongTrinhAction({
        title: f.title,
        objectives: f.objectives.map((x) => x.trim()).filter(Boolean),
        primaryFunctionTag: f.primaryFunctionTag,
        functionTags: f.functionTags,
        levelTags: f.levelTags,
        stageTag: f.stageTag,
        durationTag: f.durationTag,
        natureTag: f.natureTag,
        formatTag: f.formatTag,
        securityTag: f.securityTag,
        needId: f.needId || null,
        needExemptReason: f.needId ? null : f.needExemptReason || null,
        contentOwnerUserId: f.contentOwnerUserId,
        validityMonths: f.validityMonths ? Number(f.validityMonths) : null,
      });
      if (r.ok) toast.success(`Đã lập chương trình ${(r.data as { code: string }).code}`);
      else toast.error(r.error.message);
    });

  return (
    <Khung tieuDe="Lập chương trình đào tạo">
      <O nhan="Tên chương trình" giaTri={f.title} doi={(v) => setF({ ...f, title: v })} />

      <fieldset className="rounded-lg border border-border p-2">
        <legend className="px-1 text-xs font-medium">Mục tiêu hành vi (3–5)</legend>
        {f.objectives.map((o, i) => (
          <input
            key={i}
            value={o}
            onChange={(e) => {
              const ds = [...f.objectives];
              ds[i] = e.target.value;
              setF({ ...f, objectives: ds });
            }}
            placeholder={`Mục tiêu ${i + 1}`}
            className="mt-1 w-full rounded border border-border px-2 py-1 text-sm"
          />
        ))}
        {f.objectives.length < 5 && (
          <button
            type="button"
            onClick={() => setF({ ...f, objectives: [...f.objectives, ""] })}
            className="mt-1 text-xs underline"
          >
            + Thêm mục tiêu
          </button>
        )}
      </fieldset>

      <div className="grid gap-2 md:grid-cols-2">
        <Chon
          nhan="Chức năng chính"
          ds={CHUC_NANG}
          giaTri={f.primaryFunctionTag}
          doi={(v) =>
            setF({
              ...f,
              primaryFunctionTag: v,
              // Chức năng chính phải nằm trong tập chức năng — máy chủ chặn nếu
              // lệch, nên tự thêm vào đây thay vì để người dùng gặp lỗi.
              functionTags: f.functionTags.includes(v) ? f.functionTags : [...f.functionTags, v],
            })
          }
        />
        <Chon
          nhan="Giai đoạn"
          ds={[
            ["NEW_HIRE", "Người mới (<60 ngày)"],
            ["IN_SERVICE", "Đang công tác"],
          ]}
          giaTri={f.stageTag}
          doi={(v) => setF({ ...f, stageTag: v })}
        />
        <Chon
          nhan="Độ dài"
          ds={[
            ["S", "Ngắn"],
            ["M", "Vừa"],
            ["LG", "Dài"],
          ]}
          giaTri={f.durationTag}
          doi={(v) => setF({ ...f, durationTag: v })}
        />
        <Chon
          nhan="Tính chất"
          ds={TINH_CHAT}
          giaTri={f.natureTag}
          doi={(v) => setF({ ...f, natureTag: v })}
        />
        <Chon
          nhan="Hình thức"
          ds={HINH_THUC}
          giaTri={f.formatTag}
          doi={(v) => setF({ ...f, formatTag: v })}
        />
        <Chon
          nhan="Mức bảo mật"
          ds={BAO_MAT}
          giaTri={f.securityTag}
          doi={(v) => setF({ ...f, securityTag: v })}
          ghiChu="Từ Hạn chế trở lên sẽ bật hình mờ động và cấm tải tệp."
        />
      </div>

      <NhieuChon
        nhan="Bậc công việc"
        ds={BAC.map((b) => [b, b] as const)}
        chon={f.levelTags}
        doi={(v) => setF({ ...f, levelTags: v })}
      />

      {f.natureTag === "MANDATORY_COMPLIANCE" && (
        <O
          nhan="Số tháng hiệu lực"
          giaTri={f.validityMonths}
          doi={(v) => setF({ ...f, validityMonths: v.replace(/\D/g, "") })}
          ghiChu="Khoá tuân thủ bắt buộc có hạn tái chứng nhận."
        />
      )}

      <O
        nhan="Người chịu trách nhiệm nội dung (userId)"
        giaTri={f.contentOwnerUserId}
        doi={(v) => setF({ ...f, contentOwnerUserId: v })}
      />

      <label className="block text-sm">
        Phiếu nhu cầu
        <select
          value={f.needId}
          onChange={(e) => setF({ ...f, needId: e.target.value })}
          className="mt-1 w-full rounded-lg border border-border px-3 py-2"
        >
          <option value="">— không gắn phiếu —</option>
          {phieuDaDuyet.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nhan}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-xs text-muted-foreground">
          Chỉ hiện phiếu ĐÃ DUYỆT. Không có phiếu thì phải ghi lý do miễn bên dưới.
        </span>
      </label>

      {!f.needId && (
        <O
          nhan="Lý do miễn phiếu"
          giaTri={f.needExemptReason}
          doi={(v) => setF({ ...f, needExemptReason: v })}
          ghiChu="Ít nhất 10 ký tự — đây là đường thoát duy nhất của luật §8.1."
        />
      )}

      <Nut chinh onClick={gui} disabled={dangChay || !f.title.trim()}>
        {dangChay ? "Đang lập…" : "Lập chương trình"}
      </Nut>
    </Khung>
  );
}

function FormKhoa({
  dangChay,
  chuyen,
  chuongTrinh,
}: ChayProps & { chuongTrinh: Muc[] }) {
  const [programId, setProgramId] = useState("");
  const [title, setTitle] = useState("");

  const gui = () =>
    chuyen(async () => {
      const r = await taoKhoaAction({ programId, title });
      if (r.ok) {
        const d = r.data as { courseId: string; code: string };
        toast.success(`Đã tạo khoá ${d.code}`);
        window.location.href = `/elearning/soan-khoa/${d.courseId}`;
      } else toast.error(r.error.message);
    });

  return (
    <Khung tieuDe="Tạo khoá học">
      <label className="block text-sm">
        Thuộc chương trình
        <select
          value={programId}
          onChange={(e) => setProgramId(e.target.value)}
          className="mt-1 w-full rounded-lg border border-border px-3 py-2"
        >
          <option value="">— chọn chương trình —</option>
          {chuongTrinh.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nhan}
            </option>
          ))}
        </select>
      </label>
      <O nhan="Tên khoá" giaTri={title} doi={setTitle} />
      <Nut chinh onClick={gui} disabled={dangChay || !programId || !title.trim()}>
        {dangChay ? "Đang tạo…" : "Tạo và mở màn soạn"}
      </Nut>
    </Khung>
  );
}

// ── Mảnh dùng lại ──────────────────────────────────────────────────────────

function Khung(props: { tieuDe: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 rounded-xl border border-border p-4">
      <h3 className="text-sm font-semibold">{props.tieuDe}</h3>
      {props.children}
    </section>
  );
}

function Nut(props: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  chinh?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      className={
        props.chinh
          ? "rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          : "rounded-lg border border-border px-3 py-1.5 text-sm"
      }
    >
      {props.children}
    </button>
  );
}

function O(props: {
  nhan: string;
  giaTri: string;
  doi: (v: string) => void;
  ghiChu?: string;
  nhieuDong?: boolean;
}) {
  return (
    <label className="block text-sm">
      {props.nhan}
      {props.nhieuDong ? (
        <textarea
          value={props.giaTri}
          onChange={(e) => props.doi(e.target.value)}
          className="mt-1 min-h-20 w-full rounded-lg border border-border px-3 py-2"
        />
      ) : (
        <input
          value={props.giaTri}
          onChange={(e) => props.doi(e.target.value)}
          className="mt-1 w-full rounded-lg border border-border px-3 py-2"
        />
      )}
      {props.ghiChu && (
        <span className="mt-1 block text-xs text-muted-foreground">{props.ghiChu}</span>
      )}
    </label>
  );
}

function Chon(props: {
  nhan: string;
  ds: readonly (readonly [string, string])[];
  giaTri: string;
  doi: (v: string) => void;
  ghiChu?: string;
}) {
  return (
    <label className="block text-sm">
      {props.nhan}
      <select
        value={props.giaTri}
        onChange={(e) => props.doi(e.target.value)}
        className="mt-1 w-full rounded-lg border border-border px-3 py-2"
      >
        {props.ds.map(([v, n]) => (
          <option key={v} value={v}>
            {n}
          </option>
        ))}
      </select>
      {props.ghiChu && (
        <span className="mt-1 block text-xs text-muted-foreground">{props.ghiChu}</span>
      )}
    </label>
  );
}

function NhieuChon(props: {
  nhan: string;
  ds: readonly (readonly [string, string])[];
  chon: string[];
  doi: (v: string[]) => void;
}) {
  return (
    <fieldset className="rounded-lg border border-border p-2">
      <legend className="px-1 text-xs font-medium">{props.nhan}</legend>
      <div className="flex flex-wrap gap-3">
        {props.ds.map(([v, n]) => (
          <label key={v} className="flex items-center gap-1 text-sm">
            <input
              type="checkbox"
              checked={props.chon.includes(v)}
              onChange={(e) =>
                props.doi(
                  e.target.checked
                    ? [...props.chon, v]
                    : props.chon.filter((x) => x !== v),
                )
              }
            />
            {n}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
