import { generateSpeech, normalizeSpeed } from '#core'
import type { Format, Metadata, Model } from '#core'
import { getLibraryService, getTtsProvider } from '../utils/container'
import { respondError } from '../utils/errors'
import { toGenerationDto } from '../utils/serialize'

interface GenerationBody {
  text?: string
  voiceId?: string
  model?: string
  format?: string
  speed?: number
  instructions?: string
  metadata?: Metadata
}

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody<GenerationBody>(event)
    const input = {
      text: body?.text ?? '',
      voiceId: body?.voiceId ?? '',
      model: body?.model,
      format: body?.format,
      speed: body?.speed,
      instructions: body?.instructions,
    }

    // Validation (voice/model/format/length + instructions rule) runs inside
    // generateSpeech before any provider call. The provider is resolved per
    // request from the active key + optional base URL (UI→env).
    const bytes = await generateSpeech(getTtsProvider(), input)

    // After validation the model/format are known-good; the audio is tagged with
    // the metadata (inside save) before being written under a dated, slug-named
    // path. `skippedTags` reports any fields dropped for the format (FR-021).
    const service = await getLibraryService()
    const { skippedTags, ...entry } = await service.save(
      {
        text: input.text,
        voiceId: input.voiceId,
        model: (input.model as Model | undefined) ?? null,
        format: input.format as Format | undefined,
        // Persist the speed actually used for synthesis (clamped), not the raw
        // request value, so the library row matches the produced clip.
        speed: normalizeSpeed(input.speed),
        metadata: body?.metadata ?? {},
      },
      bytes,
    )

    setResponseStatus(event, 201)
    return toGenerationDto(entry, skippedTags)
  } catch (err) {
    return respondError(event, err)
  }
})
