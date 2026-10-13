import type { Preset } from '@st/shared';
import { parsePresetYaml, presetToYaml } from './preset-yaml.js';
import { YamlRepository, type YamlCodec } from './yaml-repository.js';

const presetCodec: YamlCodec<Preset> = {
  label: 'preset',
  fallbackStem: 'preset',
  parse(text) {
    const result = parsePresetYaml(text);
    return result.ok
      ? { ok: true, item: result.preset }
      : { ok: false, reason: result.reason, needsStamp: result.needsStamp };
  },
  serialize: presetToYaml,
};

/** Presets as YAML files under `data/presets/` (see `YamlRepository`). */
export class PresetRepository extends YamlRepository<Preset> {
  constructor(directory: string) {
    super(directory, presetCodec);
  }
}
