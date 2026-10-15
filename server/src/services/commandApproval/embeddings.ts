import os from 'os';
import path from 'path';
import type { CommandPart } from './signature';

export const COMMAND_EMBEDDING_MODEL = 'Qdrant/all-MiniLM-L6-v2-onnx:fastembed-v3';
export const COMMAND_EMBEDDING_FORMAT = 'normalized-v2';

async function createExtractor() {
  const { EmbeddingModel, FlagEmbedding } = await import('fastembed');
  return FlagEmbedding.init({
    model: EmbeddingModel.AllMiniLML6V2,
    cacheDir: path.join(os.homedir(), '.iodine', 'models'),
    showDownloadProgress: false,
  });
}

let extractorPromise: ReturnType<typeof createExtractor> | null = null;

export function commandEmbeddingInput(part: CommandPart): string {
  const { signature, paths } = part;
  return [signature.program, signature.subcommand, ...signature.flags, ...signature.literalOperands, ...paths]
    .filter((value): value is string => Boolean(value))
    .join(' ');
}

export async function embedCommand(command: string): Promise<number[]> {
  const extractor = await (extractorPromise ??= createExtractor().catch(error => {
    extractorPromise = null;
    throw error;
  }));
  const output = await extractor.embed([command], 1).next();
  if (!output.value?.[0]) throw new Error('Local embedding model returned no vector');
  return output.value[0];
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) return 0;

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] ** 2;
    rightMagnitude += right[index] ** 2;
  }
  return leftMagnitude && rightMagnitude ? dot / Math.sqrt(leftMagnitude * rightMagnitude) : 0;
}
