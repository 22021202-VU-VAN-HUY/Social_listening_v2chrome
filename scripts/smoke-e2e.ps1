param(
  [string]$BaseUrl = "http://localhost:4000/api/v1",
  [int]$SentimentTimeoutSeconds = 30
)

$ErrorActionPreference = "Stop"

$baseUri = [Uri]$BaseUrl
if ($baseUri.Scheme -ne "http" -or $baseUri.Host -notin @("localhost", "127.0.0.1")) {
  throw "Smoke test is restricted to a local HTTP API."
}

function Invoke-JsonRequest {
  param(
    [Parameter(Mandatory = $true)][string]$Method,
    [Parameter(Mandatory = $true)][string]$Uri,
    [object]$Body,
    [hashtable]$Headers = @{}
  )

  $request = @{
    Method = $Method
    Uri = $Uri
    Headers = $Headers
  }
  if ($null -ne $Body) {
    $json = $Body | ConvertTo-Json -Depth 30 -Compress
    $request.ContentType = "application/json; charset=utf-8"
    $request.Body = [Text.Encoding]::UTF8.GetBytes($json)
  }
  return Invoke-RestMethod @request
}

function Assert-True {
  param(
    [Parameter(Mandatory = $true)][bool]$Condition,
    [Parameter(Mandatory = $true)][string]$Message
  )
  if (-not $Condition) {
    throw "SMOKE_ASSERTION_FAILED: $Message"
  }
}

$runId = [Guid]::NewGuid().ToString("N")
$now = [DateTimeOffset]::UtcNow
$published = $now.AddMinutes(-10).ToString("o")
$collected = $now.ToString("o")
$pair = $null
$previousSettings = $null
$previousSelectedSourceIds = @()
$selectionCaptured = $false
$result = $null

try {
$pairing = Invoke-JsonRequest -Method POST -Uri "$BaseUrl/extension/pairing-codes" -Body @{}
$pair = Invoke-JsonRequest -Method POST -Uri "$BaseUrl/extension/pair" -Body @{
  code = $pairing.code
  installationId = "smoke-installation-$runId"
  extensionVersion = "0.1.0-smoke"
}
$auth = @{ Authorization = "Bearer $($pair.deviceToken)" }

$null = Invoke-JsonRequest -Method POST -Uri "$BaseUrl/extension/heartbeat" -Headers $auth -Body @{
  deviceId = $pair.deviceId
  extensionVersion = "0.1.0-smoke"
  status = "online"
}

$discoverJob = Invoke-JsonRequest -Method POST -Uri "$BaseUrl/jobs/discover-sources" -Body @{
  platform = "facebook"
  deviceId = $pair.deviceId
}
$discoverClaim = Invoke-JsonRequest -Method POST -Uri "$BaseUrl/extension/jobs/$($discoverJob.id)/claim" -Headers $auth -Body @{
  deviceId = $pair.deviceId
  extensionVersion = "0.1.0-smoke"
}

$sourceExternalId = "smoke-group-$runId"
$sourceHeaders = @{
  Authorization = "Bearer $($pair.deviceToken)"
  "Idempotency-Key" = "smoke-sources-$runId"
}
$sourceAck = Invoke-JsonRequest -Method POST -Uri "$BaseUrl/extension/jobs/$($discoverJob.id)/batches" -Headers $sourceHeaders -Body @{
  deviceId = $pair.deviceId
  leaseToken = $discoverClaim.leaseToken
  fencingToken = $discoverClaim.fencingToken
  checksum = ("a" * 64)
  kind = "sources"
  sources = @(
    @{
      externalId = $sourceExternalId
      name = "Vinsmart Future smoke group"
      canonicalUrl = "https://www.facebook.com/groups/$sourceExternalId/"
    }
  )
}
Assert-True ($sourceAck.accepted.sources -eq 1) "Discovery batch must accept one group."

$null = Invoke-JsonRequest -Method POST -Uri "$BaseUrl/extension/jobs/$($discoverJob.id)/complete" -Headers $auth -Body @{
  deviceId = $pair.deviceId
  leaseToken = $discoverClaim.leaseToken
  fencingToken = $discoverClaim.fencingToken
  outcome = "crawl_complete"
  coverageStatus = "complete"
}

$sourceList = Invoke-RestMethod -Uri "$BaseUrl/sources?platform=facebook&limit=200"
$previousSelectedSourceIds = @(
  @($sourceList.items) |
    Where-Object { $_.selected } |
    ForEach-Object { $_.id }
)
$selectionCaptured = $true
$source = @($sourceList.items) | Where-Object { $_.externalId -eq $sourceExternalId } | Select-Object -First 1
Assert-True ($null -ne $source) "The discovered group must be readable from the API."

$temporarySelection = @(
  @($previousSelectedSourceIds) + @($source.id) | Select-Object -Unique
)
$null = Invoke-JsonRequest -Method PUT -Uri "$BaseUrl/sources/selection" -Body @{
  platform = "facebook"
  sourceIds = $temporarySelection
}

$settings = Invoke-RestMethod -Uri "$BaseUrl/settings/facebook"
$previousSettings = $settings
$null = Invoke-JsonRequest -Method PUT -Uri "$BaseUrl/settings/facebook" -Body @{
  lookbackPreset = "7_days"
  crawlComments = $true
  maxSourcesPerJob = $settings.maxSourcesPerJob
  maxPostsPerSource = $settings.maxPostsPerSource
  maxCommentsPerPost = [Math]::Max(1, $settings.maxCommentsPerPost)
  maxRuntimeMinutes = $settings.maxRuntimeMinutes
  enabled = $true
}

$keywordList = Invoke-RestMethod -Uri "$BaseUrl/keywords?platform=facebook&active=true"
$keywords = @($keywordList.items) | Where-Object {
  $_.value -in @("VSF", "Vin Future", "Vinfuture")
}
Assert-True ($keywords.Count -ge 3) "The VSF, Vin Future, and Vinfuture seed keywords are required."
$keywordIds = @($keywords | ForEach-Object { $_.id })

$crawlJob = Invoke-JsonRequest -Method POST -Uri "$BaseUrl/jobs/crawl" -Body @{
  platform = "facebook"
  deviceId = $pair.deviceId
  sourceIds = @($source.id)
  keywordIds = $keywordIds
  lookbackPreset = "7_days"
}
$crawlClaim = Invoke-JsonRequest -Method POST -Uri "$BaseUrl/extension/jobs/$($crawlJob.id)/claim" -Headers $auth -Body @{
  deviceId = $pair.deviceId
  extensionVersion = "0.1.0-smoke"
}
$crawlTaskId = @($crawlClaim.snapshot.tasks)[0].id
Assert-True (-not [string]::IsNullOrWhiteSpace($crawlTaskId)) "Crawl claim must include a frozen task ID."

$postRealId = "post-real-$runId"
$postAnonymousId = "post-anonymous-$runId"
$commentRealId = "comment-real-$runId"
$commentAnonymousId = "comment-anonymous-$runId"
$commentUnknownTimeId = "comment-unknown-time-$runId"
$replyRealId = "reply-real-$runId"
$contentHeaders = @{
  Authorization = "Bearer $($pair.deviceToken)"
  "Idempotency-Key" = "smoke-content-$runId"
}

$contentAck = Invoke-JsonRequest -Method POST -Uri "$BaseUrl/extension/jobs/$($crawlJob.id)/batches" -Headers $contentHeaders -Body @{
  deviceId = $pair.deviceId
  leaseToken = $crawlClaim.leaseToken
  fencingToken = $crawlClaim.fencingToken
  checksum = ("b" * 64)
  taskId = $crawlTaskId
  kind = "content"
  posts = @(
    @{
      externalId = $postRealId
      sourceId = $source.id
      url = "https://www.facebook.com/groups/$sourceExternalId/posts/$postRealId/?fbclid=tracking-secret&utm_source=smoke"
      body = "Parent post mentions VSF, Vin Future, and Vinfuture."
      publishedAt = $published
      collectedAt = $collected
      timeParseStatus = "parsed"
      author = @{
        authorName = "Nguyen Minh An"
        isAnonymous = $false
        authorKind = "real"
      }
      matchedKeywordIds = $keywordIds
    },
    @{
      externalId = $postAnonymousId
      sourceId = $source.id
      url = "https://www.facebook.com/groups/$sourceExternalId/posts/$postAnonymousId/"
      body = "Anonymous discussion about VSF, Vin Future, and Vinfuture."
      publishedAt = $published
      collectedAt = $collected
      timeParseStatus = "parsed"
      author = @{
        authorName = $null
        isAnonymous = $true
        authorKind = "anonymous"
      }
      matchedKeywordIds = $keywordIds
    }
  )
  comments = @(
    @{
      externalId = $commentRealId
      postExternalId = $postRealId
      parentCommentExternalId = $null
      url = "https://www.facebook.com/groups/$sourceExternalId/posts/$postRealId/?comment_id=$commentRealId&fbclid=secret"
      body = "This program is very meaningful and inspiring."
      publishedAt = $published
      collectedAt = $collected
      timeParseStatus = "parsed"
      author = @{
        authorName = "Tran Binh"
        isAnonymous = $false
        authorKind = "real"
      }
    },
    @{
      externalId = $commentAnonymousId
      postExternalId = $postRealId
      parentCommentExternalId = $commentRealId
      url = $null
      body = "I think this information is not clear yet."
      publishedAt = $published
      collectedAt = $collected
      timeParseStatus = "parsed"
      author = @{
        authorName = $null
        isAnonymous = $true
        authorKind = "anonymous"
      }
    },
    @{
      externalId = $commentUnknownTimeId
      postExternalId = $postAnonymousId
      parentCommentExternalId = $null
      url = $null
      body = "I am waiting for more information."
      publishedAt = $null
      collectedAt = $collected
      timeParseStatus = "unknown"
      author = @{
        authorName = $null
        isAnonymous = $false
        authorKind = "unknown"
      }
    },
    @{
      externalId = $replyRealId
      postExternalId = $postAnonymousId
      parentCommentExternalId = $commentUnknownTimeId
      url = $null
      body = "I am also following the latest updates."
      publishedAt = $published
      collectedAt = $collected
      timeParseStatus = "parsed"
      author = @{
        authorName = "Le Chi"
        isAnonymous = $false
        authorKind = "real"
      }
    }
  )
}
Assert-True ($contentAck.accepted.posts -eq 2) "Content batch must store two parent posts."
Assert-True ($contentAck.accepted.comments -eq 4) "Content batch must store four comments/replies."

$null = Invoke-JsonRequest -Method POST -Uri "$BaseUrl/extension/jobs/$($crawlJob.id)/complete" -Headers $auth -Body @{
  deviceId = $pair.deviceId
  leaseToken = $crawlClaim.leaseToken
  fencingToken = $crawlClaim.fencingToken
  outcome = "crawl_complete"
  coverageStatus = "complete"
  progress = @{
    stage = "processing_ai"
    postsScanned = 2
    postsMatched = 2
    postsSaved = 2
    commentsSaved = 4
    sentimentTotal = 4
    sentimentDone = 0
  }
}

$expectedCommentIds = @(
  $commentRealId,
  $commentAnonymousId,
  $commentUnknownTimeId,
  $replyRealId
)
$deadline = [DateTimeOffset]::UtcNow.AddSeconds($SentimentTimeoutSeconds)
$smokeComments = @()
do {
  Start-Sleep -Milliseconds 500
  $commentResponse = Invoke-RestMethod -Uri "$BaseUrl/listening/comments?limit=200&includeUnknownTime=true"
  $smokeComments = @($commentResponse.items) | Where-Object {
    $_.externalId -in $expectedCommentIds
  }
  $allAnalyzed = $smokeComments.Count -eq 4 -and
    (@($smokeComments | Where-Object { $null -eq $_.sentiment }).Count -eq 0)
} while (-not $allAnalyzed -and [DateTimeOffset]::UtcNow -lt $deadline)

Assert-True ($smokeComments.Count -eq 4) "API must return all four ingested comments/replies."
Assert-True $allAnalyzed "Worker must analyze all four comments/replies."

$realComment = $smokeComments | Where-Object { $_.externalId -eq $commentRealId }
$anonymousComment = $smokeComments | Where-Object { $_.externalId -eq $commentAnonymousId }
$unknownTimeComment = $smokeComments | Where-Object { $_.externalId -eq $commentUnknownTimeId }
$reply = $smokeComments | Where-Object { $_.externalId -eq $replyRealId }

Assert-True (
  $realComment.author.authorKind -eq "real" -and
  $realComment.author.authorName -eq "Tran Binh" -and
  -not $realComment.author.isAnonymous
) "A real author must retain only the display name."
Assert-True (
  $anonymousComment.author.authorKind -eq "anonymous" -and
  $null -eq $anonymousComment.author.authorName -and
  $anonymousComment.author.isAnonymous
) "An anonymous comment must have authorName=null."
Assert-True (
  $unknownTimeComment.author.authorKind -eq "unknown" -and
  $null -eq $unknownTimeComment.publishedAt -and
  $unknownTimeComment.timeParseStatus -eq "unknown"
) "Unknown author/time must stay unknown and must not fall back to anonymous or collectedAt."
Assert-True ($null -ne $reply.parentCommentId) "A reply must link to its parent comment."
Assert-True (
  $realComment.post.externalId -eq $postRealId -and
  $realComment.post.body -like "*VSF*" -and
  [DateTimeOffset]::Parse($realComment.post.publishedAt).ToUnixTimeMilliseconds() -eq
    [DateTimeOffset]::Parse($published).ToUnixTimeMilliseconds() -and
  [DateTimeOffset]::Parse($realComment.post.collectedAt).ToUnixTimeMilliseconds() -eq
    [DateTimeOffset]::Parse($collected).ToUnixTimeMilliseconds()
) "A comment must include complete parent-post time and content metadata."
Assert-True (
  @($realComment.post.matchedKeywords).Count -ge 3
) "A parent post must return every keyword actually matched."
Assert-True (
  $realComment.post.url -notmatch "fbclid|utm_"
) "Post URL must remove tracking parameters."

$postResponse = Invoke-RestMethod -Uri "$BaseUrl/listening/posts?limit=200&includeUnknownTime=true"
$smokePosts = @($postResponse.items) | Where-Object {
  $_.externalId -in @($postRealId, $postAnonymousId)
}
Assert-True ($smokePosts.Count -eq 2) "Metadata endpoint must return both parent posts."
Assert-True (
  @($smokePosts | Where-Object { $null -ne $_.sentiment }).Count -eq 0
) "Posts must never have sentiment."
Assert-True (
  @($smokePosts | Where-Object { @($_.matchedKeywords).Count -eq 0 }).Count -eq 0
) "Metadata endpoint must return keyword hits for every post."

$dashboard = Invoke-RestMethod -Uri "$BaseUrl/dashboard/summary"
Assert-True ($dashboard.total -ge 4) "Dashboard must count comments/replies, including unknown time."
Assert-True ($dashboard.unknownTime -ge 1) "Dashboard must count unknown-time comments separately."

$job = Invoke-RestMethod -Uri "$BaseUrl/jobs/$($crawlJob.id)"
Assert-True (
  $job.status -in @("completed", "processing_ai")
) "Crawl job must be completed or processing AI, not failed."

$result = [ordered]@{
  ok = $true
  runId = $runId
  deviceId = $pair.deviceId
  discoverJobId = $discoverJob.id
  crawlJobId = $crawlJob.id
  accepted = @{
    posts = $contentAck.accepted.posts
    comments = $contentAck.accepted.comments
  }
  analyzedComments = $smokeComments.Count
  sentiments = @($smokeComments | ForEach-Object { $_.sentiment.label })
  dashboard = $dashboard
}
} finally {
  if ($null -ne $previousSettings) {
    try {
      $null = Invoke-JsonRequest -Method PUT -Uri "$BaseUrl/settings/facebook" -Body @{
        lookbackPreset = $previousSettings.lookbackPreset
        crawlComments = $true
        maxSourcesPerJob = $previousSettings.maxSourcesPerJob
        maxPostsPerSource = $previousSettings.maxPostsPerSource
        maxCommentsPerPost = [Math]::Max(1, $previousSettings.maxCommentsPerPost)
        maxRuntimeMinutes = $previousSettings.maxRuntimeMinutes
        enabled = $previousSettings.enabled
      }
    } catch {
      Write-Warning "Could not restore Facebook settings: $($_.Exception.Message)"
    }
  }
  if ($selectionCaptured) {
    try {
      $null = Invoke-JsonRequest -Method PUT -Uri "$BaseUrl/sources/selection" -Body @{
        platform = "facebook"
        sourceIds = @($previousSelectedSourceIds)
      }
    } catch {
      Write-Warning "Could not restore group selection: $($_.Exception.Message)"
    }
  }
  if ($null -ne $pair) {
    try {
      $null = Invoke-JsonRequest -Method DELETE -Uri "$BaseUrl/extension/devices/$($pair.deviceId)" -Body $null
    } catch {
      Write-Warning "Could not revoke smoke device: $($_.Exception.Message)"
    }
  }
}

if ($null -ne $result) {
  $result | ConvertTo-Json -Depth 10
}
