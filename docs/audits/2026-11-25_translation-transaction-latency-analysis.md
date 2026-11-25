# Translation Transaction Latency Analysis

- **Report date:** 2026-11-25
- **Project:** SuaraPutra Smart Multilingual Broadcasting
- **Evidence source:** Google Cloud Logging, `projects/suaraputra/logs/syslog`
- **Timezone used for reported source times:** Malaysia time, UTC+08:00
- **Scope:** Five user-identified workflow transactions beginning at approximately 8:22 PM
- **Related analysis:** [2026-11-24 latency audit](./2026-11-24_translation-transaction-latency-analysis.md)

## Executive summary

Five traces were found between 8:20 PM and 8:35 PM and matched, by receive
time and the order supplied by the user, to the five reported image-caption
and text-only transactions. Each trace recorded all 15 expected checkpoint
spans: CP01–CP07, four CP08 reconstructions, and four language-specific CP09
sends.

The five `CP05_AI_PROCESS` durations ranged from **9.907 s to 14.312 s**,
with a mean of **11.885 s** and median of **11.618 s**. `CP02_FIFO_WAIT`
was negligible for the first two traces, but measured **2.597 s, 7.827 s,
and 6.319 s** for the three later traces. This is consistent with messages
waiting behind earlier work in the sequential ingestion queue.

Compared with the seven AI-processed traces in the prior audit, the new
sample's mean CP05 duration is lower by **48.4%**. The samples are small and
not controlled; the logs do not prove that the configured thinking level
caused this difference.

## Scope and evidence handling

The Cloud Logging query covered
`2026-11-25T12:20:00Z` through `2026-11-25T12:35:00Z`, equivalent to
8:20–8:35 PM Malaysia time. Only trace identifiers, checkpoint names,
checkpoint durations, and log timestamps were extracted for this report.
Message contents, media, group JIDs, sender details, and credentials were
not included. Trace identifiers are shortened to their first eight
characters.

The transaction descriptions below follow the order and types supplied by
the user. The checkpoint records themselves provide the trace and timing
data, not message content. All five traces contained 15 successful
checkpoint records, with no missing CP01–CP07 or destination CP08/CP09 span.

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
- `Σ checkpoints` is the sum of the instrumented spans. It excludes
  uninstrumented intervals and should not be treated as complete end-to-end
  wall time.

`CP05` includes the provider call and response handling inside
`GeminiModelProvider.generate()`. The traces do not separate model execution,
provider queueing, network time, or response parsing. `CP09` measures the
adapter send call but does not confirm that a recipient device displayed the
message.

The Cloud Logging representation replaced the microsecond glyph in the
checkpoint text. The integer duration was retained and is reported below in
microseconds (`μs`), matching the tracer implementation.

## Transaction summary

Durations in the following tables are microseconds (`μs`). CP08 and CP09
language sequences are ordered `ms / en / zh-CN / ta`.

### Ingestion, AI, validation, and queue persistence

| Source time (UTC+08) | Trace | User-described path | CP01 | CP02 | CP03 | CP04 | CP05 | CP06 | CP07 | Σ checkpoints |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Nov 25, 20:22:57 | `4bb64520` | Image with caption | 6,289 | 273 | 84,098 | 1,645 | 9,907,407 | 421 | 58,653 | 13,381,009 |
| Nov 25, 20:23:56 | `f05a95cd` | Image with caption | 777 | 50 | 9,730 | 821 | 11,618,287 | 26 | 3,236 | 13,757,884 |
| Nov 25, 20:24:05 | `6bd4b05b` | Image with caption | 516 | 2,596,994 | 4,807 | 568 | 14,311,828 | 40 | 31,566 | 19,002,702 |
| Nov 25, 20:24:14 | `b85770c5` | Text only | 761 | 7,827,452 | 1,597 | 708 | 11,078,322 | 47 | 3,599 | 19,395,336 |
| Nov 25, 20:24:27 | `6051b975` | Image with caption | 2,028 | 6,318,530 | 4,995 | 773 | 12,510,081 | 66 | 3,757 | 20,723,326 |

### Message reconstruction and destination send

| Source time (UTC+08) | Trace | CP08 `ms / en / zh-CN / ta` (μs) | CP09 `ms / en / zh-CN / ta` (μs) |
|---|---|---|---|
| Nov 25, 20:22:57 | `4bb64520` | 1,599 / 81 / 79 / 80 | 1,905,669 / 369,424 / 538,856 / 506,435 |
| Nov 25, 20:23:56 | `f05a95cd` | 1,112 / 82 / 76 / 77 | 533,358 / 616,359 / 580,306 / 393,587 |
| Nov 25, 20:24:05 | `6bd4b05b` | 1,028 / 193 / 64 / 76 | 580,421 / 437,913 / 502,052 / 534,636 |
| Nov 25, 20:24:14 | `b85770c5` | 272 / 97 / 255 / 64 | 120,189 / 118,895 / 124,265 / 118,813 |
| Nov 25, 20:24:27 | `6051b975` | 937 / 59 / 72 / 58 | 392,948 / 395,896 / 583,285 / 509,841 |

## Comparison with the 2026-11-24 audit

The previous audit contains seven AI-processed traces. Its values are
compared with the five AI-processed traces in this report. Means, medians,
and ranges below are calculated from the checkpoint data in the two reports.
Durations are milliseconds.

| Measure | Previous audit (n=7) | Current audit (n=5) | Difference |
|---|---:|---:|---:|
| CP05 mean | 23,030.917 | 11,885.185 | -48.4% |
| CP05 median | 22,600.463 | 11,618.287 | -48.6% |
| CP05 range | 5,551.080–50,680.407 | 9,907.407–14,311.828 | Current sample has a narrower range |
| Σ checkpoint mean | 26,650.529 | 17,252.051 | -35.3% |
| Σ checkpoint median | 27,328.621 | 19,002.702 | -30.5% |
| Σ checkpoint range | 5,994.162–55,618.038 | 13,381.009–20,723.326 | Current sample has a narrower range |
| CP02 mean | 0.645 | 3,348.660 | Increased due to queue waits in three current traces |

The current sample's mean CP05 was lower than the previous sample's mean,
and its five calls fell within a narrower range. This is descriptive only:
the runs used different messages and occurred at different times, and the
logs do not establish that the exact deployed model configuration, provider
conditions, or network conditions were controlled between audits. The
difference therefore cannot be attributed to a specific thinking level or
code change.

The higher CP02 mean is driven by the three later transactions, whose FIFO
waits were 2.597–7.827 seconds. CP02 measures queue waiting, not Gemini
latency. The new checkpoint totals also remain instrumented sums rather than
end-to-end elapsed times; no new E2E values are asserted here.

## Findings and limitations

1. **CP05 remains the largest measured stage.** Its range in this five-trace
   sample is 9.907–14.312 seconds.
2. **FIFO waiting affected later items.** The last three traces recorded
   multi-second CP02 waits, consistent with sequential processing of a burst.
3. **Destination-send latency varied.** The first trace's Malay CP09 span was
   1.906 seconds; other sends ranged from 0.119 to 0.616 seconds. CP09 does
   not split adapter work into network, media, or other sub-operations.
4. **No model-internal timing is available.** CP05 does not distinguish
   Gemini computation from provider queueing, network time, or response
   handling.
5. **No controlled performance conclusion is possible.** The sample is small,
   uses different messages than the prior audit, and is not an A/B test.
   No latency target or SLA is evaluated.

No code or runtime configuration was changed for this audit.
