import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../src/app';

describe('GET /api/health', () => {
  it('reports the service as up', async () => {
    const response = await request(createApp()).get('/api/health').expect(200);

    expect(response.body.status).toBe('ok');
    expect(response.body.data.service).toBe('margin-dashboard-api');
    expect(typeof response.body.data.uptimeSeconds).toBe('number');
  });

  it('answers an unknown endpoint with the error envelope', async () => {
    const response = await request(createApp()).get('/api/nope').expect(404);

    expect(response.body.status).toBe('error');
    expect(typeof response.body.message).toBe('string');
  });
});
