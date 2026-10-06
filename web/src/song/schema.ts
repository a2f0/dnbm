// The JSON Schema for song files, generated from the parameter tables and served at
// /song.schema.json. Song files name it in "$schema", so editors validate and complete
// hand edits. parseSong in format.ts remains the authority; the schema is a guide.

import { FORMAT_VERSION, SCHEMA_URL } from "./format";
import {
  BPM,
  CHOKE_GROUPS,
  DELAY_PARAMS,
  INSTRUMENT_KINDS,
  INSTRUMENTS,
  MASTER_PARAMS,
  MIXER_PARAMS,
  type ParamSpec,
  REVERB_PARAMS,
  SWING,
} from "./instruments";
import { ID_PATTERN, MAX_ARRANGEMENT, MAX_PATTERNS, MAX_TRACKS } from "./model";
import { MAX_BARS } from "./notation";

function numberSchema(spec: ParamSpec): object {
  return {
    type: "number",
    minimum: spec.min,
    maximum: spec.max,
    default: spec.default,
    description: spec.unit ? `${spec.label} (${spec.unit})` : spec.label,
  };
}

function paramsSchema(specs: readonly ParamSpec[]): object {
  return {
    type: "object",
    additionalProperties: false,
    properties: Object.fromEntries(specs.map((spec) => [spec.key, numberSchema(spec)])),
  };
}

const idSchema = { type: "string", pattern: ID_PATTERN.source };

export function songSchema(): object {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: SCHEMA_URL,
    title: "dnbm song",
    description: "A drum and bass song for dnbm (https://dnbm.a2f0.net).",
    type: "object",
    required: ["dnbm", "patterns", "arrangement"],
    additionalProperties: false,
    properties: {
      $schema: { type: "string" },
      dnbm: { const: FORMAT_VERSION, description: "Song format version" },
      title: { type: "string", maxLength: 120 },
      bpm: numberSchema(BPM),
      swing: numberSchema(SWING),
      master: paramsSchema(MASTER_PARAMS),
      reverb: paramsSchema(REVERB_PARAMS),
      delay: paramsSchema(DELAY_PARAMS),
      tracks: {
        type: "array",
        maxItems: MAX_TRACKS,
        items: {
          type: "object",
          required: ["id", "instrument"],
          additionalProperties: false,
          properties: {
            id: idSchema,
            instrument: { enum: INSTRUMENT_KINDS },
            choke: { type: "integer", minimum: 0, maximum: CHOKE_GROUPS },
            mixer: {
              type: "object",
              additionalProperties: false,
              properties: {
                ...Object.fromEntries(MIXER_PARAMS.map((spec) => [spec.key, numberSchema(spec)])),
                mute: { type: "boolean" },
                solo: { type: "boolean" },
              },
            },
            params: { type: "object" },
          },
          allOf: INSTRUMENT_KINDS.map((kind) => ({
            if: { properties: { instrument: { const: kind } } },
            // biome-ignore lint/suspicious/noThenProperty: JSON Schema's conditional keyword.
            then: { properties: { params: paramsSchema(INSTRUMENTS[kind].params) } },
          })),
        },
      },
      patterns: {
        type: "array",
        minItems: 1,
        maxItems: MAX_PATTERNS,
        items: {
          type: "object",
          required: ["id"],
          additionalProperties: false,
          properties: {
            id: idSchema,
            bars: { type: "integer", minimum: 1, maximum: MAX_BARS },
            rows: {
              type: "object",
              description:
                'One string per track. Hits: ". o x X" per step. Notes: "F-1", "---" (tie) or "..." (rest) per step.',
              additionalProperties: { type: "string" },
            },
          },
        },
      },
      arrangement: {
        type: "array",
        minItems: 1,
        maxItems: MAX_ARRANGEMENT,
        items: idSchema,
      },
    },
  };
}
