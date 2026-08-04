# Kế hoạch và trạng thái dự án `Social Listening`

> Phiên bản tài liệu: 2.3 — Threads Web collector
>
> Ngày lập: 2026-07-30
>
> Cập nhật gần nhất: 2026-08-04
>
> Trạng thái: Facebook MVP và Threads Web collector đã triển khai; đang UAT DOM thật
>
> Mốc mã nguồn đối chiếu: source đến `5079f08`; tài liệu nền tại `HEAD dd9a35e`
>
> Xác minh gần nhất: 110/110 test pass, toàn bộ build pass và Compose config hợp lệ ngày 2026-07-31
>
> Tên ứng dụng: **Social Listening**
>
> Chủ đề chuẩn: **VinSmart Future**
>
> Extension: `0.2.0`
>
> Phạm vi ưu tiên: Facebook + Threads qua extension; TikTok chờ kênh truy cập phù hợp
>
> Múi giờ nghiệp vụ: `Asia/Ho_Chi_Minh`

![Công nghệ sử dụng trong Social Listening](docs/images/social-listening-technology-stack-v2.png)

## Trạng thái triển khai hiện tại

Đây là phần đối chiếu kế hoạch với mã nguồn đã triển khai. Các mục phía dưới tiếp tục giữ vai trò đặc tả kiến trúc và tiêu chí nghiệm thu.

| Hạng mục | Công nghệ / cách triển khai hiện tại | Trạng thái |
|---|---|---|
| Web | Vinext `0.0.50`, React `19.2`, TypeScript `5.9`, Tailwind CSS `4.2`; ba route `/`, `/jobs`, `/settings` | Đã triển khai |
| Giao diện | Dashboard đỏ `#EB0A2A`, đen và trắng theo nhận diện VinSmart Future; logo, favicon, feed kiểu Facebook | Đã triển khai |
| Extension | Chrome Manifest V3, TypeScript, một tab Facebook hoặc Threads nền, chỉ đọc | Đã triển khai `0.2.0` |
| Group discovery | Đọc danh sách group đã tham gia, tổng kỳ vọng từ tiêu đề `(N)`, nested scroller, không giới hạn 10 group | Đã triển khai |
| Crawl Facebook | Lọc post theo keyword/lookback; lấy post, comment, reply và metadata thời gian/keyword | Đã triển khai, tiếp tục UAT với DOM thật |
| Reply hierarchy | Lưu `parent_comment_id`, reply nhiều bậc và `observed_order` theo thứ tự Facebook quan sát được | Đã triển khai qua migration `009_preserve_comment_order.sql` |
| Danh tính tối thiểu | Chỉ lưu display name và `real|anonymous|unknown`; không lưu link/ID/handle/avatar người dùng | Đã triển khai |
| API | Fastify 5 + TypeScript, Zod contract, ingest idempotent, job/lease, listening feed và sentiment endpoint | Đã triển khai |
| Database | PostgreSQL 16, migrations `001`–`013` | Đã triển khai |
| AI sentiment | Phân tích targeted stance đối với VSF; tách text cần chấm khỏi ngữ cảnh bài post/reply; hiểu phủ định, mỉa mai và reply ngắn; chống gửi lại nội dung đã phân tích | Đã triển khai v2 |
| Báo cáo PDF | Bản in sát dashboard: KPI, cơ cấu/tỷ lệ sắc thái, toàn bộ card bài post và cây comment/reply; lưu PDF qua hộp thoại in của trình duyệt | Đã triển khai |
| Hạ tầng | Docker Compose: PostgreSQL, migrate, API, worker, web; Ollama là profile tùy chọn | Đã triển khai local |
| Realtime | Web poll API mỗi 5 giây và fetch ngay khi tab được focus lại | Đã triển khai |
| Kiểm thử | Web 3, Extension 62, API 33, Worker 12 — tổng 110 test pass bằng `npm run test:all` ngày 2026-07-31 | Đã xác minh |
| Threads | Web Search + post/reply DOM adapter, không cần Meta API/token | MVP đã triển khai, chờ smoke test live |
| TikTok | Settings và connector boundary | Phase 2, chưa có connector |

### Những hạng mục đã hoàn thành theo mã nguồn

| Nhóm thay đổi | Kết quả hiện có | Bằng chứng Git |
|---|---|---|
| Nền tảng MVP | Monorepo, web, API, worker, PostgreSQL, Chrome Extension và Docker Compose chạy cùng kiến trúc | `9821672` |
| Thu thập thật | Bỏ dữ liệu demo; extension thực hiện group discovery trên Facebook và ingest qua API | `e5d2b39` |
| Lọc nội dung | Parse kết quả tìm kiếm Facebook, lọc bài gần đây theo lookback và chặn lỗi job trùng gây nhiễu | `9c6070e`, `c9ea196` |
| Listening feed | Giao diện feed post/comment, API đọc dữ liệu và thao tác phân tích AI thủ công | `40a55da` |
| Comment/reply | Comment được ràng buộc đúng post/job; lấy reply và giữ quan hệ cha-con | `6b67c25` |
| AI có kiểm soát chi phí | Crawl không tự gọi AI; `Phân tích tất cả` chỉ queue nội dung chưa có kết quả hoặc chưa được queue | `905571c` |
| Bao phủ group | Discovery cuộn đúng nested scroller và không dừng ở 10 group đầu tiên | `79fe30d` |
| Độ bền crawler | Khôi phục message channel, giữ reply sâu, `parent_comment_id` và `observed_order` | `6d7fe07`, `42a7c7b` |
| Nhận diện sản phẩm | Logo/favicon/extension đồng bộ; palette đỏ `#EB0A2A`, đen và trắng | `42a7c7b`, `5079f08` |
| AI stance v2 | Chỉ chấm thái độ của entity đối với VSF, dùng ngữ cảnh bài post và chuỗi reply cha tối đa 8 cấp để giải nghĩa | Working tree 2026-07-31 |
| Xuất PDF | Bản in HTML/CSS tái hiện feed web, tải toàn bộ bài post và comment/reply trước khi mở hộp thoại lưu PDF | Working tree 2026-07-31 |

### Luồng đang vận hành

1. Người dùng mở web tại `http://localhost:3000` theo cấu hình Compose mặc định, cấu hình keyword, lookback và chọn Facebook Group.
2. Web tạo job; extension đã ghép nhận job và chỉ mở tối đa một tab Facebook nền.
3. Extension đọc group/post/comment/reply, chỉ click các nút xem hoặc tải thêm nội dung, rồi gửi batch về API tại `http://localhost:4000/api/v1`.
4. API upsert dữ liệu vào PostgreSQL, giữ đúng bài post, cây reply, thứ tự quan sát, timestamp và keyword đã bắt.
5. Dữ liệu mới xuất hiện với trạng thái `Chờ AI`; crawl không tự gọi AI.
6. Khi người dùng bấm `Phân tích tất cả`, API chỉ queue post/comment chưa có kết quả. Nội dung đã phân tích hoặc đang queue/processing không bị gửi lại.
7. Worker chỉ chấm lập trường của entity hiện tại đối với VSF; ngữ cảnh bài post và reply cha chỉ dùng để hiểu câu trả lời ngắn, phủ định, so sánh hoặc mỉa mai.
8. Dashboard cập nhật kết quả sau mỗi chu kỳ tối đa 5 giây và có thể xuất toàn bộ báo cáo PDF.
9. Extension đóng tab do nó sở hữu khi job thành công, một phần, lỗi, bị hủy hoặc cần đăng nhập lại.

### Phần còn lại

- UAT thêm với Facebook DOM thực tế, đặc biệt các biến thể reply bị Facebook render phẳng và bài/comment lazy-load.
- Hoàn thiện rate limit/log redaction/observability, healthcheck cho worker/web, runbook backup/restore và bộ đánh giá AI tiếng Việt.
- Smoke test Threads thật sau khi reload extension 0.2.0; TikTok chỉ triển khai khi có kênh truy cập hợp lệ.
- Production hosting chưa chốt; Docker local và GitHub hiện là nguồn mã chuẩn.

## 1. Tóm tắt dự án

`Social Listening` là hệ thống thu thập và phân tích những nội dung liên quan đến VinSmart Future trên:

- Facebook Group mà người dùng đã tham gia;
- TikTok;
- Threads.

Hệ thống lọc bài viết theo keyword, lưu đầy đủ metadata bài post, lấy comment/reply liên quan và cho phép người dùng chủ động gọi AI để phân loại cảm xúc của cả post lẫn comment/reply thành đúng ba nhãn:

- `positive`;
- `negative`;
- `neutral`.

Web là ứng dụng chính để cấu hình, khởi chạy, theo dõi và xem kết quả. Chrome Extension chỉ là agent chạy trong trình duyệt đã đăng nhập Facebook để:

- đồng bộ danh sách group;
- đi tới các group đã chọn;
- lấy bài viết và bình luận cần thiết;
- gửi dữ liệu theo batch về backend.

Extension không chứa dashboard, không lưu dữ liệu nghiệp vụ dài hạn và không gửi cookie, mật khẩu hoặc Facebook session về server.

> **Làm rõ ranh giới extension:** với group đã join/private, backend không có phiên Facebook để tự lấy comment. Vì vậy, nếu “extension chỉ lấy group + bài viết” được hiểu là không được đọc comment, chức năng crawl comment phải bỏ khỏi MVP hoặc thay bằng một API được cấp quyền. Kế hoạch này hiểu đúng vai trò mong muốn là extension chỉ làm **data collection agent** cho group, post và comment; toàn bộ cấu hình, business logic, AI, lưu trữ và dashboard vẫn nằm ở web/backend.

> **Quyết định phạm vi 2.0:** feed lấy comment/reply làm trọng tâm nhưng bài post cũng là một entity có thể phân tích AI. Post được lưu đủ source, URL, body, tác giả dạng name-only, thời gian đăng/thu thập, trạng thái parse thời gian và toàn bộ keyword khớp. Extension hoàn toàn read-only: không nhập text, Like, Share, đăng bài hoặc gửi comment.

## 2. Các quyết định nền tảng

| Hạng mục | Quyết định |
|---|---|
| Cách triển khai | Modular monolith trong một monorepo |
| Web | vinext/React + TypeScript, tương thích Next App Router |
| API | Fastify + TypeScript |
| Worker | Node.js/TypeScript, dùng chung domain package với API |
| Database | PostgreSQL |
| Hàng đợi MVP | Bảng `sentiment_queue` dùng PostgreSQL locking; `crawler_slots` riêng cho extension lease |
| Extension | Chrome Manifest V3 + TypeScript |
| Chia sẻ contract | Zod schema + TypeScript types |
| AI | `SentimentProvider` độc lập nhà cung cấp |
| Cập nhật tiến độ MVP | Poll API mỗi 5 giây khi job đang hoạt động |
| Phạm vi release đầu | Facebook và Threads Web qua extension; TikTok để feature flag |
| Auth MVP | Một workspace, một tài khoản admin; schema sẵn sàng mở rộng nhiều người dùng |
| Lịch chạy MVP | Chạy thủ công từ web; scheduler là phase sau |

Không thêm Redis hoặc `pg-boss` trong bản hiện tại. Sentiment worker claim trực tiếp từ bảng `sentiment_queue` bằng PostgreSQL locking; crawl lease nằm ở các bảng domain riêng. Chỉ tách queue sang hạ tầng chuyên dụng ở phase scale nếu đo tải thực tế cho thấy PostgreSQL không còn phù hợp.

## 3. Mục tiêu và chỉ số thành công

### 3.1. Mục tiêu sản phẩm

1. Người dùng ghép extension với web mà không cần cung cấp thông tin đăng nhập Facebook cho hệ thống.
2. Từ web, người dùng bấm lấy danh sách Facebook Group đã tham gia.
3. Web hiển thị tên group, link group và checkbox để chọn nguồn cần theo dõi.
4. Người dùng quản lý keyword và khoảng thời gian lấy dữ liệu.
5. Hệ thống chỉ xử lý những group đã chọn và ưu tiên những bài có keyword.
6. Tại mọi thời điểm, extension chỉ sở hữu tối đa một tab Facebook automation cho mỗi thiết bị/job và luôn đóng tab đang sở hữu khi kết thúc.
7. Dashboard thấy tiến độ mới chậm nhất 5 giây sau khi backend nhận cập nhật.
8. Post và comment/reply có thể được AI gán sentiment, có confidence và thông tin model/prompt để truy vết; chỉ phân tích khi người dùng bấm nút thủ công.

### 3.2. Chỉ số vận hành ban đầu

- `100%` job không có hơn một tab Facebook do extension sở hữu cùng thời điểm.
- `100%` đường kết thúc job gọi cleanup tab: thành công, một phần, lỗi, hủy, hết thời gian hoặc cần đăng nhập lại.
- Không có Facebook cookie/password/session token trong request hoặc log backend.
- Job chạy lại không tạo post/comment trùng.
- P95 API đọc trạng thái job dưới `500 ms` ở tải MVP.
- Dashboard phản ánh event mới trong tối đa `5 giây + độ trễ mạng`.
- Nội dung phân tích thành công luôn có đúng một trong ba nhãn sentiment.

## 4. Phạm vi

### 4.1. MVP Facebook — bắt buộc

- Web Settings có ba tab: Facebook, TikTok, Threads.
- Ghép/hủy ghép Chrome Extension.
- Hiển thị trạng thái extension: online, offline, đang chạy, cần đăng nhập.
- Nút `Lấy danh sách group`.
- Đồng bộ group mà tài khoản Facebook hiện tại có thể nhìn thấy trong danh sách đã tham gia.
- Hiển thị tên group, URL, trạng thái đồng bộ và checkbox chọn.
- Thêm, sửa, bật/tắt, xóa keyword.
- Có sẵn bốn keyword:
  - `VSF`;
  - `VinSmart Future`;
  - `Vinfuture`;
  - `Vin Future`.
- Khoảng thời gian:
  - Hôm nay;
  - 3 ngày gần nhất;
  - 7 ngày gần nhất;
  - 30 ngày gần nhất.
- Chạy crawl thủ công từ web.
- Lấy post khớp keyword trong group đã chọn.
- Chỉ lấy comment của post đã khớp keyword.
- Upsert dữ liệu, chống trùng và hỗ trợ chạy lại.
- AI sentiment thủ công cho post và comment/reply; nội dung đã có kết quả không bị gửi lại.
- Dashboard tiến độ và kết quả.
- Hủy job từ web.
- Docker Compose cho web, API, worker và PostgreSQL.

### 4.2. Threads Web MVP và TikTok Phase 2

- Threads dùng phiên đăng nhập Chrome qua extension, không cần Meta App/token.
- Search Threads theo keyword và khoảng ngày, match lại nội dung tại máy.
- Lấy reply đang hiển thị trong conversation và ghi coverage trung thực.
- Chuẩn hóa về cùng schema post/comment/sentiment.
- Dùng chung dashboard, worker AI và cơ chế chống trùng.
- TikTok tiếp tục khóa cho đến khi có connector phù hợp.

Tab Threads cho phép tạo job thật qua extension; chỉ tab TikTok còn bị khóa.

### 4.3. Ngoài phạm vi MVP

- Không thu thập inbox, chat hoặc nội dung mà tài khoản không có quyền xem.
- Không tự nhập password, giải CAPTCHA, vượt 2FA/checkpoint hoặc né cơ chế chống automation.
- Không điều khiển nhiều tài khoản Facebook đồng thời trên cùng extension.
- Không cam kết thu thập 100% mọi post/comment mà Facebook đang lưu.
- Không crawl profile cá nhân ngoài phạm vi nguồn đã chọn.
- Không tự đăng bài, comment, like hoặc thực hiện tương tác xã hội.
- Không có mobile app.
- Không có scheduler chạy 24/7 khi máy người dùng/Chrome tắt.
- Không có báo cáo BI nâng cao hoặc cảnh báo đa kênh ở release đầu.

### 4.4. Truy vết yêu cầu

| ID | Yêu cầu gốc | Phần thiết kế/kiểm thử |
|---|---|---|
| REQ-01 | Extension + web, auto-click trong tab nền | Mục 6, 8, 9, 22.1 |
| REQ-02 | Docker + PostgreSQL | Mục 12, 18, 22.6 |
| REQ-03 | Settings ba nền tảng; Facebook lấy group, link và checkbox | Mục 7.2–7.4, 8.2, 22.2 |
| REQ-04 | Thêm keyword và bốn keyword mặc định | Mục 7.2, 14, 22.3 |
| REQ-05 | Hôm nay/3/7/30 ngày | Mục 5, 7.2, 22.3 |
| REQ-06 | Extension tối đa một tab Facebook đồng thời và cleanup | Mục 9.3–9.5, 22.1 |
| REQ-07 | Web là chủ lực, cập nhật crawl mỗi 5 giây | Mục 6.2, 8.5, 22.4 |
| REQ-08 | AI Positive/Negative/Neutral | Mục 15, 20.5, 22.5 |

## 5. Giả định nghiệp vụ

1. “Extension mở tối đa một tab Facebook” nghĩa là tối đa một tab automation do extension sở hữu **đồng thời**. Tab cũ bị người dùng/Chrome đóng có thể được thay thế sau khi extension xác nhận tab cũ không còn và lấy lại lease; không bao giờ tồn tại hai owned tab cùng lúc. Tab Facebook do người dùng tự mở không bị đóng hoặc chiếm quyền.
2. Tab automation được tạo với `active: false`, dùng tuần tự cho toàn bộ group/keyword của một job và được đóng trong khối cleanup bắt buộc.
3. Extension chỉ đọc nội dung đang hiển thị cho tài khoản Facebook đã đăng nhập trong Chrome.
4. `Hôm nay` tính từ `00:00:00` theo `Asia/Ho_Chi_Minh`.
5. `3/7/30 ngày gần nhất` là rolling window `N × 24 giờ`, tính lùi từ `job_created_at`; `window_start_utc` và `window_end_utc` được đóng băng trong snapshot. Riêng `Hôm nay` bắt đầu từ 00:00 theo timezone workspace và kết thúc tại `job_created_at`.
6. Keyword được trim, Unicode normalize và so sánh không phân biệt hoa/thường.
7. `VSF` mặc định dùng chế độ `whole_word`; các cụm còn lại dùng `contains_phrase`.
8. Một job giữ nguyên snapshot cấu hình dù người dùng sửa Settings trong lúc job đang chạy.
9. Kết quả được mô tả là “nội dung quan sát được qua giao diện/API tại thời điểm crawl”, không phải toàn bộ dữ liệu tuyệt đối của nền tảng.
10. Nếu Facebook yêu cầu đăng nhập lại, checkpoint hoặc CAPTCHA, job dừng an toàn và chuyển sang trạng thái cần người dùng xử lý; hệ thống không tìm cách vượt qua.

## 6. Kiến trúc tổng thể

```mermaid
flowchart LR
    U[Người dùng] --> W[Web Dashboard]
    W -->|REST + poll 5 giây| A[API]
    A <--> DB[(PostgreSQL)]
    WK[Worker] <--> DB
    WK --> AI[AI Sentiment Provider]

    W -->|External message: start/cancel job| E[Chrome Extension]
    E -->|Một tab automation nền| FB[Facebook Web]
    E -->|Batch + heartbeat + event| A

    A --> TT[TikTok Connector - Phase 2]
    A --> TH[Threads Connector - Phase 2]
```

### 6.1. Trách nhiệm từng thành phần

| Thành phần | Trách nhiệm | Không chịu trách nhiệm |
|---|---|---|
| Web | Settings, chọn group, tạo/hủy job, theo dõi tiến độ, dashboard | Đọc DOM Facebook |
| API | Auth, pairing, validate request, job state, ingest, query dữ liệu | Giữ Facebook session |
| Worker | Normalize, keyword validation, AI sentiment, aggregate, retry | Auto-click Facebook |
| Extension | Nhận job, quản lý tab, điều hướng/click/scroll, extract, upload | Dashboard, AI, lưu dữ liệu dài hạn |
| PostgreSQL | Dữ liệu nghiệp vụ, event, lease, queue, audit | Lưu cookie/password Facebook |
| Platform connector | Chuyển dữ liệu từng nền tảng về schema chung | Thay đổi logic dashboard |

### 6.2. Vì sao dùng web làm control plane

- Mọi cấu hình và lịch sử job có nguồn sự thật duy nhất trong PostgreSQL.
- Extension có thể bị suspend theo vòng đời Manifest V3 nên không được giữ state quan trọng chỉ trong RAM.
- Web chủ động gửi lệnh tức thời sang extension khi người dùng bấm nút.
- Extension upload về API; web không chờ message ngược từ extension mà poll backend 5 giây/lần.
- Khi extension offline, job ở `waiting_extension`, không hiển thị sai là đang crawl.

## 7. Cấu trúc giao diện web

### 7.1. Điều hướng chính

```text
Dashboard
Listening
  ├─ Comments & replies
  └─ Sentiment review
Jobs
Settings
  ├─ Facebook
  ├─ TikTok
  └─ Threads
```

### 7.2. `Settings > Facebook`

#### Khối Kết nối extension

- Trạng thái: `Chưa ghép`, `Online`, `Offline`, `Đang crawl`, `Cần đăng nhập`.
- Extension version và lần heartbeat gần nhất.
- Nút `Tạo mã ghép extension`.
- Nút `Hủy ghép`.
- Cảnh báo nếu extension version không tương thích API contract.

#### Khối Nguồn dữ liệu

- Nút `Lấy danh sách group`.
- Thời điểm đồng bộ gần nhất.
- Tìm kiếm group theo tên.
- Checkbox chọn từng group.
- Checkbox chọn tất cả trên trang.
- Cột:
  - tên group;
  - link mở ở tab mới;
  - selected;
  - trạng thái active/inactive;
  - lần phát hiện gần nhất;
  - lỗi crawl gần nhất.
- Nút `Lưu lựa chọn`.

#### Khối Keyword

- Input dạng chips.
- Bật/tắt từng keyword thay vì buộc xóa.
- Kiểu match: `whole_word` hoặc `contains_phrase`.
- Không cho lưu bản trùng sau normalize.
- Bốn giá trị mặc định được seed khi tạo workspace.

#### Khối Thời gian và giới hạn

- Radio/select: hôm nay, 3, 7 hoặc 30 ngày.
- `Crawl comments`: mặc định bật.
- Hard limits mặc định:
  - tối đa `50` group/job;
  - tối đa `300` post được mở/group;
  - tối đa `500` comment/post;
  - tối đa `120` phút/job.
- Các hard limit đặt trong server config; chỉ admin mới được đổi.

#### Khối Hành động

- `Crawl ngay`.
- `Hủy job hiện tại`.
- Validation trước khi chạy:
  - extension online;
  - ít nhất một group đã chọn;
  - ít nhất một keyword đang bật;
  - không có Facebook job đang chạy trên cùng device.

### 7.3. `Settings > TikTok`

- Trạng thái connector/API credential.
- Keyword và lookback dùng cùng component với Facebook.
- Thông tin quyền API cần thiết.
- Nút test connection.
- Trong MVP: `Crawl ngay` bị disable bằng feature flag.

### 7.4. `Settings > Threads`

- Trạng thái extension/heartbeat và tương thích phiên bản 0.2.0+.
- Keyword và lookback riêng cho platform Threads.
- Search mode mặc định: `RECENT`.
- Nút tạo job Threads thật, mở tối đa một tab nền.
- Thông báo rõ collector chỉ đọc và coverage phụ thuộc Threads Search.

### 7.5. Dashboard

- Tên sản phẩm `Social Listening`, chủ đề `VinSmart Future`, logo thống nhất với extension.
- Màu đỏ nhận diện `#EB0A2A`, phối đen sâu, trắng và xám rất nhạt.
- Tổng nội dung theo sentiment.
- Tỷ lệ positive/negative/neutral.
- Biểu đồ theo ngày.
- Breakdown theo platform, group/source và keyword.
- `Listening feed` và `Bình luận & phản hồi` hiển thị dạng card giống luồng bài viết Facebook:
  - bài post với tên group/tác giả, nội dung, thời gian đăng và keyword đã bắt;
  - comment đúng bài post, có tên hiển thị hoặc nhãn người tham gia ẩn danh;
  - reply nhiều bậc được thụt theo `parent_comment_id`, không ép phẳng ở bậc 2;
  - root comment và từng nhóm reply sắp theo `observed_order` đã quan sát trên Facebook;
  - badge `Chờ AI`, `Positive`, `Negative` hoặc `Neutral`.
- Nút thủ công `Phân tích tất cả` để phân tích một lần toàn bộ post/comment chưa có kết quả.
- Nút `Xuất / In PDF` tải toàn bộ trang API rồi dựng bản in gần giống dashboard:
  KPI, cơ cấu/tỷ lệ sắc thái comment, toàn bộ card bài post và cây reply thụt bậc.
  Trình duyệt mở hộp thoại in để người dùng chọn `Save as PDF`/`Lưu dưới dạng PDF`.
- Bộ lọc ngày/platform/source/keyword/sentiment.
- Badge `Cần xem lại` cho confidence thấp.
- Widget job đang chạy:
  - bước hiện tại;
  - group/task hiện tại;
  - số post đã quét/khớp/lưu;
  - số comment đã lưu;
  - số sentiment hoàn tất/tổng;
  - heartbeat;
  - lỗi gần nhất;
  - nút hủy.

## 8. Các flow end-to-end

### 8.1. Ghép extension với web

1. Admin bấm `Tạo mã ghép extension`.
2. API tạo pairing code một lần, hết hạn sau 5 phút.
3. Người dùng nhập code trong popup extension.
4. Extension gửi code cùng installation ID công khai tới API.
5. API trả device token có scope hẹp.
6. Extension lưu token trong `chrome.storage.local`; server chỉ lưu token hash.
7. Extension gửi heartbeat.
8. Web hiển thị trạng thái online ở lần poll tiếp theo.

Pairing code hết hạn hoặc đã dùng không thể dùng lại. Hủy ghép sẽ revoke token ngay lập tức.

### 8.2. Lấy danh sách Facebook Group

```mermaid
sequenceDiagram
    participant U as Người dùng
    participant W as Web
    participant A as API
    participant E as Extension
    participant F as Facebook

    U->>W: Bấm "Lấy danh sách group"
    W->>A: POST discover-groups job
    A-->>W: job_id
    W->>E: START_JOB(job_id)
    E->>A: Claim job + acquire lease
    E->>F: Mở 1 tab nền và kiểm tra login
    E->>F: Mở danh sách group đã tham gia, scroll
    loop Theo batch
        E->>A: Upsert group batch + progress
    end
    E->>A: Complete/partial/fail
    E->>F: Đóng tab trong finally
    W->>A: Poll trạng thái mỗi 5 giây
    W-->>U: Hiển thị group + link + checkbox
```

Quy tắc dừng scroll:

- không phát hiện group mới sau một số vòng liên tiếp;
- đạt hard limit;
- job bị hủy;
- hết timeout;
- Facebook yêu cầu login/checkpoint;
- DOM adapter phát hiện trạng thái không an toàn.

Backend upsert group theo external ID; nếu không lấy được ID ổn định thì dùng canonical URL. Chỉ đánh dấu group không còn xuất hiện là `inactive` khi lần discovery có `coverage_status = complete`. Với lần scan `partial/unknown`, giữ nguyên trạng thái cũ và lưu `partial_reason`; không suy luận rằng group đã bị rời.

### 8.3. Crawl bài viết và bình luận Facebook

1. Web validate Settings và tạo `CRAWL_CONTENT` job.
2. API lưu snapshot:
   - selected group IDs;
   - keyword + match mode;
   - `window_start_utc` và `window_end_utc`;
   - timezone;
   - crawl comment flag;
   - hard limits;
   - adapter version.
3. Web gửi `START_JOB(job_id)` cho extension.
4. Extension claim job và nhận lease độc quyền.
5. Extension tạo đúng một background tab nếu chưa resume tab hợp lệ.
6. Trong từng group, extension dùng khả năng search theo keyword của group nếu giao diện có hỗ trợ.
7. Extension xử lý tuần tự từng `group × keyword`.
8. Với mỗi kết quả:
   - đọc canonical URL/external ID;
   - mở rộng text nếu cần;
   - đọc thời gian và `time_parse_status`;
   - loại nội dung ngoài time window;
   - chạy keyword match cục bộ;
   - upload post theo batch.
9. Chỉ với post khớp keyword:
   - mở permalink trong cùng tab;
   - chọn tất cả bình luận nếu giao diện cho phép;
   - mở rộng comment/reply đến hard limit;
   - upload comment theo batch.
10. Extension checkpoint sau mỗi task và gửi heartbeat định kỳ.
    - Checkpoint chỉ được tăng sau khi backend ACK batch tương ứng.
11. Backend upsert post context + comment; dữ liệu mới có trạng thái `Chờ AI`, chưa gọi AI.
12. Khi tất cả task kết thúc, extension báo complete/partial và đóng tab trong `finally`.
13. Job crawl kết thúc độc lập với AI sentiment.
14. Khi người dùng bấm `Phân tích tất cả`, API mới queue các entity chưa có kết quả để worker xử lý.

Một group lỗi không làm mất dữ liệu của group khác. Job có thể hoàn thành `partial` cùng danh sách task lỗi.

Nếu không parse chắc chắn timestamp, entity được lưu với `published_at = null` và `time_parse_status = unknown` để điều tra nhưng không xuất hiện trong listening result mặc định. Giới hạn `300 post/group` tính trên số post unique của cả group qua tất cả keyword, không nhân lại theo `group × keyword`; comment cap tính trên từng post unique đã match.

### 8.4. AI sentiment

1. Người dùng bấm `Phân tích tất cả` trên dashboard.
2. API chọn cả `post` và `comment` chưa có kết quả sentiment.
3. Với reply, API dựng chuỗi comment/reply cha tối đa 8 cấp theo thứ tự từ gốc đến gần nhất.
4. Entity đã phân tích, đã queue hoặc đang processing bị bỏ qua; entity lỗi có thể retry có kiểm soát.
5. Worker tạo `analysis_input_hash` từ text, context bài post, chuỗi reply cha, topic/target, normalization version và analysis schema version.
6. Prompt yêu cầu targeted stance: chỉ positive/negative khi bằng chứng trong entity hướng tới VSF; context không được truyền sắc thái sang entity.
7. Kiểm tra cache theo analysis input hash + provider + model + prompt version để không gọi lại AI khi input không đổi.
8. Loại bỏ author identifier trước khi gửi AI; provider trả structured JSON và `reason` nêu bằng chứng.
9. Lưu sentiment và cập nhật aggregate.
10. Confidence thấp vẫn giữ một trong ba nhãn nhưng gắn `needs_review = true`.
11. AI lỗi sau retry chuyển `analysis_failed`; raw content vẫn được giữ.

### 8.5. Cập nhật tiến độ trên web

- Khi job ở `queued`, `waiting_extension`, `running` hoặc `processing_ai`, web gọi:
  - `GET /api/v1/jobs/{jobId}`;
  - `GET /api/v1/jobs/{jobId}/events?after={sequence}`.
- Chu kỳ mặc định: 5 giây.
- Dùng `ETag` hoặc `after sequence` để tránh tải lại toàn bộ event.
- SLA `5 giây + network/render latency` chỉ áp dụng khi dashboard đang visible/foreground; browser có thể throttle timer của tab nền.
- Khi tab web được focus/visible trở lại, fetch ngay thay vì chờ chu kỳ kế tiếp.
- Khi lần poll thấy job ở trạng thái kết thúc, fetch trạng thái và event lần cuối rồi mới dừng polling.
- SSE/WebSocket chỉ là tối ưu phase sau, không phải điều kiện MVP.

## 9. Thiết kế Chrome Extension

### 9.1. Permission tối thiểu

```json
{
  "manifest_version": 3,
  "permissions": ["alarms", "storage", "tabs"],
  "host_permissions": [
    "https://www.facebook.com/*",
    "https://<api-domain>/*"
  ],
  "externally_connectable": {
    "matches": ["https://<web-domain>/*"]
  }
}
```

Dev và production dùng manifest/environment riêng. Ưu tiên static content script chỉ cho Facebook host; chỉ thêm permission `scripting` nếu technical spike chứng minh programmatic injection là bắt buộc. Không dùng `<all_urls>`, `cookies`, `webRequest` hoặc `debugger` nếu chưa có yêu cầu và phê duyệt riêng.

### 9.2. Module

| Module | Vai trò |
|---|---|
| `DevicePairing` | Pair/revoke token, installation identity |
| `ExternalBridge` | Nhận start/cancel/status request từ web origin allowlist |
| `JobRunner` | Chạy đúng một job tuần tự |
| `TabLeaseManager` | Sở hữu, kiểm tra và dọn một automation tab |
| `FacebookAdapter` | Navigate, click, scroll, extract |
| `BatchUploader` | Batch, retry, idempotency key |
| `CheckpointStore` | Lưu job/task/tab/cursor trong extension storage |
| `Heartbeat` | Renew backend lease và báo trạng thái |
| `Watchdog` | Timeout, stuck detection, auth/checkpoint detection |
| `RedactedDiagnostics` | Log kỹ thuật đã bỏ nội dung nhạy cảm |

### 9.3. Bất biến một tab

1. Mỗi installation chỉ có một local mutex.
2. Backend chỉ cấp một active lease Facebook cho một device; lease có token, fencing token tăng dần, TTL và heartbeat.
3. `automationTabId` và `ownerJobId` được lưu bền vững.
4. Chỉ `TabLeaseManager` được gọi `chrome.tabs.create`.
5. Mọi group và permalink dùng `chrome.tabs.update` trên cùng tab.
6. Không dùng `window.open` trong content script.
7. Chỉ đóng tab có đủ bằng chứng ownership:
   - tab ID khớp checkpoint;
   - owner job khớp;
   - tab do extension tạo.
8. Không đóng tab Facebook do người dùng mở.
9. `finally` luôn gọi cleanup khi success, partial, fail, cancel, timeout hoặc needs-login.
10. Khi service worker thức dậy, recovery kiểm tra:
    - job/lease còn hợp lệ thì resume;
    - lease hết hạn thì đóng tab mồ côi thuộc extension và đánh dấu job interrupted;
    - không tìm thấy tab thì resume bằng một tab mới sau khi reacquire lease.
11. Để tránh crash tạo orphan giữa lúc mở tab và lưu tab ID:
    - lưu runner ở phase `RESERVING_TAB`;
    - tạo tab nền trỏ tới extension-owned `runner.html`;
    - lưu tab ID/ownership;
    - điều hướng chính tab đó sang Facebook.
12. Nếu Facebook mở child tab từ automation tab, extension đóng đúng child tab đó và fail an toàn; không tác động tab không chứng minh được ownership.

### 9.4. State machine

```mermaid
stateDiagram-v2
    [*] --> IDLE
    IDLE --> CLAIMING: START_JOB
    CLAIMING --> OPENING_TAB: lease acquired
    CLAIMING --> WAITING: extension/API unavailable
    WAITING --> CLAIMING: recovery/start signal
    CLAIMING --> CANCELLING: cancel
    CLAIMING --> INTERRUPTED: lease/network lost
    OPENING_TAB --> AUTH_CHECK
    OPENING_TAB --> CANCELLING: cancel
    OPENING_TAB --> INTERRUPTED: tab/lease lost
    AUTH_CHECK --> RUNNING: logged in
    AUTH_CHECK --> NEEDS_LOGIN: login/checkpoint/captcha
    AUTH_CHECK --> CANCELLING: cancel
    RUNNING --> UPLOADING
    UPLOADING --> RUNNING: next task
    UPLOADING --> CANCELLING: cancel
    UPLOADING --> INTERRUPTED: ACK/lease lost
    RUNNING --> CANCELLING: cancel requested
    RUNNING --> COMPLETING: tasks finished
    RUNNING --> FAILED: fatal/timeout
    RUNNING --> INTERRUPTED: tab/lease lost
    CANCELLING --> CLEANUP
    COMPLETING --> CLEANUP
    NEEDS_LOGIN --> CLEANUP
    FAILED --> CLEANUP
    INTERRUPTED --> CLEANUP
    CLEANUP --> IDLE: tab closed + lease released
```

### 9.5. Khả năng phục hồi Manifest V3

- Không giữ job state quan trọng chỉ trong global variable.
- Dùng `chrome.storage.local` cho checkpoint cần sống qua browser restart.
- Dùng `chrome.storage.session` cho cache không cần sống qua restart.
- Credential dài hạn đặt access level `TRUSTED_CONTEXTS`; content script không được đọc.
- Đăng ký listener đồng bộ khi service worker load.
- Mỗi lần startup/heartbeat, extension reconcile runner local với backend và hỏi job `waiting_extension/interrupted` có thể claim; external `START_JOB` chỉ là fast path, không phải tín hiệu duy nhất.
- Heartbeat trong lúc content script đang hoạt động.
- `chrome.alarms` 30–60 giây chỉ là recovery/watchdog, không dùng làm cơ chế cập nhật UI 5 giây.
- Upload batch nhỏ để một lần lỗi không mất toàn bộ job.
- Mọi API ghi hỗ trợ idempotency.
- Mọi batch/checkpoint kèm lease token và fencing token; backend từ chối stale runner sau takeover.
- Message từ web chỉ mang `jobId + nonce`; extension tải snapshot đã validate từ backend, không thực thi selector, JavaScript hoặc arbitrary URL do webpage gửi.

### 9.6. Quy tắc DOM automation

- Ưu tiên canonical `href`, URL pattern, `aria-*` và role hơn class CSS ngẫu nhiên.
- Adapter có version; selector tách khỏi orchestration.
- Có fixture HTML đã làm sạch dữ liệu để test từng selector.
- Mỗi action có timeout, expected state và error code cụ thể.
- Dừng ngay ở CAPTCHA/checkpoint/2FA; không bypass.
- Không chạy song song group hoặc keyword trong nhiều tab.
- Throttle ở mức an toàn và có jitter nhỏ để tránh tạo tải dồn, nhưng không có cơ chế che giấu automation.

## 10. Connector theo nền tảng

| Nền tảng | Cách lấy dữ liệu dự kiến | Phạm vi release | Điều kiện bật |
|---|---|---|---|
| Facebook | Extension trong Chrome đã đăng nhập, chỉ nội dung được phép xem | MVP | Phê duyệt nội bộ về quyền/điều khoản và UAT bằng tài khoản test |
| TikTok | API chính thức phù hợp use case; ưu tiên Research API nếu đủ điều kiện | Phase 2 | App/Research access được duyệt, credential và quota hợp lệ |
| Threads | Extension dùng Threads Web Search/replies trong phiên Chrome đã đăng nhập | MVP | Extension 0.2.0+, tài khoản Threads đăng nhập và UAT DOM thật |

Mọi connector implement cùng interface:

```ts
interface SocialConnector {
  validateConnection(): Promise<ConnectionStatus>;
  discoverSources(input: DiscoverSourcesInput): Promise<SourcePage>;
  searchPosts(input: SearchPostsInput): Promise<PostPage>;
  listComments(input: ListCommentsInput): Promise<CommentPage>;
}
```

Facebook và Threads adapter chạy phía extension; TikTok connector tương lai có thể chạy backend. Tất cả trả về DTO chuẩn hóa chung trước khi ghi database.

TikTok cần feasibility spike riêng: Research API có keyword/comment nhưng không phải quyền truy cập thương mại đại trà và chỉ mở cho hồ sơ đủ điều kiện. Nếu dự án không đủ điều kiện, connector phải dùng một kênh được TikTok phê duyệt hoặc dừng ở import hợp lệ.

## 11. Job model và trạng thái

### 11.1. Loại job

- `DISCOVER_SOURCES`;
- `CRAWL_CONTENT`;
- `ANALYZE_SENTIMENT`;
- `REBUILD_AGGREGATES`;
- `DELETE_EXPIRED_DATA`.

### 11.2. Trạng thái job

```text
queued
  -> waiting_extension
  -> running
  -> processing_ai
  -> completed

Nhánh phục hồi:
claiming/opening/running/uploading
  -> interrupted
  -> waiting_extension
  -> running

Nhánh hành động/kết thúc:
needs_login
partial
cancelled
failed
```

`interrupted` là trạng thái có thể phục hồi khi tab bị đóng, browser restart, mất lease hoặc mất heartbeat. Cancel có thể được yêu cầu từ mọi trạng thái chưa kết thúc; timeout/lease-lost từ `claiming`, `opening`, `running` hoặc `uploading` đều phải hội tụ về cleanup rồi `interrupted`, `partial` hoặc `failed` theo khả năng resume. `needs_login` giữ job/action context nhưng không giữ tab/lease.

Không dùng `completed` nếu còn AI task bắt buộc chưa xử lý. Nếu crawl xong nhưng một phần content phân tích lỗi sau retry, job kết thúc `partial`.

### 11.3. Progress contract

```json
{
  "stage": "running",
  "currentSource": "Tên group",
  "sourcesTotal": 10,
  "sourcesDone": 4,
  "tasksTotal": 40,
  "tasksDone": 17,
  "postsScanned": 320,
  "postsMatched": 18,
  "postsSaved": 18,
  "commentsSaved": 246,
  "sentimentTotal": 264,
  "sentimentDone": 180,
  "lastHeartbeatAt": "2026-07-30T10:00:00Z"
}
```

Các counter chỉ tăng theo transaction hoặc được tính lại idempotently; retry không được làm counter tăng sai.

## 12. Mô hình dữ liệu PostgreSQL

### 12.1. Bảng chính

| Bảng | Mục đích / trường quan trọng |
|---|---|
| `workspaces` | Tenant boundary, timezone, retention |
| `users` | Admin/viewer, password hash/session metadata |
| `extension_devices` | installation ID, token hash, version, status, last seen, current job |
| `platform_connections` | platform, status, encrypted credential reference, metadata |
| `platform_settings` | platform, lookback preset, crawl comment flag, limits |
| `keywords` | value, normalized value, match mode, active |
| `sources` | platform, external ID, name, canonical URL, active, last discovered |
| `monitored_sources` | workspace + source + selected |
| `crawl_jobs` | type, platform, status, settings snapshot, progress, error, timestamps |
| `crawl_tasks` | job, source, keyword, state, attempt, checkpoint, lease |
| `crawl_events` | sequence, job, level, type, safe payload, timestamp |
| `crawler_slots` | device, platform, job, lease token hash, fencing token, lease expiry |
| `ingest_batches` | idempotency key, job, checksum, received count |
| `posts` | platform, external ID, source, URL, body, published/collected time, author name, anonymous flag/kind |
| `comments` | platform, external ID, post, parent comment, `observed_order`, body, published/collected time, author name, anonymous flag/kind |
| `keyword_hits` | keyword + entity reference + match excerpt |
| `sentiment_queue` | post/comment cần phân tích, trạng thái queued/processing/completed/failed, attempt và lease |
| `sentiment_analyses` | entity, analysis input hash, relevance, label, confidence, provider/model/prompt/schema version |
| `sentiment_overrides` | human label, reason, actor, timestamp |
| `audit_logs` | security/settings/admin actions |

`sentiment_queue.post_context` giữ nội dung bài post; `conversation_context`
giữ chuỗi reply cha tối đa 8 cấp. Hai trường chỉ làm ngữ cảnh giải nghĩa, không
được cộng trực tiếp vào sắc thái của entity đang phân tích.

### 12.2. Ràng buộc unique

- `(workspace_id, platform, normalized_value)` trên keyword.
- `(workspace_id, platform, external_id)` trên source.
- `(workspace_id, platform, external_id)` trên post.
- `(workspace_id, platform, external_id)` trên comment.
- `(job_id, sequence)` trên event.
- `(job_id, idempotency_key)` trên ingest batch.
- `(entity_type, entity_id, analysis_input_hash, provider, model, prompt_version, schema_version)` trên sentiment.
- Một partial unique active lease cho `(extension_device_id, platform = facebook)`.
- `crawler_slots` có primary key `(extension_device_id, platform)`; takeover luôn tăng `fencing_token`.

### 12.3. Index cần có

- `posts(platform, published_at DESC)`.
- `comments(post_id, observed_order, published_at)`.
- `crawl_jobs(workspace_id, status, created_at DESC)`.
- `crawl_events(job_id, sequence)`.
- `sentiment_analyses(label, analyzed_at DESC)`.
- `keyword_hits(keyword_id, entity_type, entity_id)`.
- GIN/trigram cho text search nội bộ khi khối lượng dữ liệu đủ lớn.

### 12.4. Retention và dữ liệu cá nhân

- Không lưu cookie/password/session Facebook.
- Chỉ lưu tên hiển thị tác giả, `is_anonymous` và `author_kind = real|anonymous|unknown`.
- Không thu thập/lưu platform author ID, username/handle, avatar URL hoặc profile URL; tên tác giả không được render thành link.
- Nhận diện ẩn danh theo nhãn VN/EN hiển thị trên Facebook; không suy luận danh tính từ DOM ID, ảnh hoặc request mạng.
- Raw diagnostic DOM bị tắt mặc định; nếu bật để debug phải redact và tự xóa trong 7 ngày.
- Dữ liệu content mặc định giữ 180 ngày; cấu hình được theo workspace.
- Audit log giữ tối thiểu 365 ngày.
- Có job xóa dữ liệu hết hạn và khả năng xóa theo source/job.

## 13. API dự kiến

### 13.1. Auth và extension

| Method | Endpoint | Mục đích |
|---|---|---|
| `POST` | `/api/v1/extension/pairing-codes` | Tạo code một lần |
| `POST` | `/api/v1/extension/pair` | Ghép extension |
| `DELETE` | `/api/v1/extension/devices/{id}` | Revoke device |
| `POST` | `/api/v1/extension/heartbeat` | Trạng thái/renew lease |
| `GET` | `/api/v1/extension/status` | Web đọc trạng thái |

### 13.2. Settings và sources

| Method | Endpoint | Mục đích |
|---|---|---|
| `GET` | `/api/v1/settings/{platform}` | Đọc Settings |
| `PUT` | `/api/v1/settings/{platform}` | Lưu Settings |
| `GET` | `/api/v1/keywords` | Danh sách keyword |
| `POST` | `/api/v1/keywords` | Thêm keyword |
| `PATCH` | `/api/v1/keywords/{id}` | Sửa/bật/tắt |
| `DELETE` | `/api/v1/keywords/{id}` | Xóa keyword |
| `GET` | `/api/v1/sources?platform=facebook` | Danh sách group |
| `PUT` | `/api/v1/sources/selection` | Lưu checkbox |

### 13.3. Jobs

| Method | Endpoint | Mục đích |
|---|---|---|
| `POST` | `/api/v1/jobs/discover-sources` | Tạo job lấy group |
| `POST` | `/api/v1/jobs/crawl` | Tạo job crawl |
| `GET` | `/api/v1/jobs/{id}` | Trạng thái/progress |
| `GET` | `/api/v1/jobs/{id}/events` | Event sau sequence |
| `POST` | `/api/v1/jobs/{id}/cancel` | Yêu cầu hủy |
| `POST` | `/api/v1/extension/jobs/{id}/claim` | Extension claim + lease |
| `POST` | `/api/v1/extension/jobs/{id}/batches` | Ingest batch idempotent |
| `POST` | `/api/v1/extension/jobs/{id}/events` | Gửi event/progress |
| `POST` | `/api/v1/extension/jobs/{id}/complete` | Complete/partial |
| `POST` | `/api/v1/extension/jobs/{id}/fail` | Fail/needs-login |

### 13.4. Listening và dashboard

| Method | Endpoint | Mục đích |
|---|---|---|
| `GET` | `/api/v1/listening/posts` | Bài post kèm metadata, keyword và trạng thái/kết quả sentiment |
| `GET` | `/api/v1/listening/comments` | Comment/reply kèm toàn bộ context post và keyword |
| `GET` | `/api/v1/dashboard/summary` | KPI sentiment post/comment |
| `GET` | `/api/v1/dashboard/timeline` | Chuỗi thời gian nội dung đã parse |
| `POST` | `/api/v1/sentiment/analyze-all` | Queue thủ công toàn bộ post/comment chưa có kết quả |
| `POST` | `/api/v1/sentiment/{entityType}/{entityId}/override` | Human override cho post/comment |

Mọi endpoint ghi dùng request ID; ingest batch bắt buộc có `Idempotency-Key`. Extension token chỉ có quyền extension endpoints, không có quyền admin Settings.

## 14. Keyword filtering

### 14.1. Normalize

```text
trim
-> Unicode NFKC
-> collapse whitespace
-> locale-aware lowercase
```

Không bỏ dấu tiếng Việt mặc định vì có thể tạo false positive; có thể bổ sung alias có/không dấu như keyword riêng.

### 14.2. Match hai lớp

1. Extension prefilter để giảm dữ liệu và số lần mở post.
2. Backend chạy lại cùng shared matcher trước khi lưu `keyword_hit`.

Backend là nguồn sự thật. Shared test vectors phải đảm bảo extension và backend trả cùng kết quả.

### 14.3. Quy tắc

- `whole_word`: phù hợp `VSF`, dùng biên Unicode-aware.
- `contains_phrase`: phù hợp cụm từ.
- Post phải match ít nhất một keyword đang bật trong snapshot.
- Comment không bắt buộc lặp lại keyword vì ngữ cảnh nằm ở bài post.
- Lưu keyword nào đã match để dashboard filter chính xác.

## 15. AI sentiment

### 15.1. Contract

```json
{
  "isRelevant": true,
  "label": "positive",
  "confidence": 0.91,
  "reason": "Nội dung thể hiện đánh giá tích cực.",
  "language": "vi"
}
```

`label` chỉ nhận `positive`, `negative`, `neutral`. Lỗi vận hành nằm ở `analysis_status`, không tạo nhãn sentiment thứ tư.

Nội dung có `isRelevant = false` vẫn giữ tri-state label để đúng contract, nhưng mặc định bị loại khỏi KPI sentiment/listening; UI cho phép mở bộ lọc xem lại các false match này.

### 15.2. Input

- Post: post text và topic/target `VinSmart Future`.
- Comment/reply: comment text + ngữ cảnh bài post + chuỗi reply cha tối đa 8 cấp.
- Không gửi group member ID, author ID hoặc dữ liệu ghép extension.
- Giới hạn độ dài và cắt theo chiến lược ổn định.

### 15.3. Độ tin cậy

- `confidence < 0.60`: `needs_review = true`.
- Human override không ghi đè bản AI; lưu thành record audit riêng.
- Dashboard dùng effective label: override mới nhất nếu có, nếu không dùng AI label.
- Có tập đánh giá tiếng Việt gồm:
  - khen trực tiếp;
  - chê trực tiếp;
  - thông tin trung tính;
  - phủ định;
  - so sánh;
  - slang;
  - mỉa mai;
  - comment chỉ hiểu khi có bài post hoặc chuỗi reply cha.

### 15.4. Kiểm soát chi phí

- Cache theo toàn bộ analysis input hash + provider + model + prompt/schema version; comment giống chữ nhưng khác bài post/chuỗi reply không được dùng chung cache.
- Chỉ queue khi người dùng bấm `Phân tích tất cả`; crawl không tự gọi AI.
- Phân tích post đã match và comment/reply của post đó; entity đã có kết quả hoặc đang queue/processing không bị gửi lại.
- Batch nếu provider hỗ trợ.
- Theo dõi token/request/cost theo job.
- Budget guard theo ngày và theo job.
- Khi hết budget, job `partial` và dữ liệu chờ phân tích không bị xóa.

## 16. Bảo mật, quyền riêng tư và tuân thủ

### 16.1. Cổng bắt buộc trước UAT Facebook

Meta công khai rằng tự động thu thập dữ liệu Facebook khi chưa có sự cho phép có thể vi phạm điều khoản. Vì vậy trước khi bật crawl trên tài khoản thật cần:

1. Xác nhận use case và quyền truy cập với chủ dữ liệu/workspace.
2. Rà soát điều khoản Meta và yêu cầu pháp lý tại nơi vận hành.
3. Chỉ thử nghiệm bằng tài khoản và group được phép.
4. Ghi rõ mục đích, retention và ai được xem dữ liệu.
5. Không triển khai kỹ thuật né phát hiện, CAPTCHA, rate limit hoặc checkpoint.

Nếu không có cơ sở cho automation, thay Facebook connector bằng phương án được cấp quyền chính thức hoặc luồng import dữ liệu hợp lệ. Đây là release gate, không phải việc để xử lý sau production.

### 16.2. Biện pháp kỹ thuật

- HTTPS bắt buộc ngoài localhost.
- Password dùng Argon2id hoặc provider auth tương đương.
- Session cookie: `HttpOnly`, `Secure`, `SameSite=Lax/Strict`.
- CSRF protection cho session-authenticated mutation.
- Extension token ngắn quyền, rotate/revoke được.
- Secret chỉ qua environment/secret manager.
- Credential TikTok mã hóa at rest; Threads Web không lưu credential/token.
- CORS và `externally_connectable` allowlist chính xác origin.
- Rate limit auth, pairing, job start và ingest.
- Validate Zod ở mọi trust boundary.
- Log redaction.
- Audit thay đổi Settings, device, job và human override.
- Backup PostgreSQL mã hóa và kiểm tra restore định kỳ.

## 17. Cấu trúc mã nguồn hiện tại

```text
Social_listeningv2/
├─ app/                       # Next App Router/Vinext web
├─ apps/
│  └─ extension/             # Chrome MV3 extension
├─ packages/
│  └─ contracts/             # Zod schema và shared types
├─ services/
│  ├─ api/                   # Fastify API và migrations 001–010
│  └─ worker/                # Sentiment worker
├─ docs/
│  ├─ images/                # Ảnh kiến trúc/công nghệ
│  ├─ AUTHOR_PRIVACY.md      # Contract danh tính tối thiểu
│  ├─ DATA_DICTIONARY.md     # Từ điển dữ liệu
│  └─ READ_ONLY_FACEBOOK.md  # Allowlist hành vi chỉ đọc
├─ scripts/
│  └─ smoke-e2e.ps1          # Smoke test API/PostgreSQL/worker
├─ .env.example
├─ compose.yaml
├─ Dockerfile
├─ package.json
└─ PROJECT_PLAN.md
```

Extension build ra artifact riêng; extension không chạy trong Docker.

## 18. Docker Compose

### 18.1. Services

| Service | Vai trò |
|---|---|
| `postgres` | Database + queue |
| `api` | REST API |
| `worker` | Claim và xử lý sentiment |
| `web` | Vinext/React web |
| `migrate` | One-shot migration trước khi API nhận traffic |
| `ollama` | Provider local tùy chọn, chỉ bật bằng Compose profile |

### 18.2. Trạng thái Compose hiện tại

- `postgres` và `api` có healthcheck; `migrate` là one-shot service.
- `api` và `worker` chỉ khởi động sau khi `migrate` hoàn tất.
- PostgreSQL và Ollama dùng named volume.
- Có `.env.example`; secret không được commit.
- Web mặc định ở `http://localhost:3000`, API ở `http://localhost:4000`.
- Local developer chạy toàn bộ stack bằng:

```bash
docker compose up --build
```

- Extension dùng API localhost qua manifest hiện tại.
- Việc còn lại trước production: thêm healthcheck cho `worker`/`web`, reverse proxy/TLS, backup/restore và cấu hình secret production.

## 19. Biến môi trường đang dùng

```text
NODE_ENV=
NEXT_PUBLIC_API_BASE_URL=
WEB_PORT=
DATABASE_URL=
WORKSPACE_ID=
DEVICE_ONLINE_SECONDS=
LEASE_TTL_SECONDS=
ADAPTER_VERSION=
CORS_ORIGINS=
SENTIMENT_PROVIDER=
SENTIMENT_MODEL=
SENTIMENT_BASE_URL=
SENTIMENT_API_KEY=
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.6-terra
OPENAI_BASE_URL=https://api.openai.com/v1
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.6-flash
GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
MIMO_API_KEY=
MIMO_BASE_URL=https://api.xiaomimimo.com/v1
MIMO_MODEL=mimo-v2.5-pro
SENTIMENT_TOPIC=VinSmart Future
ALLOW_HEURISTIC_FALLBACK=
```

`SENTIMENT_PROVIDER=auto` ưu tiên OpenAI, rồi Gemini, rồi MiMo. Không đưa Facebook username/password/cookie hoặc API key thật vào Git.

## 20. Chiến lược kiểm thử

### 20.1. Unit test

- Keyword normalize/match.
- Date window, timestamp parsing và timezone.
- Job state transition.
- Lease acquire/renew/release.
- Tab ownership/cleanup.
- Batch idempotency.
- DTO/schema validation.
- Sentiment structured-output parser.
- Confidence/review/effective label.

### 20.2. Integration test

- API + PostgreSQL migration.
- Pairing code một lần và revoke device.
- Chỉ một active Facebook lease/device.
- Upsert group/post/comment.
- Retry cùng idempotency key.
- Worker retry và cache sentiment.
- Hủy job và stale heartbeat.
- Retention cleanup.

### 20.3. Extension test

- Vitest + JSDOM với trang fixture mô phỏng:
  - danh sách group;
  - group search result;
  - post rút gọn;
  - comment/reply;
  - login required;
  - checkpoint/CAPTCHA marker;
  - DOM thiếu selector;
  - infinite scroll dừng.
- Kiểm tra không tạo tab thứ hai.
- Kiểm tra tab đóng ở mọi terminal state.
- Restart service worker giữa job và resume từ checkpoint.
- Không gửi field nhạy cảm trong batch.

CI không tự crawl Facebook thật. Live UAT chỉ chạy thủ công trong phạm vi đã được cho phép.

### 20.4. Kết quả xác minh gần nhất

Lệnh chạy tại repository root ngày 2026-07-31:

```bash
npm run test:all
npm run build:all
docker compose config --quiet
```

| Thành phần | Số test pass |
|---|---:|
| Web | 3 |
| Extension | 62 |
| API | 33 |
| Worker | 12 |
| **Tổng** | **110** |

Kết quả: `110/110` test pass, không có test fail/skipped/todo; web, contracts, API, worker và extension đều build thành công; cấu hình Docker Compose hợp lệ. Bước web test đã render thành công ba route `/`, `/jobs` và `/settings`.

### 20.5. Web E2E

- Lưu bốn keyword mặc định.
- Thêm/xóa/bật/tắt keyword.
- Chọn group và giữ lựa chọn sau reload.
- Tạo job khi hợp lệ.
- Chặn tạo job khi extension offline/không có group/keyword.
- Poll progress 5 giây.
- Hủy job.
- Filter dashboard.
- Human sentiment override.

### 20.6. AI evaluation

- Bộ dữ liệu nhãn tay ban đầu tối thiểu 200 mẫu tiếng Việt.
- Tách train/prompt-tuning và holdout evaluation.
- Ghi confusion matrix cho ba nhãn.
- Chưa release nếu bộ holdout chưa được người phụ trách nghiệp vụ duyệt.
- Theo dõi drift theo model/prompt version.

## 21. Milestone và task graph

Ước lượng dưới đây cho một kỹ sư full-stack có kinh nghiệm, chưa tính thời gian chờ duyệt quyền từ nền tảng.

| Mốc | Nội dung | Trạng thái as-built | Phụ thuộc | Ước lượng gốc |
|---|---|---|---|---:|
| M0 | Chốt compliance, UX và tiêu chí dữ liệu | Một phần — đã có privacy/read-only contract; còn UAT và release gate | Không | 2–3 ngày |
| M1 | Monorepo, Docker, PostgreSQL, migration | Hoàn thành ở local; chưa ghi nhận CI production trong repository | M0 | 3–4 ngày |
| M2 | Settings, keyword, source schema | Hoàn thành phạm vi một workspace/admin | M1 | 4–5 ngày |
| M3 | Extension pairing, heartbeat, bridge, single-tab lease | Hoàn thành, có fixture/unit test | M1–M2 | 5–7 ngày |
| M4 | Facebook group discovery + selection | Hoàn thành mã; tiếp tục UAT DOM thật | M3 | 5–7 ngày |
| M5 | Facebook post/comment/reply crawl + checkpoint + ingest | Hoàn thành mã; tiếp tục UAT coverage/lazy-load | M4 | 8–12 ngày |
| M6 | AI sentiment, dedupe/cache và review state | Hoàn thành luồng phân tích thủ công; còn holdout evaluation | M2 + M5 | 5–7 ngày |
| M7 | Dashboard, progress polling, cancel, errors | Hoàn thành | M3 + M5 + M6 | 4–6 ngày |
| M8 | Hardening, privacy, fixture/E2E/UAT, runbook | Đang thực hiện | M7 | 5–7 ngày |
| M9 | TikTok connector | Chưa bắt đầu — chờ API/quyền truy cập | M8 + API approval | 6–10 ngày |
| M10 | Threads Web collector | Đã triển khai mã extension/API/UI; chờ smoke test live | M8 + extension 0.2.0 | 5–8 ngày |

Facebook MVP dự kiến khoảng `41–58 developer-days`. Ba nền tảng dự kiến khoảng `52–76 developer-days`, chưa tính lead time App Review/Research access và thời gian sửa adapter khi UI nền tảng thay đổi.

Trạng thái tổng hợp: phần mã Facebook MVP từ M1–M7 đã chạy; M0/M8 còn các gate vận hành, compliance, UAT và runbook. M9 chưa triển khai; M10 đã hoàn thành mã và còn smoke test Threads thật.

### 21.1. Thứ tự build chi tiết

#### M0 — Discovery và release gates

- Xác nhận tên brand/topic và bốn keyword mặc định.
- Xác nhận phạm vi group/tài khoản dùng cho UAT.
- Duyệt retention và dữ liệu tác giả.
- Chốt AI provider/budget.
- Chốt domain local/staging/production để build allowlist extension.
- Viết dữ liệu mẫu và acceptance test.

#### M1 — Foundation

- Khởi tạo Git/monorepo.
- TypeScript strict mode, lint, format, test.
- Compose services và healthcheck.
- Database migration workflow.
- Shared config/contracts.
- CI build/test.

#### M2 — Web/API Settings

- Admin auth.
- Ba tab Settings.
- Keyword CRUD/seed.
- Lookback settings.
- Source list/selection.
- Feature flag TikTok; Threads Web được bật qua extension 0.2.0+.

#### M3 — Extension core

- Manifest V3.
- Pairing popup.
- External bridge allowlist.
- Device heartbeat.
- Job claim/lease.
- Single-tab manager.
- Checkpoint/watchdog/cleanup.

#### M4 — Group discovery

- Facebook auth state detector.
- Joined-groups adapter.
- Scroll/dedupe/canonical URL.
- Batch ingest/progress.
- Web table + checkbox/link.

#### M5 — Crawl engine

- Job/task snapshot.
- Group search by keyword.
- Date parsing/time-window validation.
- Post extractor.
- Comment/reply extractor.
- Batch idempotency.
- Resume/cancel/partial error.

#### M6 — Sentiment

- Provider interface.
- Structured prompt/versioning.
- Worker queue/retry.
- Cache/cost guard.
- Aggregates.
- Review/override.

#### M7 — Dashboard

- Job widget.
- 5-second polling/event cursor.
- Summary/timeline/source breakdown.
- Comment/reply filters kèm metadata bài post và keyword.
- Empty/loading/error/partial states.

#### M8 — Release hardening

- Security/privacy review.
- Extension fixture suite.
- API integration/E2E.
- AI holdout evaluation.
- Backup/restore test.
- Observability.
- UAT và runbook.

## 22. Acceptance criteria MVP

### 22.1. Extension và tab

- Một device không chạy đồng thời hai Facebook job.
- Không tồn tại đồng thời hơn một Facebook automation tab do extension sở hữu; tab thay thế chỉ được tạo sau khi tab cũ đã được xác nhận không còn và lease được reacquire.
- Tab được mở nền và mọi task bình thường dùng lại cùng tab.
- Khi Chrome đang hoạt động, tab extension tạo đóng ngay sau mọi terminal state; nếu browser crash/tắt đột ngột, startup reconciliation dọn đúng owned tab ngay lần Chrome/extension hoạt động lại.
- Extension không đóng tab người dùng tự mở.
- Browser/service worker restart không tạo job hoặc tab trùng.
- Mất external `START_JOB` không làm mất job; extension nhận lại job ở lần startup/heartbeat/alarm tiếp theo.
- Stale runner sau lease takeover bị backend từ chối bằng fencing token.
- Backend không nhận Facebook cookie, password hoặc session token.

### 22.2. Group

- Bấm `Lấy danh sách group` tạo job và thấy tiến độ.
- Group thu được có tên và link hợp lệ.
- Group trùng chỉ có một dòng.
- Checkbox được giữ sau reload.
- Group không còn thấy chỉ được đánh dấu inactive sau một discovery `complete`; scan `partial/unknown` không thay đổi active state.
- Chưa login chuyển `needs_login` và cleanup tab.

### 22.3. Settings

- Có đủ ba tab Facebook/TikTok/Threads.
- Facebook và Threads active; TikTok thể hiện đúng trạng thái feature flag.
- Có sẵn đúng bốn keyword yêu cầu.
- Keyword normalize và không lưu trùng.
- Có đủ hôm nay/3/7/30 ngày.
- Job đang chạy không bị thay đổi bởi Settings mới.

### 22.4. Crawl

- Chỉ source đã tick được đưa vào snapshot.
- Chỉ post match ít nhất một keyword được lưu; feed ưu tiên comment/reply nhưng post vẫn có trạng thái và kết quả AI riêng.
- Post ngoài `window_start_utc..window_end_utc` không xuất hiện trong kết quả.
- Comment chỉ được lấy từ post match.
- Post context lưu source, URL, body, tác giả name-only/anonymous, thời gian đăng, thời gian thu thập, trạng thái parse và toàn bộ keyword khớp.
- Comment/reply lưu thời gian comment, thời gian thu thập, quan hệ comment cha, `observed_order` và kế thừa keyword của post context khi hiển thị/lọc.
- Reply nhiều bậc giữ đúng cây Facebook; UI thụt theo depth thực tế và chỉ giới hạn độ rộng hiển thị, không ép dữ liệu về hai bậc.
- Parent reply được xác định theo thứ tự ưu tiên: DOM explicit, comment root lồng gần nhất, tên người được reply trong cùng thread, rồi `comment_id` URL fallback.
- Post/comment lưu được tên hiển thị và phân biệt `real|anonymous|unknown`.
- Extension không nhập text, Like, Share, đăng bài hoặc gửi comment; chỉ click allowlist nút xem/tải thêm nội dung.
- Payload có profile URL, platform author ID, username/handle hoặc avatar URL bị API từ chối; UI không tạo link từ tên tác giả.
- Retry không sinh duplicate.
- Một source lỗi không xóa dữ liệu source khác.
- Cancel từ web làm extension dừng, checkpoint, release lease và đóng tab.
- Khi dashboard đang visible, progress backend mới xuất hiện trên web trong `5 giây + network/render latency`; focus lại tab sẽ fetch ngay và terminal state luôn có final fetch.
- Mất heartbeat quá TTL không tiếp tục hiển thị giả là đang chạy bình thường.

### 22.5. AI

- Phân tích thành công có đúng một nhãn positive/negative/neutral.
- `entity_type = post|comment` được queue/claim khi người dùng bấm `Phân tích tất cả`.
- Dữ liệu mới mặc định `Chờ AI`; crawl không tự tạo request AI.
- Có confidence, relevant, provider/model và prompt version.
- Analysis input/provider/model/prompt/schema không đổi thì không gọi AI lại.
- Confidence thấp được đưa vào review.
- AI lỗi không làm mất post context/comment.
- Bộ holdout tiếng Việt được duyệt trước release.

### 22.6. Hạ tầng

- `docker compose up --build` khởi động stack sau khi điền `.env`.
- Migration chạy được trên database mới.
- Healthcheck pass.
- Backup có thể restore vào database test.
- Log không chứa secret hoặc Facebook session.

## 23. Rủi ro và giảm thiểu

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| Automation không phù hợp điều khoản Facebook | Rất cao | Compliance gate, chỉ dùng phạm vi được phép, ưu tiên API/luồng được cấp quyền |
| Facebook đổi DOM/React markup | Cao | Adapter version, selector theo URL/ARIA, fixture tests, diagnostic redact |
| Comment “Most relevant”, ẩn hoặc lazy-load | Cao | Chọn all-comments khi có, expand tới cap, công khai coverage thực |
| Group search bị ranking, không theo thời gian tuyệt đối | Cao | Lưu crawl method, time-window validation backend, không cam kết 100% coverage |
| Background tab bị throttle | Cao | Watchdog, timeout, checkpoint, cảnh báo cần foreground nếu gặp |
| MV3 service worker suspend | Cao | Persistent checkpoint, backend lease, idempotent API, alarms recovery |
| Login hết hạn/2FA/CAPTCHA | Cao | `needs_login`, cleanup, hướng dẫn người dùng; không bypass |
| Extension đóng nhầm tab | Cao | Ownership record; chỉ `TabLeaseManager` được đóng tab |
| Rò rỉ dữ liệu cá nhân | Cao | Chỉ lưu display name + anonymous flag, cấm profile link/ID, encryption, RBAC, retention, redaction |
| Duplicate do retry | Trung bình | Unique constraints, upsert, idempotency key |
| Sentiment sai với mỉa mai/slang | Trung bình | Context, confidence, holdout tiếng Việt, human review |
| AI cost tăng | Trung bình | Prefilter, cache, batch, budget guard |
| TikTok không được cấp quyền | Cao | Feature flag, connector boundary, không giả lập chức năng |
| Threads đổi DOM/search ranking | Cao | Adapter fixture, fail closed và coverage `partial/unknown` |
| Máy/Chrome tắt giữa job | Trung bình | Lease TTL, resume checkpoint; UI hiển thị interrupted |

## 24. Observability và runbook

### 24.1. Metrics

- Job theo status/platform.
- Job duration và partial/failure rate.
- Extension heartbeat age.
- Active/stale lease.
- Posts scanned/matched ratio.
- Comment coverage thực tế.
- Batch retry/idempotency hit.
- Selector failure theo adapter version.
- AI latency/error/cost/cache hit.
- Poll API latency.

### 24.2. Structured log fields

```text
request_id
workspace_id
job_id
task_id
device_id
platform
adapter_version
event_type
error_code
duration_ms
```

Không log raw cookie, access token, pairing code, full author identity hoặc toàn bộ DOM.

### 24.3. Alert cơ bản

- Extension mất heartbeat khi job đang chạy.
- Lease quá TTL.
- Selector failure vượt ngưỡng.
- Job failure/partial tăng đột biến.
- AI provider error/budget vượt ngưỡng.
- Database disk/connection cao.
- Backup hoặc retention job thất bại.

## 25. Definition of Done

Một milestone chỉ hoàn tất khi:

- code đã review;
- migration và rollback/forward-fix đã kiểm tra;
- unit/integration test liên quan pass;
- web state loading/empty/error đã xử lý;
- log và metric đủ để chẩn đoán;
- không có secret/PII mới trong log;
- tài liệu API/runbook được cập nhật;
- acceptance criteria tương ứng có bằng chứng;
- không còn lỗi P0/P1;
- release gate về quyền nền tảng đã được đáp ứng.

MVP chỉ được gọi là hoàn tất khi toàn bộ acceptance criteria ở mục 22 pass trong môi trường staging và UAT đã ký xác nhận.

## 26. Cấu hình và quyết định đang áp dụng

| Quyết định | Giá trị hiện tại |
|---|---|
| Tên topic chuẩn | `VinSmart Future` |
| Tên ứng dụng | `Social Listening` |
| Màu thương hiệu | Đỏ `#EB0A2A`, đen và trắng |
| Số người dùng MVP | 1 admin |
| Crawl thủ công hay lịch | Thủ công trong MVP |
| Lưu tên tác giả | Có, chỉ display name; không profile link/ID/handle |
| Retention content | 180 ngày |
| Comment cap | 500/post |
| AI confidence review | `< 0.60` |
| AI provider/model | OpenAI-compatible qua env; model mặc định `gpt-5.6-terra` |
| Cách gọi AI | Nút `Phân tích tất cả`; chỉ queue dữ liệu chưa phân tích |
| Nơi deploy | Local/staging trước; production sau UAT |
| TikTok / Threads | TikTok feature flag off; Threads Web active qua extension 0.2.0+ |

## 27. Tài liệu kỹ thuật tham chiếu

- [Chrome Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs)
- [Chrome extension service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [Chrome extension message passing và externally connectable](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)
- [Chrome Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [Meta: How We Combat Scraping](https://about.fb.com/news/2021/04/how-we-combat-scraping/)
- [Facebook Terms](https://www.facebook.com/terms)
- [Facebook Automated Data Collection Terms](https://www.facebook.com/legal/automated_data_collection_terms)
- [TikTok Research API: Getting Started](https://developers.tiktok.com/doc/research-api-get-started/)
- [TikTok Research API: Query Video Comments](https://developers.tiktok.com/doc/research-api-specs-query-video-comments)
- [Meta Threads API collection: Keyword Search](https://www.postman.com/meta/threads/request/34203612-b3b2c12a-7ce6-4d86-a3c6-6d31e3b66ea1)

Các API/quyền nền tảng có thể thay đổi. Phải kiểm tra lại tài liệu chính thức và quyền thực tế ngay trước khi bắt đầu connector tương ứng và trước mỗi release production.
