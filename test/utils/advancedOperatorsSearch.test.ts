import { advancedOperatorsSearch } from '@utils/advancedOperatorsSearch';
import { describe, expect, it } from 'vitest';

describe('advancedOperatorsSearch', () => {
  it('matches contains ignoring case and accents', () => {
    expect(advancedOperatorsSearch('Olá Mundo', 'contains:ola')).toBe(true);
    expect(advancedOperatorsSearch('Hello', 'contains:bye')).toBe(false);
  });

  it('matches notcontains only when the value is absent', () => {
    expect(advancedOperatorsSearch('hello world', 'notcontains:bye')).toBe(true);
    expect(advancedOperatorsSearch('hello world', 'notcontains:world')).toBe(false);
  });

  it('matches startswith and endswith', () => {
    expect(advancedOperatorsSearch('Hello world', 'startswith:hello')).toBe(true);
    expect(advancedOperatorsSearch('Hello world', 'startswith:world')).toBe(false);
    expect(advancedOperatorsSearch('Hello world', 'endswith:WORLD')).toBe(true);
    expect(advancedOperatorsSearch('Hello world', 'endswith:hello')).toBe(false);
  });

  it('matches exact only on the whole normalized text', () => {
    expect(advancedOperatorsSearch('Ação', 'exact:acao')).toBe(true);
    expect(advancedOperatorsSearch('Ação rápida', 'exact:acao')).toBe(false);
  });

  it('strips accents from the query value', () => {
    expect(advancedOperatorsSearch('acao', 'contains:Ação')).toBe(true);
  });

  it('returns false for an empty query', () => {
    expect(advancedOperatorsSearch('hello', '')).toBe(false);
  });

  it('accepts operator names in any case', () => {
    expect(advancedOperatorsSearch('hello', 'CONTAINS:ell')).toBe(true);
  });

  it('returns false for unknown operators', () => {
    expect(advancedOperatorsSearch('hello', 'matches:hello')).toBe(false);
  });

  it('requires every comma separated value to match', () => {
    expect(advancedOperatorsSearch('buy red shoes', 'contains:red,shoes')).toBe(true);
    expect(advancedOperatorsSearch('buy red shoes', 'contains:red,hat')).toBe(false);
  });

  it('accepts any repeated value for the same operator', () => {
    expect(advancedOperatorsSearch('buy shoes', 'contains:hat contains:shoes')).toBe(true);
  });

  it('requires every distinct operator to match', () => {
    expect(advancedOperatorsSearch('buy shoes', 'startswith:buy notcontains:hat')).toBe(true);
    expect(advancedOperatorsSearch('buy shoes', 'startswith:buy notcontains:shoes')).toBe(false);
  });

  it('keeps colons inside the value', () => {
    expect(advancedOperatorsSearch('time 10:30', 'endswith:10:30')).toBe(true);
  });

  it('KNOWN BUG: never matches values that contain spaces (current behavior)', () => {
    expect(advancedOperatorsSearch('good morning', 'exact:good morning')).toBe(false);
  });

  it.fails('matches values that contain spaces', () => {
    expect(advancedOperatorsSearch('good morning', 'exact:good morning')).toBe(true);
  });
});
