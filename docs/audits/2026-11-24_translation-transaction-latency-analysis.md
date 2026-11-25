# Translation Transaction Latency Analysis

- **Report date:** 2026-11-24
- **Project:** SuaraPutra Smart Multilingual Broadcasting
- **Evidence source:** Google Cloud Logging, `projects/suaraputra/logs/syslog`
- **Timezone used for reported source times:** Malaysia time, UTC+08:00
- **Scope:** One transaction observed on 2026-11-24 and the five earlier time windows supplied for review

## Executive summary

The traces show a consistent pattern: for AI-processed messages, the
`CP05_AI_PROCESS` model-generation call is the largest individual processing
stage. It ranged from **5.551 seconds to 50.680 seconds** across the seven
AI-processed traces reviewed. The 2026-11-24 test message had a 50.680-second
AI call and a **60.145-second end-to-end interval**.

The earlier examples did not all take one minute. Their end-to-end durations
ranged from **6.110 seconds to 44.667 seconds**. The longest earlier AI call
was **34.759 seconds** at 11:42 AM on November 23. The 11:19 AM November 23
transaction also had a comparatively slow Malay send call of **8.645 seconds**;
the logs do not split that adapter call into media-upload, network, or other
sub-operations.

Three traces without a `CP05_AI_PROCESS` checkpoint followed a direct
passthrough-style path and completed in **6.110–6.595 seconds**. This is
consistent with image-only handling, but the trace timing itself does not
identify message content.

**Conclusion:** the observed delay is primarily variable AI-provider-call
latency, not FIFO waiting, validation, or database persistence. The available
trace data establishes how long the provider call took, but not why the
provider call took that long internally. No explicit end-to-end latency SLA
was found in the reviewed project documents, so this is an operational
latency finding rather than a formal SLA-breach determination.

## Scope and evidence handling

The analysis covers:

- The 2026-11-24 test message sent at approximately 7:58 PM.
- November 23 messages supplied as 11:19 AM and 11:42 AM.
- November 21 messages supplied as 2:00 AM, 1:30 AM, and 1:25 AM.

All times in the tables are UTC+08:00. The Cloud Logging queries used UTC
windows around the supplied times. The 1:25 AM window contained three
distinct source-message traces at 1:25:20, 1:25:21, and 1:25:58, so the
available timing evidence does not establish which exact trace corresponds
to the user's “image with caption” description.

The queried records were restricted to trace and timing fields. Original
message text, media, group JIDs, and credentials are not included in this
report. Trace identifiers are shortened to their first eight characters for
correlation.

The Cloud Logging records had an empty `instance_name` resource label, so the
query used the project syslog stream, narrow time windows, and the application's
distinctive `[TRACE:...]` records rather than an instance-name filter. This is
a limitation of the available log metadata.

## Timing definitions

Checkpoint boundaries are defined in
[`src/observability/telemetry.ts`](../../src/observability/telemetry.ts).
Relevant implementation boundaries are in
[`src/ai/ai-processor.ts`](../../src/ai/ai-processor.ts),
[`src/ai/model-provider.ts`](../../src/ai/model-provider.ts),
[`src/ingestion/message-ingestor.ts`](../../src/ingestion/message-ingestor.ts),
and [`src/delivery/dispatcher.ts`](../../src/delivery/dispatcher.ts).

- `CP01` normalizes the incoming WhatsApp event.
- `CP02` measures time waiting in the ingestion FIFO.
- `CP03` covers eligibility checks and source-message/media persistence.
- `CP04` assembles bounded context.
- `CP05` measures a model-provider generation attempt.
- `CP06` validates the model response.
- `CP07` persists the announcement, translations, and delivery jobs.
- `CP08` reconstructs each destination's outbound message.
- `CP09_<language>` measures the adapter's `sendMessage()` call for that
  destination.
- `Σ checkpoints` is the recorded `totalPipelineUs` converted to
  milliseconds. It is the sum of instrumented spans, not the complete
  end-to-end wall time.
- `E2E` is `totalE2eWallMs`: WhatsApp source-message timestamp to the final
  adapter send acknowledgment. The acknowledgment indicates the send call
  resolved; it is not confirmation that the recipient's device displayed the
  message.

`CP05` includes the provider call and response handling inside
`GeminiModelProvider.generate()`. The traces do not separate model execution,
provider queueing, network time, or response parsing. Each AI-processed trace
below recorded attempt 1; no application-level retry was observed for these
calls.

`CP09` excludes the dispatcher's polling and pacing waits. E2E minus
`Σ checkpoints` is therefore shown as **unattributed E2E remainder**, not as a
single measured function.

## Transaction summary

Durations in the `CP05` and `Σ checkpoints` columns are milliseconds.
`E2E` and the remainder are also milliseconds.

| Source time (UTC+08) | Trace | Observed path | CP05 | Σ checkpoints | E2E | Unattributed E2E remainder |
|---|---|---|---:|---:|---:|---:|
| Nov 24, 19:58:48 | `6b7c25d9` | Test message; AI processed | 50,680.407 | 55,618.038 | 60,145 | 4,526.962 |
| Nov 23, 11:19:16 | `a4ce5ace` | User-described image with caption; AI processed | 22,600.463 | 35,399.862 | 44,667 | 9,267.138 |
| Nov 23, 11:42:09 | `cfe9485f` | User-described image with caption; AI processed | 34,759.121 | 38,919.005 | 41,679 | 2,759.995 |
| Nov 21, 02:00:11 | `3ae7458a` | One of the separate image/text traces; no AI checkpoint | — | 3,760.021 | 6,492 | 2,731.979 |
| Nov 21, 02:00:11 | `9020b29f` | One of the separate image/text traces; AI processed | 26,832.379 | 27,328.621 | 32,530 | 5,201.379 |
| Nov 21, 01:30:28 | `b26cc84d` | One of the separate image/text traces; no AI checkpoint | — | 2,339.750 | 6,110 | 3,770.250 |
| Nov 21, 01:30:28 | `24ddd6f6` | One of the separate image/text traces; AI processed | 12,665.846 | 13,225.076 | 18,723 | 5,497.924 |
| Nov 21, 01:25:20 | `dd92f310` | No AI checkpoint; passthrough-style trace | — | 1,765.878 | 6,595 | 4,829.122 |
| Nov 21, 01:25:21 | `ca8ac5d4` | AI-processed trace; exact content type not inferred | 5,551.080 | 5,994.162 | 11,284 | 5,289.838 |
| Nov 21, 01:25:58 | `807a4411` | AI-processed trace; exact content type not inferred | 8,127.122 | 10,068.941 | 14,653 | 4,584.059 |

The two traces in each user-described separate image/text pair are reported
individually. The trace without `CP05` is consistent with the application's
direct image-only path; that association is inferred from the checkpoint
pattern, not from message content. The 1:25 AM window contains more traces
than a single event and is therefore not mapped to one specific caption
transaction.

## Detailed checkpoint measurements

All stage values below are integer microseconds (`μs`). A dash means that the
trace did not emit that checkpoint. The pipeline sum and E2E columns are
repeated here to make the ledger independently readable.

### Ingestion, AI, validation, and queue persistence

| Source time (UTC+08) | Trace | CP01 | CP02 | CP03 | CP04 | CP05 | CP06 | CP07 | Σ checkpoints (μs) | E2E (ms) |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Nov 24, 19:58:48 | `6b7c25d9` | 179,289 | 487 | 281,504 | 2,139 | 50,680,407 | 70 | 125,292 | 55,618,038 | 60,145 |
| Nov 23, 11:19:16 | `a4ce5ace` | 202,577 | 3,573 | 413,120 | 585 | 22,600,463 | 111 | 142,323 | 35,399,862 | 44,667 |
| Nov 23, 11:42:09 | `cfe9485f` | 3,072 | 144 | 69,777 | 12,785 | 34,759,121 | 60 | 62,032 | 38,919,005 | 41,679 |
| Nov 21, 02:00:11 | `3ae7458a` | 3,965 | 325 | 75,670 | 416 | — | — | 29,407 | 3,760,021 | 6,492 |
| Nov 21, 02:00:11 | `9020b29f` | 1,190 | 35 | 3,413 | 856 | 26,832,379 | 135 | 6,617 | 27,328,621 | 32,530 |
| Nov 21, 01:30:28 | `b26cc84d` | 695 | 37 | 29,127 | 619 | — | — | 3,181 | 2,339,750 | 6,110 |
| Nov 21, 01:30:28 | `24ddd6f6` | 194 | 46 | 1,881 | 517 | 12,665,846 | 26 | 3,880 | 13,225,076 | 18,723 |
| Nov 21, 01:25:20 | `dd92f310` | 593 | 53 | 7,133 | 1,006 | — | — | 5,082 | 1,765,878 | 6,595 |
| Nov 21, 01:25:21 | `ca8ac5d4` | 809 | 191 | 2,843 | 984 | 5,551,080 | 34 | 4,271 | 5,994,162 | 11,284 |
| Nov 21, 01:25:58 | `807a4411` | 461 | 139 | 9,071 | 1,022 | 8,127,122 | 173 | 3,690 | 10,068,941 | 14,653 |

### Message reconstruction and destination send

Values in each language sequence are ordered `ms / en / zh-CN / ta`, in
microseconds. `CP08` is reconstruction; `CP09` is the corresponding adapter
send call.

| Source time (UTC+08) | Trace | CP08 `ms / en / zh-CN / ta` (μs) | CP09 `ms / en / zh-CN / ta` (μs) | Total CP09 (μs) |
|---|---|---|---|---:|
| Nov 24, 19:58:48 | `6b7c25d9` | 212,668 / 103 / 102 / 190 | 2,423,664 / 560,653 / 559,188 / 592,282 | 4,135,787 |
| Nov 23, 11:19:16 | `a4ce5ace` | 1,041,898 / 138 / 95 / 114 | 8,644,976 / 696,611 / 773,425 / 879,853 | 10,994,865 |
| Nov 23, 11:42:09 | `cfe9485f` | 1,072 / 112 / 211 / 82 | 1,475,902 / 863,187 / 804,564 / 866,884 | 4,010,537 |
| Nov 21, 02:00:11 | `3ae7458a` | 1,193 / 55 / 79 / 68 | 1,667,518 / 614,963 / 732,495 / 633,867 | 3,648,843 |
| Nov 21, 02:00:11 | `9020b29f` | 183 / 73 / 60 / 75 | 93,743 / 118,441 / 107,010 / 164,411 | 483,605 |
| Nov 21, 01:30:28 | `b26cc84d` | 925 / 53 / 46 / 70 | 730,693 / 489,777 / 576,660 / 507,867 | 2,304,997 |
| Nov 21, 01:30:28 | `24ddd6f6` | 68 / 60 / 101 / 58 | 88,948 / 189,198 / 172,638 / 101,615 | 552,399 |
| Nov 21, 01:25:20 | `dd92f310` | 1,367 / 104 / 104 / 90 | 483,402 / 406,562 / 461,669 / 398,713 | 1,750,346 |
| Nov 21, 01:25:21 | `ca8ac5d4` | 204 / 120 / 282 / 99 | 98,341 / 135,676 / 114,331 / 84,897 | 433,245 |
| Nov 21, 01:25:58 | `807a4411` | 3,458 / 99 / 91 / 102 | 445,717 / 497,984 / 570,417 / 409,395 | 1,923,513 |

## Findings

### 1. AI generation dominates AI-processed traces

Every AI-processed trace has a `CP05` span substantially longer than its
validation and persistence spans. The seven measured AI calls were:

| Source time | CP05 duration |
|---|---:|
| Nov 24, 19:58:48 | 50.680407 s |
| Nov 23, 11:19:16 | 22.600463 s |
| Nov 23, 11:42:09 | 34.759121 s |
| Nov 21, 02:00:11 | 26.832379 s |
| Nov 21, 01:30:28 | 12.665846 s |
| Nov 21, 01:25:21 | 5.551080 s |
| Nov 21, 01:25:58 | 8.127122 s |

These are provider-call wall times, not an internal breakdown of Gemini's
model execution. Each observed call was attempt 1, so the logs provide no
evidence that application retry backoff caused these durations.

### 2. One image-associated send was unusually slow

At Nov 23, 11:19:16, the Malay `CP09` call took **8.645 seconds**. The other
three destination sends took 0.697–0.880 seconds. This is consistent with
additional media transfer work on the first image send, but `CP09` measures
the whole adapter send call and does not prove which internal operation was
slow.

The Nov 24 test transaction's first send took 2.424 seconds; its other sends
took approximately 0.56–0.59 seconds. This send-side variation is notable,
but smaller than that transaction's 50.680-second AI call.

### 3. Direct/no-AI traces complete much faster

The three traces with no `CP05` span completed end-to-end in 6.110, 6.492,
and 6.595 seconds. Their checkpoints show that the AI pipeline was not run
for those events. This supports the conclusion that the long waits in the
AI-processed transactions are not caused by a universal ingestion or delivery
delay.

### 4. Some end-to-end time is outside the checkpoint spans

The difference between E2E and `Σ checkpoints` ranged from about 2.760 to
9.267 seconds. The instrumentation does not assign that difference to one
function. Known uninstrumented intervals include the source-message timestamp
to application processing, delivery polling, and dispatcher pacing. Thus,
the measured checkpoint sum should not be treated as a complete latency
decomposition.

## Limitations and follow-up

- The logs identify the AI generation call as the measured bottleneck but do
  not distinguish Gemini service time from transport/network time or
  response-handling time.
- The 11:19 AM send anomaly is measured at the adapter boundary; its internal
  cause is not available in these traces.
- The 1:25 AM window contains three source-message traces. Without message
  content or a user-supplied message ID, the captioned-image event cannot be
  uniquely assigned to one of the AI traces.
- End-to-end send acknowledgment is not recipient-device delivery
  confirmation.
- This report records observed latency only. No code was changed, no
  performance target was modified, and no formal latency SLA is asserted.

For further diagnosis, correlate these trace times with provider-side request
latency/usage telemetry and, for the 11:19 AM outlier, with safe media-size
and send-duration metrics. Do not log message content, credentials, auth
state, or private media to obtain that evidence.
