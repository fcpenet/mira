import request from 'supertest';
import app from '../../app';

jest.mock('../../db', () => ({
  query: jest.fn(),
  queryAsOrg: jest.fn(),
  pool: { query: jest.fn() },
}));

jest.mock('../../redis', () => ({
  publisher: { publish: jest.fn().mockResolvedValue(1) },
  subscriber: { subscribe: jest.fn(), on: jest.fn() },
  CHANNEL: 'mira:events',
}));

describe('MIRASRV sticky session cookie', () => {
  function getCookies(res: request.Response): string[] {
    const raw = res.headers['set-cookie'];
    if (!raw) return [];
    return Array.isArray(raw) ? raw : [raw as unknown as string];
  }

  it('sets MIRASRV cookie on a response when not already present', async () => {
    const res = await request(app).get('/health');

    const cookies = getCookies(res);
    expect(cookies.some(c => c.startsWith('MIRASRV='))).toBe(true);
  });

  it('cookie is HttpOnly', async () => {
    const res = await request(app).get('/health');

    const mirasrv = getCookies(res).find(c => c.startsWith('MIRASRV='));
    expect(mirasrv).toMatch(/HttpOnly/i);
  });

  it('cookie has SameSite=Strict', async () => {
    const res = await request(app).get('/health');

    const mirasrv = getCookies(res).find(c => c.startsWith('MIRASRV='));
    expect(mirasrv).toMatch(/SameSite=Strict/i);
  });

  it('does not reset the cookie when MIRASRV is already present', async () => {
    const res = await request(app)
      .get('/health')
      .set('Cookie', 'MIRASRV=app1');

    const cookies = getCookies(res);
    expect(cookies.some(c => c.startsWith('MIRASRV='))).toBe(false);
  });

  it('cookie is present on non-health routes too', async () => {
    const res = await request(app).get('/events');

    // 401 because no auth, but cookie should still be set
    expect(res.status).toBe(401);
    const cookies = getCookies(res);
    expect(cookies.some(c => c.startsWith('MIRASRV='))).toBe(true);
  });
});
