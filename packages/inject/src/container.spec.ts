import { describe, expect, it } from 'vitest';
import { Container, token } from './index';

const Url = token<string>('Url');
const RunKey = token<string>('RunKey');

class Http {
  constructor(readonly url: string) {}
}

class RunRepository {
  constructor(readonly http: Http) {}
}

class RunModel {
  constructor(
    readonly key: string,
    readonly repo: RunRepository
  ) {}
}

function app(): Container {
  return new Container()
    .value(Url, 'https://api')
    .singleton(Http, [Url])
    .singleton(RunRepository, [Http])
    .scoped(RunModel, [RunKey, RunRepository]);
}

describe('Container', () => {
  it('builds singletons once, from constructor deps', () => {
    const c = app();
    const repo = c.resolve(RunRepository);
    expect(repo.http.url).toBe('https://api');
    expect(c.resolve(RunRepository)).toBe(repo);
  });

  it('builds scoped bindings per child, with values the child provides', () => {
    const c = app();
    const a = c.child([[RunKey, 'a']]).resolve(RunModel);
    const b = c.child([[RunKey, 'b']]).resolve(RunModel);
    expect([a.key, b.key]).toEqual(['a', 'b']);
    expect(a.repo).toBe(b.repo);
  });

  it("won't let a singleton capture a value only a child provides", () => {
    const c = new Container().singleton(RunModel, [RunKey, RunRepository]).singleton(RunRepository, [Http]);
    expect(() => c.child([[RunKey, 'a']]).resolve(RunModel)).toThrow(/Nothing provides RunKey/);
  });

  it('names the chain when something is missing', () => {
    const c = new Container().singleton(RunRepository, [Http]).singleton(Http, [Url]);
    expect(() => c.resolve(RunRepository)).toThrow('Nothing provides Url (needed by RunRepository → Http)');
  });

  it('builds classes without constructor parameters unbound, once', () => {
    class Plain {}
    const c = new Container();
    expect(c.resolve(Plain)).toBe(c.resolve(Plain));
  });

  it('reports cycles', () => {
    class A {
      constructor(readonly b: unknown) {}
    }
    class B {
      constructor(readonly a: unknown) {}
    }
    const c = new Container().singleton(A, [B]).singleton(B, [A]);
    expect(() => c.resolve(A)).toThrow('Circular dependency: A → B → A');
  });

  it('rejects deps that do not match the constructor', () => {
    // @ts-expect-error Url is a string; RunRepository needs an Http
    new Container().singleton(RunRepository, [Url]);
  });
});
