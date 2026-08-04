# Cấu hình Threads API — trường hợp 1: post chứa keyword

Connector hiện tại dùng API chính thức của Meta để tìm **public root post** có keyword.
Nó chỉ nhận kết quả `is_reply=false`, kiểm tra keyword lần nữa ở worker rồi lưu
`posts` và `keyword_hits`. Reply/comment chưa được lấy trong milestone này.

## 1. Bạn cần chuẩn bị

- Một tài khoản Meta có quyền tạo app tại Meta for Developers.
- Một tài khoản Threads dùng để cấp quyền OAuth cho app.
- Một Meta App có use case **Access the Threads API**.
- Quyền `threads_basic` và `threads_keyword_search`.
- Một Threads **User Access Token** dài hạn để đặt trên server/worker.
- App Review/Advanced Access cho `threads_keyword_search` nếu muốn tìm public post
  không thuộc chính tài khoản đã OAuth.

Không cần Chrome Extension, password Threads, cookie trình duyệt hay app access
token. `THREADS_ACCESS_TOKEN` phải là **user token**, không phải app token.

## 2. Tạo Meta App và bật Threads API

1. Mở [Meta for Developers — Apps](https://developers.facebook.com/apps/) và
   chọn **Create App**.
2. Chọn use case **Access the Threads API**. Nếu app đã tồn tại, mở **Use cases**,
   thêm/cấu hình Threads API.
3. Trong phần Threads API của app, lấy **Threads App ID** và **Threads App
   Secret**. Meta lưu ý hai giá trị này có thể khác App ID/App Secret thông thường.
4. Tại **Use cases > Access the Threads API > Customize > Permissions**, thêm:
   - `threads_basic`;
   - `threads_keyword_search`.
5. Tại phần **Settings** của cùng use case, thêm HTTPS OAuth redirect callback.
   Redirect URI phải khớp tuyệt đối với URI dùng khi xin code. Sample app chính
   thức của Meta không dùng `localhost`; nếu test OAuth local, dùng một local
   hostname có HTTPS hoặc một callback HTTPS được kiểm soát.
6. Khi app còn ở Development mode, thêm tài khoản thử nghiệm vào app role/tester
   và chấp nhận lời mời bằng đúng tài khoản Threads đó.

Tên menu trong App Dashboard có thể thay đổi theo rollout, nhưng cần tìm đúng
**Threads App ID**, **Threads App Secret**, **Redirect Callback URLs** và
**Permissions** của use case Threads.

## 3. Lấy access token

Cách ít lỗi nhất cho P0 là dùng
[Meta official Threads API collection trên Postman](https://www.postman.com/meta/threads/overview):

1. Fork/mở collection, vào **Authorization**.
2. Chọn OAuth 2.0, Grant Type **Authorization Code**.
3. Cấu hình:
   - Auth URL: `https://threads.net/oauth/authorize`
   - Access Token URL: `https://graph.threads.net/oauth/access_token`
   - Client ID: Threads App ID
   - Client Secret: Threads App Secret
   - Scope: `threads_basic,threads_keyword_search`
   - Callback URL: đúng redirect URI đã whitelist
4. Chọn **Get New Access Token**, đăng nhập/đồng ý bằng Threads tester.
5. Kiểm tra token có đủ hai permission bằng Access Token Debugger hoặc request
   keyword search thử.

Token đổi trực tiếp từ authorization code ban đầu là token ngắn hạn. Đổi sang
long-lived token bằng request chính thức:

```http
GET https://graph.threads.net/access_token
  ?grant_type=th_exchange_token
  &client_secret=<THREADS_APP_SECRET>
Authorization: Bearer <SHORT_LIVED_THREADS_USER_TOKEN>
```

Response có `access_token` và `expires_in` (thường là `5184000`, tương đương 60
ngày). Chỉ copy giá trị `access_token` dài hạn vào `.env`; không commit token hoặc
App Secret.

Token dài hạn còn hiệu lực có thể refresh bằng:

```http
GET https://graph.threads.net/refresh_access_token
  ?grant_type=th_refresh_token
Authorization: Bearer <LONG_LIVED_THREADS_USER_TOKEN>
```

Hãy refresh sau ít nhất 24 giờ kể từ lúc cấp/refresh trước đó và trước khi token
hết hạn. MVP hiện đọc token từ environment, nên sau khi refresh phải cập nhật
`THREADS_ACCESS_TOKEN` trong secret store/`.env` và restart worker.

## 4. App Review để tìm public post

Trong Development mode hoặc khi `threads_keyword_search` chưa được duyệt, Meta
chỉ search post do user đang OAuth sở hữu. Muốn social listening public:

1. Xin Advanced Access/App Review cho `threads_keyword_search`.
2. Video review nên thể hiện đúng luồng read-only: nhập/bật keyword, tạo job,
   request `keyword_search`, hiển thị post đã khớp; không mô tả tính năng
   comment khi chưa triển khai.
3. Giải thích data minimization: không lưu owner ID, username, profile URL hoặc
   raw permalink chứa handle; chỉ lưu media ID, text, timestamp và short content
   URL.
4. Cung cấp test credentials/instructions và privacy policy/data deletion URL
   theo checklist App Dashboard yêu cầu.

Public search chỉ sẵn sàng sau khi permission được duyệt. Token tester thành công
không chứng minh app đã có public coverage.

## 5. Cấu hình project

Sao chép `.env.example` thành `.env` và điền:

```env
THREADS_ACCESS_TOKEN=<LONG_LIVED_THREADS_USER_TOKEN>
THREADS_GRAPH_BASE_URL=https://graph.threads.net
THREADS_API_VERSION=v1.0
THREADS_POLL_MS=2000
THREADS_PAGE_SIZE=100
THREADS_MAX_PAGES_PER_TASK=10
THREADS_MAX_ATTEMPTS=3
THREADS_MAX_REQUESTS_PER_JOB=0
```

`THREADS_API_VERSION` được pin/configurable vì Meta có thể đổi version. Trước khi
production, đối chiếu version đang hỗ trợ trong App Dashboard/changelog. Không
đặt token vào biến `NEXT_PUBLIC_*`; frontend không cần và không được biết token.

Khởi động/cập nhật stack:

```powershell
docker compose up --build -d
```

Migration tạo khóa chống hai Threads job chạy đồng thời. Seed tạo keyword chính
xác `VinSmart Future` cho platform Threads nhưng vẫn để connector disabled cho
đến khi bạn chủ động bật.

## 6. Bật connector và tạo job đầu tiên

UI Threads vẫn là màn hình trạng thái giai đoạn 2, nên P0 gọi REST API trực tiếp.
Trong PowerShell:

```powershell
$settings = @{
  lookbackPreset = "7_days"
  crawlComments = $true
  maxSourcesPerJob = 1
  maxPostsPerSource = 300
  maxCommentsPerPost = 1
  maxRuntimeMinutes = 30
  enabled = $true
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Put `
  -Uri "http://localhost:4000/api/v1/settings/threads" `
  -ContentType "application/json" `
  -Body $settings
```

`crawlComments=true` và `maxCommentsPerPost` vẫn phải có do settings contract
chung hiện tại; Threads worker trường hợp 1 không dùng chúng.

Tạo job:

```powershell
$job = Invoke-RestMethod `
  -Method Post `
  -Uri "http://localhost:4000/api/v1/jobs/crawl" `
  -ContentType "application/json" `
  -Body '{"platform":"threads","lookbackPreset":"7_days"}'

$job
```

Theo dõi job và xem post đã lưu:

```powershell
Invoke-RestMethod "http://localhost:4000/api/v1/jobs/$($job.id)"
Invoke-RestMethod "http://localhost:4000/api/v1/jobs/$($job.id)/events"
Invoke-RestMethod "http://localhost:4000/api/v1/listening/posts?platform=threads"
```

Nếu không dùng seed hoặc muốn thêm keyword khác:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "http://localhost:4000/api/v1/keywords" `
  -ContentType "application/json" `
  -Body '{"platform":"threads","value":"VinSmart Future","matchMode":"contains_phrase","active":true}'
```

## 7. Kiểm tra token/API trước khi chạy job

Sau khi đặt token vào environment hiện tại, có thể probe mà không in token:

```powershell
$headers = @{ Authorization = "Bearer $env:THREADS_ACCESS_TOKEN" }
$query = [Uri]::EscapeDataString("VinSmart Future")
$url = "https://graph.threads.net/v1.0/keyword_search?q=$query&search_type=RECENT&search_mode=KEYWORD&fields=id,text,timestamp,permalink,is_reply&limit=10"
Invoke-RestMethod -Method Get -Uri $url -Headers $headers
```

Nếu token chỉ nằm trong `.env`, không cần copy ra terminal; chạy job và đọc event
là an toàn hơn. Worker không ghi token, username hoặc raw permalink vào event.

## 8. Lỗi thường gặp

| Mã/trạng thái | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| `THREADS_CONNECTOR_DISABLED` | Settings Threads chưa bật | Gọi `PUT /settings/threads` với `enabled=true`. |
| Job ở `queued` mãi | Worker không có `THREADS_ACCESS_TOKEN` hoặc chưa restart | Kiểm tra `.env`, recreate/restart worker. Startup log phải có `threadsConnector=enabled`. |
| Search chỉ thấy post của mình | Permission chưa qua App Review | Hoàn tất Advanced Access cho `threads_keyword_search`. |
| HTTP 401/permission error | Token hết hạn, sai loại token hoặc thiếu scope | Tạo/refresh Threads **user token**, kiểm tra permission. |
| HTTP 429 | Quota/rate limit | Chờ retry; giảm keyword/tần suất hoặc `THREADS_MAX_PAGES_PER_TASK`. |
| Job `partial` | Chạm max page, runtime hoặc một keyword thất bại | Xem job events/checkpoint, điều chỉnh giới hạn rồi tạo job mới. |
| Có API result nhưng không lưu post | Reply, ngoài window, local keyword không match, URL không canonicalize được | Đây là privacy/filter boundary có chủ ý; xem fixture/P0 trước khi nới rule. |

Meta công bố tối đa 2.200 keyword queries mỗi user trong rolling 24 giờ và tối đa
100 records/request tại thời điểm viết tài liệu. Mỗi page/retry đều tiêu thụ query;
giữ số keyword và `THREADS_MAX_PAGES_PER_TASK` ở mức nhỏ trong P0.

Để smoke test lần đầu với tối đa hai request cho toàn bộ job, đặt
`THREADS_MAX_REQUESTS_PER_JOB=2`. Giá trị `0` bỏ giới hạn tạm thời này.

## 9. Giới hạn của milestone này

- Chỉ post public quan sát được qua `keyword_search`; không phải firehose/toàn bộ
  Threads.
- Chỉ `RECENT`; chưa chạy lịch poll tự động, TOP, reply hoặc conversation.
- Một job chỉ chạy khi được gọi thủ công qua REST.
- Token refresh chưa tự ghi lại secret; vận hành phải refresh/cập nhật định kỳ.
- UI Settings chưa bật thao tác Threads; dashboard/listening API đã đọc được post
  Threads sau khi worker lưu thành công.

Nguồn chính thức:

- [Meta — Keyword and Topic Tag Search](https://developers.facebook.com/docs/threads/keyword-search/)
- [Meta official Threads API Postman](https://www.postman.com/meta/threads/overview)
- [Meta official sample app](https://github.com/fbsamples/threads_api)
