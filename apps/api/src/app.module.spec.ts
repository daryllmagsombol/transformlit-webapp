import { Kind } from 'graphql';
import { GraphQLError } from 'graphql';
import { DateTimeScalar } from './app.module.js';

describe('DateTime scalar', () => {
  it('parseValue converts a valid ISO string to a Date', () => {
    const result = DateTimeScalar.parseValue('2026-09-02T09:54:33.000Z');
    expect(result).toBeInstanceOf(Date);
    expect((result as Date).toISOString()).toBe('2026-09-02T09:54:33.000Z');
  });

  it('parseValue throws on an invalid string', () => {
    expect(() => DateTimeScalar.parseValue('not-a-date')).toThrow(GraphQLError);
    expect(() => DateTimeScalar.parseValue('not-a-date')).toThrow(/invalid date/);
  });

  it('parseValue throws on a non-string value', () => {
    expect(() => DateTimeScalar.parseValue(12345)).toThrow(GraphQLError);
    expect(() => DateTimeScalar.parseValue(null)).toThrow(GraphQLError);
  });

  it('serialize converts a Date to an ISO string', () => {
    expect(DateTimeScalar.serialize(new Date('2026-09-02T09:54:33.000Z'))).toBe(
      '2026-09-02T09:54:33.000Z',
    );
  });

  it('serialize converts a valid ISO string to an ISO string', () => {
    expect(DateTimeScalar.serialize('2026-09-02T09:54:33.000Z')).toBe('2026-09-02T09:54:33.000Z');
  });

  it('serialize throws on invalid input instead of returning null', () => {
    expect(() => DateTimeScalar.serialize('garbage')).toThrow(GraphQLError);
    expect(() => DateTimeScalar.serialize(42)).toThrow(GraphQLError);
    expect(() => DateTimeScalar.serialize(null)).toThrow(GraphQLError);
  });

  it('parseLiteral converts a STRING literal to a Date', () => {
    const result = DateTimeScalar.parseLiteral(
      { kind: Kind.STRING, value: '2026-09-02T09:54:33.000Z' },
      {},
    ) as Date;
    expect(result).toBeInstanceOf(Date);
    expect(result.toISOString()).toBe('2026-09-02T09:54:33.000Z');
  });

  it('parseLiteral throws on a non-string literal', () => {
    expect(() => DateTimeScalar.parseLiteral({ kind: Kind.INT, value: '123' }, {})).toThrow(
      GraphQLError,
    );
    expect(() => DateTimeScalar.parseLiteral({ kind: Kind.STRING, value: 'bad-date' }, {})).toThrow(
      GraphQLError,
    );
  });
});