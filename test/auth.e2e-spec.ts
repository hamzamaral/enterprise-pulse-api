import { createHash } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';

const ADMIN = { email: 'admin@enterprisepulse.dev', password: 'Admin123!' };
const EMPLOYEE = { email: 'employee@enterprisepulse.dev', password: 'Employee123!' };

describe('Auth & authorization (e2e)', () => {
  let app: NestExpressApplication;

  const login = async (credentials: { email: string; password: string }) => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send(credentials)
      .expect(200);
    return { token: res.body.accessToken as string, cookies: res.get('Set-Cookie') ?? [] };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports health without authentication', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(res.body.status).toBe('ok');
  });

  it('rejects anonymous access to protected endpoints', async () => {
    await request(app.getHttpServer()).get('/api/v1/users').expect(401);
  });

  it('rejects wrong credentials with the standard error shape', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@enterprisepulse.dev', password: 'Wrong123!' })
      .expect(401);
    expect(res.body).toMatchObject({ statusCode: 401, error: 'UNAUTHORIZED' });
    expect(res.body.requestId).toBeDefined();
  });

  it('validates the login body', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'not-an-email' })
      .expect(400);
    expect(res.body.statusCode).toBe(400);
  });

  it('logs in, sets the refresh cookie and returns the session', async () => {
    const { token, cookies } = await login(ADMIN);
    expect(token).toEqual(expect.any(String));
    expect(cookies.join(';')).toMatch(/ep_refresh=.+HttpOnly/i);

    const me = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(me.body.user.email).toBe(ADMIN.email);
    expect(me.body.companies.length).toBeGreaterThan(0);
    // The demo admin uses the general manager's personnel record for self-service screens.
    expect(me.body.employeeId).toEqual(expect.any(String));
  });

  it('returns paginated lists', async () => {
    const { token } = await login(ADMIN);
    const res = await request(app.getHttpServer())
      .get('/api/v1/users?page=1&pageSize=5')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.data.length).toBeLessThanOrEqual(5);
    expect(res.body.meta).toMatchObject({ page: 1, pageSize: 5 });
    expect(res.body.data[0]).not.toHaveProperty('passwordHash');
  });

  it('forbids actions without permission', async () => {
    const { token } = await login(EMPLOYEE);
    await request(app.getHttpServer())
      .post('/api/v1/roles')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'hacker', name: 'Hacker', permissionCodes: ['users:delete'] })
      .expect(403);
  });

  it('rotates the refresh token and detects reuse', async () => {
    const { cookies } = await login(EMPLOYEE);

    const first = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookies)
      .expect(200);
    expect(first.body.accessToken).toEqual(expect.any(String));

    // A parallel tab may still present the cookie that was rotated a moment ago.
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookies)
      .expect(200);

    // Replaying it later means it was stolen: the request fails and the family is revoked.
    const prisma = app.get(PrismaService);
    const raw = /ep_refresh=([^;]+)/.exec(cookies.join(';'))![1];
    await prisma.refreshToken.update({
      where: { tokenHash: createHash('sha256').update(decodeURIComponent(raw)).digest('hex') },
      data: { revokedAt: new Date(Date.now() - 60_000) },
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookies)
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', first.get('Set-Cookie') ?? [])
      .expect(401);
  });

  it('ends every token of the session on logout', async () => {
    const { cookies } = await login(EMPLOYEE);
    const first = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookies)
      .expect(200);
    // The parallel-tab refresh hands out a second token of the same session.
    const sibling = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookies)
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Cookie', first.get('Set-Cookie') ?? [])
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', sibling.get('Set-Cookie') ?? [])
      .expect(401);
  });
});
