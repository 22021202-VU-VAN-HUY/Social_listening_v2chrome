# Từ điển dữ liệu listening

## Nguyên tắc phạm vi

- `post` vừa là metadata/ngữ cảnh của comment vừa có thể được phân tích sentiment riêng.
- `comment` bao gồm cả bình luận cấp đầu và reply. Post/comment/reply chỉ được đưa vào AI
  khi người dùng chủ động bấm `Phân tích tất cả`.
- Keyword được khớp trên bài post. Mỗi comment trả về toàn bộ keyword đã khớp của bài post.
- Mọi timestamp là ISO 8601 có múi giờ. Không suy đoán thời gian khi Facebook không cung cấp
  đủ thông tin.

## Tác giả

| Trường | Kiểu | Ý nghĩa |
| --- | --- | --- |
| `authorName` | `string \| null` | Chỉ tên hiển thị tại thời điểm crawl. |
| `isAnonymous` | `boolean` | `true` khi Facebook hiển thị tác giả ẩn danh. |
| `authorKind` | `real \| anonymous \| unknown` | Loại tác giả đã nhận diện. |

Quy tắc bắt buộc:

- người dùng thật: `authorName` có giá trị, `isAnonymous=false`, `authorKind=real`;
- ẩn danh: `authorName=null`, `isAnonymous=true`, `authorKind=anonymous`;
- không xác định: `authorName=null`, `isAnonymous=false`, `authorKind=unknown`;
  UI hiển thị “Không xác định”, không gộp với “Ẩn danh”.

Không thu thập profile URL, platform user ID, username, handle hoặc avatar URL.

## Metadata bài post

Được lưu trong bảng `posts` và trả về tại `comment.post`.

| Trường API | Trường DB | Ý nghĩa |
| --- | --- | --- |
| `id` | `posts.id` | UUID nội bộ. |
| `externalId` | `posts.external_id` | ID nội dung trên nền tảng, dùng chống trùng. |
| `sourceId` | `posts.source_id` | UUID group/source. |
| `sourceName` | `sources.name` | Tên group/source. |
| `url` | `posts.canonical_url` | Permalink chuẩn hóa, đã bỏ tracking parameter. |
| `body` | `posts.body` | Nội dung text của bài viết. |
| `publishedAt` | `posts.published_at` | Thời gian đăng; `null` nếu không đọc chắc chắn. |
| `collectedAt` | `posts.collected_at` | Thời gian extension thu thập. |
| `timeParseStatus` | `posts.time_parse_status` | `parsed` hoặc `unknown`. |
| `author` | ba cột author | Tác giả theo closed privacy shape ở trên. |
| `matchedKeywords` | `keyword_hits` + `keywords` | Tất cả keyword khớp, không chỉ keyword đầu tiên. |
| `sentiment` | `sentiment_analyses` / override | Kết quả AI của bài post, hoặc `null` khi chờ xử lý. |

Mỗi phần tử `matchedKeywords` gồm `id`, `value` và `matchMode`
(`whole_word` hoặc `contains_phrase`). `value` và `matchMode` được đóng băng ngay
lúc match trong `keyword_hits`; sửa keyword sau này không viết lại lịch sử.
Thao tác xóa keyword trên API là soft-disable để không làm mất hit cũ.

## Comment và reply

Được lưu trong bảng `comments` và trả về từ `GET /api/v1/listening/comments`.

| Trường API | Trường DB | Ý nghĩa |
| --- | --- | --- |
| `id` | `comments.id` | UUID nội bộ. |
| `externalId` | `comments.external_id` | ID comment trên nền tảng. |
| `postId` / `postExternalId` | quan hệ `post_id` | Bài post. |
| `parentCommentId` | `comments.parent_comment_id` | `null` với comment cấp đầu; có giá trị với reply. |
| `url` | `comments.canonical_url` | Permalink comment nếu DOM cung cấp, nếu không là `null`. |
| `body` | `comments.body` | Nội dung comment/reply. |
| `publishedAt` | `comments.published_at` | Thời gian comment; `null` nếu không đọc chắc chắn. |
| `collectedAt` | `comments.collected_at` | Thời gian extension thu thập comment. |
| `timeParseStatus` | `comments.time_parse_status` | `parsed` hoặc `unknown`. |
| `author` | ba cột author | Người dùng thật, ẩn danh hoặc chưa xác định. |
| `sentiment` | `sentiment_analyses` / override | Kết quả AI, hoặc `null` khi đang chờ xử lý. |
| `post` | quan hệ bài viết | Toàn bộ metadata bài post và keyword đã khớp. |

## Sentiment

| Trường | Kiểu | Ý nghĩa |
| --- | --- | --- |
| `label` | `positive \| negative \| neutral` | Nhãn cảm xúc. |
| `confidence` | số từ `0` đến `1` | Độ tin cậy của provider. |
| `isRelevant` | `boolean` | Comment có liên quan đến ngữ cảnh/keyword hay không. |
| `needsReview` | `boolean` | Cần người vận hành kiểm tra thủ công. |

Queue và worker chấp nhận `entity_type='post'` hoặc `entity_type='comment'`.
Khi phân tích comment/reply:

- `post_context` chứa nội dung bài post để xác định đối tượng;
- `conversation_context` chứa chuỗi reply cha tối đa 8 cấp;
- worker chỉ chấm `text` của entity hiện tại, không sao chép sắc thái từ ngữ cảnh;
- prompt nhận diện các alias `VSF`, `VinSmart Future`, `VinFuture`, `Vin Future`.

## Ràng buộc scope crawl

- Content batch bắt buộc có `taskId` thuộc đúng crawl job Facebook.
- Source và keyword của task phải có trong snapshot đóng băng khi tạo job.
- API tự chạy lại matcher; `matchedKeywordIds` từ extension chỉ là gợi ý và không
  phải nguồn sự thật.
- Post có thời gian đã parse nằm ngoài `windowStartUtc..windowEndUtc` bị từ chối.
- Post không rõ thời gian được giữ với `publishedAt=null` và
  `timeParseStatus=unknown` để không bịa timestamp.
- Comment-only batch chỉ được gắn vào post đã thấy trong cùng job và đúng task;
  reply chỉ được gắn vào comment cha của cùng post.

## Thời gian không xác định

Nếu DOM không cung cấp timestamp có thể chuyển đổi an toàn:

```json
{
  "publishedAt": null,
  "timeParseStatus": "unknown",
  "collectedAt": "2026-07-30T10:00:00.000Z"
}
```

`collectedAt` không được dùng thay cho `publishedAt`. Dashboard đếm riêng `unknownTime`;
timeline chỉ dùng bản ghi có `timeParseStatus=parsed`.
