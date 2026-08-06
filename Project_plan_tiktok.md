# Kế hoạch thu thập TikTok cho VinSmart Future

> Cập nhật: 2026-08-05. Đây là tài liệu đánh giá và kế hoạch, chưa mở khóa
> collector TikTok trong code production.

## Kết luận ngắn

Có thể làm social listening trên TikTok, nhưng **không có một API chính thức dành
cho doanh nghiệp cho phép tìm mọi video organic chứa một chuỗi bất kỳ rồi đọc mọi
comment giống ô Search của Facebook**. Phương án phù hợp nhất là kết hợp nhiều
nguồn với coverage được ghi rõ:

1. **TikTok API for Business — Organic API**: hướng chính thức nên ưu tiên. Accounts
   API lấy bài và comment/reply trên tài khoản TikTok Business đã ủy quyền. Mentions
   API lấy các bài nhắc trực tiếp `@handle` doanh nghiệp, bài dùng brand hashtag đã
   cấu hình và các comment mention; có webhook. Đây là coverage rất hữu ích cho
   brand listening nhưng không phải free-text search toàn TikTok.
2. **TikTok Research API**: mạnh nhất về kỹ thuật cho query video theo keyword rồi
   lấy comment/reply, nhưng chỉ dành cho tổ chức/nghiên cứu đủ điều kiện và mục đích
   phi thương mại. Dự án thương mại ở Việt Nam không nên giả định sẽ được cấp.
3. **Nhà cung cấp dữ liệu được TikTok cho phép hoặc có căn cứ hợp đồng rõ ràng**:
   dùng để lấp khoảng trống tìm chuỗi tự do như `VinSmart Future` ngoài `@handle`
   và hashtag. Coverage phải được đo bằng POC, không tin tuyên bố “full TikTok”.
4. **Commercial Content API**: keyword search chính thức nhưng chỉ cho quảng cáo/
   commercial content; không thay thế organic comment listening.
5. **Nhập link thủ công + TikTok oEmbed**: làm được ngay cho video đã biết, nhưng
   không tự khám phá video và không lấy comment.
6. **Chrome Extension đọc TikTok Web**: khả thi về kỹ thuật nhưng chỉ là POC sau
   khi có chấp thuận bằng văn bản từ TikTok và rà soát pháp lý/privacy; không phải
   connector production mặc định.

Khuyến nghị cho dự án hiện tại: **nộp quyền TikTok API for Business ngay**, đồng
thời làm nền tảng TikTok và đường nhập link thủ công. Khi được cấp quyền, triển
khai ba luồng chính thức: bài/comment của kênh sở hữu, `@handle` mentions và brand
hashtag/comment mentions. Chỉ dùng vendor đã kiểm chứng nếu bắt buộc phải tìm
free-text rộng hơn; không xây crawler TikTok Web tự động ở giai đoạn này.

## Mục tiêu dữ liệu

### Mức 1 — video có keyword

- Theo luồng chính thức: lấy bài của kênh sở hữu, bài nhắc `@<official_handle>` và
  bài dùng brand hashtag đã cấu hình như `#VinSmartFuture`, `#VSF`.
- Theo Research API/vendor nếu có quyền: tìm thêm `VSF`, `VinSmart Future`,
  `Vinfuture`, `Vin Future` trong caption/description hoặc trường được phép.
- Lưu TikTok video ID, caption, thời gian đăng, số liệu tương tác nếu có, keyword
  hits và URL nội dung không chứa tracking.
- Chống trùng theo TikTok video ID, không theo URL thô.

### Mức 2 — comment/reply có keyword

- Lấy comment/reply trên video của tài khoản sở hữu qua Accounts API.
- Lấy comment nhắc trực tiếp doanh nghiệp qua Mentions API.
- Với video ngoài kênh sở hữu do Research API/vendor tìm thấy, chỉ lấy comment và
  reply khi connector đó có quyền và endpoint tương ứng.
- Match keyword cục bộ trên toàn bộ text comment/reply.
- Giữ `parentCommentExternalId` để dựng cây hội thoại.
- Phân biệt rõ:
  - video khớp keyword nhưng comment không khớp;
  - comment khớp keyword trong video không khớp trực tiếp;
  - coverage `complete`, `partial` hoặc `unknown`.

## So sánh các phương án

| Phương án | Tìm video keyword | Comment/reply | Setup | Coverage | Khuyến nghị |
|---|---:|---:|---:|---:|---|
| API for Business — Accounts + Mentions | `@handle`, brand hashtag và bài kênh sở hữu; không phải free-text toàn cục | Có cho video sở hữu; có comment mention | Cao, cần Business app/OAuth/quyền | Chính thức nhưng có biên rõ ràng | **Ưu tiên production** |
| Research API | Có | Có | Rất cao, phải đủ điều kiện | Tốt nhưng có độ trễ | Tốt nhất nếu được duyệt |
| Commercial Content API | Có, cho ads | Không phải API comment organic | Trung bình, cần duyệt | Chỉ ads/commercial content EU hiện tại | Là module theo dõi quảng cáo riêng |
| Display API | Không, chỉ video của user đã OAuth | Không | Trung bình, App Review/OAuth | Hẹp | Không phù hợp social listening |
| Data Portability API | Không, dữ liệu của user đã cho phép | Không phải tìm kiếm công khai | Cao | Theo từng user, chủ yếu EEA | Không phù hợp |
| oEmbed + link thủ công | Không tự tìm | Không | Thấp | Chỉ link được nhập | MVP an toàn, làm được ngay |
| Vendor được cấp phép | Tùy hợp đồng | Tùy hợp đồng | Trung bình/cao | Phải đo bằng POC | Bổ sung free-text nếu cần |
| Extension TikTok Web tự động | Có theo UI/ranking | Có phần đang render | Thấp về setup, cao về bảo trì/rủi ro | Không thể cam kết đầy đủ | Chỉ khi có chấp thuận bằng văn bản |

## Phương án 1 — TikTok API for Business (Organic API)

### Đây là gì và lấy được gì

Đây là bộ API chính thức cho doanh nghiệp. Với một TikTok Business Account đã
ủy quyền cho developer app, hai nhóm endpoint hữu ích nhất là:

**Accounts API — dữ liệu kênh sở hữu**

- `/business/video/list/`: lấy bài của tài khoản đã ủy quyền;
- `/business/comment/list/`: lấy comment public và hidden trên một video organic
  do tài khoản đó đăng;
- `/business/comment/reply/list/`: lấy reply của một comment trên video sở hữu.

**Mentions API — hội thoại nói trực tiếp tới thương hiệu**

- `/business/mention/video/list/`: top 1.000 bài nhắc `@handle` doanh nghiệp;
- `/business/mention/hashtag/video/list/`: top 1.000 bài theo brand hashtag;
- `/business/mention/comment/list/`: top 1.000 comment mention;
- endpoint quản lý tối đa 50 brand hashtag và webhook để nhận mention mới;
- endpoint thống kê keyword/hashtag thường gặp trong tập mentioned posts.

“Mentioned post” trong tài liệu TikTok là bài có caption nhắc **handle doanh
nghiệp**. “Brand hashtag” là hashtag đã được cấu hình cho Business Account. Vì
vậy một caption chỉ viết `VinSmart Future` nhưng không có `@handle` hay brand
hashtag vẫn có thể bị bỏ sót. Các endpoint “top 1.000” là tập xếp hạng/giới hạn,
không được trình bày trên UI như coverage toàn bộ TikTok.

Discovery API trong cùng bộ sản phẩm có trending/recommended search keywords,
hashtag và video thịnh hành. Nó hữu ích để mở rộng bộ từ khóa, nhưng không phải
endpoint free-text search toàn bộ video/comment.

### Flow đề xuất

```text
TikTok Business Account của VSF
  -> OAuth cấp quyền cho developer app
  -> đồng bộ bài của kênh sở hữu
  -> lấy comment/reply từng bài + match keyword cục bộ
  -> đồng bộ @handle mentions
  -> đồng bộ bài theo brand hashtag đã bật
  -> đồng bộ comment mentions
  -> nhận webhook + chạy reconcile định kỳ
  -> chuẩn hóa ID, dedupe, ingest, sentiment, checkpoint
```

Nên cấu hình hashtag sau khi xác minh hashtag hợp lệ, ví dụ
`#VinSmartFuture`, `#VinSmart_Future`, `#VSF`; không tự thêm một hashtag có thể
thuộc thương hiệu khác. Handle phải là handle chính thức của tài khoản doanh
nghiệp, không suy ra từ tên hiển thị.

### Cần chuẩn bị

1. Tạo hoặc xác nhận TikTok Business Account chính thức của VSF.
2. Tạo TikTok for Business account, đăng ký developer và tạo developer app.
3. Khai báo callback HTTPS công khai, privacy policy và data handling phù hợp.
4. Xin đúng scope tối thiểu:
   - `TikTok Accounts > Account User`;
   - `TikTok Accounts > Get Account Media`;
   - `TikTok Accounts > Account Comment > Get Business Comment`;
   - `Mentions > Content`;
   - `Mentions > Comment`.
5. Thực hiện OAuth của Business Account và đổi `auth_code` lấy access/refresh
   token ở backend. Không đưa app secret hoặc refresh token xuống frontend.
6. Bật brand hashtag hợp lệ và đăng ký webhook; vẫn chạy reconcile định kỳ để
   chống mất sự kiện.

Không ghi cứng thời gian duyệt vào kế hoạch: app và quyền phải được TikTok phê
duyệt, thời gian thực tế phụ thuộc hồ sơ/quyền/khu vực tại lúc nộp.

```env
TIKTOK_CONNECTOR=business_api
TIKTOK_BUSINESS_APP_ID=
TIKTOK_BUSINESS_APP_SECRET=
TIKTOK_BUSINESS_REDIRECT_URI=https://<domain>/api/connectors/tiktok/callback
TIKTOK_BUSINESS_WEBHOOK_SECRET=
TIKTOK_REQUEST_BUDGET_PER_JOB=50
```

## Phương án 2 — TikTok Research API

### Khả năng

Research API có endpoint query video công khai theo `keyword`, khoảng ngày, vùng,
hashtag và các điều kiện khác. `keyword` trong tài liệu được định nghĩa là keyword
trong video description. Một cửa sổ truy vấn tối đa 30 ngày, tối đa 100 video mỗi
trang, có `cursor` và `search_id` để phân trang.

Sau khi có video ID, endpoint comment có thể:

- nhận `video_id` để lấy comment của video;
- nhận `comment_id` để lấy reply của comment;
- trả tối đa 100 bản ghi mỗi trang.

Do API comment không phải global comment keyword search, flow đúng là **tìm video
trước → lấy comment/reply → match keyword cục bộ**.

### Flow đề xuất

```text
Settings > TikTok
  -> đóng băng keyword + khoảng ngày + giới hạn
  -> tạo job queued cho connector server-side
  -> chia khoảng ngày thành các đoạn <= 30 ngày
  -> query từng keyword, paginate cursor/search_id
  -> chuẩn hóa và chống trùng bằng video_id
  -> lấy comment cho từng video mới
  -> lấy reply cho comment có reply_count > 0
  -> match keyword cục bộ trên caption/comment/reply
  -> ingest batch + checkpoint bền vững
  -> complete hoặc partial với lý do cụ thể
```

### Điều kiện và giới hạn quan trọng

- Ứng viên phải thuộc vùng và tổ chức đủ điều kiện, có đề cương nghiên cứu, yêu
  cầu bảo mật dữ liệu và bằng chứng ethical review.
- Nghiên cứu phải độc lập với lợi ích thương mại và theo mục tiêu phi thương mại.
- TikTok FAQ nói rõ creator, advertiser hoặc commercial user không đủ điều kiện.
- TikTok công bố thời gian phản hồi hồ sơ thường khoảng 4 tuần, không đảm bảo.
- Quota hiện được công bố là 1.000 request/ngày và tối đa 100.000 record/ngày;
  token Research API hết hạn sau khoảng 2 giờ.
- Video mới có thể mất tới 48 giờ mới vào search index; một số chỉ số có thể chậm
  tới 10 ngày. Vì vậy đây không phải nguồn realtime tuyệt đối.

### Cấu hình cần chuẩn bị nếu đủ điều kiện

```env
TIKTOK_CONNECTOR=research_api
TIKTOK_CLIENT_KEY=
TIKTOK_CLIENT_SECRET=
TIKTOK_API_BASE_URL=https://open.tiktokapis.com
TIKTOK_REQUEST_BUDGET_PER_JOB=200
```

`TIKTOK_CLIENT_SECRET` chỉ được tồn tại trong API/worker, không gửi xuống web hay
Chrome Extension và không commit vào Git.

## Phương án 3 — Commercial Content API

Đây là API chính thức để tìm **quảng cáo và commercial content**, không phải toàn
bộ video organic. Query Ads hỗ trợ `search_term`, `exact_phrase`/`fuzzy_phrase`,
khoảng ngày và tối đa 50 kết quả mỗi trang.

TikTok hiện công bố:

- người nộp hồ sơ có thể ở bất kỳ quốc gia nào;
- dữ liệu giai đoạn hiện tại chỉ gồm các quốc gia EU;
- phản hồi hồ sơ hoàn chỉnh thường trong khoảng 2 ngày làm việc;
- API cung cấp metadata quảng cáo/advertiser/reach, không phải comment organic.

Nên triển khai thành connector riêng `tiktok-commercial-api-v1`, source riêng
`tiktok:commercial-content`, không trộn coverage với organic listening.

## Phương án 4 — Display API và Data Portability API

### Display API

Display API chỉ đọc profile và video public của **tài khoản đã OAuth cho ứng
dụng** qua `user.info.basic` và `video.list`. Endpoint query video cũng chỉ xác
nhận/lấy chi tiết video thuộc user đã ủy quyền. Nó không có global keyword search
và không có API đọc comment công khai, nên không giải quyết yêu cầu này.

### Data Portability API

Data Portability API xuất dữ liệu của từng user sau khi user cho phép, cần app,
Login Kit, Webhooks và xét duyệt. Đây là data export theo chủ thể dữ liệu, không
phải kênh tìm bài/comment công khai theo keyword.

## Phương án 5 — nhập link thủ công + oEmbed

TikTok cung cấp oEmbed chính thức:

```http
GET https://www.tiktok.com/oembed?url=<public-video-url>
```

Endpoint có thể trả title/caption, display name, thumbnail và embed HTML cho một
link video đã biết. MVP nên chỉ lấy các trường cần thiết, không lưu `author_url`,
username hoặc HTML chưa làm sạch.

Flow:

```text
Người dùng tìm trên TikTok bằng thao tác thủ công
  -> dán một hoặc nhiều URL video vào Settings > TikTok
  -> API xác thực host/path và lấy video_id
  -> gọi oEmbed để lấy caption/thumbnail cần thiết
  -> match keyword cục bộ
  -> upsert video và đưa vào sentiment pipeline
```

Ưu điểm: không cần TikTok Developer App, triển khai nhanh, dùng endpoint chính
thức. Nhược điểm: không tự khám phá video, không có comment, không có cam kết
coverage. Đây là bước đệm chứ không phải social listening đầy đủ.

## Phương án 6 — vendor dữ liệu

Chỉ chọn vendor sau một POC có dữ liệu thật với bốn keyword seed. Hợp đồng và
demo phải trả lời được:

- nguồn dữ liệu có được TikTok cho phép hay không;
- tìm caption, hashtag, transcript và comment/reply đến mức nào;
- độ trễ, vùng Việt Nam, lịch sử tối đa và tỷ lệ coverage;
- có stable video/comment ID và parent reply ID hay không;
- quota, giá theo record/request và cơ chế xóa dữ liệu;
- có được lưu text để phân tích sentiment nội bộ hay chỉ được hiển thị link;
- xử lý video/comment bị xóa và yêu cầu data subject như thế nào.

Không tích hợp vendor chỉ dựa trên lời quảng cáo “full TikTok”. POC phải đối
chiếu một tập video/comment do người dùng kiểm tra thủ công.

## Phương án 7 — TikTok Web qua Chrome Extension

### Về kỹ thuật

Có thể xây adapter tương tự Threads:

```text
tiktok.com/search?q=<keyword>
  -> đọc card video public đang render
  -> chuẩn hóa /@handle/video/<video_id> thành video_id
  -> mở từng video
  -> cuộn và mở comment/reply bằng allowlist
  -> local keyword match
  -> upload checkpoint/idempotent batch
```

Cần có watchdog/liveness, giới hạn vòng không tăng dữ liệu, skip theo video ID,
phát hiện login/CAPTCHA/challenge và tuyệt đối không Like, Follow, Share hay gửi
comment.

### Vì sao chưa chọn

TikTok Web có ranking/personalization, virtualized DOM, lazy loading, CAPTCHA và
anti-automation. Quan trọng hơn, điều khoản TikTok theo khu vực có thể hạn chế
script tự động thu thập dữ liệu; điều khoản US hiện nêu rõ scrape/crawl tự động
chỉ được phép khi TikTok chấp thuận bằng văn bản.

Do đó trạng thái của phương án này là:

```text
technically_feasible = true
production_approved = false
required_gate = written TikTok approval + legal/privacy review
```

Không dùng kỹ thuật né CAPTCHA, fingerprint, rate limit hoặc cơ chế bảo vệ.

## Tích hợp với codebase hiện tại

### Phần đã sẵn sàng

- Platform enum, database và dashboard đã biết giá trị `tiktok`.
- Settings/keyword API đã có mô hình theo platform.
- Post/comment/reply, sentiment, job progress và export PDF có thể tái sử dụng.
- Cơ chế upsert, keyword history và chống trùng đã có nền tảng.

### Phần còn thiếu

1. `createCrawlJobSchema` hiện chỉ chấp nhận `facebook | threads`.
2. API ingest và known-post lookup hiện chỉ hỗ trợ Facebook/Threads.
3. Chưa có canonical TikTok video ID/URL và kiểm tra comment ID.
4. Chưa có connector TikTok server-side hoặc TikTok content adapter.
5. Chưa có job builder/source hệ thống cho TikTok.
6. UI TikTok chưa có flow chạy thật và thông báo rõ connector đang dùng.
7. Chưa có fixture/test về URL, privacy, pagination, quota và checkpoint TikTok.

### Quy tắc URL và privacy đề xuất

- Khóa chống trùng: `video_id`, không dùng handle.
- URL lưu nội bộ ưu tiên dạng không chứa username:
  `https://www.tiktok.com/player/v1/{video_id}`.
- URL người dùng nhập chỉ dùng để trích video ID, sau đó bỏ tracking và handle.
- Comment API không cần URL: lưu external ID và `url = null` nếu không có URL
  canonical không chứa danh tính.
- Không lưu username, author ID, profile URL, cookie hoặc access token.
- Video author mặc định `unknown`; display name chỉ được nhận khi qua privacy
  validator và không có dạng handle/URL.

## Roadmap đề xuất

### Giai đoạn 0 — quyền truy cập và cổng quyết định

- [ ] Xác nhận TikTok Business Account, handle chính thức và người có quyền OAuth.
- [ ] Tạo TikTok for Business developer app; khai báo callback, privacy policy.
- [ ] Xin Accounts và Mentions scopes tối thiểu; chuẩn bị danh sách brand hashtag.
- [ ] Chốt retention, trường tác giả và quyền hiển thị nội dung TikTok.
- [ ] Xác định có thực sự cần free-text ngoài handle/hashtag hay không.
- [ ] Xin xác nhận pháp lý trước mọi crawler web tự động.

### Giai đoạn 1 — nền tảng TikTok dùng chung

- [ ] Tạo `services/tiktok-collector` hoặc worker connector server-side riêng.
- [ ] Thêm canonical video ID/URL và privacy validator.
- [ ] Mở job contract, ingest và known-post cho TikTok với test fail-closed.
- [ ] Tạo driver/connector interface thay vì thêm chuỗi ternary Facebook/Threads.
- [ ] Thêm source và coverage metadata cho từng loại nguồn TikTok.
- [ ] Thêm UI kết nối Business Account, trạng thái quyền và lỗi cần hành động.
- [ ] Thêm source `tiktok:manual-links`, oEmbed và UI nhập URL làm fallback.

### Giai đoạn 2 — API for Business production

- [ ] OAuth callback, token refresh và mã hóa secret ở backend.
- [ ] Đồng bộ `/business/video/list/`, comment và reply của kênh sở hữu.
- [ ] Đồng bộ `@handle` mentioned posts, brand hashtag posts và comment mentions.
- [ ] Đăng ký webhook; xác thực chữ ký và dedupe event.
- [ ] Reconcile theo lịch với cursor/checkpoint và request budget.
- [ ] Match keyword cục bộ, map reply parent và ghi coverage chính xác.
- [ ] Hiển thị rõ giới hạn `top 1000` và không gắn nhãn “toàn bộ TikTok”.

### Giai đoạn 3 — mở rộng free-text nếu thật sự cần

- [ ] Kiểm tra Research API chỉ khi có tổ chức/mục đích đủ điều kiện.
- [ ] Nếu không đủ, POC 2–3 vendor bằng cùng một tập kiểm thử thủ công.
- [ ] Chuẩn hóa connector được chọn về cùng DTO, checkpoint và privacy contract.
- [ ] Đo coverage/latency; có kill switch khi quyền hoặc hợp đồng thay đổi.

### Giai đoạn 4 — quảng cáo TikTok tùy chọn

- [ ] Connector Commercial Content API riêng.
- [ ] Không trộn KPI ads với organic.
- [ ] Gắn `contentKind = ad | commercial | organic` trong dữ liệu/report.

## Giới hạn chạy thử đầu tiên

Với API for Business, lần smoke test đầu tiên nên giữ đúng giới hạn nhỏ để xác
minh quyền, ID và privacy trước:

- tối đa **2 API request tổng cộng**;
- request 1: lấy tối đa 2 bài của Business Account đã OAuth;
- request 2: lấy tối đa 1 trang comment của một bài sở hữu;
- chưa lấy reply, chưa bật webhook ingest và chưa chạy backfill;
- dry-run log số record/ID/keyword hit, không log token hay handle;
- sau khi pass mới test Mentions API bằng một budget 2 request riêng.

Smoke test Mentions tiếp theo dùng một `@handle` chính thức và brand hashtag đã
xác minh. Với dữ liệu vendor/Research API, mới dùng keyword `VinSmart Future`,
một cửa sổ ngày và tối đa 2 request query video.

Sau khi kiểm chứng ID, checkpoint, keyword hit và privacy mới bỏ giới hạn tạm.

## Tiêu chí hoàn tất TikTok organic

- [ ] Có nguồn dữ liệu được phép bằng API/hợp đồng rõ ràng.
- [ ] Lấy được bài kênh sở hữu, handle mention và brand hashtag trong đúng phạm vi
      API; free-text chỉ được bật khi có connector được phép hỗ trợ.
- [ ] Lấy comment/reply hoặc ghi rõ connector không hỗ trợ.
- [ ] Chống trùng theo TikTok video/comment ID qua nhiều job.
- [ ] Không lưu handle/profile URL/token/cookie.
- [ ] Job phục hồi từ cursor và không retry vô hạn.
- [ ] Coverage, quota, độ trễ và partial reason hiển thị trên UI.
- [ ] Test contract, URL, privacy, pagination, idempotency và quota pass.
- [ ] UAT đối chiếu tập mẫu thủ công và tài liệu vận hành hoàn tất.

## Tài liệu chính thức tham khảo

- [TikTok API for Business — danh mục endpoint, scope và base URL v1.3](https://business-api.tiktok.com/gateway/docs/index?doc_id=1735713875563521&identify_key=c0138ffadd90a955c1f0670a56fe348d1d40680b3c89461e09f78ed26785164b&language=ENGLISH)
- [TikTok API for Business — Mentions API Overview](https://business-api.tiktok.com/gateway/docs/index?doc_id=1825103341635586&identify_key=c0138ffadd90a955c1f0670a56fe348d1d40680b3c89461e09f78ed26785164b&language=ENGLISH)
- [TikTok API for Business — workflow tạo account/app và gọi API đầu tiên](https://business-api.tiktok.com/gateway/docs/index?doc_id=1735713609895937&identify_key=c0138ffadd90a955c1f0670a56fe348d1d40680b3c89461e09f78ed26785164b&language=ENGLISH)
- [TikTok API for Business — OAuth authorization](https://business-api.tiktok.com/gateway/docs/index?doc_id=1738928364967937&identify_key=c0138ffadd90a955c1f0670a56fe348d1d40680b3c89461e09f78ed26785164b&language=ENGLISH)
- [Research API — sản phẩm, điều kiện và cách đăng ký](https://developers.tiktok.com/products/research-api/)
- [Research API — Query Videos](https://developers.tiktok.com/doc/research-api-specs-query-videos)
- [Research API — Query Video Comments/Replies](https://developers.tiktok.com/doc/research-api-specs-query-video-comments)
- [Research API — FAQ, quota và độ trễ dữ liệu](https://developers.tiktok.com/doc/research-api-faq)
- [Display API Overview](https://developers.tiktok.com/doc/display-api-overview/)
- [Commercial Content API](https://developers.tiktok.com/products/commercial-content-api)
- [Commercial Content API — Query Ads](https://developers.tiktok.com/doc/commercial-content-api-query-ads)
- [Data Portability API — Get Started](https://developers.tiktok.com/doc/data-portability-api-get-started)
- [TikTok oEmbed/Embed Videos](https://developers.tiktok.com/doc/embed-videos)
- [TikTok Terms of Service — bản US hiện hành, cần đối chiếu đúng khu vực sử dụng](https://t.tiktok.com/legal/page/us/terms-of-service/en)
