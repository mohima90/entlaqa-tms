import { describe, expect, it } from 'vitest';
import { ConfigurationError, readSettings } from './config';

const QUEUE = 'postgres://app_queue:pw@127.0.0.1:5432/postgres';
const WORKER = 'postgres://app_worker:pw@127.0.0.1:5432/postgres';
const env = { DATABASE_URL_APP_QUEUE: QUEUE, DATABASE_URL_APP_WORKER: WORKER };
const CA = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n';
const noCa = () => undefined;

describe('readSettings', () => {
  it('defaults to daemon mode with five jobs at a time', () => {
    expect(readSettings([], env, noCa)).toEqual({
      mode: 'daemon',
      queueUrl: QUEUE,
      workerUrl: WORKER,
      caPem: undefined,
      concurrency: 5,
    });
  });

  it('one-pass mode runs two jobs at a time unless configured', () => {
    expect(
      readSettings(['once'], { ...env, DATABASE_URL_APP_QUEUE: ` ${QUEUE} ` }, noCa),
    ).toMatchObject({ mode: 'once', queueUrl: QUEUE, concurrency: 2 });
    expect(readSettings(['once'], { ...env, WORKER_CONCURRENCY: '8' }, noCa).concurrency).toBe(8);
  });

  it('remote hosts need the CA', () => {
    const remote = {
      DATABASE_URL_APP_QUEUE: 'postgres://app_queue.ref:pw@pooler.example.com:5432/postgres',
      DATABASE_URL_APP_WORKER: 'postgres://app_worker.ref:pw@pooler.example.com:5432/postgres',
    };
    expect(readSettings(['once'], remote, () => CA).caPem).toBe(CA);
    expect(() => readSettings(['once'], remote, noCa)).toThrow(/DATABASE_CA_CERT/);
  });

  it('refuses an unknown mode, missing or wrong connections and a bad concurrency', () => {
    const fails = (argv: string[], values: NodeJS.ProcessEnv, pattern: RegExp) => {
      let error: unknown;
      try {
        readSettings(argv, values, noCa);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(ConfigurationError);
      expect((error as Error).message).toMatch(pattern);
    };
    fails(['tick'], env, /unknown mode/);
    fails([], { DATABASE_URL_APP_WORKER: WORKER }, /DATABASE_URL_APP_QUEUE/);
    fails([], { ...env, DATABASE_URL_APP_QUEUE: '  ' }, /DATABASE_URL_APP_QUEUE/);
    fails([], { DATABASE_URL_APP_QUEUE: QUEUE }, /DATABASE_URL_APP_WORKER/);
    fails([], { ...env, DATABASE_URL_APP_QUEUE: WORKER }, /app_queue/);
    fails([], { ...env, DATABASE_URL_APP_WORKER: QUEUE }, /app_worker/);
    for (const bad of ['0', '51', '2.5', 'many']) {
      fails([], { ...env, WORKER_CONCURRENCY: bad }, /WORKER_CONCURRENCY/);
    }
    expect(() =>
      readSettings([], env, () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- a non-Error throw is the case under test
        throw 'unreadable';
      }),
    ).toThrow('invalid configuration');
  });
});
