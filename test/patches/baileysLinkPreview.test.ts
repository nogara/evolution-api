import { getUrlInfo } from 'baileys';
import { afterEach, describe, expect, it, vi } from 'vitest';

const pageUrl = 'https://plain-page.example/article';
const pageWithoutImage =
  '<html><head><title>Plain page</title><meta name="description" content="No image here"></head><body>hi</body></html>';

describe('getUrlInfo for a page without an image', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the title and description without uploading a thumbnail', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const response = new Response(pageWithoutImage, { headers: { 'content-type': 'text/html' } });
        Object.defineProperty(response, 'url', { value: url });
        return response;
      }),
    );
    const uploadImage = vi.fn();

    const info = await getUrlInfo(pageUrl, { thumbnailWidth: 192, fetchOpts: { timeout: 3000 }, uploadImage } as any);

    expect(info).toMatchObject({ title: 'Plain page', description: 'No image here', 'matched-text': pageUrl });
    expect(info.jpegThumbnail).toBeUndefined();
    expect(uploadImage).not.toHaveBeenCalled();
  });
});
