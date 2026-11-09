import { Logger } from '../http/logger';
import { config } from '../config';
import { integration } from '../platform/integrations';
import { type PrismaService } from '../common/prisma.service';
import { type FileStore } from '../jobs/file-store';

export interface Transcript {
  text: string;
  language: string | null;
  /** Length of the audio, seconds, when the provider says. */
  durationS: number | null;
}

export interface SpeechToTextProvider {
  readonly name: string;
  transcribe(audio: Buffer, contentType: string, language: string | null, signal: AbortSignal): Promise<Transcript>;
}

export class TranscriptionError extends Error {}

/** Deepgram pre-recorded API: results.channels[0].alternatives[0].transcript. */
export class DeepgramProvider implements SpeechToTextProvider {
  readonly name = 'deepgram';
  constructor(
    private readonly key: string,
    private readonly model: string,
    private readonly base: string,
  ) {}

  async transcribe(audio: Buffer, contentType: string, language: string | null, signal: AbortSignal): Promise<Transcript> {
    const q = new URLSearchParams({ model: this.model, smart_format: 'true', punctuate: 'true' });
    // The interview's language when known (primary subtag, e.g. "fr" of "fr-CA"); else let it detect.
    if (language) q.set('language', language.split('-')[0]!.toLowerCase());
    else q.set('detect_language', 'true');
    const res = await fetch(`${this.base.replace(/\/$/, '')}/v1/listen?${q}`, {
      method: 'POST',
      headers: { Authorization: `Token ${this.key}`, 'Content-Type': contentType },
      body: audio,
      signal,
    }).catch((e: Error) => {
      throw new TranscriptionError(`Could not reach Deepgram (${e.message})`);
    });
    const body = (await res.json().catch(() => ({}))) as {
      err_msg?: string;
      metadata?: { duration?: number };
      results?: { channels?: Array<{ detected_language?: string; alternatives?: Array<{ transcript?: string }> }> };
    };
    if (!res.ok) throw new TranscriptionError(`Deepgram refused the recording: ${body.err_msg ?? `HTTP ${res.status}`}`);
    const channel = body.results?.channels?.[0];
    const text = channel?.alternatives?.[0]?.transcript;
    if (typeof text !== 'string') throw new TranscriptionError('Deepgram answered without a transcript');
    return {
      text: text.trim(),
      language: channel?.detected_language ?? (language ? language.split('-')[0]!.toLowerCase() : null),
      durationS: typeof body.metadata?.duration === 'number' ? body.metadata.duration : null,
    };
  }
}

/** Longest transcript kept (characters); a two-hour interview is well under this. */
const MAX_TEXT = 200_000;

export class TranscriptionService {
  private readonly log = new Logger('Transcription');
  private provider: SpeechToTextProvider | null | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly store: FileStore,
  ) {}

  /** For tests: use this provider instead of the configured one. */
  useProvider(p: SpeechToTextProvider | null) {
    this.provider = p;
  }

  /** Built from Settings > Integrations (or TRANSCRIPTION and DEEPGRAM_*), rebuilt when they change. */
  private built?: { fingerprint: string; provider: SpeechToTextProvider | null };

  current(): SpeechToTextProvider | null {
    if (this.provider !== undefined) return this.provider;
    const s = integration('deepgram');
    if (this.built?.fingerprint !== s.fingerprint)
      this.built = {
        fingerprint: s.fingerprint,
        provider: s.enabled ? new DeepgramProvider(s.values.apiKey!, s.values.model!, config().DEEPGRAM_API_BASE) : null,
      };
    return this.built.provider;
  }

  /** Transcribe one recording and store the text. Throws TranscriptionError with a readable reason. */
  async transcribe(tenantId: string, captureId: string): Promise<Transcript> {
    const provider = this.current();
    if (!provider) throw new TranscriptionError('Transcription is not turned on for this installation.');
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { blockExternalProcessors: true } });
    if (tenant?.blockExternalProcessors)
      throw new TranscriptionError('Your organization keeps data inside this deployment, so transcription (an outside service) is off.');
    const c = await this.prisma.capture.findFirst({
      where: { id: captureId, tenantId, kind: 'audio', deletedAt: null },
      include: { response: { select: { language: true } } },
    });
    if (!c) throw new TranscriptionError('The recording was deleted.');
    const audio = await this.store.get(c.storageKey);
    const t = await provider.transcribe(
      audio,
      c.contentType,
      c.response?.language ?? null,
      AbortSignal.timeout(config().TRANSCRIPTION_TIMEOUT_S * 1000),
    );
    const text = t.text.slice(0, MAX_TEXT);
    // The recording may have been erased while the provider worked: then keep nothing.
    const kept = await this.prisma.capture.updateMany({
      where: { id: c.id, deletedAt: null },
      data: { transcript: text, transcriptLanguage: t.language, transcribedAt: new Date(), transcriptProvider: provider.name },
    });
    if (!kept.count) throw new TranscriptionError('The recording was deleted.');
    this.log.log(`Transcribed recording ${c.id} (${c.size} bytes) with ${provider.name}`);
    return { ...t, text };
  }
}
