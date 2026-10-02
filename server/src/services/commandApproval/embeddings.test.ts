import { describe, expect, it } from 'vitest';
import { commandEmbeddingInput, cosineSimilarity } from './embeddings';
import { describeCommand } from './signature';

describe('embedding input', () => {
  it('uses the same input for equivalent flags and relative paths', () => {
    const cwd = process.cwd();
    const first = describeCommand('mkdir -p src/example', cwd, cwd);
    const second = describeCommand('mkdir --parents ./src/example', cwd, cwd);
    if (!first.ok || !second.ok) throw new Error('command could not be described');
    expect(commandEmbeddingInput(first.parts[0])).toBe(commandEmbeddingInput(second.parts[0]));
  });
});

describe('cosine similarity', () => {
  it('compares vectors without depending on their magnitude', () => {
    expect(cosineSimilarity([1, 0], [5, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it('rejects empty and incompatible vectors', () => {
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([1, 0], [1])).toBe(0);
  });
});
