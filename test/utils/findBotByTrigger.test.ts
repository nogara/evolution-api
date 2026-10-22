import { findBotByTrigger } from '@utils/findBotByTrigger';
import { describe, expect, it, vi } from 'vitest';

type Bot = { id: string; triggerType: string; triggerOperator?: string; triggerValue?: string };

const createRepository = (bots: Bot[]) => ({
  findFirst: vi.fn(async ({ where }) => {
    if (where.triggerType?.in) return bots.find((bot) => where.triggerType.in.includes(bot.triggerType)) ?? null;
    return (
      bots.find(
        (bot) =>
          bot.triggerType === where.triggerType &&
          bot.triggerOperator === where.triggerOperator &&
          bot.triggerValue === where.triggerValue,
      ) ?? null
    );
  }),
  findMany: vi.fn(async ({ where }) =>
    bots.filter(
      (bot) =>
        bot.triggerType === where.triggerType &&
        (where.triggerOperator === undefined || bot.triggerOperator === where.triggerOperator),
    ),
  ),
});

describe('findBotByTrigger', () => {
  it('returns a bot with trigger type all before any other bot', async () => {
    const repository = createRepository([
      { id: 'kw', triggerType: 'keyword', triggerOperator: 'equals', triggerValue: 'hi' },
      { id: 'all', triggerType: 'all' },
    ]);

    expect(await findBotByTrigger(repository, 'hi', 'inst')).toEqual({ id: 'all', triggerType: 'all' });
  });

  it('returns a bot with trigger type none', async () => {
    const repository = createRepository([{ id: 'none', triggerType: 'none' }]);

    expect((await findBotByTrigger(repository, 'anything', 'inst'))?.id).toBe('none');
  });

  it('filters every query by enabled and instance id', async () => {
    const repository = createRepository([]);

    await findBotByTrigger(repository, 'hi', 'inst-1');

    for (const call of [...repository.findFirst.mock.calls, ...repository.findMany.mock.calls]) {
      expect(call[0].where).toMatchObject({ enabled: true, instanceId: 'inst-1' });
    }
  });

  it('returns the first advanced bot whose query matches', async () => {
    const repository = createRepository([
      { id: 'a1', triggerType: 'advanced', triggerValue: 'contains:bye' },
      { id: 'a2', triggerType: 'advanced', triggerValue: 'startswith:hello' },
    ]);

    expect((await findBotByTrigger(repository, 'Hello there', 'inst'))?.id).toBe('a2');
  });

  it('prefers advanced bots over keyword bots', async () => {
    const repository = createRepository([
      { id: 'eq', triggerType: 'keyword', triggerOperator: 'equals', triggerValue: 'hello' },
      { id: 'adv', triggerType: 'advanced', triggerValue: 'exact:hello' },
    ]);

    expect((await findBotByTrigger(repository, 'hello', 'inst'))?.id).toBe('adv');
  });

  it('returns a keyword bot on exact equality', async () => {
    const repository = createRepository([
      { id: 'eq', triggerType: 'keyword', triggerOperator: 'equals', triggerValue: 'menu' },
    ]);

    expect((await findBotByTrigger(repository, 'menu', 'inst'))?.id).toBe('eq');
    expect(await findBotByTrigger(repository, 'Menu', 'inst')).toBeNull();
  });

  it('returns a keyword bot whose regex matches', async () => {
    const repository = createRepository([
      { id: 're', triggerType: 'keyword', triggerOperator: 'regex', triggerValue: '^order\\s\\d+$' },
    ]);

    expect((await findBotByTrigger(repository, 'order 42', 'inst'))?.id).toBe('re');
    expect(await findBotByTrigger(repository, 'order x', 'inst')).toBeNull();
  });

  it('returns a keyword bot whose value starts the content', async () => {
    const repository = createRepository([
      { id: 'sw', triggerType: 'keyword', triggerOperator: 'startsWith', triggerValue: '/start' },
    ]);

    expect((await findBotByTrigger(repository, '/start now', 'inst'))?.id).toBe('sw');
    expect(await findBotByTrigger(repository, 'now /start', 'inst')).toBeNull();
  });

  it('returns a keyword bot whose value ends the content', async () => {
    const repository = createRepository([
      { id: 'ew', triggerType: 'keyword', triggerOperator: 'endsWith', triggerValue: '?' },
    ]);

    expect((await findBotByTrigger(repository, 'help?', 'inst'))?.id).toBe('ew');
    expect(await findBotByTrigger(repository, '?help', 'inst')).toBeNull();
  });

  it('returns a keyword bot whose value is contained in the content', async () => {
    const repository = createRepository([
      { id: 'ct', triggerType: 'keyword', triggerOperator: 'contains', triggerValue: 'price' },
    ]);

    expect((await findBotByTrigger(repository, 'what is the price today', 'inst'))?.id).toBe('ct');
    expect(await findBotByTrigger(repository, 'hello', 'inst')).toBeNull();
  });

  it('checks keyword operators in the order equals, regex, startsWith, endsWith, contains', async () => {
    const repository = createRepository([
      { id: 'ct', triggerType: 'keyword', triggerOperator: 'contains', triggerValue: 'a' },
      { id: 'ew', triggerType: 'keyword', triggerOperator: 'endsWith', triggerValue: 'a' },
      { id: 'sw', triggerType: 'keyword', triggerOperator: 'startsWith', triggerValue: 'a' },
      { id: 're', triggerType: 'keyword', triggerOperator: 'regex', triggerValue: 'a' },
    ]);

    expect((await findBotByTrigger(repository, 'aba', 'inst'))?.id).toBe('re');
  });

  it('KNOWN BUG: rejects the whole lookup when a stored regex is invalid (current behavior)', async () => {
    const repository = createRepository([
      { id: 're', triggerType: 'keyword', triggerOperator: 'regex', triggerValue: '(' },
    ]);

    await expect(findBotByTrigger(repository, 'x', 'inst')).rejects.toThrow(SyntaxError);
  });

  it.fails('skips a bot with an invalid stored regex and keeps searching', async () => {
    const repository = createRepository([
      { id: 're', triggerType: 'keyword', triggerOperator: 'regex', triggerValue: '(' },
      { id: 'ct', triggerType: 'keyword', triggerOperator: 'contains', triggerValue: 'x' },
    ]);

    expect((await findBotByTrigger(repository, 'x', 'inst'))?.id).toBe('ct');
  });

  it('returns null when nothing matches', async () => {
    expect(await findBotByTrigger(createRepository([]), 'hi', 'inst')).toBeNull();
  });
});
