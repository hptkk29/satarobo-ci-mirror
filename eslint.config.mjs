import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactPlugin from 'eslint-plugin-react'
import reactHooksPlugin from 'eslint-plugin-react-hooks'
import { DB_IMPORT_ALLOWLIST } from './lib/eslint/db-import-allowlist.mjs'
import { INLINE_AUTHZ_ALLOWLIST } from './lib/eslint/inline-authz-allowlist.mjs'
import inlineAuthzPlugin from './lib/eslint/require-can-in-write-action.mjs'
import noBareNextResponsePlugin from './lib/eslint/no-bare-next-response.mjs'
import requireNowPlugin from './lib/eslint/require-now-in-tests.mjs'

// R6-F1 — chặn import @/lib/db TRẦN trong route group admin/portal (nơi cần cách ly
// cơ sở). Code mới PHẢI đi qua scopedDb(actor) (cổng an toàn dữ liệu, A0-04/D1).
// Public pages = read toàn cục (không có scope) → KHÔNG áp rule. API cron/webhook
// dùng SYSTEM_ACTOR + scopedDb(actor,{bypass:true}).
const dbBlockedImports = {
  patterns: [
    {
      group: ['@/lib/db'],
      message:
        '❌ R6-F1: KHÔNG import @/lib/db trần trong admin/portal. Dùng scopedDb(actor) ' +
        '(cách ly cơ sở) — vd `const sdb = scopedDb(await resolveActor(session.user.id))`. ' +
        'Cron/webhook: SYSTEM_ACTOR + scopedDb(actor,{bypass:true}).',
    },
  ],
}

// Patterns chặn import sai giữa Admin và Client sites (Phase 4.X.1).
const adminBlockedImports = {
  patterns: [
    {
      group: ['@/components/magic/*', '@/components/magic'],
      message:
        '❌ Magic UI chỉ dùng cho CLIENT site. Admin dùng shadcn/ui + Recharts.',
    },
    {
      group: ['@/components/motion/*', '@/components/motion'],
      message:
        '❌ Motion wrappers chỉ cho CLIENT site. Admin dùng CSS transitions Tailwind hoặc shadcn defaults.',
    },
    {
      group: ['framer-motion', 'framer-motion/*', 'motion', 'motion/*'],
      message:
        '❌ Framer Motion / Motion KHÔNG import trực tiếp ở admin. Dùng Tailwind transitions (transition-colors, transition-all).',
    },
  ],
}

const clientBlockedImports = {
  patterns: [
    {
      group: ['@/components/charts/*', '@/components/charts'],
      message:
        '❌ Recharts wrappers chỉ cho ADMIN site. Client cần visualization → dùng SVG đơn giản hoặc Magic UI.',
    },
    {
      group: ['recharts', 'recharts/*'],
      message:
        '❌ Recharts là admin-only library. Không import ở client site.',
    },
  ],
}

// TS-03 (US-02 AC5) — no-inline-authz tầng (a): cấm KIỂM QUYỀN inline trong action
// files. Mọi kiểm tra quyền đi qua can(actor, permissionKey, target) — lib/permissions/can.
// Escape hatch: so sánh DATA hợp lệ (không phải kiểm quyền) → eslint-disable-next-line
// no-restricted-syntax kèm lý do tại chỗ.
const noInlineAuthzSelectors = [
  {
    selector:
      'CallExpression:matches([callee.name=/^(hasRole|isParentOnly|getEffectiveRoles)$/], [callee.property.name=/^(hasRole|isParentOnly|getEffectiveRoles)$/])',
    message:
      '❌ no-inline-authz (TS-03): không gọi hasRole()/isParentOnly()/getEffectiveRoles() trong Server Action — ' +
      'kiểm quyền đi qua can(actor, permissionKey, target) từ lib/permissions/can (fallback đường cũ nằm TRONG can()).',
  },
  {
    selector:
      'CallExpression[callee.property.name="includes"]:matches([callee.object.property.name="roles"], [callee.object.name="roles"])',
    message:
      '❌ no-inline-authz (TS-03): không kiểm quyền bằng .roles.includes(...) — ' +
      'dùng can(actor, permissionKey, target) từ lib/permissions/can.',
  },
  // 2 selector dưới loại trừ so sánh với undefined/null (cả 2 chiều) — đó là guard
  // partial-update (`data.centerId !== undefined`) / change-detection, KHÔNG phải kiểm quyền
  // (review đối kháng 09/08). PHẢI dùng regex `[*.name=/^undefined$/]` chứ KHÔNG dùng
  // `[*.name="undefined"]`: esquery so sánh literal bằng template-string nên thuộc tính
  // KHÔNG TỒN TẠI (undefined) cũng stringify thành "undefined" → :not giết nhầm mọi
  // BinaryExpression có vế không phải Identifier; regex đòi typeof === 'string' nên an toàn.
  // `[*.raw=/^null$/]` chỉ khớp Literal null (string 'null' có raw kèm nháy nên không dính).
  {
    selector:
      'BinaryExpression[operator=/^(===|!==)$/]:matches([left.property.name="role"], [right.property.name="role"], [left.expression.property.name="role"], [right.expression.property.name="role"])' +
      ':not([left.name=/^undefined$/]):not([right.name=/^undefined$/]):not([left.raw=/^null$/]):not([right.raw=/^null$/])',
    message:
      '❌ no-inline-authz (TS-03): không so sánh .role ===/!== trong Server Action — ' +
      'dùng can(actor, permissionKey, target) từ lib/permissions/can. Nếu đây là so sánh DATA hợp lệ ' +
      '(không phải kiểm quyền): eslint-disable-next-line no-restricted-syntax kèm lý do.',
  },
  {
    selector:
      'BinaryExpression[operator=/^(===|!==)$/]:matches([left.property.name="centerId"], [right.property.name="centerId"], [left.expression.property.name="centerId"], [right.expression.property.name="centerId"])' +
      ':not([left.name=/^undefined$/]):not([right.name=/^undefined$/]):not([left.raw=/^null$/]):not([right.raw=/^null$/])',
    message:
      '❌ no-inline-authz (TS-03): không so sánh .centerId ===/!== để chặn quyền trong Server Action — ' +
      'scope đi qua can(actor, permissionKey, target) từ lib/permissions/can hoặc scopedDb/passesScope. ' +
      'Nếu đây là so sánh DATA hợp lệ (không phải kiểm quyền): eslint-disable-next-line no-restricted-syntax kèm lý do.',
  },
]

// TS-03 — bộ glob scope file Server Action (dùng cho block bật 2 rule dưới; block off
// grandfather cuối file dùng danh sách FILE trong INLINE_AUTHZ_ALLOWLIST — luôn là tập
// con của scope này). Mở rộng 09/08 sau review đối kháng: 2 glob gốc bỏ sót 11 file
// action thật (`_qr-actions.ts`, `_eval-actions.ts`, `_*-approval-actions.ts`,
// `_schedule/_curriculum/_attendance-actions.ts`, logic-core `_qr-core.ts`/
// `_feedback-core.ts`, thư mục `_actions/*.ts`). Đã tự kiểm bằng liệt kê match thật:
// KHÔNG kéo nhầm file client ('use client' = 0 hit trong scope).
const inlineAuthzActionGlobs = [
  'app/**/_actions*.ts', // glob gốc: _actions.ts
  'app/**/actions.ts', // glob gốc: actions.ts
  'app/**/_*actions*.ts', // _eval-actions.ts, _qr-actions.ts, _installment-approval-actions.ts...
  'app/**/_*-core.ts', // _qr-core.ts, _feedback-core.ts — logic THẬT của action tách khỏi "use server"
  'app/**/_actions/**/*.ts', // app/(admin)/admin/_actions/active-role.ts, cron-trigger.ts
]

export default tseslint.config(
  { ignores: ['.next/**', 'node_modules/**', 'prisma/migrations/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-empty': ['error', { allowEmptyCatch: false }],
    },
  },

  // Admin components (ngoài route group app) — chặn Magic UI + Framer Motion.
  {
    files: [
      'components/admin/**/*.{ts,tsx}',
      'components/design-system/admin/**/*.{ts,tsx}',
      // CMP-26: charts là admin-only → cũng chặn Magic/Motion (defensive, không vi phạm hiện tại).
      'components/charts/**/*.{ts,tsx}',
    ],
    rules: {
      'no-restricted-imports': ['error', adminBlockedImports],
    },
  },

  // app/(admin)/** — Magic/Motion block + R6-F1 db block (gộp patterns vì
  // no-restricted-imports bị REPLACE giữa các override, không merge).
  {
    files: ['app/(admin)/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [...adminBlockedImports.patterns, ...dbBlockedImports.patterns] },
      ],
    },
  },

  // Client scope — chặn import Recharts
  {
    files: [
      'app/(public)/**/*.{ts,tsx}',
      'app/(auth)/**/*.{ts,tsx}',
      'components/public/**/*.{ts,tsx}',
      'components/honors/**/*.{ts,tsx}',
      'components/blog/**/*.{ts,tsx}',
      'components/jobs/**/*.{ts,tsx}',
      'components/seo/**/*.{ts,tsx}',
      'components/magic/**/*.{ts,tsx}',
      'components/motion/**/*.{ts,tsx}',
      'components/design-system/heroes/**/*.{ts,tsx}',
      'components/design-system/sections/**/*.{ts,tsx}',
      'components/design-system/cards/**/*.{ts,tsx}',
      'components/design-system/ctas/**/*.{ts,tsx}',
      'components/design-system/decorations/**/*.{ts,tsx}',
      'components/design-system/illustrations/**/*.{ts,tsx}',
      'components/design-system/effects/**/*.{ts,tsx}',
      // CMP-02: các dir client trước đây KHÔNG được cover recharts-block → bổ sung.
      // (components/client đã xóa ở batch 1.1; components/lms dùng chung admin+portal → tạm chưa áp.)
      'components/home/**/*.{ts,tsx}',
      'components/sections/**/*.{ts,tsx}',
      'components/khoa-hoc/**/*.{ts,tsx}',
      'components/report-card/**/*.{ts,tsx}',
      'components/transcript/**/*.{ts,tsx}',
      'components/aceternity/**/*.{ts,tsx}',
    ],
    rules: {
      'no-restricted-imports': ['error', clientBlockedImports],
    },
  },

  // app/(portal)/** — R6-F1 db block (portal không có Magic/Motion rule riêng).
  {
    files: ['app/(portal)/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', dbBlockedImports],
    },
  },

  // app/(teacher)/** — L5 site giáo viên: shadcn THUẦN (chặn Magic/Motion như
  // admin + Recharts như client) + db block (site MỚI đi scopedDb từ đầu,
  // KHÔNG grandfather).
  {
    files: ['app/(teacher)/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...adminBlockedImports.patterns,
            ...clientBlockedImports.patterns,
            ...dbBlockedImports.patterns,
          ],
        },
      ],
    },
  },

  // ⚠️ KHÔNG CÒN khối `app/(sale)/**` và `components/sale/**` (gỡ 22/09/2026 cùng
  // site Sale). Hai khối đó tồn tại vì cấu hình flat gắn luật theo GLOB chứ không
  // thừa hưởng theo cây: một route group mới KHÔNG tự chịu luật nào, nên thiếu
  // khối là `import { db } from "@/lib/db"` trần trở thành HỢP LỆ và cổng cách ly
  // cơ sở thủng mà lint vẫn xanh (đúng chỗ `components/sale/` đã thủng tới S-6,
  // 27/08/2026). Dựng lại site Sale hay bất kỳ route group nào khác thì phải khai
  // khối cho nó — cả `app/(...)/**` LẪN thư mục `components/` mà nó dùng.

  // components/lead-intake/** — biểu mẫu nhập khách DÙNG CHUNG.
  //
  // 23/08/2026 trang dời vào `app/(admin)/admin/nhap-khach-hang/` (khối admin
  // phía trên đã phủ). Nhưng component sống ở `components/` nên KHÔNG thừa hưởng
  // khối nào — mà site Sale sau này sẽ mount lại chính nó. Giữ đúng luật cũ ở
  // đây: shadcn THUẦN + cấm `@/lib/db` trần (phải đi `scopedDb`).
  //
  // ⚠️ Bỏ khối này là cổng cách ly cơ sở thủng mà không ai báo.
  {
    files: ['components/lead-intake/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...adminBlockedImports.patterns,
            ...clientBlockedImports.patterns,
            ...dbBlockedImports.patterns,
          ],
        },
      ],
    },
  },

  // tests/** — 13/09/2026: mở phạm vi `pnpm lint` sang thư mục test.
  //
  // Vì sao BẮT BUỘC phải mở: `pnpm lint` trước đây quét `app components lib scripts` —
  // KHÔNG có `tests`. Nghĩa là MỌI rule nhắm vào test đều vô hiệu trong CI, kể cả rule
  // cắm ngay dưới đây. Một cổng không soi tới nơi cần soi thì bằng không có cổng
  // (luật 10 — `docs/luat-doc-so-va-ket-luan.md`). Phát hiện khi viết rule `thoigian`:
  // rule báo 12 lỗi khi gọi `eslint <file>` tay, nhưng `pnpm lint` im lặng.
  //
  // Đây là khai môi trường Node y như khối `scripts/**` ngay dưới, KHÔNG phải hạ luật:
  // `Buffer`/`console` thật sự tồn tại khi Vitest chạy trên Node — thiếu khai thì
  // `no-undef` báo nhầm 12 chỗ.
  {
    files: ['tests/**/*.{ts,tsx,mts,cts,mjs,cjs,js}'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        Buffer: 'readonly',
        require: 'readonly',
        module: 'writable',
      },
    },
  },

  // Ép test chốt `now` khi gọi hàm nhạy-thời-gian (sự cố 13/09/2026 — xem
  // `lib/eslint/require-now-in-tests.mjs`). Ngày cứng trong ca + `now` rơi về giờ thật =
  // ca xanh vài ngày rồi ĐỎ MÃI MÃI, nổ một chiều, không có cửa sổ để đợi tự xanh lại.
  //
  // Phạm vi CỐ Ý loại mã sản phẩm: ở đó gọi với `now` mặc định là đường chạy THẬT.
  {
    files: ['tests/**/*.ts', '**/*.test.ts', '**/*.spec.ts'],
    plugins: { thoigian: requireNowPlugin },
    rules: {
      'thoigian/require-now-in-tests': 'error',
    },
  },

  // scripts/** — EL-07: mở phạm vi `pnpm lint` sang thư mục này (trước đây chỉ quét
  // `app components lib`, nên script CHẠY TAY TRÊN PROD nằm ngoài mọi cổng chất lượng).
  //
  // Đây là khai môi trường Node, KHÔNG phải hạ luật: `console`/`process`/`__dirname`/
  // `Buffer`/`require` thật sự CÓ tồn tại khi chạy script bằng Node — thiếu khai thì
  // `no-undef` báo nhầm 43 chỗ. Tắt rule là giấu lỗi; khai globals là sửa cấu hình.
  {
    files: ['scripts/**/*.{ts,mts,cts,mjs,cjs,js}'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        Buffer: 'readonly',
        require: 'readonly',
        module: 'writable',
        exports: 'writable',
        fetch: 'readonly',
        URL: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
  },

  // scripts/**/*.cjs — CommonJS thật: `require()` là cú pháp ĐÚNG của định dạng này,
  // không phải nợ kỹ thuật. Tắt rule ở đúng phần mở rộng .cjs, không tắt toàn thư mục.
  {
    files: ['scripts/**/*.cjs'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  // EL-07 (C23) — route API e-learning phải trả envelope chuẩn `lib/api/response.ts`.
  // Phạm vi HẸP có chủ đích: chỉ module này, KHÔNG áp cho 69 route cũ (sửa chúng là
  // việc riêng). Một chuẩn không có máy cưỡng chế thì chết trong hai sprint — đúng
  // điều đã xảy ra với `lib/api/response.ts`: tồn tại nhưng có ĐÚNG 0 consumer.
  {
    files: ['app/api/elearning/**/*.ts', 'app/api/cron/elearning-*/**/*.ts'],
    plugins: { elearning: noBareNextResponsePlugin },
    rules: {
      'elearning/no-bare-next-response': 'error',
    },
  },

  // app/(elearning)/** — EL-07: khu đào tạo nội bộ (host thứ 6). Khu QUẢN TRỊ nội
  // bộ ⇒ chuẩn admin: shadcn THUẦN (chặn Magic/Motion) + chặn Recharts như client
  // + db block. Site MỚI đi scopedDb từ đầu, KHÔNG grandfather, KHÔNG xin entry
  // trong DB_IMPORT_ALLOWLIST.
  //
  // ⚠️ Khối này PHẢI tồn tại trước file .tsx đầu tiên của module. Luật "cổng DB đã
  // đóng" gắn theo GLOB TỪNG ROUTE GROUP (khai tay: admin, portal, teacher, và giờ
  // là elearning) — route group mới KHÔNG tự thừa hưởng luật nào. Thiếu khối này
  // thì `app/(elearning)/**` import `@/lib/db` trần HỢP LỆ và không ai báo.
  {
    files: ['app/(elearning)/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...adminBlockedImports.patterns,
            ...clientBlockedImports.patterns,
            ...dbBlockedImports.patterns,
          ],
        },
      ],
    },
  },

  // TS-03 (US-02 AC5) — no-inline-authz 2 tầng trên action files (Server Actions).
  // Tầng (a): no-restricted-syntax cấm kiểm quyền inline (selectors ở đầu file).
  // Tầng (b): plugin local `authz` — action GHI dữ liệu phải gọi can()/assertCan().
  {
    files: inlineAuthzActionGlobs,
    plugins: { authz: inlineAuthzPlugin },
    rules: {
      'no-restricted-syntax': ['error', ...noInlineAuthzSelectors],
      'authz/require-can-in-write-action': 'error',
    },
  },

  // R6-F1 — grandfather: 201 file hiện trạng tạm miễn db block (whitelist→0 theo
  // từng epic). Vẫn GIỮ Magic/Motion block (chỉ bỏ pattern @/lib/db). Override này
  // đặt CUỐI để thắng. Migrate file sang scopedDb → xóa entry khỏi allowlist.
  {
    files: DB_IMPORT_ALLOWLIST,
    rules: {
      'no-restricted-imports': ['error', adminBlockedImports],
    },
  },

  // TS-03 — grandfather no-inline-authz: file hiện trạng còn kiểm quyền inline
  // (đo bằng lint thật 09/08) tạm miễn CẢ 2 tầng. Trả nợ dần → 0, CẤM thêm file mới
  // (test freshness inline-authz.test.ts ép xoá entry đã sạch). Block ĐỘC LẬP đặt
  // CUỐI CÙNG — KHÔNG gộp với block DB allowlist ở trên: override REPLACE theo TÊN
  // rule, gộp block là rule của nhau đè mất nhau.
  ...(INLINE_AUTHZ_ALLOWLIST.length > 0
    ? [
        {
          files: INLINE_AUTHZ_ALLOWLIST,
          rules: {
            'no-restricted-syntax': 'off',
            'authz/require-can-in-write-action': 'off',
          },
        },
      ]
    : []),
)
