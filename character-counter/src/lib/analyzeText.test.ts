import { describe, expect, it } from 'vitest';
import {
  analyzeFieldValue,
  summarizeWordFrequencies,
  supportsStopwordFiltering,
} from './analyzeText';

describe('analyzeFieldValue', () => {
  it('handles empty and null input', () => {
    expect(analyzeFieldValue(null, 'text')).toMatchObject({
      charactersWithSpaces: 0,
      charactersWithoutSpaces: 0,
      words: 0,
      uniqueWords: 0,
      specialCharacters: 0,
      sentences: 0,
      paragraphs: 0,
      topWords: [],
    });

    expect(analyzeFieldValue('', 'string')).toMatchObject({
      charactersWithSpaces: 0,
      charactersWithoutSpaces: 0,
      words: 0,
      uniqueWords: 0,
      specialCharacters: 0,
      sentences: 0,
      paragraphs: 0,
      topWords: [],
    });
  });

  it('normalizes punctuation and whitespace for word statistics while preserving character counts', () => {
    const input = " Hello,\nhello!  Don't stop. ";
    const result = analyzeFieldValue(input, 'text', { locale: 'en' });

    expect(result.charactersWithSpaces).toBe(input.length);
    expect(result.charactersWithoutSpaces).toBe(
      input.replace(/\s/gu, '').length,
    );
    expect(result.specialCharacters).toBe(4);
    expect(result.words).toBe(4);
    expect(result.uniqueWords).toBe(3);
    expect(result.sentences).toBe(2);
    expect(result.paragraphs).toBe(2);
    expect(result.topWords.slice(0, 3)).toEqual([
      { word: 'hello', count: 2 },
      { word: 'dont', count: 1 },
      { word: 'stop', count: 1 },
    ]);
  });

  it('counts repeated words and sorts the common words list by frequency', () => {
    const result = analyzeFieldValue('red blue red green blue red', 'string', {
      locale: 'en',
    });

    expect(result.words).toBe(6);
    expect(result.uniqueWords).toBe(3);
    expect(result.topWords).toEqual([
      { word: 'red', count: 3 },
      { word: 'blue', count: 2 },
      { word: 'green', count: 1 },
    ]);
  });

  it('supports English stopword filtering without changing the base metrics', () => {
    const result = analyzeFieldValue('the cat and the hat', 'text', {
      locale: 'en',
    });

    expect(result.words).toBe(5);
    expect(result.uniqueWords).toBe(4);

    const filteredWords = summarizeWordFrequencies(result.wordFrequencyEntries, {
      locale: 'en',
      filterStopwords: true,
    });

    expect(filteredWords.uniqueWords).toBe(2);
    expect(filteredWords.topWords).toEqual([
      { word: 'cat', count: 1 },
      { word: 'hat', count: 1 },
    ]);
  });

  it('caps the common words list to the top ten entries', () => {
    const input = Array.from({ length: 12 }, (_, index) => {
      const word = `word${index}`;
      return Array.from({ length: index + 1 }, () => word).join(' ');
    }).join(' ');

    const result = analyzeFieldValue(input, 'text', { locale: 'en' });

    expect(result.topWords).toHaveLength(10);
    expect(result.topWords[0]).toEqual({ word: 'word11', count: 12 });
    expect(result.topWords[result.topWords.length - 1]).toEqual({
      word: 'word2',
      count: 3,
    });
  });

  it('flattens structured text paragraphs and counts punctuation-heavy content safely', () => {
    const value = [
      {
        type: 'paragraph',
        children: [{ text: 'Hello world!' }],
      },
      {
        type: 'paragraph',
        children: [{ text: 'Second paragraph #1' }],
      },
      {
        type: 'list',
        style: 'bulleted',
        children: [
          {
            type: 'listItem',
            children: [
              {
                type: 'paragraph',
                children: [{ text: 'List item?' }],
              },
            ],
          },
        ],
      },
    ];

    const result = analyzeFieldValue(value, 'structured_text', {
      locale: 'en',
    });

    expect(result.charactersWithSpaces).toBe(
      'Hello world!Second paragraph #1List item?'.length,
    );
    expect(result.words).toBe(7);
    expect(result.uniqueWords).toBe(7);
    expect(result.specialCharacters).toBe(3);
    expect(result.sentences).toBe(3);
    expect(result.paragraphs).toBe(3);
  });

  it('keeps slug analysis lightweight and count-focused', () => {
    const result = analyzeFieldValue('hello-world', 'slug');

    expect(result.charactersWithSpaces).toBe(11);
    expect(result.charactersWithoutSpaces).toBe(11);
    expect(result.words).toBe(0);
    expect(result.uniqueWords).toBe(0);
    expect(result.sentences).toBe(0);
    expect(result.topWords).toEqual([]);
  });
});

describe('supportsStopwordFiltering', () => {
  it('only enables stopword filtering for english locales in v1', () => {
    expect(supportsStopwordFiltering('en')).toBe(true);
    expect(supportsStopwordFiltering('en-US')).toBe(true);
    expect(supportsStopwordFiltering('it')).toBe(false);
    expect(supportsStopwordFiltering(undefined)).toBe(false);
  });
});
