# listening_socialmediav2

Ứng dụng Social Listening cho chủ đề VinSmart Future. Bản MVP thu
thập comment/reply Facebook qua Chrome Extension; bài post vẫn được lưu đủ
metadata để lọc keyword và làm ngữ cảnh. Web là control plane để cấu hình, chạy
job, theo dõi tiến độ mỗi 5 giây, xem sentiment
`positive | negative | neutral` và xuất báo cáo PDF.

TikTok và Threads đã có màn hình cấu hình nhưng connector được khóa cho tới khi
có API/quyền truy cập phù hợp.

## Thành phần

```text
Web (vinext/React) ── REST ── API (Fastify) ── PostgreSQL
                             │                      │
Chrome Extension ────────────┘                Sentiment worker
  └─ tối đa 1 tab Facebook nền
```

- `app/`: dashboard, jobs và settings.
- `services/api/`: API, migration, seed, job lease/fencing và ingest.
- `services/worker/`: phân tích lập trường của post và bình luận đối với VSF;
  reply được tính như bình luận và có thêm ngữ cảnh chuỗi cha.
- `apps/extension/`: Chrome Manifest V3, Facebook DOM adapter và tab runner.
- `packages/contracts/`: Zod contract dùng chung.
- `compose.yaml`: PostgreSQL, migrate, API, worker và web.
- `PROJECT_PLAN.md`: thiết kế, flow, acceptance criteria và rủi ro đầy đủ.
- `docs/DATA_DICTIONARY.md`: trường post/comment, timestamp, keyword và sentiment.
- `docs/READ_ONLY_FACEBOOK.md`: allowlist thao tác đọc và các hành vi bị cấm.
- `docs/AUTHOR_PRIVACY.md`: contract tên hiển thị/ẩn danh, không theo dõi profile.

## Chạy nhanh bằng Docker

Yêu cầu Docker Desktop và Docker Compose.

```bash
docker compose up --build
```

Sau khi các healthcheck đạt:

- Web: `http://localhost:3000`
- API live: `http://localhost:4000/health/live`
- API ready: `http://localhost:4000/health/ready`
- PostgreSQL: `localhost:5432`

Sao chép `.env.example` thành `.env`. Chế độ `auto` ưu tiên OpenAI; nếu không
khoá OpenAI thì tự dùng Gemini, rồi MiMo; nếu cả ba đều thiếu thì chỉ dùng heuristic
khi `ALLOW_HEURISTIC_FALLBACK=true`:

```env
SENTIMENT_PROVIDER=auto
OPENAI_API_KEY=<openai-api-key-hoặc-để-trống>
OPENAI_MODEL=gpt-5.6-terra
GEMINI_API_KEY=<gemini-api-key-hoặc-để-trống>
GEMINI_MODEL=gemini-3.6-flash
MIMO_API_KEY=<mimo-api-key-hoặc-để-trống>
MIMO_BASE_URL=https://api.xiaomimimo.com/v1
MIMO_MODEL=mimo-v2.5-pro
ALLOW_HEURISTIC_FALLBACK=true
```

Khóa OpenAI cũ trong `SENTIMENT_API_KEY` vẫn được hỗ trợ để tương thích ngược.
Muốn chạy hoàn toàn local với Ollama, dùng:

```env
SENTIMENT_PROVIDER=ollama
SENTIMENT_MODEL=<model-name>
SENTIMENT_BASE_URL=http://ollama:11434
```

Không commit `.env` hoặc secret.

Với Docker, nút **Phân tích tất cả** trên Listening feed sẽ đưa toàn bộ post và
bình luận chưa có kết quả vào hàng đợi. Reply được phân tích và tính chung như
bình luận, nhưng vẫn hiển thị bên dưới bình luận cha như Facebook. Khóa OpenAI/Gemini/MiMo chỉ tồn
tại worker và không được gửi xuống trình duyệt.

Nút **Xuất / In PDF** trên dashboard tải toàn bộ dữ liệu theo từng trang API,
sau đó dựng bản in HTML/CSS sát giao diện feed: KPI, cơ cấu/tỷ lệ sắc thái của
toàn bộ bình luận, toàn bộ card bài post và cây comment/reply thụt bậc. Trong hộp thoại
in của trình duyệt, chọn **Save as PDF** hoặc **Lưu dưới dạng PDF**.

## Chạy từng phần khi phát triển

Yêu cầu Node.js `>=22.13`.

```bash
npm install
npm install --prefix services/api
npm install --prefix services/worker
npm install --prefix apps/extension

npm run dev
npm run dev:api
npm run dev:worker
npm run dev:extension
```

API cần PostgreSQL và schema:

```bash
npm run db:migrate --prefix services/api
npm run db:seed --prefix services/api
```

## Cài Chrome Extension

```bash
npm run build --prefix apps/extension
```

1. Mở `chrome://extensions`.
2. Bật **Developer mode**.
3. Chọn **Load unpacked** và trỏ tới `apps/extension/dist`.
4. Tại `Settings > Facebook` trên web, tạo mã ghép.
5. Mở popup extension, nhập API URL và mã ghép.

Sau mỗi lần build extension mới, bấm **Reload** tại `chrome://extensions`.
Phiên bản hiện tại là `0.1.3` và API mặc định phải là
`http://localhost:4000/api/v1`.

Extension chỉ dùng phiên Facebook đang đăng nhập sẵn trong Chrome. Nó không đọc
hoặc gửi password, cookie hay session token về backend. Nó không nhập nội dung,
không Like, không đăng bài và không gửi comment; chỉ click allowlist nút xem
thêm/tải thêm comment và chọn `Tất cả bình luận`. Mỗi run sở hữu tối đa một tab Facebook nền, dùng lại tab
đó cho các bước và đóng trong mọi trạng thái kết thúc. Nếu gặp login,
checkpoint, 2FA hoặc CAPTCHA, run dừng an toàn thay vì tìm cách vượt qua.

Crawler cố mở rộng toàn bộ comment/reply quan sát được trong giới hạn đã cấu
hình. Chỉ khi DOM có marker kết thúc chính xác mới báo coverage `complete`; nếu
không chứng minh được điểm cuối hoặc chạm giới hạn, job báo `unknown/partial`
thay vì khẳng định sai là đã lấy hết.

Trước khi đọc kết quả tìm kiếm trong group, extension chọn bộ lọc Facebook
`Bài viết mới đây/Recent posts`. Nếu không tìm thấy hoặc không xác nhận được
trạng thái đã chọn, coverage của bước tìm bài là `partial` với lý do
`recent_posts_filter_unconfirmed`.

Trong một lượt chạy, mỗi Facebook post ID chỉ được mở lấy comment một lần dù
bài xuất hiện ở nhiều kết quả keyword. API đối chiếu post/comment ID với URL
Facebook và PostgreSQL upsert theo `(workspace, platform, external_id)`, nên
chạy lại không tạo thêm một bản ghi bài viết trùng.

DOM Facebook thay đổi theo tài khoản, ngôn ngữ và rollout. Fixture tests bảo vệ
các selector/flow hiện có; trước production vẫn phải UAT thủ công trên các group
được phép và cập nhật adapter khi markup thay đổi.

## Quyền riêng tư tác giả

Hệ thống chỉ chấp nhận ba trường:

```json
{
  "authorName": "Nguyễn An",
  "isAnonymous": false,
  "authorKind": "real"
}
```

Với bài/comment ẩn danh, `authorName` bắt buộc là `null` và
`authorKind = "anonymous"`. Contract, extension, API và constraint PostgreSQL
đều từ chối platform author ID, profile URL, username, handle hoặc avatar URL.
Extension chỉ tạo một nhóm màu `anonymousAvatarVariant` từ nhãn ẩn danh đang
hiển thị và ID bài viết. Giá trị 0–7 này không phải ID tác giả, không cho phép
liên kết người dùng giữa các bài và chỉ dùng để dựng avatar màu trên dashboard.
Comment và reply ẩn danh đều luôn có variant; nếu Facebook không hiển thị số
nhãn ẩn danh thì external comment ID chỉ được dùng làm seed một chiều trong bài.
UI hiển thị tên dưới dạng text, không tạo link profile. Xem
`docs/AUTHOR_PRIVACY.md`.

URL nguồn/group/post/comment vẫn được phép vì đó là link nội dung, không phải
link hồ sơ người dùng; query tracking như `fbclid` và `utm_*` được loại bỏ.

## Luồng Facebook

1. Web tạo pairing code; extension ghép thiết bị và gửi heartbeat.
2. `Lấy danh sách group` tạo discovery job.
3. Extension claim lease, mở một tab nền, đọc group đã join và gửi batch.
4. Người dùng tick group, chỉnh keyword và khoảng `hôm nay / 3 / 7 / 30 ngày`.
5. Crawl job tìm post khớp keyword, lưu metadata bài post rồi lấy comment/reply.
6. API kiểm lại source/task/window và keyword từ snapshot, upsert chống trùng;
   crawl không tự tiêu tốn lượt AI.
7. Khi người dùng bấm `Phân tích tất cả`, API queue post và mọi bình luận chưa
   có kết quả; worker phân tích lập trường đối với VSF, gồm cả reply.
8. Dashboard đọc PostgreSQL, refresh mỗi 5 giây và cho phép xuất PDF.

Bốn keyword seed mặc định: `VSF`, `VinSmart Future`, `Vinfuture`, `Vin Future`.

## Kiểm tra

```bash
npm run test:all
npm run build:all
docker compose config
```

Sau khi stack Docker đang chạy, kiểm tra xuyên suốt API/PostgreSQL/worker bằng:

```powershell
./scripts/smoke-e2e.ps1
```

Script từ chối URL không phải HTTP local, khôi phục Settings/lựa chọn group và
thu hồi thiết bị test khi kết thúc. Các post/comment có tiền tố `smoke-` được
giữ lại trong database development để đối chiếu dashboard.

Các test bao gồm:

- server-render ba route web;
- keyword, privacy contract, idempotency và API validation;
- post context + comment ingest cho tác giả thật và ẩn danh;
- sentiment schema/hash/provider fallback;
- Facebook DOM fixture, post/comment/reply, anonymous detection;
- single-tab ownership, cleanup và payload privacy.
- read-only guard: không auto post, auto-comment, Like hoặc Share.

## Lưu ý vận hành

- Chỉ crawl dữ liệu tài khoản hiện tại có quyền xem và đã được chủ dự án cho
  phép.
- Không dùng để né rate limit, checkpoint, CAPTCHA hoặc cơ chế bảo vệ nền tảng.
- Kết quả là nội dung quan sát được qua UI tại thời điểm crawl, không phải cam
  kết bao phủ 100% dữ liệu Facebook.
- Post có sentiment riêng để hiển thị trên feed; KPI, tỷ lệ và timeline chính
  gộp bình luận gốc và reply vào cùng một loại dữ liệu là bình luận. Mọi bình
  luận có nhãn đều thuộc một trong ba nhóm tích cực, trung lập hoặc tiêu cực.
- Frontend không tạo dữ liệu demo khi API offline; màn hình để trống và báo lỗi
  kết nối. Dữ liệu chỉ xuất hiện từ API/PostgreSQL/extension thật.
- Trước production cần chốt retention, quyền truy cập, điều khoản nền tảng,
  backup/restore và UAT trên tài khoản thử nghiệm được phép.
