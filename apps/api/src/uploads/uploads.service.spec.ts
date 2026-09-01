/// <reference types="jest" />
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UploadsService } from './uploads.service';

describe('UploadsService (local driver)', () => {
  let service: UploadsService;
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'uploads-test-'));
    const moduleRef = await Test.createTestingModule({
      providers: [
        UploadsService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => (key === 'UPLOAD_DIR' ? dir : undefined),
          },
        },
      ],
    }).compile();
    service = moduleRef.get(UploadsService);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('saves a png buffer and returns an uploads/ key', async () => {
    const key = await service.saveImage(Buffer.from([1, 2, 3]), 'image/png');
    expect(key).toMatch(/^uploads\/[0-9a-f-]{36}\.png$/);
    const saved = await readFile(join(dir, key.replace('uploads/', '')));
    expect(saved).toEqual(Buffer.from([1, 2, 3]));
  });

  it('resolveLocalPath only accepts keys under uploads/', () => {
    expect(service.resolveLocalPath('uploads/x.png')).toContain('x.png');
    expect(service.resolveLocalPath('http://evil/x.png')).toBeNull();
  });
});
