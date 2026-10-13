import type { Voice } from '#core/client'
import type { QueueItem } from './useQueue'

function extractApiError(e: unknown): string {
  const data = (e as { data?: { error?: { message?: string } } })?.data
  return data?.error?.message ?? 'Something went wrong. Please try again.'
}

/**
 * Live state of a generation run (007 · US4 / G-CANCEL, data-model §5). Drives the
 * {@link GenerationProgressModal}: the current file, the running per-item tally, and —
 * once the loop stops — a succeeded/failed/not-generated summary. In-memory only.
 *
 * `state` follows `idle` (pre-run / after {@link useGeneration.reset}) → `running`
 * → (`completed` when the loop finishes) | (`cancelled` when a cancel request breaks
 * the loop after the in-flight file finishes). `notGenerated` is populated only on
 * `cancelled` — the non-done target items not reached in the current run, including
 * rows whose `failed` status came from an earlier attempt.
 */
export interface GenerationProgress {
  /** Target items to process this run. */
  total: number
  /** 0-based position of the current item within the target. */
  index: number
  /** The file currently generating; `null` between/after items. */
  current: QueueItem | null
  /** Saved generation ids of the successes so far. */
  succeeded: string[]
  /** Per-item failures (isolated — a failure never aborts the run, FR-015). */
  failed: { clientId: string; label: string; error: string }[]
  /** On cancel: target items left unprocessed when the loop broke (FR-017). */
  notGenerated: QueueItem[]
  state: 'idle' | 'running' | 'completed' | 'cancelled'
}

function idleProgress(): GenerationProgress {
  return { total: 0, index: 0, current: null, succeeded: [], failed: [], notGenerated: [], state: 'idle' }
}

/** Today as a local calendar date for metadata written by a successful generation. */
function todayIso(): string {
  const date = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function itemLabel(item: QueueItem): string {
  return item.sourceName ?? item.text
}

/**
 * Drives batch generation: one request per queue row with per-item progress and
 * isolated failures (a failing item never aborts the rest, FR-006/007). On the
 * 005 redesign each successfully generated row is removed from the queue while
 * failures remain for retry (FR-005b); the run's successful generation ids are
 * kept in {@link useGeneration.lastBatchIds} so the page can still offer a single
 * `.zip` download of that batch after the rows have left the queue (FR-022).
 */
export function useGeneration() {
  const voices = ref<Voice[]>([])
  const generating = ref(false)
  // Saved generation ids of the most recent run's successes — drives the post-run
  // "download this batch" affordance. Reset at the start of every run, so a run
  // with zero successes offers no download (FR-022).
  const lastBatchIds = ref<string[]>([])
  // 007 · US4 (G-CANCEL): live run progress for the modal, plus a cancel flag checked
  // BETWEEN items — the in-flight file finishes, then the loop breaks before the next
  // (graceful stop, not an AbortController). `cancelRequested` is cleared at each run's
  // start so a stale request never leaks into a fresh run.
  const progress = ref<GenerationProgress>(idleProgress())
  const cancelRequested = ref(false)

  async function loadVoices() {
    const res = await $fetch<{ voices: Voice[] }>('/api/voices')
    voices.value = res.voices
  }

  async function generateItem(item: QueueItem, speed: number) {
    item.status = 'generating'
    item.error = undefined
    item.result = undefined // clear any stale result so it signals only this run's success
    // FR-020: a blank date belongs to the successful generation attempt, not to the
    // queue row or batch start. Restore the original metadata when the request fails so
    // a retry on a later day receives that later day's date.
    const originalMetadata = item.metadata
    const recordedAt = originalMetadata.recordedAt
    const stampedRecordingDate = recordedAt === undefined || recordedAt === ''
    if (stampedRecordingDate) {
      item.metadata = { ...originalMetadata, recordedAt: todayIso() }
    }
    try {
      const entry = await $fetch<{ id: string; audioUrl?: string; skippedTags?: string[] }>(
        '/api/generations',
        {
          method: 'POST',
          body: {
            text: item.text,
            voiceId: item.voiceId,
            model: item.model,
            format: item.format,
            speed,
            instructions: item.instructions,
            metadata: item.metadata,
          },
        },
      )
      item.status = 'done'
      item.result = {
        id: entry.id,
        audioUrl: entry.audioUrl ?? `/api/generations/${entry.id}/audio`,
        skippedTags: entry.skippedTags,
      }
    } catch (e) {
      if (stampedRecordingDate) item.metadata = originalMetadata
      item.status = 'failed'
      item.error = extractApiError(e)
    }
  }

  /** Request a graceful stop: the in-flight item finishes, then the loop breaks (US4). */
  function requestCancel() {
    cancelRequested.value = true
  }

  /** Return progress to idle and clear any pending cancel (before/after a run, US4). */
  function reset() {
    progress.value = idleProgress()
    cancelRequested.value = false
  }

  /**
   * Generate every not-yet-done item in the target list in order, isolating
   * per-item failures. The target is chosen by the caller (checked-else-all,
   * FR-005a). Each success is recorded in {@link lastBatchIds} and, when a
   * `remove` callback is given, dropped from the queue (FR-005b); failures stay.
   *
   * 007 · US4: publishes live {@link progress} (current file + succeeded/failed tally)
   * and honours {@link requestCancel} — the flag is checked BETWEEN items, so the
   * in-flight item finishes and the loop breaks before the next; the remaining target
   * items are reported as `notGenerated` and the run ends `cancelled` (FR-016/FR-017).
   */
  async function generateAll(
    items: QueueItem[],
    speed: number,
    remove?: (clientId: string) => void,
  ) {
    generating.value = true
    cancelRequested.value = false
    const succeeded: string[] = []
    const failed: { clientId: string; label: string; error: string }[] = []
    // Snapshot so removing successes from the queue can't disturb iteration or the
    // not-generated tail (the callers already pass a fresh `generateTarget` array).
    const target = [...items]
    progress.value = {
      total: target.length,
      index: 0,
      current: null,
      succeeded: [],
      failed: [],
      notGenerated: [],
      state: 'running',
    }
    try {
      for (let i = 0; i < target.length; i++) {
        const item = target[i]!
        if (item.status === 'done') continue
        progress.value.index = i
        progress.value.current = item
        await generateItem(item, speed)
        // `result` is set only on success (and cleared at the start of each attempt),
        // so it is the reliable per-run success signal — failures leave it undefined.
        if (item.result) {
          succeeded.push(item.result.id)
          progress.value.succeeded = [...succeeded]
          remove?.(item.clientId)
        } else {
          failed.push({
            clientId: item.clientId,
            label: itemLabel(item),
            error: item.error ?? 'unknown',
          })
          progress.value.failed = [...failed]
        }
        // Graceful cancel: check AFTER the in-flight item settled, break before the next.
        if (cancelRequested.value) {
          progress.value.notGenerated = target
            .slice(i + 1)
            .filter((it) => it.status !== 'done')
          progress.value.current = null
          progress.value.state = 'cancelled'
          break
        }
      }
      if (progress.value.state === 'running') {
        progress.value.current = null
        progress.value.state = 'completed'
      }
    } finally {
      generating.value = false
      lastBatchIds.value = succeeded
    }
  }

  /** Download the given saved items as one `.zip` via the archive endpoint. */
  async function downloadArchive(ids: string[]) {
    if (ids.length === 0) return
    const blob = await $fetch<Blob>('/api/generations/archive', {
      method: 'POST',
      body: { ids },
      responseType: 'blob',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'echorecall-batch.zip'
    document.body.appendChild(link)
    link.click()
    // Firefox handles synthetic clicks asynchronously; revoking the object URL
    // synchronously on the next line aborts the download before it starts.
    setTimeout(() => {
      link.remove()
      URL.revokeObjectURL(url)
    }, 1000)
  }

  return {
    voices,
    generating,
    lastBatchIds,
    progress,
    cancelRequested,
    loadVoices,
    generateItem,
    generateAll,
    requestCancel,
    reset,
    downloadArchive,
  }
}
