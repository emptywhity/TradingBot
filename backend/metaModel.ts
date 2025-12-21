import fs from 'fs/promises';
import { MetaModelV1, validateMetaModel } from '@/services/metaModel';

type MetaModelOpts = {
  path?: string;
  inlineJson?: string;
};

export class MetaModelManager {
  private cached: MetaModelV1 | null = null;
  private lastMtime?: number;

  constructor(private readonly opts: MetaModelOpts) {}

  async getModel(): Promise<MetaModelV1 | null> {
    if (this.opts.inlineJson) {
      const parsed = this.parseJson(this.opts.inlineJson);
      this.cached = parsed;
      return this.cached;
    }
    if (!this.opts.path) return this.cached;
    try {
      const stat = await fs.stat(this.opts.path);
      const mtime = stat.mtimeMs;
      if (!this.cached || this.lastMtime !== mtime) {
        const raw = await fs.readFile(this.opts.path, 'utf-8');
        const parsed = this.parseJson(raw);
        this.cached = parsed;
        this.lastMtime = mtime;
      }
    } catch (err) {
      console.warn('[meta-model] unable to load model', err);
      this.cached = null;
    }
    return this.cached;
  }

  private parseJson(text: string): MetaModelV1 | null {
    try {
      const json = JSON.parse(text);
      const validated = validateMetaModel(json);
      if (validated.ok) return validated.model;
      console.warn('[meta-model] invalid model', validated.error);
      return null;
    } catch (err) {
      console.warn('[meta-model] failed to parse JSON', err);
      return null;
    }
  }
}
