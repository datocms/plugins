/**
 * Tests for recoverJsonArray — last-resort recovery of lightly-malformed JSON
 * arrays emitted by chat models (single-quoted strings, trailing commas,
 * markdown fences, surrounding prose). This is the mitigation for the reported
 * "record with single quotes only translated after 3-4 retries" bug: the model
 * intermittently returns a JS/Python-style single-quoted array which strict
 * JSON.parse rejects, so the whole field translation failed until a retry
 * happened to yield clean JSON.
 */

import { describe, expect, it } from 'vitest';
import { recoverJsonArray } from './jsonArrayRecovery';

describe('recoverJsonArray', () => {
  it('returns null for non-array JSON objects', () => {
    expect(recoverJsonArray('{"a":1}')).toBeNull();
  });

  it('returns null for free-form prose with no array', () => {
    expect(recoverJsonArray('Sorry, I cannot translate that.')).toBeNull();
  });

  it('parses an already-valid double-quoted array unchanged', () => {
    expect(recoverJsonArray('["Bonjour", "Le monde"]')).toEqual([
      'Bonjour',
      'Le monde',
    ]);
  });

  it('recovers a single-quoted array (JS/Python style)', () => {
    expect(recoverJsonArray("['Bonjour', 'Le monde']")).toEqual([
      'Bonjour',
      'Le monde',
    ]);
  });

  it('recovers single-quoted strings that contain apostrophes (escaped)', () => {
    // The exact failure the customer hit: content full of apostrophes.
    expect(recoverJsonArray("['Aujourd\\'hui', 'L\\'hôtel est ouvert']")).toEqual([
      "Aujourd'hui",
      "L'hôtel est ouvert",
    ]);
  });

  it('recovers a single-quoted string containing literal double quotes', () => {
    expect(recoverJsonArray('[\'He said "hi"\']')).toEqual(['He said "hi"']);
  });

  it('recovers a trailing comma before the closing bracket', () => {
    expect(recoverJsonArray('["a", "b",]')).toEqual(['a', 'b']);
  });

  it('strips a markdown ```json fence', () => {
    expect(recoverJsonArray('```json\n["a", "b"]\n```')).toEqual(['a', 'b']);
  });

  it('extracts an array embedded in surrounding prose', () => {
    expect(recoverJsonArray('Here you go: ["a", "b"]. Done.')).toEqual([
      'a',
      'b',
    ]);
  });

  it('recovers a single-quoted array wrapped in a fence and prose', () => {
    expect(
      recoverJsonArray("Sure!\n```\n['c\\'est', 'là']\n```"),
    ).toEqual(["c'est", 'là']);
  });

  it('preserves non-string elements when recovering', () => {
    expect(recoverJsonArray('[1, 2, 3,]')).toEqual([1, 2, 3]);
  });

  it('returns null when the bracketed region is not recoverable', () => {
    // Genuinely broken: unterminated string with no closing quote.
    expect(recoverJsonArray("['unterminated")).toBeNull();
  });

  it('ignores prose brackets BEFORE the array (travel content)', () => {
    // The first `[` belongs to prose, not the array — naive first-[/last-]
    // slicing would mis-grab "[Europe]: [...]" and fail.
    expect(
      recoverJsonArray("Hotels in [Europe]: ['Paris', 'Rome']"),
    ).toEqual(['Paris', 'Rome']);
  });

  it('keeps brackets that live INSIDE single-quoted string values', () => {
    expect(
      recoverJsonArray("['Paris [CDG]', 'Rome [FCO]']"),
    ).toEqual(['Paris [CDG]', 'Rome [FCO]']);
  });

  it('recovers an array after prose brackets with bracketed string contents', () => {
    expect(
      recoverJsonArray("Top picks [4-star]: ['Hotel A [4★]', 'Hotel B [5★]']"),
    ).toEqual(['Hotel A [4★]', 'Hotel B [5★]']);
  });

  it('skips a bracketed-list prose preamble before the array', () => {
    expect(
      recoverJsonArray(
        "Flights [CDG, FCO, MXP]: ['Paris [Charles de Gaulle]', 'Rome [Fiumicino]']",
      ),
    ).toEqual(['Paris [Charles de Gaulle]', 'Rome [Fiumicino]']);
  });
});
