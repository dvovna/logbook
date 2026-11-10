import request from 'supertest';
import { createTestApp, ITestApp } from './support/test-app';

describe('Health check', () => {
  let t: ITestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  it('answers ok while the database is reachable', async () => {
    await request(t.app.getHttpServer())
      .get('/health')
      .expect(200, { status: 'ok' });
  });
});
